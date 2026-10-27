"""Client for the VieNeu worker process (server/vieneu_worker.py in .venv-vieneu)."""
import atexit
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / '.venv-vieneu/bin/python'
MODELS = ROOT / 'models/vieneu'
LOG = ROOT / '.cache/vieneu.log'


class VieneuWorker:
    """One long-lived worker; requests are serialized. A crash or timeout kills
    it and disables VieNeu for a short while so callers fall back to Piper."""

    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.lines = queue.Queue()
        self.sequence = 0
        self.disabled_until = 0
        self.voice = None

    def installed(self):
        return os.environ.get('LT_VOICE') != 'piper' and PYTHON.exists() and (MODELS / 'pnnbao-ump__VieNeu-TTS-v3-Turbo').is_dir()

    def available(self):
        return self.installed() and time.monotonic() >= self.disabled_until

    def _reader(self, process):
        for line in process.stdout:
            self.lines.put((process, line))
        self.lines.put((process, None))

    def _next(self, timeout):
        deadline = time.monotonic() + timeout
        while True:
            process, line = self.lines.get(timeout=max(0.01, deadline - time.monotonic()))
            if process is not self.process:
                continue  # left over from a worker that was replaced
            if line is None:
                raise RuntimeError('VieNeu worker exited; see .cache/vieneu.log')
            return json.loads(line)

    def _start(self):
        LOG.parent.mkdir(exist_ok=True)
        with LOG.open('a') as log:
            self.process = subprocess.Popen([str(PYTHON), str(ROOT / 'server/vieneu_worker.py')], stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1, encoding='utf-8')
        threading.Thread(target=self._reader, args=(self.process,), daemon=True).start()
        ready = self._next(timeout=180)
        if not ready.get('ready'):
            raise RuntimeError('VieNeu worker did not start')
        self.voice = ready.get('voice')

    def warm(self):
        """Start the worker ahead of the first sentence (model load takes a few seconds)."""
        with self.lock:
            if self.available() and (self.process is None or self.process.poll() is not None):
                try:
                    self._start()
                except Exception:
                    self.stop()
                    self.disabled_until = time.monotonic() + 30

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
        self.process = None

    def synthesize(self, text, path, timeout=60):
        """Write a 48 kHz WAV of `text` to `path`; raises if VieNeu cannot."""
        with self.lock:
            if not self.available():
                raise RuntimeError('VieNeu is unavailable')
            try:
                if self.process is None or self.process.poll() is not None:
                    self._start()
                self.sequence += 1
                self.process.stdin.write(json.dumps({'id': self.sequence, 'text': text, 'out': str(path)}, ensure_ascii=False) + '\n')
                self.process.stdin.flush()
                while True:
                    reply = self._next(timeout)
                    if reply.get('id') == self.sequence:
                        break
            except (OSError, RuntimeError, queue.Empty, json.JSONDecodeError):
                self.stop()
                self.disabled_until = time.monotonic() + 30
                raise
            if not reply.get('ok'):
                raise RuntimeError(reply.get('error', 'VieNeu failed'))
            return reply


vieneu = VieneuWorker()
atexit.register(vieneu.stop)
