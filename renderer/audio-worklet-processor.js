// AudioWorklet processor — runs off the main thread for low-latency audio capture.
// Replaces the deprecated ScriptProcessor. Receives Float32 audio, downmixes any
// multichannel loopback stream to mono, converts to Int16 PCM, and sends it to
// the main thread via MessagePort.

function downmixToMono(input) {
  if (!input || !input.length || !input[0]) return new Float32Array(0);
  if (input.length === 1) return input[0];

  const frames = input[0].length;
  const mono = new Float32Array(frames);
  for (let channel = 0; channel < input.length; channel++) {
    const samples = input[channel];
    if (!samples) continue;
    const count = Math.min(frames, samples.length);
    for (let i = 0; i < count; i++) mono[i] += samples[i];
  }
  const scale = 1 / input.length;
  for (let i = 0; i < frames; i++) mono[i] *= scale;
  return mono;
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class ClarityAudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this._bufferSize = 4096; // accumulate before sending (matches old ScriptProcessor)
      this._buffer = new Float32Array(this._bufferSize);
      this._writeIndex = 0;
    }

    process(inputs, _outputs, _parameters) {
      const input = inputs[0];
      if (!input || !input[0]) return true;

      const channelData = downmixToMono(input);
      for (let i = 0; i < channelData.length; i++) {
        this._buffer[this._writeIndex++] = channelData[i];
        if (this._writeIndex >= this._bufferSize) {
          this._flush();
        }
      }
      return true;
    }

    _flush() {
      // Convert Float32 [-1,1] to Int16 PCM
      const pcm = new Int16Array(this._writeIndex);
      for (let i = 0; i < this._writeIndex; i++) {
        const s = Math.max(-1, Math.min(1, this._buffer[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this._buffer = new Float32Array(this._bufferSize);
      this._writeIndex = 0;
    }
  }

  registerProcessor('clarity-audio-processor', ClarityAudioProcessor);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { downmixToMono };
