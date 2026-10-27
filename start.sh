#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  uv venv .venv
  uv pip install --python .venv/bin/python -r requirements.txt
fi
.venv/bin/python scripts/pair.py
exec .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload
