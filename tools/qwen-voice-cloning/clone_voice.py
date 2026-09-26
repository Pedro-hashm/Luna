import argparse
from pathlib import Path
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

parser = argparse.ArgumentParser()
parser.add_argument('--reference', required=True)
parser.add_argument('--reference-text', required=True)
parser.add_argument('--text', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--model', default='Qwen/Qwen3-TTS-12Hz-0.6B-Base')
parser.add_argument('--max-new-tokens', type=int, default=512)
args = parser.parse_args()

if not torch.cuda.is_available():
    raise SystemExit('Qwen3-TTS voice cloning is configured here to use the NVIDIA GPU, but CUDA is unavailable.')

model = Qwen3TTSModel.from_pretrained(
    args.model,
    device_map='cuda:0',
    dtype=torch.bfloat16,
)
wavs, sample_rate = model.generate_voice_clone(
    text=args.text,
    language='Portuguese',
    ref_audio=args.reference,
    ref_text=args.reference_text,
    max_new_tokens=args.max_new_tokens,
)
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
sf.write(args.output, wavs[0], sample_rate)
print(f'Wrote {args.output} ({sample_rate} Hz, {len(wavs[0]) / sample_rate:.1f}s)')
