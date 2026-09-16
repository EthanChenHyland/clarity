// AudioWorklet processor — runs off the main thread for low-latency audio capture.
// Replaces the deprecated ScriptProcessor. Receives Float32 audio, downmixes any
// multichannel loopback stream to mono, converts to Int16 PCM, and sends it to
// the main thread via MessagePort.

function downmixToMono(input) {
  if (!input || !input.length || !input[0]) return new Float32Array(0);
  if (input.length === 1) return input[0];

  const frames = input[0].length;
  const energies = input.map(samples => samples ? samples.reduce((sum, x) => sum + x * x, 0) : 0);
  const strongest = energies.indexOf(Math.max(...energies));
  const peakEnergy = energies[strongest];
  if (!peakEnergy) return input[0];
  // Ignore empty/near-empty channels rather than attenuating the useful signal.
  const active = input.filter((samples, i) => samples && energies[i] > peakEnergy * 0.01);
  if (active.length === 1) return active[0];
  const mono = new Float32Array(frames);
  for (const samples of active) {
    for (let i = 0; i < Math.min(frames, samples.length); i++) mono[i] += samples[i] / active.length;
  }
  const mixedEnergy = mono.reduce((sum, x) => sum + x * x, 0);
  // Destructive phase cancellation: retain a real channel instead of amplifying
  // the near-zero difference signal. Otherwise preserve the strongest input RMS.
  if (mixedEnergy < peakEnergy * 0.25) return input[strongest];
  const gain = Math.sqrt(peakEnergy / mixedEnergy);
  for (let i = 0; i < frames; i++) mono[i] *= gain;
  return mono;
}

// Bounded gain for quiet loopback audio before speech detection. A fast peak
// attack prevents clipping; slow release avoids amplifying every pause separately.
class AudioConditioner {
  constructor(maxGain = 1) { this.maxGain = maxGain; this.peak = 0; }
  process(samples) {
    if (this.maxGain === 1) return samples;
    const output = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      this.peak = Math.max(Math.abs(samples[i]), this.peak * 0.999875);
      output[i] = samples[i] * Math.min(this.maxGain, 0.9 / Math.max(this.peak, 0.000001));
    }
    return output;
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class ClarityAudioProcessor extends AudioWorkletProcessor {
    constructor(options = {}) {
      super();
      this._conditioner = new AudioConditioner(options.processorOptions?.maxGain || 1);
      this._bufferSize = 4096; // accumulate before sending (matches old ScriptProcessor)
      this._buffer = new Float32Array(this._bufferSize);
      this._writeIndex = 0;
    }

    process(inputs, _outputs, _parameters) {
      const input = inputs[0];
      if (!input || !input[0]) return true;

      const channelData = this._conditioner.process(downmixToMono(input));
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

if (typeof module !== 'undefined' && module.exports) module.exports = { downmixToMono, AudioConditioner };
if (typeof window !== 'undefined') window.ClarityAudio = { downmixToMono, AudioConditioner };
