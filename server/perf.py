"""Small, privacy-safe JSONL performance logger for local benchmarking."""

import json
import os
from pathlib import Path
import threading
import time


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / '.cache' / 'performance.jsonl'
_lock = threading.Lock()


def log(event, **metrics):
    payload = {'ts': time.time(), 'event': event, **metrics}
    line = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    PATH.parent.mkdir(exist_ok=True)
    with _lock:
        with PATH.open('a', encoding='utf-8') as output:
            output.write(line + '\n')
    if os.environ.get('LT_PERF_STDOUT', '1') != '0':
        print('[perf] ' + line, flush=True)

