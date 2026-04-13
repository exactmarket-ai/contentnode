#!/usr/bin/env python3
"""
Local Kokoro TTS server for ContentNode — OpenAI-compatible /v1/audio/speech endpoint.
Uses kokoro-onnx (no spacy, no Docker needed).

Install:
  .venv-musicgen/bin/pip install kokoro-onnx soundfile

Run:
  bash scripts/start-local-audio.sh kokoro
  # or directly:
  .venv-musicgen/bin/python scripts/kokoro_server.py

Default port: 8880
Voices: af_heart, af_bella, af_nicole, af_aoede, af_kore, af_sarah, af_sky, af_nova,
        af_river, af_jessica, af_alloy, am_michael, am_adam, am_echo, am_eric,
        am_fenrir, am_liam, am_onyx, am_puck, am_santa,
        bf_alice, bf_emma, bf_isabella, bf_lily,
        bm_lewis, bm_daniel, bm_fable, bm_george
"""

import io
import logging
import os
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger("kokoro-tts")

# ── Model files ───────────────────────────────────────────────────────────────

MODELS_DIR = Path(__file__).parent.parent / ".kokoro-models"
MODELS_DIR.mkdir(exist_ok=True)

MODEL_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin":  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}

def download_if_missing(filename: str, url: str) -> Path:
    dest = MODELS_DIR / filename
    if dest.exists():
        return dest
    logger.info(f"Downloading {filename} (~90 MB total for both files)…")
    urllib.request.urlretrieve(url, dest)
    logger.info(f"  ✔ {filename} saved to {dest}")
    return dest

for name, url in MODEL_FILES.items():
    download_if_missing(name, url)

# ── Model ────────────────────────────────────────────────────────────────────

from kokoro_onnx import Kokoro

logger.info("Loading Kokoro ONNX model…")
kokoro = Kokoro(str(MODELS_DIR / "kokoro-v1.0.onnx"), str(MODELS_DIR / "voices-v1.0.bin"))
logger.info("Kokoro ready.")

app = FastAPI(title="Kokoro TTS Server", version="1.0.0")

# ── OpenAI-compatible endpoint ────────────────────────────────────────────────

class SpeechRequest(BaseModel):
    model: str = "kokoro"
    input: str
    voice: str = "af_heart"
    response_format: str = "mp3"
    speed: float = 1.0

@app.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
    if not req.input.strip():
        raise HTTPException(status_code=400, detail="input is required")

    logger.info(f"TTS | voice={req.voice} | len={len(req.input)} chars")

    try:
        samples, sample_rate = kokoro.create(
            req.input,
            voice=req.voice,
            speed=max(0.5, min(2.0, req.speed)),
            lang="en-us",
        )
    except Exception as e:
        logger.error(f"Kokoro error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Encode to WAV (universally supported; worker accepts wav)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    wav_bytes = buf.getvalue()

    logger.info(f"Done — {len(wav_bytes) // 1024} KB")
    return Response(content=wav_bytes, media_type="audio/wav")


@app.get("/health")
async def health():
    return {"status": "ok", "model": "kokoro-onnx", "device": "cpu"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8880))
    uvicorn.run(app, host="0.0.0.0", port=port)
