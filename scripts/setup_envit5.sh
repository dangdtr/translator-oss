#!/usr/bin/env bash
# Convert the official VietAI/envit5-translation weights (pinned revision) to
# CTranslate2 int8 in models/envit5-translation. Conversion tools (torch CPU,
# transformers 4.x) live in a build venv under .cache/envit5-build; the server
# only needs ctranslate2. That directory is kept between runs on purpose: an
# interrupted run then resumes instead of re-downloading torch and the ~1.3 GB
# of weights. Delete .cache/envit5-build to reclaim the disk.
set -euo pipefail
cd "$(dirname "$0")/.."
REVISION=840bc88104d5a4277af740eaedb024df8c3093e7
OUT=models/envit5-translation
WORK=.cache/envit5-build
trap 'rm -rf "$OUT.part"' EXIT
export HF_HOME="${HF_HOME:-$WORK/hf}" HF_HUB_DISABLE_XET=1
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-300}" HF_HUB_DOWNLOAD_TIMEOUT="${HF_HUB_DOWNLOAD_TIMEOUT:-60}"

mkdir -p "$WORK"
echo 'Cài torch CPU (~200 MB, dùng lại nếu đã có)…'
uv venv -q --allow-existing "$WORK/venv"
uv pip install -q --python "$WORK/venv/bin/python" --index-url https://download.pytorch.org/whl/cpu torch
# transformers 5.x cannot load this model's tokenizer.json.
uv pip install -q --python "$WORK/venv/bin/python" 'transformers>=4.44,<5' 'ctranslate2>=4.5,<5' sentencepiece
echo 'Đang tải trọng số envit5 (~1.3 GB) và convert sang int8…'
rm -rf "$OUT.part"
"$WORK/venv/bin/ct2-transformers-converter" --model VietAI/envit5-translation --revision "$REVISION" \
  --quantization int8 --copy_files spiece.model README.md --output_dir "$OUT.part"
echo "$REVISION" > "$OUT.part/REVISION"
rm -rf "$OUT" && mv "$OUT.part" "$OUT"
echo "envit5 ready in $OUT"
