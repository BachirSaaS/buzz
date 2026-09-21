// AudioWorklet globals exist on the audio rendering thread, outside the DOM.
const { AudioWorkletProcessor, registerProcessor, sampleRate } = globalThis;
class InterfaceAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1600);
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.buffer[this.offset++] = this.sum / this.count;
        this.phase -= sampleRate;
        this.sum = 0;
        this.count = 0;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(1600);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("interface-audio-capture", InterfaceAudioCapture);
