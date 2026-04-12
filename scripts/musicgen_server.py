#!/usr/bin/env python3
"""
Local MusicGen server for ContentNode
Wraps facebook/musicgen-small via HuggingFace transformers

Install:
  pip install transformers torch scipy numpy fastapi uvicorn

Run:
  python scripts/musicgen_server.py

Default port: 8881 (set PORT env var to override)
Set device to 'mps' for Apple Silicon GPU acceleration.
"""

import io
import logging
import os

import numpy as np
import scipy.io.wavfile
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import pipeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger("musicgen")

# ── Device ───────────────────────────────────────────────────────────────────
# Change to "mps" for Apple Silicon (M1/M2/M3) GPU — ~5–10× faster than CPU.
# Change to "cuda" for Nvidia GPU.
DEVICE = os.environ.get("MUSICGEN_DEVICE", "cpu")

# ── Model ────────────────────────────────────────────────────────────────────
# musicgen-small  — ~1.5 GB, fastest, good quality
# musicgen-medium — ~3.3 GB, slower, better quality
# musicgen-large  — ~6.7 GB, slowest, best quality
MODEL = os.environ.get("MUSICGEN_MODEL", "facebook/musicgen-small")

logger.info(f"Loading {MODEL} on {DEVICE} (first run downloads the model)…")
synthesiser = pipeline("text-to-audio", model=MODEL, device=DEVICE)
logger.info("Model loaded — server ready.")

app = FastAPI(title="MusicGen Server", version="1.0.0")


class GenerateRequest(BaseModel):
    prompt: str
    duration_seconds: float = 10.0


@app.post("/generate")
async def generate(req: GenerateRequest):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")

    duration = max(1.0, min(req.duration_seconds, 120.0))
    # MusicGen generates ~50 tokens per second of audio
    max_new_tokens = int(duration * 50)

    logger.info(f"Generating {duration}s | tokens={max_new_tokens} | prompt: {req.prompt[:80]}")

    result = synthesiser(
        req.prompt,
        forward_params={"do_sample": True, "max_new_tokens": max_new_tokens},
    )

    audio_array = result["audio"]
    sampling_rate = result["sampling_rate"]

    # Flatten to mono: shape may be (1, samples) or (samples,)
    if hasattr(audio_array, "ndim") and audio_array.ndim > 1:
        audio_array = audio_array.squeeze()

    # Convert to 16-bit PCM WAV
    audio_int16 = (np.array(audio_array) * 32767).clip(-32768, 32767).astype(np.int16)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, sampling_rate, audio_int16)
    wav_bytes = buf.getvalue()

    logger.info(f"Done — {len(wav_bytes) // 1024} KB")
    return Response(content=wav_bytes, media_type="audio/wav")


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL, "device": DEVICE}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8881))
    uvicorn.run(app, host="0.0.0.0", port=port)
