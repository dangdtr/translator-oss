// Runs on the Web Audio rendering thread. Batching keeps port traffic low while
// the offscreen controller performs resampling, framing and WebSocket I/O.
class LiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.[0]?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] || 0;
      this.buffer[this.offset++] = sample / channels.length;
      if (this.offset === this.buffer.length) {
        const block = this.buffer;
        this.buffer = new Float32Array(1024);
        this.offset = 0;
        this.port.postMessage(block.buffer, [block.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('live-capture-processor', LiveCaptureProcessor);
