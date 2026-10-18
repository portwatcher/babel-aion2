// Identified synthetic test data: a PCM tone with an actual silent middle third.
// This is not a recording or evidence of speech/translation quality.
export function syntheticWave(sampleRate = 48_000, durationMs = 1_000) {
  const samples = Math.round((sampleRate * durationMs) / 1000)
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  for (let sample = 0; sample < samples; sample += 1) {
    if (sample < samples / 3 || sample >= (samples * 2) / 3) {
      bytes.writeInt16LE(
        Math.round(Math.sin((sample / sampleRate) * Math.PI * 880) * 8_000),
        44 + sample * 2,
      )
    }
  }
  return bytes
}
