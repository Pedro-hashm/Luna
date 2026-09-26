"""Train an openWakeWord-compatible ONNX classification head from prepared audio.

The frozen openWakeWord mel/embedding backbone creates the 16 x 96 features;
only the small keyword classifier is trained. This deliberately uses Kokoro
audio already generated through the running API, never a second TTS install.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import random
from collections import Counter, deque
from pathlib import Path

import numpy as np

from common import DATA, ROOT, load_config, read_wav, write_json


def load_rows() -> list[dict]:
    manifest = DATA / "manifest.jsonl"
    if not manifest.is_file():
        raise FileNotFoundError("Run scripts/prepare_data.py before training")
    return [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line]


def to_window(samples: np.ndarray, length: int, positive: bool, rng: np.random.Generator) -> np.ndarray:
    x = samples.astype(np.float32) / 32768
    if positive:
        # Trim silence, then place the word near the end of a streaming window.
        active = np.flatnonzero(np.abs(x) > 0.004)
        if active.size:
            x = x[max(0, active[0] - 800):min(x.size, active[-1] + 801)]
        if x.size > length - 800:
            raise ValueError("Positive clip is too long for the 2-second window; trim the recording")
        after = int(rng.integers(800, min(3200, length - x.size) + 1))
        before = length - x.size - after
        x = np.pad(x, (before, after))
    else:
        if x.size > length:
            start = int(rng.integers(0, x.size - length + 1))
            x = x[start:start + length]
        elif x.size < length:
            offset = int(rng.integers(0, length - x.size + 1))
            x = np.pad(x, (offset, length - x.size - offset))
    return x


def augment(x: np.ndarray, rng: np.random.Generator, backgrounds: list[np.ndarray],
            rirs: list[np.ndarray]) -> np.ndarray:
    x = x * float(rng.uniform(0.6, 1.35))
    if rirs and rng.random() < 0.3:
        from scipy.signal import fftconvolve
        rir = rirs[int(rng.integers(len(rirs)))].astype(np.float32) / 32768
        y = fftconvolve(x, rir[:8000], mode="full")[:x.size]
        peak = max(float(np.max(np.abs(y))), 1e-6)
        x = y * min(1.0, 0.9 / peak)
    if backgrounds and rng.random() < 0.75:
        bg = to_window(backgrounds[int(rng.integers(len(backgrounds)))], x.size, False, rng)
        speech_rms = max(float(np.sqrt(np.mean(x * x))), 1e-4)
        bg_rms = max(float(np.sqrt(np.mean(bg * bg))), 1e-4)
        snr_db = float(rng.uniform(5, 20))
        x += bg * (speech_rms / (bg_rms * 10 ** (snr_db / 20)))
    x += rng.normal(0, float(rng.uniform(0, 0.002)), x.size)
    return np.clip(x, -1, 1)


def feature_data(rows: list[dict], split: str, config: dict, extractor, rng: np.random.Generator,
                ncpu: int = 1):
    length = int(config["train"]["clip_seconds"] * 16000)
    if length != 32000:
        raise ValueError("This classifier uses the validated 2-second / 16-frame openWakeWord window")
    background_rows = [row for row in rows if row["split"] == split and row["label"] == "background"]
    backgrounds = [read_wav(ROOT / row["path"]) for row in background_rows]
    rirs = []
    if split == "train":
        for path in (DATA / "rir").glob("*.wav"):
            try:
                rirs.append(read_wav(path))
            except ValueError:
                print(f"Skipping non-16-kHz RIR: {path}")
    windows = []
    labels = []
    rounds = int(config["train"]["positive_augmentations"]) if split == "train" else 1
    negative_rounds = int(config["train"]["negative_windows_per_clip"]) if split == "train" else 1
    for row in rows:
        if row["split"] != split or row["label"] == "background":
            continue
        samples = read_wav(ROOT / row["path"])
        positive = row["label"] == "positive"
        for _ in range(rounds if positive else negative_rounds):
            window = to_window(samples, length, positive, rng)
            if split == "train":
                window = augment(window, rng, backgrounds, rirs)
            windows.append((window * 32767).astype(np.int16))
            labels.append(1 if positive else 0)
    if split == "train" and backgrounds:
        max_windows = int(config["train"]["max_train_background_windows"])
        for index in range(max_windows):
            bg = backgrounds[index % len(backgrounds)]
            window = to_window(bg, length, False, rng)
            windows.append((window * 32767).astype(np.int16))
            labels.append(0)
    elif split == "validation" and backgrounds:
        for bg in backgrounds:
            for offset in range(0, max(1, bg.size - length + 1), length):
                window = to_window(bg[offset:offset + length], length, False, rng)
                windows.append((window * 32767).astype(np.int16))
                labels.append(0)
    if not windows:
        return np.empty((0, 16, 96), dtype=np.float32), np.empty(0, dtype=np.float32)
    features = []
    for offset in range(0, len(windows), 32):
        batch = np.stack(windows[offset:offset + 32])
        features.append(extractor.embed_clips(batch, batch_size=len(batch), ncpu=ncpu))
        print(f"Embedded {min(offset + 32, len(windows))}/{len(windows)} {split} clips", end="\r")
    print()
    result = np.concatenate(features).astype(np.float32)
    if result.shape[1:] != (16, 96):
        raise RuntimeError(f"Unexpected openWakeWord features {result.shape}; expected (N,16,96)")
    return result, np.asarray(labels, dtype=np.float32)


def build_network(torch):
    nn = torch.nn
    return nn.Sequential(
        nn.Flatten(),
        nn.Linear(16 * 96, 64), nn.LayerNorm(64), nn.ReLU(),
        nn.Linear(64, 32), nn.ReLU(),
        nn.Linear(32, 1), nn.Sigmoid(),
    )


def mine_streaming_features(rows: list[dict], split: str, runtime, min_score: float = 0.2,
                            hard_negative_phrases: set[str] | None = None):
    """Mine hard examples with the wake service's silence gate and pre-roll.

    Cover all user recordings plus configured synthetic near-homophones, since
    static-window training alone can miss cases that fail in streaming. Mirror
    the runtime's 3 ms RMS gate, 480 ms pre-roll, and two-frame hangover so the
    mined features match what the API sees. Only train and validation splits
    are inspected; held-out test audio is never mined.
    """
    positives = []
    negatives = []
    for row in rows:
        is_user_recording = row["source_kind"] == "real_recording"
        is_hard_negative_phrase = (
            row["source_kind"] == "synthetic_kokoro" and row["label"] == "negative"
            and row.get("phrase") in (hard_negative_phrases or set())
        )
        if (row["split"] != split or row["label"] == "background"
                or not (is_user_recording or is_hard_negative_phrase)):
            continue
        samples = read_wav(ROOT / row["path"])
        padded = np.concatenate((np.zeros(16000, dtype=np.int16), samples, np.zeros(16000, dtype=np.int16)))
        runtime.reset()
        quiet_frames = deque(maxlen=6)
        speaking = False
        quiet_hangover = 0
        candidates = []
        for offset in range(0, padded.size, 1280):
            frame = padded[offset:offset + 1280]
            if frame.size < 1280:
                frame = np.pad(frame, (0, 1280 - frame.size))
            rms = float(np.sqrt(np.mean(np.square(frame.astype(np.float32))))) / 32768
            if rms < 0.003:
                if speaking and quiet_hangover < 2:
                    quiet_hangover += 1
                else:
                    if speaking:
                        runtime.reset()
                        speaking = False
                    quiet_frames.append(frame.copy())
                    continue
            else:
                if not speaking and quiet_frames:
                    frame = np.concatenate((*quiet_frames, frame))
                quiet_frames.clear()
                speaking = True
                quiet_hangover = 0
            score = float(runtime.predict(frame)["luna"])
            if score >= min_score:
                features = runtime.preprocessor.get_features(16)[0].copy()
                candidates.append((score, features))
        best = [features for _, features in sorted(candidates, key=lambda pair: pair[0], reverse=True)[:3]]
        (positives if row["label"] == "positive" else negatives).extend(best)
    return positives, negatives


def refine_with_hard_negatives(net, rows: list[dict], X_train: np.ndarray, y_train: np.ndarray,
                               X_val: np.ndarray, y_val: np.ndarray, runtime, config: dict,
                               torch):
    hard_negative_phrases = set(config["train"].get("hard_negative_phrases", []))
    train_pos, train_neg = mine_streaming_features(rows, "train", runtime,
                                                   hard_negative_phrases=hard_negative_phrases)
    val_pos, val_neg = mine_streaming_features(rows, "validation", runtime,
                                               hard_negative_phrases=hard_negative_phrases)
    mined = {"train_positive": len(train_pos), "train_hard_negative": len(train_neg),
             "validation_positive": len(val_pos), "validation_hard_negative": len(val_neg)}
    print(f"Streaming hard-negative mining: {mined}")
    if not train_neg or not train_pos:
        return net, mined, []
    extra_train = np.stack(train_pos + train_neg * 3).astype(np.float32)
    extra_train_y = np.asarray([1] * len(train_pos) + [0] * (len(train_neg) * 3), dtype=np.float32)
    refine_x = torch.from_numpy(np.concatenate((X_train, extra_train)))
    refine_y = torch.from_numpy(np.concatenate((y_train, extra_train_y))[:, None])
    validation_examples = val_pos + val_neg * 2
    if validation_examples:
        val_extra = np.stack(validation_examples).astype(np.float32)
        val_extra_y = np.asarray([1] * len(val_pos) + [0] * (len(val_neg) * 2), dtype=np.float32)
        val_x = torch.from_numpy(np.concatenate((X_val, val_extra)))
        val_y = torch.from_numpy(np.concatenate((y_val, val_extra_y))[:, None])
    else:
        val_x = torch.from_numpy(X_val)
        val_y = torch.from_numpy(y_val[:, None])
    loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(refine_x, refine_y),
                                         batch_size=int(config["train"]["batch_size"]), shuffle=True)
    optimizer = torch.optim.Adam(net.parameters(), lr=float(config["train"]["learning_rate"]) / 5)
    criterion = torch.nn.BCELoss()
    best = copy.deepcopy(net)
    best_val = math.inf
    history = []
    for epoch in range(int(config["train"].get("hard_negative_refine_epochs", 8))):
        net.train()
        losses = []
        for x, y in loader:
            optimizer.zero_grad()
            loss = criterion(net(x), y)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        net.eval()
        with torch.no_grad():
            val_loss = float(criterion(net(val_x), val_y).item())
        history.append({"epoch": epoch + 1, "train_loss": float(np.mean(losses)), "validation_loss": val_loss})
        print("Refine", history[-1])
        if val_loss < best_val:
            best_val = val_loss
            best = copy.deepcopy(net)
    return best, mined, history


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    config = load_config(args.config)
    rows = load_rows()
    counts = Counter((row["split"], row["label"]) for row in rows)
    if counts[("train", "positive")] < config["train"]["min_positive_train"]:
        raise SystemExit("Insufficient positive train clips; generate more Kokoro and real examples")
    if counts[("train", "negative")] < config["train"]["min_negative_train"]:
        raise SystemExit("Insufficient negative train clips; generate confusables and collect normal speech")
    if not counts[("validation", "positive")] or not counts[("validation", "negative")]:
        raise SystemExit("Validation split needs both positive and negative clips")
    if not any(row["split"] == "train" and row["label"] == "background" for row in rows):
        raise SystemExit("Collect background training audio before training")

    import torch
    from openwakeword.model import Model as RuntimeModel
    from openwakeword.utils import AudioFeatures

    seed = int(config["train"]["seed"])
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    feature_workers = min(4, os.cpu_count() or 1)
    print(f"Feature extraction workers: {feature_workers}")
    extractor = AudioFeatures(inference_framework="onnx", device="cpu", ncpu=1)
    X_train, y_train = feature_data(rows, "train", config, extractor, rng, feature_workers)
    X_val, y_val = feature_data(rows, "validation", config, extractor, rng, feature_workers)
    dataset = torch.utils.data.TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train[:, None]))
    loader = torch.utils.data.DataLoader(dataset, batch_size=int(config["train"]["batch_size"]), shuffle=True)
    net = build_network(torch)
    optimizer = torch.optim.Adam(net.parameters(), lr=float(config["train"]["learning_rate"]))
    criterion = torch.nn.BCELoss()
    validation_x = torch.from_numpy(X_val)
    validation_y = torch.from_numpy(y_val[:, None])
    best_loss = math.inf
    best_net = None
    patience = 0
    history = []
    for epoch in range(int(config["train"]["epochs"])):
        net.train()
        losses = []
        for x, y in loader:
            optimizer.zero_grad()
            probability = net(x)
            loss = criterion(probability, y)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        net.eval()
        with torch.no_grad():
            val_loss = float(criterion(net(validation_x), validation_y).item())
        history.append({"epoch": epoch + 1, "train_loss": float(np.mean(losses)), "validation_loss": val_loss})
        print(history[-1])
        if val_loss < best_loss:
            best_loss = val_loss
            best_net = copy.deepcopy(net)
            patience = 0
        else:
            patience += 1
            if patience >= int(config["train"]["early_stopping_patience"]):
                break
    if best_net is None:
        raise RuntimeError("No model checkpoint was produced")
    model_path = ROOT / "models" / "luna.onnx"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(best_net.eval(), torch.zeros(1, 16, 96), str(model_path),
                      input_names=["features"], output_names=["score"], opset_version=13)
    # Fails training if the exported classifier cannot load in the exact runtime.
    runtime = RuntimeModel(wakeword_models=[str(model_path)], inference_framework="onnx", vad_threshold=0)
    runtime.predict(np.zeros(1280, dtype=np.int16))
    best_net, mined, refine_history = refine_with_hard_negatives(
        best_net, rows, X_train, y_train, X_val, y_val, runtime, config, torch,
    )
    if refine_history:
        torch.onnx.export(best_net.eval(), torch.zeros(1, 16, 96), str(model_path),
                          input_names=["features"], output_names=["score"], opset_version=13)
        RuntimeModel(wakeword_models=[str(model_path)], inference_framework="onnx", vad_threshold=0)
    torch.save(best_net.state_dict(), ROOT / "models" / "luna_state.pt")
    write_json(ROOT / "reports" / "train.json", {
        "model": str(model_path.relative_to(ROOT)).replace("\\", "/"),
        "manifest_sha256": hashlib.sha256((DATA / "manifest.jsonl").read_bytes()).hexdigest(),
        "training_config": config["train"],
        "openwakeword_version": "0.6.0",
        "torch_version": torch.__version__,
        "samples": {"train": len(y_train), "validation": len(y_val)},
        "best_validation_loss": best_loss,
        "history": history,
        "hard_negative_mining": mined,
        "refine_history": refine_history,
        "note": "Synthetic/validation loss does not certify deployment; evaluate on held-out real recordings.",
    })
    print(f"Exported {model_path}; run evaluate.py on held-out real audio")


if __name__ == "__main__":
    main()
