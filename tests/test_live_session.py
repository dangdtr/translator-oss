import asyncio
import json

import pytest

from server.live_protocol import ProtocolError, audio_frame, command, read_audio_frame
from server.live_session import InputBackpressure, LiveSession
from server.live_transcript import Transcript


class Browser:
    def __init__(self):
        self.messages = []
        self.audio = []
        self.incoming = asyncio.Queue()
        self.closed = False

    async def send_json(self, message):
        self.messages.append(message)

    async def send_bytes(self, data):
        self.audio.append(data)

    async def receive(self):
        return await self.incoming.get()

    async def close(self, code):
        self.closed = True


class Gemini:
    def __init__(self, blocked=False):
        self.sent = []
        self.incoming = asyncio.Queue()
        self.closed = False
        self.setup = asyncio.Event()
        if not blocked:
            self.setup.set()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def send(self, data):
        self.sent.append(json.loads(data))

    async def recv(self):
        await self.setup.wait()
        return '{"setupComplete": {}}'

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self.incoming.get()
        if isinstance(message, Exception):
            raise message
        return json.dumps(message)


def control(kind, epoch, **fields):
    return dict(type=kind, epoch=epoch, sessionId='test-session',
                requestId=str(epoch), protocolVersion=2, **fields)


async def until(check):
    async with asyncio.timeout(3):
        while not check():
            await asyncio.sleep(.001)


def test_protocol_rejects_bad_headers_and_controls():
    assert read_audio_frame(audio_frame(7, 3, b'\x00\x01')) == (7, 3, b'\x00\x01')
    for data in (b'', b'123456789', b'x' * 64010):
        with pytest.raises(ProtocolError):
            read_audio_frame(data)
    for message in (control('start', True), control('start', -1),
                    {**control('start', 0), 'protocolVersion': 1}, {'type': 'start'},
                    control('unknown', 0)):
        with pytest.raises(ProtocolError):
            command(message)


def test_transcript_streams_partials_deduplicates_and_resets_turn():
    transcript = Transcript()
    assert transcript.apply({'original': 'Hello', 'translation': 'Xin'})['translation'] == 'Xin'
    assert transcript.apply({'original': ' world.', 'translation': ' chào.'})['translation'] == 'Xin chào.'
    assert transcript.apply({'translation': 'Xin chào.'})['translation'] == 'Xin chào.'
    transcript.apply({'complete': True})
    assert transcript.apply({'translation': 'Tiếp theo'})['translation'] == 'Tiếp theo'
    assert len(transcript.apply({'translation': 'x' * 5000})['translation']) == 4000


def test_seek_pause_resume_keep_local_socket_and_discard_old_epochs(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')

    async def scenario():
        browser, sockets = Browser(), []
        def connector(*args, **kwargs):
            socket = Gemini()
            sockets.append(socket)
            return socket
        session = LiveSession(browser, connector=connector)
        try:
            await session.control(control('start', 0))
            await until(lambda: session.ready)
            await session.input(audio_frame(0, 0, bytes(3200)))
            await until(lambda: len(sockets[0].sent) == 2)
            await sockets[0].incoming.put({'serverContent': {
                'outputTranscription': {'text': 'Xin'},
                'modelTurn': {'parts': [{'inlineData': {'mimeType': 'audio/pcm', 'data': 'AAA='}}]}}})
            await until(lambda: len(browser.audio) == 1)
            old_generation = session.generation
            await session.control(control('seek', 1, paused=True))
            assert sockets[0].closed and session.paused and session.worker is None
            await session.send({'type': 'caption', 'translation': 'stale'}, old_generation)
            assert not any(m.get('translation') == 'stale' for m in browser.messages)
            await session.control(control('seek', 2, paused=False))
            await until(lambda: session.ready)
            await session.input(audio_frame(0, 1, bytes(3200)))
            assert session.queue.empty()
            await session.control(control('pause', 3))
            await session.control(control('resume', 4))
            await until(lambda: session.ready)
            assert len(sockets) == 3 and not browser.closed
            await session.control(control('stop', 4))
            assert session.worker is None and all(s.closed for s in sockets)
        finally:
            await session.cancel_worker()
    asyncio.run(scenario())


def test_seek_and_stop_cancel_pending_setup(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    async def scenario():
        sockets = []
        def connector(*args, **kwargs):
            socket = Gemini(blocked=True)
            sockets.append(socket)
            return socket
        session = LiveSession(Browser(), connector=connector)
        await session.control(control('start', 0))
        await until(lambda: len(sockets) == 1)
        await session.control(control('seek', 1, paused=True))
        assert sockets[0].closed
        await session.control(control('seek', 2, paused=False))
        await until(lambda: len(sockets) == 2)
        await session.control(control('stop', 2))
        assert sockets[1].closed and session.worker is None
    asyncio.run(scenario())


def test_upstream_failure_reconnects_without_closing_browser(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    async def scenario():
        browser, sockets = Browser(), []
        def connector(*args, **kwargs):
            socket = Gemini()
            sockets.append(socket)
            return socket
        session = LiveSession(browser, connector=connector)
        try:
            await session.control(control('start', 0))
            await until(lambda: session.ready)
            await sockets[0].incoming.put(OSError())
            await until(lambda: len(sockets) == 2 and session.ready)
            assert any(m.get('state') == 'reconnecting' for m in browser.messages)
            assert not browser.closed
            await session.control(control('pause', 1))
            assert session.paused and session.worker is None
        finally:
            await session.cancel_worker()
    asyncio.run(scenario())


def test_queue_is_bounded_and_stale_frames_do_not_enter_it():
    async def scenario():
        session = LiveSession(Browser())
        session.epoch, session.ready = 2, True
        await session.input(audio_frame(1, 0, bytes(3200)))
        assert session.queue.empty()
        for seq in range(10):
            await session.input(audio_frame(2, seq, bytes(3200)))
        with pytest.raises(InputBackpressure):
            await session.input(audio_frame(2, 10, bytes(3200)))
        assert session.queue.qsize() == 10
    asyncio.run(scenario())


def test_browser_disconnect_cancels_gemini(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    async def scenario():
        browser, gemini = Browser(), Gemini()
        session = LiveSession(browser, connector=lambda *a, **kw: gemini)
        task = asyncio.create_task(session.run())
        await browser.incoming.put({'type': 'websocket.receive', 'text': json.dumps(control('start', 0))})
        await until(lambda: session.ready)
        await browser.incoming.put({'type': 'websocket.disconnect'})
        await task
        assert gemini.closed and session.worker is None
    asyncio.run(scenario())


def test_missing_key_is_actionable_without_exposing_details(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    async def scenario():
        browser = Browser()
        session = LiveSession(browser)
        try:
            await session.control(control('start', 0))
            await until(lambda: any(m.get('type') == 'error' for m in browser.messages))
            assert browser.messages[-1]['code'] == 'MissingGeminiKey'
        finally:
            await session.cancel_worker()
    asyncio.run(scenario())


def test_pause_during_reconnect_prevents_automatic_restart(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    async def scenario():
        browser, sockets = Browser(), []
        def connector(*args, **kwargs):
            socket = Gemini()
            sockets.append(socket)
            return socket
        session = LiveSession(browser, connector=connector)
        try:
            await session.control(control('start', 0))
            await until(lambda: session.ready)
            await sockets[0].incoming.put(OSError())
            await until(lambda: any(m.get('state') == 'reconnecting' for m in browser.messages))
            await session.control(control('pause', 1))
            await asyncio.sleep(.6)
            assert session.paused and not session.ready and len(sockets) == 1
            await session.control(control('resume', 2))
            await until(lambda: session.ready)
            assert len(sockets) == 2
        finally:
            await session.cancel_worker()
    asyncio.run(scenario())


def test_v2_endpoint_handles_audio_and_controls_on_one_connection(monkeypatch):
    from fastapi.testclient import TestClient
    from server.app import TOKEN, app
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    sockets = []
    class EchoGemini(Gemini):
        async def send(self, data):
            await super().send(data)
            if 'realtimeInput' in json.loads(data):
                await self.incoming.put({'serverContent': {
                    'inputTranscription': {'text': 'Hello'},
                    'outputTranscription': {'text': 'Xin chào'},
                    'modelTurn': {'parts': [{'inlineData': {'mimeType': 'audio/pcm', 'data': 'AAA='}}]}}})
    def connector(*args, **kwargs):
        socket = EchoGemini()
        sockets.append(socket)
        return socket
    monkeypatch.setattr('server.live_session.connect', connector)
    with TestClient(app).websocket_connect(f'/live/translate?token={TOKEN}&protocol=2') as ws:
        ws.send_json(control('start', 0))
        assert ws.receive_json()['type'] == 'ack'
        assert ws.receive_json()['state'] == 'connecting'
        assert ws.receive_json()['state'] == 'ready'
        ws.send_bytes(audio_frame(0, 0, bytes(3200)))
        assert ws.receive_json()['translation'] == 'Xin chào'
        assert read_audio_frame(ws.receive_bytes()) == (0, 0, bytes(2))
        ws.send_json(control('pause', 1))
        assert ws.receive_json()['type'] == 'ack'
        assert ws.receive_json()['state'] == 'paused'
        ws.send_json(control('resume', 2))
        assert ws.receive_json()['type'] == 'ack'
        assert ws.receive_json()['state'] == 'connecting'
        assert ws.receive_json()['state'] == 'ready'
        ws.send_bytes(audio_frame(0, 1, bytes(3200)))  # stale input is ignored
        ws.send_bytes(audio_frame(2, 0, bytes(3200)))
        assert ws.receive_json()['epoch'] == 2
        assert read_audio_frame(ws.receive_bytes())[0] == 2
        ws.send_json(control('stop', 2))
        assert ws.receive_json()['type'] == 'ack'
        assert ws.receive_json()['state'] == 'stopped'
    assert len(sockets) == 2 and all(s.closed for s in sockets)
