from fastapi.testclient import TestClient
from server.app import app, ROOT, TOKEN, find_engine, split_text, voice_path
from server.vieneu_client import vieneu
import io
import wave
import pytest

client = TestClient(app)
headers = {'Authorization': 'Bearer ' + TOKEN}


def test_local_api_requires_token():
    assert client.post('/translate', json={'texts': ['Hello']}).status_code == 401
    assert client.post('/tts', json={'text': 'Hello'}).status_code == 401
    assert client.post('/translate', headers={'Authorization': 'Bearer wrong'}, json={'texts': ['Hello']}).status_code == 401


def test_health_reports_gemini_caption_polish_capability(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    data = client.get('/health').json()['caption_polish']
    assert data['provider'] == 'gemini' and data['auto_cc_only'] is True


def test_reject_unsupported_languages_and_unbounded_requests():
    assert client.post('/translate', headers=headers, json={'texts': ['hello'], 'source': 'ja'}).status_code == 400
    assert client.post('/translate', headers=headers, json={'texts': ['a' * 6001]}).status_code == 413
    assert client.post('/translate', headers=headers, json={'texts': []}).status_code == 422
    assert client.post('/tts', headers=headers, json={'text': 'a' * 1501}).status_code == 422


def test_plain_websites_do_not_get_cors_access():
    response = client.options('/translate', headers={'Origin': 'https://example.com', 'Access-Control-Request-Method': 'POST'})
    assert 'access-control-allow-origin' not in response.headers


def test_translation_chunking_preserves_text_without_overlong_chunks():
    value = 'Hello world. ' + 'word ' * 300 + 'x' * 1000
    chunks = split_text(value)
    assert all(0 < len(chunk) <= 350 for chunk in chunks)
    assert ''.join(chunks).replace(' ', '') == value.replace(' ', '')


def test_engine_batches_and_prefers_envit5_when_installed():
    engine = find_engine()
    if engine is None:
        pytest.skip('Local model not installed')
    envit5 = (ROOT / 'models/envit5-translation/model.bin').exists()
    assert engine.name == ('envit5' if envit5 else 'opus-mt')
    body = {'texts': ['AWS Lambda lets you run code without provisioning or managing servers.', '', 'See you in the next one!']}
    result = client.post('/translate', headers=headers, json=body).json()['translations']
    assert result[0].startswith('AWS Lambda') and result[1] == '' and 'cậu' not in result[2]


@pytest.mark.skipif(find_engine() is None, reason='Local model not installed')
def test_real_translation_and_cache():
    body = {'texts': ['Hello. Welcome to this video.']}
    first = client.post('/translate', headers=headers, json=body)
    assert first.status_code == 200
    translated = first.json()['translations'][0]
    assert '▁' not in translated
    assert translated != body['texts'][0]
    assert 'chào' in translated.lower()
    assert client.post('/translate', headers=headers, json=body).json() == first.json()


@pytest.mark.skipif(not voice_path().exists(), reason='Local voice not installed')
def test_real_vietnamese_audio():
    response = client.post('/tts', headers=headers, json={'text': 'Xin chào. Đây là giọng đọc tiếng Việt.'})
    assert response.status_code == 200
    with wave.open(io.BytesIO(response.content)) as audio:
        assert audio.getnframes() > audio.getframerate()
        assert audio.getnchannels() == 1


@pytest.mark.skipif(not voice_path().exists(), reason='Local voice not installed')
def test_tts_voice_choice_reports_engine():
    fast = client.post('/tts', headers=headers, json={'text': 'Xin chào các bạn.', 'voice': 'piper'})
    assert fast.headers['x-voice-engine'] == 'piper'
    with wave.open(io.BytesIO(fast.content)) as audio:
        assert audio.getframerate() == 22050
    natural = client.post('/tts', headers=headers, json={'text': 'Xin chào các bạn.'})
    expected = 'vieneu' if vieneu.installed() else 'piper'
    assert natural.headers['x-voice-engine'] == expected
    with wave.open(io.BytesIO(natural.content)) as audio:
        assert audio.getframerate() == (48000 if expected == 'vieneu' else 22050) and audio.getnframes() > audio.getframerate() // 2
    explicit_vieneu = client.post('/tts', headers=headers, json={'text': 'Xin chào các bạn.', 'voice': 'vieneu'})
    assert explicit_vieneu.status_code == 200
    assert client.post('/tts', headers=headers, json={'text': 'x', 'voice': 'loud'}).status_code == 422
