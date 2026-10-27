"""Gemini enhancement for noisy auto-generated English captions.

The model never receives video URLs or timestamps. It identifies sentence
boundaries by a small list of cue indexes, so the extension remains the sole
owner of timing and can reject invalid model output safely.
"""

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
import time

from server.perf import log as perf_log


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache'
PROMPT_VERSION = 'auto-cc-v2-context'
MAX_CUES = 48
_lock = threading.Lock()


def configured():
    return bool(os.environ.get('GEMINI_API_KEY'))


def model_name():
    return os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash-lite')


def validate_window(cues, items):
    """Accept only ordered, in-range non-empty sentence mappings."""
    if not isinstance(items, list):
        return None
    previous_end, valid = 0, []
    for item in items:
        if not isinstance(item, dict):
            return None
        start, end = item.get('start'), item.get('end')
        original, translation = item.get('original'), item.get('translation')
        if not isinstance(start, int) or not isinstance(end, int) or not (previous_end <= start < end <= len(cues)):
            return None
        if not isinstance(original, str) or not isinstance(translation, str):
            return None
        original, translation = original.strip(), translation.strip()
        if not original or not translation or len(original) > 2000 or len(translation) > 3000:
            return None
        valid.append({'start': start, 'end': end, 'original': original, 'translation': translation})
        previous_end = end
    return valid or None


def _database():
    CACHE.mkdir(exist_ok=True)
    db = sqlite3.connect(CACHE / 'caption_polish.sqlite3', timeout=30)
    db.execute('CREATE TABLE IF NOT EXISTS caption_polish (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return db


def _key(cues):
    payload = json.dumps(cues, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(f'{PROMPT_VERSION}:{model_name()}:{payload}'.encode()).hexdigest()


def _prompt(cues):
    return """You repair English YouTube auto-generated captions and translate them to natural Vietnamese using the full context of the entire cue window.
The input is an ordered JSON array of short cue strings. Return JSON only:
{"sentences":[{"start":0,"end":2,"original":"Polished complete English sentence.","translation":"Bản dịch tiếng Việt tự nhiên."}]}

Rules:
- start is inclusive and end is exclusive indexes into the input array.
- Return ordered, non-overlapping ranges. Cover every cue when possible.
- Preserve the spoken meaning; repair obvious ASR errors only. Do not invent facts.
- Add punctuation and sentence casing to original. Do not include timestamps, notes, or markdown.
- Read the complete window before translating any sentence. Resolve pronouns, omitted subjects, terminology, tone, and ambiguous words from surrounding cues.
- Translate meaning in context, not cue-by-cue and not word-for-word. Keep terminology and names consistent across the window.
- Vietnamese must sound natural when spoken aloud while remaining faithful to the English meaning.

Input cues:
""" + json.dumps(cues, ensure_ascii=False, separators=(',', ':'))


def polish_window(cues):
    """Return cached/validated Gemini sentences, or None when unavailable."""
    began = time.perf_counter()
    if not configured() or not 1 <= len(cues) <= MAX_CUES or any(not isinstance(cue, str) or not cue.strip() for cue in cues):
        return None
    key = _key(cues)
    with _database() as db:
        found = db.execute('SELECT value FROM caption_polish WHERE key=?', (key,)).fetchone()
    if found:
        try:
            cached = validate_window(cues, json.loads(found[0]))
            if cached:
                perf_log('gemini', ms=round((time.perf_counter() - began) * 1000, 1), model=model_name(),
                         cues=len(cues), characters=sum(map(len, cues)), cached=True, success=True)
                return cached
        except (TypeError, json.JSONDecodeError):
            pass
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=os.environ['GEMINI_API_KEY'])
        response = client.models.generate_content(
            model=model_name(), contents=_prompt(cues),
            config=types.GenerateContentConfig(response_mime_type='application/json'),
        )
        parsed = json.loads(response.text or '{}')
        sentences = validate_window(cues, parsed.get('sentences'))
    except Exception as error:
        perf_log('gemini', ms=round((time.perf_counter() - began) * 1000, 1), model=model_name(),
                 cues=len(cues), characters=sum(map(len, cues)), cached=False, success=False,
                 error=type(error).__name__)
        return None
    if not sentences:
        perf_log('gemini', ms=round((time.perf_counter() - began) * 1000, 1), model=model_name(),
                 cues=len(cues), characters=sum(map(len, cues)), cached=False, success=False, error='InvalidResponse')
        return None
    with _lock, _database() as db:
        db.execute('INSERT OR REPLACE INTO caption_polish VALUES (?, ?)', (key, json.dumps(sentences, ensure_ascii=False)))
    perf_log('gemini', ms=round((time.perf_counter() - began) * 1000, 1), model=model_name(),
             cues=len(cues), characters=sum(map(len, cues)), cached=False, success=True)
    return sentences
