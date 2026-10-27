"""Expose a signed YouTube audio URL to FFmpeg through loopback byte ranges.

Bundled FFmpeg need not perform HTTPS. Only small upstream ranges are fetched,
so FFmpeg can read the container index and seek without downloading the video.
"""

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import re
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx


class RangeFailure(Exception):
    pass


def byte_range(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
    if not match or not any(match.groups()):
        raise RangeFailure('InvalidRange')
    first, last = match.groups()
    if not first:
        start, end = max(0, size - int(last)), size - 1
    else:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    if not 0 <= start <= end < size:
        raise RangeFailure('UnsatisfiableRange')
    return start, end, True


def upstream_url(url, start, end):
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != 'range']
    query.append(('range', f'{start}-{end}'))
    return urlunsplit(parts._replace(query=urlencode(query)))


@contextmanager
def audio_proxy(source, seconds=40, max_bytes=32 * 1024 * 1024):
    size = source['size']
    deadline = time.monotonic() + seconds
    stopped = threading.Event()
    lock = threading.Lock()
    stats = {'bytes': 0, 'requests': 0, 'error': None}
    client = httpx.Client(timeout=httpx.Timeout(10, connect=5), trust_env=True,
                          limits=httpx.Limits(max_connections=4, max_keepalive_connections=0))

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):
            pass

        def do_HEAD(self):
            self.serve(head=True)

        def do_GET(self):
            self.serve(head=False)

        def serve(self, head=False):
            if self.path != '/audio':
                self.send_error(404)
                return
            try:
                start, end, partial = byte_range(self.headers.get('Range'), size)
            except RangeFailure:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            self.send_response(206 if partial else 200)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(end - start + 1))
            if partial:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if head:
                return
            try:
                # Fetch in bounded blocks: closing an FFmpeg read never downloads the rest.
                for offset in range(start, end + 1, 64 * 1024):
                    if stopped.is_set() or time.monotonic() > deadline:
                        raise RangeFailure('AudioReadTimeout')
                    block_end = min(offset + 64 * 1024 - 1, end)
                    expected = block_end - offset + 1
                    with lock:
                        if stats['bytes'] + expected > max_bytes:
                            raise RangeFailure('AudioReadLimit')
                        stats['bytes'] += expected
                        stats['requests'] += 1
                    for attempt in range(2):
                        try:
                            with client.stream('GET', upstream_url(source['url'], offset, block_end),
                                               headers={'User-Agent': source['user_agent']}) as response:
                                response.raise_for_status()
                                # Reject a CDN ignoring ranges and returning the complete source.
                                if int(response.headers.get('Content-Length', '0')) != expected:
                                    raise RangeFailure('UpstreamIgnoredRange')
                                content = bytearray()
                                for chunk in response.iter_bytes():
                                    content.extend(chunk)
                                    if len(content) > expected:
                                        raise RangeFailure('UpstreamIgnoredRange')
                            break
                        except httpx.HTTPError:
                            if attempt or stopped.is_set() or time.monotonic() > deadline:
                                raise
                            with lock:
                                if stats['bytes'] + expected > max_bytes:
                                    raise RangeFailure('AudioReadLimit')
                                stats['bytes'] += expected
                                stats['requests'] += 1
                    if len(content) != expected:
                        raise RangeFailure('TruncatedAudioRange')
                    self.wfile.write(content)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass  # FFmpeg closed its old range while seeking, or finished the segment.
            except (RangeFailure, httpx.HTTPError, ValueError) as error:
                with lock:
                    stats['error'] = (str(error) if isinstance(error, RangeFailure) else
                                      f'HTTP{error.response.status_code}' if isinstance(error, httpx.HTTPStatusError) else
                                      type(error).__name__)
            finally:
                self.close_connection = True

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/audio', stats
    finally:
        stopped.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)
        client.close()
