import hashlib
import asyncio
import io
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from typing import Literal
import wave

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from server.terms import glossary
from server.vieneu_client import vieneu
from server.caption_polish import configured as gemini_configured, model_name as gemini_model, polish_window
from server.perf import log as perf_log
from server.live_translate import serve_live_translation
from server.segmented_dubbing import availability as dubbing_availability, segment as dubbing_segment
from server import dubbing_progress

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache'
CACHE.mkdir(exist_ok=True)
TOKEN_FILE = CACHE / 'token'
if not TOKEN_FILE.exists():
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as token_out:
        token_out.write(secrets.token_urlsafe(32))
TOKEN = TOKEN_FILE.read_text().strip()
app = FastAPI(title='Local Translator', docs_url=None, redoc_url=None)
model_lock = threading.Lock()
voice_lock = threading.Lock()
engine = voice = None


def authorize(authorization: str = Header(default='')):
    if not secrets.compare_digest(authorization, 'Bearer ' + TOKEN):
        raise HTTPException(401, 'Token không hợp lệ. Chạy scripts/pair.py rồi tải lại extension.')


@app.websocket('/live/translate')
async def live_translate(websocket: WebSocket):
    await websocket.accept()
    supplied_token = websocket.query_params.get('token', '')
    if not secrets.compare_digest(supplied_token, TOKEN):
        await websocket.close(code=1008)
        return
    voice = websocket.query_params.get('voice')
    prompt = websocket.query_params.get('prompt')
    await serve_live_translation(websocket, voice=voice, prompt=prompt)


def model_path():
    return next((ROOT / 'models').glob('*/model/model.bin'), None)


def voice_path():
    return ROOT / 'models/voice/vi_VN-vais1000-medium.onnx'


def database():
    db = sqlite3.connect(CACHE / 'translations.sqlite3', timeout=30)
    db.execute('CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return db


def split_text(text):
    # Keep each inference safely below the model token limit, including long code-like prose.
    chunks = []
    for sentence in re.split(r'(?<=[.!?])\s+|\n+', text.strip()):
        words = sentence.split()
        current = ''
        for word in words:
            if len(current) + len(word) > 350 and current:
                chunks.append(current)
                current = ''
            while len(word) > 350:
                if current:
                    chunks.append(current)
                    current = ''
                chunks.append(word[:350])
                word = word[350:]
            current = (current + ' ' + word).strip()
        if current:
            chunks.append(current)
    return chunks


class Engine:
    """A CTranslate2 model plus its SentencePiece tokenizer and I/O conventions."""

    def __init__(self, name, tag, directory, tokenizer_file, prefix='', strip=None):
        self.name, self.tag, self.directory, self.tokenizer_file = name, tag, directory, tokenizer_file
        self.prefix, self.strip = prefix, strip
        self.suffix = ['</s>'] if prefix else []
        self.translator = self.tokenizer = None

    def load(self):
        if self.translator is None:
            import ctranslate2
            import sentencepiece
            self.translator = ctranslate2.Translator(str(self.directory), device='cpu', compute_type='int8', intra_threads=4)
            self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(self.tokenizer_file))

    def run(self, chunks):
        tokens = [self.tokenizer.encode(self.prefix + chunk, out_type=str) + self.suffix for chunk in chunks]
        results = self.translator.translate_batch(tokens, beam_size=2, max_decoding_length=512)
        outputs = []
        for item in results:
            output = self.tokenizer.decode(item.hypotheses[0]).replace('▁', ' ')
            if self.strip:
                output = self.strip.sub('', output)
            outputs.append(re.sub(r' +', ' ', output).strip())
        return outputs


def find_engine():
    """Prefer VietAI envit5 (scripts/setup_envit5.sh); fall back to Argos OPUS-MT.

    LT_TRANSLATION_ENGINE=opus-mt forces the fallback.
    """
    envit5 = ROOT / 'models/envit5-translation'
    if os.environ.get('LT_TRANSLATION_ENGINE') != 'opus-mt' and (envit5 / 'model.bin').exists():
        revision = (envit5 / 'REVISION').read_text().strip()[:12] if (envit5 / 'REVISION').exists() else 'local'
        # The model can echo a "vi: " target prefix.
        return Engine('envit5', 'envit5-' + revision, envit5, envit5 / 'spiece.model', 'en: ', re.compile(r'^\s*vi\s*:\s*'))
    path = model_path()
    if path is not None:
        return Engine('opus-mt', 'argos-en-vi-1.9', path.parent, path.parent.parent / 'sentencepiece.model')
    return None


def translate_texts(texts):
    """Translate many texts with one batched model call for everything not cached."""
    began = time.perf_counter()
    global engine
    glossary.refresh()
    with model_lock:
        if engine is None:
            engine = find_engine()
            if engine is None:
                raise HTTPException(503, 'Chưa có model dịch. Chạy python scripts/setup_models.py.')
            engine.load()
        current = engine
    keys = [hashlib.sha256(f'{current.tag}:v4:{glossary.digest}:{text}'.encode()).hexdigest() for text in texts]
    results = [text if not text.strip() else None for text in texts]
    with database() as db:
        for i, key in enumerate(keys):
            if results[i] is None:
                found = db.execute('SELECT value FROM translations WHERE key=?', (key,)).fetchone()
                if found:
                    results[i] = found[0]
    pending = [i for i, result in enumerate(results) if result is None]
    if not pending:
        perf_log('translate', ms=round((time.perf_counter() - began) * 1000, 1), engine=current.name,
                 texts=len(texts), characters=sum(map(len, texts)), cached=True, misses=0, model_ms=0)
        return results
    chunks = [(i, chunk) for i in pending for chunk in split_text(texts[i])]
    protected = [glossary.protect(chunk) for _, chunk in chunks]
    model_began = time.perf_counter()
    with model_lock:
        outputs = [restore(output) for (_, restore), output in zip(protected, current.run([masked for masked, _ in protected]))]
        # A dropped or duplicated placeholder means the glossary would corrupt
        # the sentence; translate that chunk without it instead.
        failed = [n for n, output in enumerate(outputs) if output is None]
        for n, output in zip(failed, current.run([chunks[n][1] for n in failed]) if failed else []):
            outputs[n] = output
    model_ms = round((time.perf_counter() - model_began) * 1000, 1)
    parts = {i: [] for i in pending}
    for (i, chunk), output in zip(chunks, outputs):
        parts[i].append(glossary.postprocess(chunk, output))
    with database() as db:
        for i in pending:
            results[i] = ' '.join(parts[i])
            db.execute('INSERT OR REPLACE INTO translations VALUES (?, ?)', (keys[i], results[i]))
    perf_log('translate', ms=round((time.perf_counter() - began) * 1000, 1), engine=current.name,
             texts=len(texts), characters=sum(map(len, texts)), cached=False, misses=len(pending), model_ms=model_ms)
    return results


def translate_text(text):
    return translate_texts([text])[0]


class TranslationRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=24)
    source: str = 'en'
    target: str = 'vi'


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    # auto: VieNeu when installed, else Piper. piper: fast voice. vieneu: natural neural voice.
    voice: Literal['auto', 'piper', 'vieneu'] = 'auto'


class DubbingRequest(BaseModel):
    video_id: str = Field(pattern=r'^[A-Za-z0-9_-]{11}$')
    index: int = Field(ge=0, le=10800, strict=True)
    job_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9-]{1,64}$')


@app.post('/dubbing/segment', dependencies=[Depends(authorize)])
async def dubbing(request: DubbingRequest, http_request: Request):
    task = asyncio.create_task(dubbing_segment(request.video_id, request.index,
                              progress=lambda stage: dubbing_progress.update(request.job_id, stage)))
    if request.job_id:
        dubbing_tasks[request.job_id] = task
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.2)
            if await http_request.is_disconnected():
                task.cancel()
                break
        return await task
    except asyncio.CancelledError:
        dubbing_progress.update(request.job_id, 'cancelled')
        raise HTTPException(499, 'Đã hủy đoạn ở vị trí cũ.') from None
    except Exception:
        dubbing_progress.update(request.job_id, 'error')
        raise
    finally:
        if not task.done():
            task.cancel()
        if request.job_id and dubbing_tasks.get(request.job_id) is task:
            dubbing_tasks.pop(request.job_id, None)


dubbing_tasks = {}


class DubbingCancelRequest(BaseModel):
    job_id: str = Field(pattern=r'^[A-Za-z0-9-]{1,64}$')


@app.post('/dubbing/cancel', dependencies=[Depends(authorize)])
async def dubbing_cancel(request: DubbingCancelRequest):
    task = dubbing_tasks.get(request.job_id)
    if task and not task.done():
        task.cancel()
    return {'cancelled': bool(task)}


@app.get('/dubbing/status/{job_id}', dependencies=[Depends(authorize)])
def dubbing_status(job_id: str):
    if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', job_id):
        raise HTTPException(400, 'Request ID không hợp lệ.')
    return dubbing_progress.status(job_id)


class CaptionPolishRequest(BaseModel):
    cues: list[str] = Field(min_length=1, max_length=48)
    window_key: str = Field(min_length=1, max_length=80)


@app.get('/health')
def health():
    found = engine or find_engine()
    return {'ok': True, 'translation_ready': found is not None, 'translation_engine': found.name if found else None,
            'voice_ready': voice_path().exists(), 'voices': {'piper': voice_path().exists(), 'vieneu': vieneu.installed()},
            'source': 'en', 'target': 'vi', 'offline': True,
            'live': {'configured': gemini_configured(), 'protocol_versions': [1, 2]},
            'dubbing': dubbing_availability(),
            'caption_polish': {'provider': 'gemini' if gemini_configured() else None,
                                'model': gemini_model() if gemini_configured() else None, 'auto_cc_only': True}}


@app.post('/translate', dependencies=[Depends(authorize)])
def translate(request: TranslationRequest):
    if request.source != 'en' or request.target != 'vi':
        raise HTTPException(400, 'Bản đầu hỗ trợ Anh → Việt.')
    if any(len(text) > 6000 for text in request.texts) or sum(map(len, request.texts)) > 24000:
        raise HTTPException(413, 'Quá nhiều văn bản trong một lượt. Hãy chia nhỏ.')
    return {'translations': translate_texts(request.texts)}


@app.post('/captions/polish', dependencies=[Depends(authorize)])
def captions_polish(request: CaptionPolishRequest):
    # window_key is only a client request identity; cache identity derives from
    # the exact local cue text and the model/prompt revision.
    began = time.perf_counter()
    sentences = polish_window(request.cues)
    perf_log('caption_polish_request', ms=round((time.perf_counter() - began) * 1000, 1),
             cues=len(request.cues), characters=sum(map(len, request.cues)), available=bool(sentences), model=gemini_model())
    return {'available': bool(sentences), 'sentences': sentences or []}


AUDIO = CACHE / 'audio'


def trim_audio_cache(keep):
    # Bound the on-disk voice cache to about 256 MB, oldest first.
    files = sorted(AUDIO.glob('*.wav'), key=lambda item: item.stat().st_mtime)
    size = sum(item.stat().st_size for item in files)
    for old in files:
        if size <= 256 * 1024 * 1024:
            break
        if old != keep:
            size -= old.stat().st_size
            old.unlink(missing_ok=True)


def piper_speech(text):
    global voice
    path = AUDIO / (hashlib.sha256(('piper-vais1000-v2:' + text).encode()).hexdigest() + '.wav')
    with voice_lock:
        cached = path.exists()
        if not cached:
            if not voice_path().exists():
                raise HTTPException(503, 'Chưa có model giọng đọc. Chạy python scripts/setup_models.py.')
            if voice is None:
                from piper import PiperVoice
                voice = PiperVoice.load(voice_path())
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as output:
                voice.synthesize_wav(text, output)
            path.write_bytes(buffer.getvalue())
            trim_audio_cache(path)
        return path.read_bytes(), cached, None


def vieneu_speech(text):
    voice_name = os.environ.get('LT_VIENEU_VOICE', '')
    path = AUDIO / (hashlib.sha256(f'vieneu-v3turbo-int8:{voice_name}:v1:{text}'.encode()).hexdigest() + '.wav')
    cached = path.exists()
    worker_seconds = None
    if not cached:
        partial = path.with_suffix('.part.wav')
        result = vieneu.synthesize(text, partial)
        worker_seconds = result.get('seconds')
        partial.replace(path)
        trim_audio_cache(path)
    return path.read_bytes(), cached, worker_seconds


if vieneu.installed():
    threading.Thread(target=vieneu.warm, daemon=True).start()


@app.post('/tts', dependencies=[Depends(authorize)])
def tts(request: SpeechRequest):
    began = time.perf_counter()
    glossary.refresh()
    AUDIO.mkdir(exist_ok=True)
    text = glossary.speakable(request.text) or request.text
    engine = 'vieneu' if request.voice != 'piper' and vieneu.available() else 'piper'
    if engine == 'vieneu':
        try:
            audio, cached, worker_seconds = vieneu_speech(text)
        except Exception as error:
            print(f'VieNeu failed, using Piper: {error}', flush=True)
            engine = 'piper'
    if engine == 'piper':
        audio, cached, worker_seconds = piper_speech(text)
    perf_log('tts', ms=round((time.perf_counter() - began) * 1000, 1), engine=engine, cached=cached,
             characters=len(text), bytes=len(audio), worker_ms=round(worker_seconds * 1000, 1) if worker_seconds is not None else None)
    # The extension logs which voice actually spoke.
    return Response(audio, media_type='audio/wav', headers={'X-Voice-Engine': engine})
