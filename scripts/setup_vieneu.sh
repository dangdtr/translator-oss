#!/usr/bin/env bash
# Install VieNeu-TTS v3 Turbo (Apache-2.0) in its own venv and download the
# pinned int8 model into models/vieneu. The server uses it when present and
# falls back to Piper otherwise. .venv-vieneu and models/vieneu/hf are kept
# between runs, so an interrupted run resumes.
set -euo pipefail
cd "$(dirname "$0")/.."
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-300}" HF_HUB_DOWNLOAD_TIMEOUT="${HF_HUB_DOWNLOAD_TIMEOUT:-60}"
echo 'Cài VieNeu vào .venv-vieneu (~750 MB, dùng lại nếu đã có)…'
uv venv -q --allow-existing --python 3.12 .venv-vieneu
uv pip install -q --python .venv-vieneu/bin/python 'vieneu==3.8.3'
echo 'Đang tải model VieNeu int8 (~290 MB)…'
HF_HUB_DISABLE_XET=1 .venv-vieneu/bin/python server/vieneu_worker.py --download
echo 'VieNeu ready.'
