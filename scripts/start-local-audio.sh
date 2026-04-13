#!/usr/bin/env bash
# Usage:
#   bash scripts/start-local-audio.sh             # starts both kokoro + musicgen
#   bash scripts/start-local-audio.sh kokoro      # local TTS only    (port 8880)
#   bash scripts/start-local-audio.sh musicgen    # local music only  (port 8881)
#   bash scripts/start-local-audio.sh sadtalker   # SadTalker server  (port 7860)
#
# SadTalker setup (one-time):
#   git clone https://github.com/OpenTalker/SadTalker scripts/SadTalker
#   cd scripts/SadTalker && bash scripts/download_models.sh && cd ../..
#   pip install fastapi uvicorn -r scripts/SadTalker/requirements.txt

set -e
SERVICE="${1:-all}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$REPO_ROOT/.venv-musicgen"

start_kokoro() {
  echo "=== Starting Kokoro TTS server (local, no Docker) on :8880 ==="

  if [ ! -d "$VENV" ]; then
    echo "Creating venv at $VENV ..."
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet torch transformers scipy numpy fastapi uvicorn kokoro-onnx soundfile
    echo "Dependencies installed."
  elif ! "$VENV/bin/python" -c "import kokoro_onnx" 2>/dev/null; then
    echo "Installing kokoro-onnx into existing venv..."
    "$VENV/bin/pip" install --quiet kokoro-onnx soundfile
  fi

  echo "Model downloads ~90 MB on first run…"
  "$VENV/bin/python" "$REPO_ROOT/scripts/kokoro_server.py"
}

start_musicgen() {
  echo "=== Starting local MusicGen server on :8881 ==="

  # Ensure venv exists with deps
  if [ ! -d "$VENV" ]; then
    echo "Creating venv at $VENV ..."
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet torch transformers scipy numpy fastapi uvicorn
    echo "Dependencies installed."
  fi

  MUSICGEN_DEVICE="${MUSICGEN_DEVICE:-mps}"
  echo "Device: $MUSICGEN_DEVICE  (set MUSICGEN_DEVICE=cpu to override)"
  echo "Model: ${MUSICGEN_MODEL:-facebook/musicgen-small}  (first run downloads ~1.5 GB)"
  echo ""

  MUSICGEN_DEVICE="$MUSICGEN_DEVICE" "$VENV/bin/python" "$REPO_ROOT/scripts/musicgen_server.py"
}

start_sadtalker() {
  echo "=== Starting SadTalker REST server on :7860 ==="

  SADTALKER_DIR="$HOME/scripts/SadTalker"
  SADTALKER_VENV="$SADTALKER_DIR/.venv"

  if [ ! -d "$SADTALKER_DIR" ]; then
    echo "SadTalker not cloned yet. Run:"
    echo "  git clone https://github.com/OpenTalker/SadTalker ~/scripts/SadTalker"
    exit 1
  fi

  if [ ! -d "$SADTALKER_VENV" ]; then
    echo "Venv not found. Run:"
    echo "  /opt/homebrew/opt/python@3.11/bin/python3.11 -m venv ~/scripts/SadTalker/.venv"
    echo "  ~/scripts/SadTalker/.venv/bin/pip install fastapi uvicorn -r ~/scripts/SadTalker/requirements.txt"
    exit 1
  fi

  echo "Launching on http://localhost:7860"
  "$SADTALKER_VENV/bin/python" "$REPO_ROOT/scripts/sadtalker_server.py"
}

case "$SERVICE" in
  kokoro)     start_kokoro ;;
  musicgen)   start_musicgen ;;
  sadtalker)  start_sadtalker ;;
  all)
    start_kokoro
    start_musicgen   # blocks — kokoro runs in background
    ;;
  *)
    echo "Unknown service: $SERVICE. Use: kokoro | musicgen | sadtalker | all"
    exit 1
    ;;
esac
