"""Install only openWakeWord's shared ONNX audio feature models with fixed hashes."""

from __future__ import annotations

import hashlib
import pathlib
import urllib.request

import openwakeword


BASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/"
MODELS = {
    "embedding_model.onnx": "70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f",
    "melspectrogram.onnx": "ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f",
}


def main() -> None:
    directory = pathlib.Path(openwakeword.__file__).parent / "resources" / "models"
    directory.mkdir(parents=True, exist_ok=True)
    for name, expected_sha in MODELS.items():
        target = directory / name
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected_sha:
            continue
        temp = target.with_suffix(".download")
        try:
            urllib.request.urlretrieve(BASE + name, temp)
            if hashlib.sha256(temp.read_bytes()).hexdigest() != expected_sha:
                raise RuntimeError(f"Hash mismatch for {name}")
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
        print(f"Installed {target}")


if __name__ == "__main__":
    main()
