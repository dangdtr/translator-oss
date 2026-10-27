"""Download public English→Vietnamese translation and Vietnamese speech models."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'models'


def download(url, path, md5=None):
    if path.exists() and (not md5 or hashlib.md5(path.read_bytes()).hexdigest() == md5):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f'Downloading {path.name} …', flush=True)
    temporary = path.with_suffix(path.suffix + '.part')
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as out:
        while chunk := response.read(1024 * 1024):
            out.write(chunk)
    if md5 and hashlib.md5(temporary.read_bytes()).hexdigest() != md5:
        temporary.unlink()
        raise RuntimeError(f'Checksum mismatch: {path.name}')
    temporary.replace(path)


def main():
    MODELS.mkdir(exist_ok=True)
    archive = MODELS / 'en_vi.argosmodel'
    download('https://argos-net.com/v1/translate-en_vi-1_9.argosmodel', archive)
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            destination = (MODELS / member.filename).resolve()
            if not destination.is_relative_to(MODELS.resolve()):
                raise RuntimeError('Unsafe archive path')
        package.extractall(MODELS)
    catalog = json.load(urllib.request.urlopen('https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json', timeout=60))
    voice = catalog['vi_VN-vais1000-medium']
    for remote, info in voice['files'].items():
        download('https://huggingface.co/rhasspy/piper-voices/resolve/main/' + remote,
                 MODELS / 'voice' / Path(remote).name, info['md5_digest'])
    print('Models ready.', flush=True)


if __name__ == '__main__':
    main()
