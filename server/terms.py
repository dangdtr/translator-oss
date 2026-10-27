"""Glossary for translation and pronunciation, loaded from glossary.json.

The file is re-read when it changes, so terms can be edited while the server
runs. Its digest is part of the translation cache key.
"""
import hashlib
import json
from pathlib import Path
import re
import threading

GLOSSARY_FILE = Path(__file__).with_name('glossary.json')
LETTERS = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ', [
    'ây', 'bi', 'xi', 'đi', 'i', 'ép', 'di', 'ết', 'ai', 'giây', 'cây', 'eo', 'em',
    'en', 'âu', 'pi', 'kiu', 'a', 'ét', 'ti', 'diu', 'vi', 'đáp liu', 'ích', 'oai', 'dét']))
DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
ACRONYM = re.compile(r'\b([A-Z]{2,6}\d*|[A-Z]\d+)\b')
SYMBOLS = [(re.compile(r'\s*&\s*'), ' và '), (re.compile(r'\s*\+\s*'), ' cộng '), (re.compile(r'\s*@\s*'), ' a còng '),
           (re.compile(r'\s*[()\[\]]\s*'), ', ')]


def _pattern(terms, flags=0):
    if not terms:
        return None
    # Longest first so "Amazon S3 Glacier" wins over "Amazon S3".
    parts = []
    for term in sorted(terms, key=len, reverse=True):
        escaped = re.escape(term)
        parts.append(('\\b' if term[0].isalnum() else '') + escaped + ('\\b' if term[-1].isalnum() else ''))
    return re.compile('|'.join(parts), flags)


class Glossary:
    def __init__(self, path=GLOSSARY_FILE):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.mtime = None
        self.digest = ''
        self._load({})

    def _load(self, data):
        self.keep = list(data.get('keep', []))
        self.translate = {key.lower(): value for key, value in data.get('translate', {}).items()}
        self.pronounce = dict(data.get('pronounce', {}))
        self.fixes = [(re.compile(rule['when'], re.IGNORECASE) if rule.get('when') else None,
                       [(re.compile(pattern), value) for pattern, value in rule['replace'].items()])
                      for rule in data.get('fix', [])]
        self.keep_re = _pattern(self.keep)
        self.translate_re = _pattern(self.translate, re.IGNORECASE)
        self.pronounce_re = _pattern(self.pronounce)

    def refresh(self):
        try:
            mtime = self.path.stat().st_mtime_ns
        except FileNotFoundError:
            mtime = None
        with self.lock:
            if mtime == self.mtime:
                return
            raw = self.path.read_bytes() if mtime is not None else b'{}'
            self._load(json.loads(raw))
            self.digest = hashlib.sha256(raw).hexdigest()[:16]
            self.mtime = mtime

    def protect(self, text):
        """Replace glossary terms with placeholders the model copies verbatim.

        Returns (masked_text, restore). restore(output) gives the final text,
        or None if the model dropped or duplicated a placeholder.
        """
        original, replacements = text, []
        # T0, T1… survive OPUS-MT reliably; X0X is the fallback when the text
        # already contains T-number tokens such as EC2 instance families.
        make = (lambda i: f'X{i}X') if re.search(r'\bT\d+\b', text) else (lambda i: f'T{i}')

        def substitute(pattern, value, skip=None):
            nonlocal text
            if pattern is None:
                return

            def swap(match):
                if skip is not None and skip.fullmatch(match.group(0)):
                    return match.group(0)
                replacements.append(value(match.group(0)))
                return make(len(replacements) - 1)
            text = pattern.sub(swap, text)
        pattern = re.compile(r'\bT(\d+)\b' if make(0) == 'T0' else r'\bX(\d+)X\b')
        substitute(self.keep_re, lambda term: term)
        substitute(self.translate_re, lambda term: self.translate[term.lower()])
        # Bare acronyms get mangled too ("IAM" -> "IM"); keep them verbatim.
        substitute(ACRONYM, lambda term: term, skip=pattern)
        masked = text

        def restore(output):
            found = [int(n) for n in pattern.findall(output)]
            if sorted(found) != list(range(len(replacements))):
                return None
            result = pattern.sub(lambda m: replacements[int(m.group(1))], output)
            if original[:1].isupper() and result[:1].islower():
                result = result[:1].upper() + result[1:]
            return result
        return masked, restore

    def postprocess(self, source, output):
        """Correct known mistranslations without masking, so the model's own grammar stays.

        A fix rule applies only when its `when` pattern matches the English source.
        """
        for when, replacements in self.fixes:
            if when is None or when.search(source):
                for pattern, value in replacements:
                    output = pattern.sub(value, output)
        # Models sometimes invent a gloss inside an acronym's parentheses: "(IAM-Mã định danh…)".
        for acronym in set(re.findall(r'\(([A-Z][A-Z0-9]{1,9})\)', source)):
            output = re.sub(r'\(\s*' + re.escape(acronym) + r'\b[^)]*\)', f'({acronym})', output)
        return output

    def speakable(self, text):
        """Rewrite Vietnamese text so Piper reads English names and acronyms clearly."""
        if self.pronounce_re is not None:
            text = self.pronounce_re.sub(lambda m: self.pronounce[m.group(0)], text)

        def spell(match):
            token = match.group(0)
            return ' '.join(LETTERS[c] if c.isalpha() else DIGITS[int(c)] for c in token)
        text = ACRONYM.sub(spell, text)
        for pattern, value in SYMBOLS:
            text = pattern.sub(value, text)
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'\s+([,.;:!?])', r'\1', text)
        text = re.sub(r'([,;:])(?:\s*[,;:])+', r'\1', text)
        return text.strip(' ,')


glossary = Glossary()
