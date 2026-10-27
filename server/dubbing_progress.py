"""Bounded, content-free progress for the extension's current dubbing request."""
from collections import OrderedDict
import threading
import time

_jobs = OrderedDict()
_lock = threading.Lock()


def update(job_id, stage):
    if not job_id:
        return
    now = time.monotonic()
    with _lock:
        previous = _jobs.get(job_id)
        _jobs[job_id] = {'stage': stage, 'began': previous['began'] if previous else now,
                         'stage_began': now}
        _jobs.move_to_end(job_id)
        while len(_jobs) > 256:
            _jobs.popitem(last=False)


def status(job_id):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return {'stage': 'queued', 'elapsedSeconds': 0}
        return {'stage': job['stage'], 'elapsedSeconds': int(time.monotonic() - job['began']),
                'stageSeconds': int(time.monotonic() - job['stage_began'])}
