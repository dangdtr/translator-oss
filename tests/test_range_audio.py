from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

import pytest
from server import range_audio as ranges


def test_range_bounds():
    assert ranges.byte_range(None, 100) == (0, 99, False)
    assert ranges.byte_range('bytes=30-', 100) == (30, 99, True)
    assert ranges.byte_range('bytes=-10', 100) == (90, 99, True)
    assert ranges.byte_range('bytes=30-999', 100) == (30, 99, True)
    for value in ['bytes=100-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,2-3']:
        with pytest.raises(ranges.RangeFailure):
            ranges.byte_range(value, 100)


@pytest.fixture
def remote(monkeypatch):
    calls = []
    mode = {'ignore': False}

    class Client:
        def __init__(self, **kw):
            pass

        @contextmanager
        def stream(self, method, url, **kw):
            start, end = map(int, parse_qs(urlsplit(url).query)['range'][0].split('-'))
            calls.append((start, end))
            size = end - start + 1

            class Response:
                headers = {'Content-Length': str(size if not mode['ignore'] else 256 * 1024 * 1024)}

                def raise_for_status(self):
                    pass

                def iter_bytes(self):
                    yield b'x' * size

            yield Response()

        def close(self):
            pass

    monkeypatch.setattr(ranges.httpx, 'Client', Client)
    return calls, mode


def test_large_source_seek_reads_only_requested_bytes(remote):
    calls, _ = remote
    size = 256 * 1024 * 1024
    source = {'url': 'https://cdn.googlevideo.com/audio?sig=test', 'size': size, 'user_agent': 'test'}
    with ranges.audio_proxy(source) as (url, stats):
        with urlopen(Request(url, headers={'Range': f'bytes={size - 1024}-{size - 1}'}), timeout=5) as response:
            assert response.status == 206
            assert response.headers['Content-Range'] == f'bytes {size - 1024}-{size - 1}/{size}'
            assert response.read() == b'x' * 1024
        assert stats['bytes'] == 1024 and stats['requests'] == 1
    assert calls == [(size - 1024, size - 1)]


def test_head_and_invalid_range_do_not_fetch_upstream(remote):
    calls, _ = remote
    source = {'url': 'https://cdn.googlevideo.com/audio', 'size': 100000, 'user_agent': 'test'}
    with ranges.audio_proxy(source) as (url, stats):
        with urlopen(Request(url, method='HEAD'), timeout=5) as response:
            assert response.headers['Content-Length'] == '100000'
            assert response.headers['Accept-Ranges'] == 'bytes'
        from urllib.error import HTTPError
        with pytest.raises(HTTPError) as error:
            urlopen(Request(url, headers={'Range': 'bytes=100000-'}), timeout=5)
        assert error.value.code == 416
    assert calls == []


def test_upstream_ignoring_range_does_not_download_source(remote):
    calls, mode = remote
    mode['ignore'] = True
    source = {'url': 'https://cdn.googlevideo.com/audio', 'size': 256 * 1024 * 1024, 'user_agent': 'test'}
    with ranges.audio_proxy(source) as (url, stats):
        with urlopen(Request(url, headers={'Range': 'bytes=0-1023'}), timeout=5) as response:
            assert response.read(1024) == b''
        assert stats['error'] == 'UpstreamIgnoredRange'
    assert calls == [(0, 1023)]
