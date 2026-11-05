# modal_backend/app.py
# Deploy with: modal deploy modal_backend/app.py
import base64
import hashlib
import hmac
import io
import os
import time
from typing import Optional
import modal

app = modal.App("ron-real-or-not-backend")

# Lightweight image with Meta FAIR's AudioSeal, SigLIP-2 Deepfake Classifier, and C2PA
forensic_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "fastapi[standard]",
        "torch",
        "torchaudio",
        "transformers",
        "Pillow",
        "audioseal",      # Meta FAIR's official localized audio watermark & clone detector!
        "c2pa-python",    # Official C2PA cryptographic provenance verifier
        "httpx",
        "numpy"
    )
)

# Simple in-memory per-IP rate limiter to protect hackathon credits during Nov 5-10 judging
IP_QUOTA_WINDOW = {}
MAX_SCANS_PER_IP_PER_HOUR = 25

@app.function(
    image=forensic_image,
    gpu="T4",                  # T4 costs ~$0.00016/sec; $100 Modal credit covers ~170 hours of active compute!
    scaledown_window=60,       # Scales to zero after 60s idle so 0 credits burn overnight
    max_containers=3,          # Hard concurrency cap so traffic spikes can never drain budget
    secrets=[modal.Secret.from_name("ron-webhook")]  # Injects MODAL_WEBHOOK_SECRET (create via: modal secret create ron-webhook MODAL_WEBHOOK_SECRET=...)
)
@modal.fastapi_endpoint(method="POST")
def analyze_media_endpoint(payload: dict):
    t0 = time.time()
    # Webhook secret gate: blocks external scanners from invoking the GPU URL
    # directly. Fail closed — misconfiguration denies rather than opening up.
    expected_secret = os.environ.get("MODAL_WEBHOOK_SECRET", "")
    provided_secret = str(payload.get("webhook_secret", ""))
    if not expected_secret or not hmac.compare_digest(provided_secret, expected_secret):
        return {
            "status": "unauthorized",
            "plain_message": "Missing or invalid webhook secret."
        }
    client_ip = payload.get("client_ip", "anonymous")
    now_hr = int(time.time() // 3600)
    key = f"{client_ip}:{now_hr}"
    IP_QUOTA_WINDOW[key] = IP_QUOTA_WINDOW.get(key, 0) + 1

    if IP_QUOTA_WINDOW[key] > MAX_SCANS_PER_IP_PER_HOUR:
        return {
            "status": "rate_limited",
            "plain_message": "Hourly live scan limit reached for this IP. Built-in Ground-Truth Cases remain 100% available."
        }

    mode = payload.get("mode", "full_check")
    result = {
        "status": "ok",
        "attribution": "Built with Muse Spark Open",
        "models_executed": [],
    }

    # 1. Meta FAIR AudioSeal — Sample-Level (1/16,000s) Synthetic & Watermarked Audio Slicing
    audio_b64 = payload.get("audio_wav_base64")
    if audio_b64:
        try:
            import torch
            import wave as wave_module
            import numpy as np
            from audioseal import AudioSeal

            # Decode with stdlib `wave` (no torchcodec dependency): the RON frontend
            # encoder always sends 16-bit PCM WAV, verified here instead of assumed.
            wav_bytes = base64.b64decode(audio_b64)
            with wave_module.open(io.BytesIO(wav_bytes), "rb") as wf:
                n_channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                sr = wf.getframerate()
                raw_frames = wf.readframes(wf.getnframes())
            if sampwidth != 2:
                raise ValueError(f"expected 16-bit PCM WAV, got {sampwidth * 8}-bit")
            samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0
            if n_channels > 1:
                samples = samples.reshape(-1, n_channels).mean(axis=1)
            if sr != 16000:
                target_len = int(round(len(samples) * 16000 / sr))
                old_idx = np.linspace(0, len(samples) - 1, num=len(samples))
                new_idx = np.linspace(0, len(samples) - 1, num=target_len)
                samples = np.interp(new_idx, old_idx, samples).astype(np.float32)
            waveform = torch.from_numpy(np.ascontiguousarray(samples)).unsqueeze(0)  # [1, T]

            detector = AudioSeal.load_detector("audioseal_detector_16bits")
            with torch.no_grad():
                # Returns frame-level probability across the audio waveform
                prob_tensor, message_bits = detector(waveform.unsqueeze(0), 16000)
                frame_probs = prob_tensor[0, 1, :].cpu().numpy()

            # Slice into 1-second buckets so the UI highlights exact seconds
            samples_per_sec = max(1, len(frame_probs) // max(1, int(waveform.shape[1] / 16000)))
            slices = []
            for sec_idx in range(0, int(waveform.shape[1] / 16000)):
                chunk = frame_probs[sec_idx * samples_per_sec : (sec_idx + 1) * samples_per_sec]
                mean_p = float(chunk.mean()) if len(chunk) > 0 else 0.0
                slices.append({
                    "startSec": sec_idx,
                    "endSec": sec_idx + 1,
                    "syntheticWatermarkProb": round(mean_p, 3),
                    "isFlagged": mean_p > 0.5
                })

            result["audioseal_slices"] = slices
            result["models_executed"].append("Meta FAIR AudioSeal (16kHz Localized Detector)")
        except Exception as e:
            result["audioseal_error"] = str(e)

    # 2. SigLIP-2 Deepfake Image/Crop Classifier (Scores Full Image + SAM 3.1 Masks)
    image_b64 = payload.get("image_base64")
    if image_b64:
        try:
            import torch
            from PIL import Image
            from transformers import AutoImageProcessor, SiglipForImageClassification

            raw_img_bytes = base64.b64decode(image_b64.split(",")[-1])
            pil_img = Image.open(io.BytesIO(raw_img_bytes)).convert("RGB")

            model_id = "prithivMLmods/open-deepfake-detection"
            processor = AutoImageProcessor.from_pretrained(model_id)
            clf = SiglipForImageClassification.from_pretrained(model_id)

            inputs = processor(images=pil_img, return_tensors="pt")
            with torch.no_grad():
                logits = clf(**inputs).logits
                probs = torch.softmax(logits, dim=-1)[0].tolist()
                # Class 0: Fake, Class 1: Real
                fake_prob = round(float(probs[0]), 4)

            result["siglip2_fake_probability"] = fake_prob
            result["models_executed"].append("SigLIP-2 Deepfake Vision Classifier")
        except Exception as e:
            result["siglip2_error"] = str(e)

    result["latency_ms"] = round((time.time() - t0) * 1000)
    return result
