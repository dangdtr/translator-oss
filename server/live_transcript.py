"""Bounded transcript snapshots, scoped to one Gemini turn and epoch."""
import re


class Transcript:
    def __init__(self):
        self.original = ''
        self.translation = ''
        self.complete = False

    @staticmethod
    def append(current, part):
        text = re.sub(r'\s+', ' ', str(part or '')).strip()
        if not text:
            return current
        if text.startswith(current) and current:
            return text[-4000:]
        if current.endswith(text):
            return current
        separator = '' if text[0] in '.,!?;:…' else ' '
        return (current + (separator if current else '') + text)[-4000:]

    def apply(self, update):
        if self.complete and (update.get('original') or update.get('translation')):
            self.original = self.translation = ''
            self.complete = False
        self.original = self.append(self.original, update.get('original'))
        self.translation = self.append(self.translation, update.get('translation'))
        self.complete = update.get('complete') is True
        return {'type': 'caption', 'original': self.original,
                'translation': self.translation, 'complete': self.complete}
