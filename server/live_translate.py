"""Gemini Live audio translation bridge.

The browser-facing protocol intentionally carries audio bytes and small status
messages only. Gemini credentials and errors remain on the local backend.
"""

import asyncio
import base64
import json
import os
import time
from urllib.parse import quote

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from server.perf import log as perf_log


MODEL = os.environ.get('GEMINI_LIVE_MODEL', 'gemini-3.5-live-translate-preview')
ENDPOINT = (
    'wss://generativelanguage.googleapis.com/ws/'
    'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
)
DEFAULT_LIVE_VOICE = 'Aoede'
DEFAULT_LIVE_PROMPT = (
    'Bạn là thông dịch viên AI thời gian thực sang tiếng Việt. '
    'Hãy dịch chính xác, giữ giọng đọc tiếng Việt tự nhiên, truyền cảm, '
    'phát âm chuẩn xác, rõ ràng và nhất quán theo ngữ cảnh.'
)


class LiveAPIError(Exception):
    """An intentionally detail-free error exposed to the browser."""


def live_config():
    """Return the dedicated audio-to-Vietnamese Live session configuration."""
    return {
        'response_modalities': ['AUDIO'],
        'translation_config': {
            'target_language_code': 'vi',
            'echo_target_language': False,
        },
    }


def safe_error(error):
    """Describe an error without exposing its message, audio, or credentials."""
    return {'type': 'error', 'code': type(error).__name__}


def browser_close_for(error):
    """Map a bridge failure to a browser close.

    A Gemini socket reset is not a fatal Live error: the extension keeps the
    tab capture and opens a new session. Other failures still return a
    type-only error payload.
    """
    if isinstance(error, ConnectionClosed):
        return 1001, None
    return 1011, safe_error(error)


def setup_message(voice_name=None, system_instruction=None):
    """Build the raw v1beta setup frame expected by Live Translate."""
    config = live_config()
    model = MODEL if MODEL.startswith('models/') else f'models/{MODEL}'
    voice = voice_name or os.environ.get('GEMINI_LIVE_VOICE', DEFAULT_LIVE_VOICE)
    prompt = system_instruction or os.environ.get('GEMINI_LIVE_PROMPT', DEFAULT_LIVE_PROMPT)

    setup = {
        'model': model,
        # The v1beta endpoint currently accepts transcription switches on
        # setup (the SDK config is flattened here), while translationConfig
        # remains inside generationConfig.
        'inputAudioTranscription': {},
        'outputAudioTranscription': {},
        'contextWindowCompression': {'slidingWindow': {}},
        'generationConfig': {
            'responseModalities': config['response_modalities'],
            'speechConfig': {
                'voiceConfig': {
                    'prebuiltVoiceConfig': {
                        'voiceName': voice,
                    }
                }
            },
            'translationConfig': {
                'targetLanguageCode': config['translation_config']['target_language_code'],
                'echoTargetLanguage': config['translation_config']['echo_target_language'],
            },
        },
    }
    if prompt:
        setup['systemInstruction'] = {
            'parts': [{'text': prompt}]
        }
    return {'setup': setup}


def realtime_audio_message(data):
    """Build one raw realtime PCM input frame with JSON-safe base64 data."""
    return {
        'realtimeInput': {
            'audio': {
                'mimeType': 'audio/pcm;rate=16000',
                'data': base64.b64encode(data).decode('ascii'),
            }
        }
    }


def _decode_message(raw):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8')
    try:
        message = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LiveAPIError from error
    if not isinstance(message, dict):
        raise LiveAPIError
    return message


def _output_audio(message):
    parts = (
        message.get('serverContent', {})
        .get('modelTurn', {})
        .get('parts', [])
    )
    for part in parts:
        inline = part.get('inlineData') if isinstance(part, dict) else None
        if not isinstance(inline, dict) or not str(inline.get('mimeType', '')).startswith('audio/'):
            continue
        try:
            yield base64.b64decode(inline['data'], validate=True)
        except (KeyError, TypeError, ValueError) as error:
            raise LiveAPIError from error


def transcription_update(message):
    """Return a content-only browser update for the latest transcript chunks."""
    content = message.get('serverContent')
    if not isinstance(content, dict):
        return None
    update = {'type': 'transcript'}
    for field, output in (('inputTranscription', 'original'), ('outputTranscription', 'translation')):
        transcript = content.get(field)
        text = transcript.get('text') if isinstance(transcript, dict) else None
        if isinstance(text, str) and text.strip():
            update[output] = text[:4000]
    if content.get('turnComplete') is True:
        update['complete'] = True
    return update if len(update) > 1 else None


async def _send_browser_audio(websocket, gemini_socket, metrics):
    while True:
        message = await websocket.receive()
        if message['type'] == 'websocket.disconnect':
            return
        data = message.get('bytes')
        if data is None:
            raise ValueError('Live Translate accepts binary PCM audio only')
        if data:
            metrics['input_bytes'] += len(data)
            await gemini_socket.send(json.dumps(realtime_audio_message(data), separators=(',', ':')))


async def _send_gemini_audio(websocket, gemini_socket, metrics):
    async for raw in gemini_socket:
        message = _decode_message(raw)
        if 'error' in message:
            raise LiveAPIError
        update = transcription_update(message)
        if update:
            await websocket.send_json(update)
        for audio in _output_audio(message):
            metrics['output_bytes'] += len(audio)
            await websocket.send_bytes(audio)


async def run_live_translation(websocket: WebSocket, metrics=None, voice=None, prompt=None):
    """Relay PCM16 audio between one browser WebSocket and one Gemini session."""
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        raise RuntimeError('GEMINI_API_KEY is not configured')
    metrics = metrics if metrics is not None else {'input_bytes': 0, 'output_bytes': 0}

    url = f'{ENDPOINT}?key={quote(api_key, safe="")}'
    async with connect(url, max_size=16 * 1024 * 1024) as gemini_socket:
        await gemini_socket.send(json.dumps(setup_message(voice_name=voice, system_instruction=prompt), separators=(',', ':')))
        setup_response = _decode_message(await asyncio.wait_for(gemini_socket.recv(), timeout=15))
        if 'setupComplete' not in setup_response:
            raise LiveAPIError
        await websocket.send_json({'type': 'ready'})
        tasks = {
            asyncio.create_task(_send_browser_audio(websocket, gemini_socket, metrics)),
            asyncio.create_task(_send_gemini_audio(websocket, gemini_socket, metrics)),
        }
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            task.result()


async def serve_live_translation(websocket: WebSocket, voice=None, prompt=None):
    """Run the bridge and keep external failures privacy-safe."""
    if websocket.query_params.get('protocol') == '2':
        from server.live_session import LiveSession
        await LiveSession(websocket, voice, prompt).run()
        return
    started = time.perf_counter()
    metrics = {'input_bytes': 0, 'output_bytes': 0}
    status = 'closed'
    try:
        await run_live_translation(websocket, metrics, voice=voice, prompt=prompt)
    except WebSocketDisconnect:
        status = 'disconnected'
        return
    except Exception as error:
        status = type(error).__name__
        code, payload = browser_close_for(error)
        if payload:
            try:
                await websocket.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                pass
        try:
            await websocket.close(code=code)
        except RuntimeError:
            pass
    finally:
        perf_log(
            'live_session',
            ms=round((time.perf_counter() - started) * 1000),
            input_bytes=metrics['input_bytes'],
            output_bytes=metrics['output_bytes'],
            status=status,
            model=MODEL,
        )
