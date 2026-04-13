#!/usr/bin/env python3
# Run via: bash scripts/start-local-audio.sh sadtalker
# Or directly: ~/scripts/SadTalker/.venv/bin/python scripts/sadtalker_server.py
"""
SadTalker REST wrapper for ContentNode
  GET  /health          — readiness probe
  POST /generate        — form: audio (file), image (file), still (str), expression_scale (str), enhancer (str)
                          returns video/mp4 bytes

Expects SadTalker to be cloned at scripts/SadTalker/ (next to this file).
Setup:
  git clone https://github.com/OpenTalker/SadTalker scripts/SadTalker
  cd scripts/SadTalker && bash scripts/download_models.sh
  pip install -r requirements.txt
  cd ../.. && python scripts/sadtalker_server.py
"""
import os, sys, subprocess, tempfile, shutil, traceback
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import Response, JSONResponse
import uvicorn

# ── Locate SadTalker ─────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
# Check project-local first, then ~/scripts/SadTalker
_candidates = [SCRIPT_DIR / "SadTalker", Path.home() / "scripts" / "SadTalker"]
SADTALKER_DIR = next((p for p in _candidates if p.exists()), None)

if SADTALKER_DIR is None:
    print(
        "\n[sadtalker_server] ERROR: SadTalker not found. Tried:\n"
        + "\n".join(f"  {p}" for p in _candidates)
        + "\nRun:\n"
        "  git clone https://github.com/OpenTalker/SadTalker ~/scripts/SadTalker\n"
        "  bash scripts/start-local-audio.sh sadtalker\n",
        file=sys.stderr,
    )
    sys.exit(1)

INFERENCE_PY = SADTALKER_DIR / "inference.py"
CHECKPOINTS  = SADTALKER_DIR / "checkpoints"
if not CHECKPOINTS.exists():
    print(
        f"\n[sadtalker_server] ERROR: model checkpoints not found at {CHECKPOINTS}\n"
        "Run inside scripts/SadTalker:\n"
        "  bash scripts/download_models.sh\n",
        file=sys.stderr,
    )
    sys.exit(1)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="SadTalker REST server")


@app.get("/health")
async def health():
    return JSONResponse({"ok": True, "sadtalker": str(SADTALKER_DIR)})


@app.post("/generate")
async def generate(
    audio: UploadFile            = File(...),
    image: UploadFile            = File(...),
    still: str                   = Form("false"),
    expression_scale: str        = Form("1.0"),
    enhancer: str                = Form("gfpgan"),
):
    tmpdir = tempfile.mkdtemp(prefix="sadtalker_")
    try:
        audio_path  = Path(tmpdir) / "voice.mp3"
        image_path  = Path(tmpdir) / f"photo.{image.filename.rsplit('.',1)[-1] if image.filename and '.' in image.filename else 'jpg'}"
        result_dir  = Path(tmpdir) / "result"
        result_dir.mkdir()

        audio_path.write_bytes(await audio.read())
        image_path.write_bytes(await image.read())

        cmd = [
            sys.executable, str(INFERENCE_PY),
            "--driven_audio",     str(audio_path),
            "--source_image",     str(image_path),
            "--result_dir",       str(result_dir),
            "--expression_scale", expression_scale,
            "--enhancer",         enhancer,
        ]
        if still.lower() == "true":
            cmd.append("--still")

        proc = subprocess.run(
            cmd,
            cwd=str(SADTALKER_DIR),
            capture_output=True,
            text=True,
            timeout=1200,  # 20 min — CPU inference is slow
        )
        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"SadTalker inference failed:\n{proc.stderr[-2000:]}"
            )

        # Find the output .mp4
        mp4_files = list(result_dir.rglob("*.mp4"))
        if not mp4_files:
            raise HTTPException(status_code=500, detail="SadTalker produced no .mp4 output")

        video_bytes = mp4_files[0].read_bytes()
        return Response(content=video_bytes, media_type="video/mp4")

    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    print(f"[sadtalker_server] Starting on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
