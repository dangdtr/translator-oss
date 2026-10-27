"""VieNeu-TTS v3 Turbo (int8, CPU) worker.

Runs with .venv-vieneu so VieNeu's dependencies stay out of the server venv.
Protocol: one JSON request per stdin line {"id", "text", "out"}; one JSON reply
per stdout line. The first line written is {"ready": true, ...} once the model
is loaded. `--download` fetches the pinned model files into models/vieneu and exits.
"""
import json
import os
from pathlib import Path
import sys
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'models' / 'vieneu'
REVISIONS = {
    'pnnbao-ump/VieNeu-TTS-v3-Turbo': '61b85e3d937fbbacb387714180e8182823512523',
    'OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX': 'ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae',
}
DOWNLOAD = '--download' in sys.argv
os.environ['HF_HOME'] = str(MODELS / 'hf')
# Must be set before huggingface_hub is imported: runtime never touches the network.
if not DOWNLOAD:
    os.environ['HF_HUB_OFFLINE'] = '1'


def patch_fetch():
    from huggingface_hub import hf_hub_download
    from vieneu._v3_turbo_engine import onnx_runtime_lite as lite

    def fetch(repo, files, subfolder):
        # Real files in a local dir, pinned: onnxruntime rejects external .data
        # files reached through Hugging Face cache symlinks.
        target = MODELS / repo.replace('/', '__')
        last = None
        for name in files:
            try:
                last = hf_hub_download(repo, name, subfolder=subfolder or None,
                                       revision=REVISIONS.get(repo), local_dir=target)
            except Exception:
                if name.endswith('.json'):
                    continue
                raise
        return Path(last).parent
    lite.OnnxV3LiteEngine._fetch = staticmethod(fetch)


def write_wav(path, audio, rate):
    import numpy as np
    pcm = (np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    return len(pcm) / rate


def main():
    # Libraries may print to stdout; keep it for protocol lines only.
    protocol = os.fdopen(os.dup(1), 'w', buffering=1)
    os.dup2(2, 1)

    def send(message):
        protocol.write(json.dumps(message, ensure_ascii=False) + '\n')

    patch_fetch()
    from vieneu import Vieneu
    start = time.perf_counter()
    tts = Vieneu(precision='int8', threads=int(os.environ.get('LT_VIENEU_THREADS', '4')))
    voice = os.environ.get('LT_VIENEU_VOICE') or None
    tts.infer('Xin chào.', voice=voice)  # warm-up, and proves every file is present
    if DOWNLOAD:
        print('VieNeu model ready in', MODELS, file=sys.stderr)
        return
    send({'ready': True, 'sample_rate': tts.sample_rate, 'voice': voice or tts._default_voice,
          'load_seconds': round(time.perf_counter() - start, 2)})
    for line in sys.stdin:
        request = json.loads(line)
        try:
            began = time.perf_counter()
            duration = write_wav(request['out'], tts.infer(request['text'], voice=voice), tts.sample_rate)
            send({'id': request['id'], 'ok': True, 'duration': round(duration, 3),
                  'seconds': round(time.perf_counter() - began, 3)})
        except Exception as error:  # one bad sentence must not kill the worker
            send({'id': request['id'], 'ok': False, 'error': f'{type(error).__name__}: {error}'})


if __name__ == '__main__':
    main()
