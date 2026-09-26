"""Enable controlled local Kokoro voice packs in the existing TTS image.

The upstream API rejects file voices even though its underlying Kokoro
KPipeline supports ``.pt`` packs. Keep this patch deliberately narrow and
fail the image build if the expected upstream source changes.
"""

from pathlib import Path


def replace_once(source: str, old: str, new: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Kokoro source changed: expected one match, got {count}: {old[:72]!r}")
    return source.replace(old, new)


server_path = Path("/opt/api/app/server.py")
server = server_path.read_text(encoding="utf-8")
server = replace_once(server, "import logging\n", "import logging\nimport re\nfrom pathlib import Path\n")

start = server.index("def _resolve_voice(")
end = server.index("\n\n# ---------------------------------------------------------------------------\n# Endpoints", start)
server = server[:start] + '''def _resolve_voice(voice: str, request: Request) -> str:
    """Resolve only registered built-ins or a safe local pack slug."""
    if voice.startswith("pack://"):
        slug = voice[len("pack://"):]
        if not re.fullmatch(r"[abefhijpz][fm]_[A-Za-z0-9_-]{1,80}", slug):
            raise HTTPException(status_code=422, detail="invalid Kokoro pack id")
        root = _settings(request).voices_path.resolve()
        pack = root / f"{slug}.pt"
        if pack.is_symlink() or pack.resolve().parent != root or not pack.is_file():
            raise HTTPException(status_code=404, detail="Kokoro pack not found")
        return str(pack)

    if voice.startswith(("file://", "http://", "https://", "s3://")):
        raise HTTPException(status_code=422, detail="unsupported voice URI")

    components = [item.strip() for item in voice.split(",") if item.strip()]
    if not components:
        raise HTTPException(status_code=422, detail="voice must not be empty")
    builtin = set(_engine(request).builtin_voices_list)
    for component in components:
        if component not in builtin:
            raise HTTPException(status_code=404, detail=f"voice '{component}' not found")
    return voice
''' + server[end:]

if server.count("_resolve_voice(req.voice, request)") != 2:
    raise RuntimeError("Kokoro speech endpoints changed")
server = server.replace("_resolve_voice(req.voice, request)", "resolved_voice = _resolve_voice(req.voice, request)")
if server.count("voice=req.voice,") != 2:
    raise RuntimeError("Kokoro voice call sites changed")
server = server.replace("voice=req.voice,", "voice=resolved_voice,")
server_path.write_text(server, encoding="utf-8")

engine_path = Path("/opt/api/app/engine.py")
engine = engine_path.read_text(encoding="utf-8")
engine = replace_once(engine, "import threading\n", "import threading\nfrom pathlib import Path\n")
engine = replace_once(
    engine,
    '        first = voice.split(",", 1)[0].strip()\n',
    '        first = voice.split(",", 1)[0].strip()\n        if first.endswith(".pt"):\n            first = Path(first).stem\n',
)
engine_path.write_text(engine, encoding="utf-8")
