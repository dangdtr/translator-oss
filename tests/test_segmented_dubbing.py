import io
import asyncio
import wave
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from server import segmented_dubbing as dub


def segment(*args, **kwargs):
    return asyncio.run(dub.segment(*args, **kwargs))


def wav(seconds=1):
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(b'\0\0' * int(16000 * seconds))
    return output.getvalue()


@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    monkeypatch.setenv('GEMINI_API_KEY', 'test')
    monkeypatch.setattr(dub, 'CACHE', tmp_path)
    calls = []
    monkeypatch.setattr(dub, 'resolve_source', lambda *a, **kw: {'duration': 25})
    monkeypatch.setattr(dub, 'extract_audio', lambda source, start, duration:
                        calls.append((start, duration)) or wav(duration))
    monkeypatch.setattr(dub, 'translate_audio', lambda audio:
                        {'original': 'Hello', 'translation': 'Xin chào'})
    monkeypatch.setattr(dub, 'synthesize', lambda text: wav(2))
    return calls


def test_timeline_cache_and_last_segment(pipeline):
    first = segment('jNQXAC9IVRw', 1)
    assert (first['start'], first['end'], first['voiceDuration']) == (12, 24, 2)
    assert first['audio'] and not first['cached']
    assert segment('jNQXAC9IVRw', 1)['cached']
    last = segment('jNQXAC9IVRw', 2)
    assert last['end'] == 25
    assert pipeline == [(12, 12), (24, 1)]
    with pytest.raises(HTTPException) as error:
        segment('jNQXAC9IVRw', 3)
    assert error.value.status_code == 416


def test_progress_includes_real_pipeline_stages_and_cache(pipeline):
    stages = []
    segment('jNQXAC9IVRw', 0, progress=stages.append)
    assert stages == ['queued', 'source', 'extract', 'translate', 'tts', 'ready']
    stages.clear()
    segment('jNQXAC9IVRw', 0, progress=stages.append)
    assert stages == ['queued', 'ready']


def test_progress_status_auth_and_completion(pipeline):
    from server.app import app, TOKEN
    client = TestClient(app)
    headers = {'Authorization': 'Bearer ' + TOKEN}
    assert client.get('/dubbing/status/test-job').status_code == 401
    result = client.post('/dubbing/segment', headers=headers,
                         json={'video_id': 'jNQXAC9IVRw', 'index': 0, 'job_id': 'test-job'})
    assert result.status_code == 200
    state = client.get('/dubbing/status/test-job', headers=headers).json()
    assert state['stage'] == 'ready' and state['elapsedSeconds'] >= 0
    assert 'audio' not in state and 'translation' not in state


def test_silence_skips_tts(pipeline, monkeypatch):
    monkeypatch.setattr(dub, 'translate_audio', lambda audio: {'original': '', 'translation': ''})
    monkeypatch.setattr(dub, 'synthesize', lambda text: pytest.fail('must not synthesize silence'))
    result = segment('jNQXAC9IVRw', 0)
    assert result['audio'] == '' and result['voiceDuration'] == 0


def test_provider_failure_not_cached_or_leaked(pipeline, monkeypatch):
    def fail(text):
        raise RuntimeError('secret api key / signed URL')
    monkeypatch.setattr(dub, 'synthesize', fail)
    with pytest.raises(HTTPException) as error:
        segment('jNQXAC9IVRw', 0)
    assert error.value.status_code == 502
    assert 'secret' not in error.value.detail
    assert not list(dub.CACHE.glob('*.json'))


def test_cache_changes_with_voice(pipeline, monkeypatch):
    segment('jNQXAC9IVRw', 0)
    monkeypatch.setenv('GEMINI_DUB_VOICE', 'Puck')
    assert not segment('jNQXAC9IVRw', 0)['cached']
    assert len(pipeline) == 2


def test_fast_default_reuses_existing_flash_voice_cache(pipeline, monkeypatch):
    monkeypatch.setenv('GEMINI_DUB_TRANSLATION_MODEL', 'gemini-3.8-flash')
    segment('jNQXAC9IVRw', 0)
    monkeypatch.delenv('GEMINI_DUB_TRANSLATION_MODEL')
    assert segment('jNQXAC9IVRw', 0)['cached']
    assert len(pipeline) == 1


def test_auth_and_validation(pipeline):
    from server.app import app, TOKEN
    client = TestClient(app)
    assert client.post('/dubbing/segment', json={'video_id': 'jNQXAC9IVRw', 'index': 0}).status_code == 401
    headers = {'Authorization': 'Bearer ' + TOKEN}
    for video_id, index in [('https://localhost', 0), ('jNQXAC9IVRw', -1), ('jNQXAC9IVRw', True)]:
        assert client.post('/dubbing/segment', headers=headers,
                           json={'video_id': video_id, 'index': index}).status_code == 422
    result = client.post('/dubbing/segment', headers=headers, json={'video_id': 'jNQXAC9IVRw', 'index': 0})
    assert result.status_code == 200 and result.json()['translation'] == 'Xin chào'


def test_missing_key(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    with pytest.raises(HTTPException) as error:
        segment('jNQXAC9IVRw', 0)
    assert error.value.status_code == 503


def test_cancel_during_translation_does_not_start_tts_or_cache(pipeline, monkeypatch):
    async def run():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def waiting_translation(audio):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        monkeypatch.setattr(dub, 'translate_audio', waiting_translation)
        monkeypatch.setattr(dub, 'synthesize', lambda text: pytest.fail('cancelled request must not run TTS'))
        task = asyncio.create_task(dub.segment('jNQXAC9IVRw', 0))
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled.is_set()
        assert not list(dub.CACHE.glob('*.json'))
        # The cancelled task also releases its lock for an immediate fresh attempt.
        monkeypatch.setattr(dub, 'translate_audio', lambda audio: {'original': '', 'translation': ''})
        assert (await asyncio.wait_for(dub.segment('jNQXAC9IVRw', 0), 1))['voiceDuration'] == 0
    asyncio.run(run())


def test_ffmpeg_local_segment(tmp_path):
    source = tmp_path / 'source.wav'
    source.write_bytes(wav(3))
    result = dub.extract_audio({'path': str(source)}, 1, 1)
    # FFmpeg pipe WAV uses an unspecified length; actual payload is one second.
    assert result.startswith(b'RIFF') and 32000 <= len(result) <= 33000


def test_successful_exit_with_truncated_audio_is_rejected(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(dub.subprocess, 'run', lambda *args, **kw: SimpleNamespace(stdout=wav(0.2)))
    with pytest.raises(HTTPException) as error:
        dub.extract_audio({'path': 'source'}, 60, 12)
    assert error.value.status_code == 502
