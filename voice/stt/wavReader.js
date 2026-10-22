import wavefilePkg from 'wavefile';

const { WaveFile } = wavefilePkg;

/**
 * Turn a WAV file (as saved by the Windows speech process) into what Whisper expects:
 * 16 kHz, mono, Float32 samples between -1 and +1.
 *
 * The old reader returned wavefile's raw sample values: for 16-bit audio those run to +/-32768,
 * about 32,000 times too large. Whisper then "heard" pure distortion, which it wrote down as
 * "(buzzing)" / "(clicking)" or nothing at all, and the loudness gate passed every clip.
 * toBitDepth('32f') rescales any input (8-bit unsigned, 16/24/32-bit integer, float) to -1..+1.
 */
export function decodeWav(buffer) {
  const wav = new WaveFile(buffer);
  wav.toBitDepth('32f');
  const rate = wav.fmt.sampleRate;
  // The anti-aliasing filter is needed when going DOWN to 16 kHz; going up, it only adds ringing.
  if (rate !== 16000) wav.toSampleRate(16000, { method: 'cubic', LPF: rate > 16000 });
  let samples = wav.getSamples(false, Float32Array);
  if (Array.isArray(samples)) samples = mixDown(samples);       // stereo / multi-channel
  // Resampling can overshoot a little on loud clips; keep Whisper's input in range.
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > 1) samples[i] = 1;
    else if (samples[i] < -1) samples[i] = -1;
  }
  return samples;
}

/** Average the channels into one. */
function mixDown(channels) {
  const n = channels[0].length, out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}
