from fastapi.testclient import TestClient
import pytest

from server.app import TOKEN, app
from websockets.exceptions import ConnectionClosed

from server.live_translate import (
    ENDPOINT,
    browser_close_for,
    live_config,
    realtime_audio_message,
    safe_error,
    setup_message,
    transcription_update,
)


def test_live_config_targets_vietnamese_audio():
    config = live_config()
    assert config['response_modalities'] == ['AUDIO']
    assert config['translation_config']['target_language_code'] == 'vi'


def test_safe_error_does_not_expose_message_or_key():
    assert safe_error(ValueError('secret-key')) == {'type': 'error', 'code': 'ValueError'}


def test_gemini_socket_reset_asks_the_browser_to_reconnect():
    assert browser_close_for(ConnectionClosed(None, None)) == (1001, None)
    code, payload = browser_close_for(ValueError('secret-key'))
    assert code == 1011
    assert payload == {'type': 'error', 'code': 'ValueError'}


def test_setup_message_uses_raw_live_translate_protocol():
    assert '.v1beta.' in ENDPOINT
    setup = setup_message()['setup']
    assert setup['model'] == 'models/gemini-3.5-live-translate-preview'
    assert setup['generationConfig']['responseModalities'] == ['AUDIO']
    assert setup['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName'] == 'Aoede'
    assert setup['generationConfig']['translationConfig'] == {
        'targetLanguageCode': 'vi',
        'echoTargetLanguage': False,
    }
    assert 'systemInstruction' in setup
    assert setup['inputAudioTranscription'] == {}
    assert setup['outputAudioTranscription'] == {}
    assert setup['contextWindowCompression'] == {'slidingWindow': {}}


def test_setup_message_custom_voice_and_prompt():
    setup = setup_message(voice_name='Charon', system_instruction='Giọng nam trầm ấm')['setup']
    assert setup['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName'] == 'Charon'
    assert setup['systemInstruction']['parts'][0]['text'] == 'Giọng nam trầm ấm'


def test_realtime_audio_message_base64_encodes_pcm():
    message = realtime_audio_message(b'\x00\x01')['realtimeInput']['audio']
    assert message == {
        'mimeType': 'audio/pcm;rate=16000',
        'data': 'AAE=',
    }


def test_transcription_update_keeps_original_and_translation_separate():
    message = {'serverContent': {
        'inputTranscription': {'text': ' Hello world. '},
        'outputTranscription': {'text': ' Xin chào thế giới. '},
    }}
    assert transcription_update(message) == {
        'type': 'transcript',
        'original': ' Hello world. ',
        'translation': ' Xin chào thế giới. ',
    }
    assert transcription_update({'serverContent': {'turnComplete': True}}) == {
        'type': 'transcript', 'complete': True,
    }


def test_live_metric_contains_only_aggregate_fields(tmp_path, monkeypatch):
    from server import perf

    monkeypatch.setattr(perf, 'PATH', tmp_path / 'perf.jsonl')
    perf.log('live_session', ms=1200, input_bytes=32000, output_bytes=48000, status='closed')
    recorded = (tmp_path / 'perf.jsonl').read_text(encoding='utf-8')
    assert 'input_bytes' in recorded and 'output_bytes' in recorded
    assert 'transcript' not in recorded and 'api_key' not in recorded


def test_live_websocket_rejects_invalid_token():
    with pytest.raises(Exception) as closed:
        with TestClient(app).websocket_connect('/live/translate?token=wrong') as websocket:
            websocket.receive_json()
    assert getattr(closed.value, 'code', None) == 1008


def test_live_websocket_dispatches_authorized_session(monkeypatch):
    async def fake_bridge(websocket, voice=None, prompt=None):
        await websocket.send_json({'type': 'ready'})

    monkeypatch.setattr('server.app.serve_live_translation', fake_bridge)
    with TestClient(app).websocket_connect(f'/live/translate?token={TOKEN}') as websocket:
        assert websocket.receive_json() == {'type': 'ready'}
