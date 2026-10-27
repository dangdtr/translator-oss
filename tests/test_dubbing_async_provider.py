import asyncio
import httpx
import pytest
from google import genai
from server import segmented_dubbing as dub


def test_rate_limit_does_not_trigger_hidden_sdk_retries(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test')
    real_client = genai.Client
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(429, json={'error': {'message': 'quota exhausted', 'code': 'resource_exhausted'}})

    def client(**kwargs):
        options = kwargs['http_options'].model_copy(update={
            'base_url': 'http://mock', 'async_client_args': {'transport': httpx.MockTransport(respond)}})
        return real_client(api_key='test', http_options=options)

    monkeypatch.setattr(genai, 'Client', client)
    with pytest.raises(Exception):
        asyncio.run(dub.translate_audio(b'fake-wav'))
    assert len(calls) == 1


def test_sdk_request_is_cancelled_without_waiting_for_provider(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test')
    real_client = genai.Client

    async def run():
        started, closed = asyncio.Event(), asyncio.Event()

        async def respond(request):
            started.set()
            try:
                await asyncio.Future()
            finally:
                closed.set()

        def client(**kwargs):
            options = kwargs['http_options'].model_copy(update={
                'base_url': 'http://mock', 'async_client_args': {'transport': httpx.MockTransport(respond)}})
            return real_client(api_key='test', http_options=options)

        monkeypatch.setattr(genai, 'Client', client)
        task = asyncio.create_task(dub.translate_audio(b'fake-wav'))
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        assert closed.is_set()

    asyncio.run(run())
