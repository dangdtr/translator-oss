export function encodeLiveAudio(epoch: number, sequence: number, pcm: ArrayBuffer): ArrayBuffer {
  const frame = new Uint8Array(8 + pcm.byteLength);
  const header = new DataView(frame.buffer);
  header.setUint32(0, epoch);
  header.setUint32(4, sequence);
  frame.set(new Uint8Array(pcm), 8);
  return frame.buffer;
}

export function decodeLiveAudio(frame: ArrayBuffer): { epoch: number; sequence: number; pcm: ArrayBuffer } {
  if (frame.byteLength < 10 || frame.byteLength > 240008 || frame.byteLength % 2) {
    throw new Error('InvalidLiveAudioFrame');
  }
  const header = new DataView(frame);
  return { epoch: header.getUint32(0), sequence: header.getUint32(4), pcm: frame.slice(8) };
}
