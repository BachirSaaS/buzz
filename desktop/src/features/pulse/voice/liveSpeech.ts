export type SpeechSlice = { id: number; pcm: Float32Array; final: boolean };
/** Bounded rolling speech windows: partials while speaking, automatic finalization on a short pause. */
export class LiveSpeechBuffer {
  private id = 0;
  private blocks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private duration = 0;
  private quiet = 0;
  private voiced = 0;
  private sinceDecode = 0;
  push(block: Float32Array): SpeechSlice | null {
    const ms = block.length / 16;
    const rms = Math.sqrt(
      block.reduce((sum, value) => sum + value * value, 0) / block.length,
    );
    const speaking = rms >= 0.009;
    if (!this.blocks.length && !speaking) {
      this.preRoll.push(block);
      if (this.preRoll.length > 3) this.preRoll.shift();
      return null;
    }
    if (!this.blocks.length) {
      this.blocks.push(...this.preRoll);
      this.preRoll = [];
    }
    this.blocks.push(block);
    this.duration += ms;
    this.sinceDecode += ms;
    this.quiet = speaking ? 0 : this.quiet + ms;
    if (speaking) this.voiced += ms;
    const final = this.quiet >= 500 || this.duration >= 12_000;
    if (!final && (this.voiced < 400 || this.sinceDecode < 650)) return null;
    const pcm = new Float32Array(
      this.blocks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of this.blocks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const result = this.voiced >= 200 ? { id: this.id, pcm, final } : null;
    this.sinceDecode = 0;
    if (final) {
      this.id++;
      this.blocks = [];
      this.duration = this.quiet = this.voiced = 0;
    }
    return result;
  }
}
/** Encode local mono 16 kHz PCM for the native recognizer without a WAV round trip. */
export function encodeSpeech(pcm: Float32Array) {
  const bytes = new Uint8Array(pcm.length * 4);
  const view = new DataView(bytes.buffer);
  pcm.forEach((sample, i) => {
    view.setFloat32(i * 4, Math.max(-1, Math.min(1, sample)), true);
  });
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
