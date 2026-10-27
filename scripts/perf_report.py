#!/usr/bin/env python3
"""Summarize .cache/performance.jsonl without third-party packages."""

import json
from pathlib import Path
import statistics
import sys


ROOT = Path(__file__).resolve().parents[1]
path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.cache' / 'performance.jsonl'
rows = []
if path.exists():
    for line in path.read_text(encoding='utf-8').splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass


def percentile(values, fraction):
    values = sorted(values)
    return values[min(len(values) - 1, round((len(values) - 1) * fraction))]


if not rows:
    raise SystemExit(f'No benchmark data in {path}')

print(f'Benchmark: {path} ({len(rows)} events)')
for event in sorted({row.get('event') for row in rows}):
    group = [row for row in rows if row.get('event') == event]
    values = [float(row['ms']) for row in group if isinstance(row.get('ms'), (int, float))]
    if not values:
        continue
    hits = sum(row.get('cached') is True for row in group)
    cache = f' cache={hits}/{len(group)}' if any('cached' in row for row in group) else ''
    traffic = ''
    if any('input_bytes' in row or 'output_bytes' in row for row in group):
        input_kib = sum(row.get('input_bytes', 0) for row in group) / 1024
        output_kib = sum(row.get('output_bytes', 0) for row in group) / 1024
        traffic = f' input={input_kib:.1f}KiB output={output_kib:.1f}KiB'
    print(f'{event:18} n={len(values):4} mean={statistics.fmean(values):8.1f}ms '
          f'p50={percentile(values, .50):8.1f}ms p95={percentile(values, .95):8.1f}ms{cache}{traffic}')
