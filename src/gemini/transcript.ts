export class Transcript {
  original = '';
  translation = '';
  complete = false;
  static append(current: string, part?: string) {
    const text = (part || '').replace(/\s+/g, ' ').trim();
    if (!text || current.endsWith(text)) return current;
    if (current && text.startsWith(current)) return text.slice(-4000);
    return (current + (current && !/^[.,!?;:…]/.test(text) ? ' ' : '') + text).slice(-4000);
  }
  reset() {
    this.original = '';
    this.translation = '';
    this.complete = false;
  }
  apply(update: { original?: string; translation?: string; complete?: boolean }) {
    if (this.complete && (update.original || update.translation)) this.reset();
    this.original = Transcript.append(this.original, update.original);
    this.translation = Transcript.append(this.translation, update.translation);
    this.complete = update.complete === true;
    return {
      type: 'caption' as const,
      original: this.original,
      translation: this.translation,
      complete: this.complete,
    };
  }
}
