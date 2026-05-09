#!/bin/bash

# Download Whisper tiny model files from HuggingFace for local browser-based speech recognition.
# Usage: chmod +x scripts/download-whisper-model.sh && ./scripts/download-whisper-model.sh

set -euo pipefail

BASE_URL="https://huggingface.co/Xenova/whisper-tiny/resolve/main"
TARGET_DIR="web/public/models/whisper-tiny"

FILES=(
  "onnx/encoder_model.onnx"
  "onnx/decoder_model_merged.onnx"
  "config.json"
  "generation_config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "preprocessor_config.json"
)

mkdir -p "${TARGET_DIR}"

echo "Downloading Whisper tiny model files to ${TARGET_DIR}/"
echo ""

total_size=0
skipped=0

for file in "${FILES[@]}"; do
  dest="${TARGET_DIR}/${file}"
  dest_dir=$(dirname "${dest}")

  mkdir -p "${dest_dir}"

  if [ -f "${dest}" ] && [ -s "${dest}" ]; then
    echo "[SKIP] ${file} (already exists, $(du -h "${dest}" | cut -f1))"
    skipped=$((skipped + 1))
    total_size=$(($(stat -f%z "${dest}") + total_size))
    continue
  fi

  url="${BASE_URL}/${file}"
  echo "[DOWN] ${file}"
  curl -L -f -o "${dest}" "${url}"
  downloaded_size=$(stat -f%z "${dest}")
  total_size=$((total_size + downloaded_size))
  echo "       done ($(du -h "${dest}" | cut -f1))"
done

echo ""
if [ "${skipped}" -gt 0 ]; then
  echo "Download complete. ${skipped} file(s) skipped (already present)."
else
  echo "All files downloaded successfully."
fi
echo "Total size: $(du -sh "${TARGET_DIR}" | cut -f1)"
