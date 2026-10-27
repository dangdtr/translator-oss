"""Own Gemini lifecycle while preserving the browser's local WebSocket."""
import asyncio
import json
import os
import time
from contextlib import suppress
from urllib.parse import quote

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from starlette.websockets import WebSocketDisconnect

from server.live_protocol import ProtocolError, audio_frame, command, read_audio_frame
from server.live_transcript import Transcript
from server.live_translate import (ENDPOINT, LiveAPIError, _decode_message,
                                   _output_audio, realtime_audio_message,
                                   setup_message, transcription_update)
from server.perf import log


class MissingGeminiKey(Exception):
    pass


class InputBackpressure(Exception):
    pass


class LiveSession:
    def __init__(self, browser, voice=None, prompt=None, connector=None):
        self.browser = browser
        self.voice, self.prompt = voice, prompt
        self.connector = connector or connect
        self.session_id = None
        self.epoch = -1
        self.generation = 0
        self.worker = None
        self.closed = False
        self.paused = False
        self.ready = False
        self.queue = asyncio.Queue(maxsize=10)  # at most one second of 100-ms frames
        self.send_lock = asyncio.Lock()
        self.input_seq = -1
        self.output_seq = 0
        self.input_bytes = self.output_bytes = 0
        self.first_input_at = None
        self.first_output = False

    async def send(self, payload, generation=None):
        async with self.send_lock:
            if self.closed or (generation is not None and generation != self.generation):
                return
            await asyncio.wait_for(self.browser.send_json({**payload, 'sessionId': self.session_id,
                                                          'epoch': self.epoch}), 10)

    async def cancel_worker(self):
        self.generation += 1
        self.ready = False
        if self.worker:
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
            self.worker = None
        self.queue = asyncio.Queue(maxsize=10)
        self.input_seq = -1
        self.output_seq = 0
        self.first_input_at = None
        self.first_output = False

    async def control(self, raw):
        message = command(raw)
        kind = message['type']
        if self.session_id is None:
            if kind != 'start':
                raise ProtocolError()
            self.session_id = message['sessionId']
        elif message['sessionId'] != self.session_id or kind == 'start':
            raise ProtocolError()
        if kind == 'playback_status':
            seconds = message.get('queuedSeconds')
            if message['epoch'] == self.epoch and type(seconds) in (int, float) and 0 <= seconds <= 10:
                log('live_playback', epoch=self.epoch, queued_seconds=round(seconds, 3))
            return
        if message['epoch'] < self.epoch:
            return
        if message['epoch'] == self.epoch and kind != 'stop':
            return
        await self.cancel_worker()
        self.epoch = message['epoch']
        self.paused = kind == 'pause' or message.get('paused') is True
        await self.send({'type': 'ack', 'requestId': message['requestId']})
        if kind == 'stop':
            await self.send({'type': 'state', 'state': 'stopped'})
            self.closed = True
        elif self.paused:
            await self.send({'type': 'state', 'state': 'paused'})
        else:
            await self.send({'type': 'state', 'state': 'connecting'})
            self.worker = asyncio.create_task(self.run_gemini(self.generation))

    async def input(self, data):
        epoch, seq, pcm = read_audio_frame(data)
        if epoch != self.epoch or self.paused or not self.ready or seq <= self.input_seq:
            return
        if len(pcm) != 3200:  # the browser sends 100-ms PCM16/16-kHz frames
            raise ProtocolError()
        self.input_seq = seq
        if self.queue.full():
            raise InputBackpressure()
        self.queue.put_nowait(pcm)
        if self.first_input_at is None:
            self.first_input_at = time.perf_counter()

    async def send_input(self, socket, queue):
        while True:
            pcm = await queue.get()
            await asyncio.wait_for(socket.send(json.dumps(realtime_audio_message(pcm))), 10)
            self.input_bytes += len(pcm)

    async def receive_output(self, socket, generation):
        transcript = Transcript()
        async for raw in socket:
            message = _decode_message(raw)
            if 'error' in message:
                raise LiveAPIError()
            update = transcription_update(message)
            if update:
                await self.send(transcript.apply(update), generation)
            for pcm in _output_audio(message):
                async with self.send_lock:
                    if self.closed or generation != self.generation or self.paused:
                        return
                    if not pcm or len(pcm) % 2 or len(pcm) > 240_000:
                        raise LiveAPIError()
                    await asyncio.wait_for(self.browser.send_bytes(
                        audio_frame(self.epoch, self.output_seq, pcm)), 10)
                    self.output_seq += 1
                    self.output_bytes += len(pcm)
                    if not self.first_output and self.first_input_at is not None:
                        self.first_output = True
                        log('live_first_audio', epoch=self.epoch,
                            ms=round((time.perf_counter() - self.first_input_at) * 1000))

    async def run_gemini(self, generation):
        started = time.perf_counter()
        try:
            key = os.environ.get('GEMINI_API_KEY')
            if not key:
                raise MissingGeminiKey()
            for attempt in range(4):
                if attempt:
                    await self.send({'type': 'state', 'state': 'reconnecting',
                                     'attempt': attempt}, generation)
                    await asyncio.sleep(0.5 * 2 ** (attempt - 1))
                try:
                    async with self.connector(f'{ENDPOINT}?key={quote(key, safe="")}',
                                              max_size=16 * 1024 * 1024,
                                              open_timeout=15, close_timeout=1) as socket:
                        await socket.send(json.dumps(setup_message(self.voice, self.prompt)))
                        response = _decode_message(await asyncio.wait_for(socket.recv(), 15))
                        if 'setupComplete' not in response:
                            raise LiveAPIError()
                        self.queue = asyncio.Queue(maxsize=10)
                        self.ready = True
                        await self.send({'type': 'state', 'state': 'ready'}, generation)
                        log('live_ready', epoch=self.epoch, attempt=attempt,
                            ms=round((time.perf_counter() - started) * 1000))
                        tasks = [asyncio.create_task(self.send_input(socket, self.queue)),
                                 asyncio.create_task(self.receive_output(socket, generation))]
                        try:
                            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                            for task in done:
                                task.result()
                            # A clean upstream close also requires a new Gemini session.
                            raise ConnectionClosed(None, None)
                        finally:
                            for task in tasks:
                                task.cancel()
                            await asyncio.gather(*tasks, return_exceptions=True)
                except (ConnectionClosed, OSError, TimeoutError):
                    self.ready = False
                    if attempt == 3:
                        raise
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.ready = False
            await self.send({'type': 'error', 'code': type(error).__name__}, generation)

    async def run(self):
        message = {}
        try:
            while not self.closed:
                message = await asyncio.wait_for(self.browser.receive(), 15) if self.session_id is None else await self.browser.receive()
                if message['type'] == 'websocket.disconnect':
                    break
                if message.get('bytes') is not None:
                    await self.input(message['bytes'])
                else:
                    text = message.get('text', '')
                    if len(text) > 8000:
                        raise ProtocolError()
                    await self.control(json.loads(text))
        except WebSocketDisconnect:
            message = {'type': 'websocket.disconnect'}
        except Exception as error:
            with suppress(RuntimeError, WebSocketDisconnect, TimeoutError):
                await self.send({'type': 'error', 'code': type(error).__name__})
        finally:
            self.closed = True
            await self.cancel_worker()
            if message.get('type') != 'websocket.disconnect':
                with suppress(RuntimeError, WebSocketDisconnect):
                    await self.browser.close(code=1000)
            log('live_session_v2', input_bytes=self.input_bytes,
                output_bytes=self.output_bytes, epoch=self.epoch)
