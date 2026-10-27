#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Slow links: uv defaults to a 30 s HTTP timeout and huggingface_hub to 10 s,
# which abort large wheel/model downloads that merely stalled for a moment.
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-300}" HF_HUB_DOWNLOAD_TIMEOUT="${HF_HUB_DOWNLOAD_TIMEOUT:-60}"
echo '[1/5] Tạo venv và cài phụ thuộc…'
uv venv --allow-existing .venv
uv pip install --python .venv/bin/python -r requirements.txt
echo '[2/5] Tải model dịch Argos và giọng Piper (~130 MB)…'
.venv/bin/python scripts/setup_models.py
# Better translation model; the server falls back to OPUS-MT if this step fails.
echo '[3/5] Convert envit5 sang int8 (~1.3 GB, cache giữ lại để chạy lại được)…'
./scripts/setup_envit5.sh || echo 'Không cài được envit5; dùng tạm OPUS-MT.'
# Natural voice; the server falls back to Piper if this step fails.
echo '[4/5] Cài VieNeu và tải model (~1 GB)…'
./scripts/setup_vieneu.sh || echo 'Không cài được VieNeu; dùng giọng Piper.'
echo '[5/5] Ghép nối extension với server…'
.venv/bin/python scripts/pair.py
echo 'Sẵn sàng. Chạy ./start.sh rồi tải thư mục extension tại chrome://extensions.'
