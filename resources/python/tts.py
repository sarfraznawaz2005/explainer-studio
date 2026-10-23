"""
Kokoro voice sidecar for Explainer Studio.

Runs inside the app's own venv. Talks JSON lines over stdin/stdout:
  in : {"id": "1", "cmd": "speak", "text": "...", "voice": "af_heart", "speed": 1.0, "lang": "en-us", "out": "C:/.../x.wav"}
  out: {"id": "1", "ok": true, "durationMs": 2310, "sampleRate": 24000}
Commands: speak, voices, ping, quit. On start it prints {"type": "ready", ...}.

stdout carries only protocol lines. Anything a library prints goes to stderr.
The output path comes from the app (never from user input) and must end in .wav.
"""

import argparse
import json
import os
import sys
import time
import wave

# Keep the protocol channel clean: libraries that print() write to stderr instead.
PROTOCOL = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr

MAX_TEXT = 5000


def send(obj):
    PROTOCOL.write(json.dumps(obj, ensure_ascii=False) + "\n")
    PROTOCOL.flush()


def write_wav(path, samples, sample_rate):
    """16-bit mono PCM. Written to a temp file first so a crash never leaves half a WAV."""
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    tmp = path + ".part"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    os.replace(tmp, path)
    return int(round(len(pcm) * 1000 / sample_rate))


def speak(kokoro, req):
    text = str(req.get("text", "")).strip()
    out = str(req.get("out", ""))
    voice = str(req.get("voice", "af_heart"))
    lang = str(req.get("lang", "en-us"))
    speed = float(req.get("speed", 1.0))
    if not text:
        raise ValueError("No text to speak")
    if len(text) > MAX_TEXT:
        raise ValueError(f"Text is longer than {MAX_TEXT} characters")
    if not out.lower().endswith(".wav") or not os.path.isabs(out):
        raise ValueError("Output must be an absolute .wav path")
    if not 0.5 <= speed <= 2.0:
        raise ValueError("Speed must be between 0.5 and 2.0")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    t0 = time.perf_counter()
    samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    duration_ms = write_wav(out, samples, sample_rate)
    return {"durationMs": duration_ms, "sampleRate": sample_rate, "elapsedMs": int((time.perf_counter() - t0) * 1000)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    args = ap.parse_args()

    try:
        from importlib.metadata import version
        from kokoro_onnx import Kokoro
        import onnxruntime

        t0 = time.perf_counter()
        kokoro = Kokoro(args.model, args.voices)
        voices = sorted(kokoro.get_voices())
    except Exception as e:  # noqa: BLE001 - report any start failure to the app
        send({"type": "fatal", "error": f"{type(e).__name__}: {e}"})
        return 1

    send(
        {
            "type": "ready",
            "voices": voices,
            "python": sys.version.split()[0],
            "kokoro": version("kokoro-onnx"),
            "onnxruntime": onnxruntime.__version__,
            "loadMs": int((time.perf_counter() - t0) * 1000),
        }
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            cmd = req.get("cmd")
            if cmd == "speak":
                send({"id": rid, "ok": True, **speak(kokoro, req)})
            elif cmd == "voices":
                send({"id": rid, "ok": True, "voices": voices})
            elif cmd == "ping":
                send({"id": rid, "ok": True})
            elif cmd == "quit":
                send({"id": rid, "ok": True})
                return 0
            else:
                send({"id": rid, "ok": False, "error": f"Unknown command: {cmd}"})
        except Exception as e:  # noqa: BLE001 - one bad request must not stop the sidecar
            send({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
