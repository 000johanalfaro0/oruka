// Genera un "ding" corto (dos tonos, tipo campanilla) como WAV, sin
// dependencias. Se corre una sola vez; el resultado se versiona.
import { writeFileSync } from 'node:fs'

const SAMPLE_RATE = 44100
const notas = [
  { freq: 880, inicio: 0.0, dur: 0.18 },
  { freq: 1318.5, inicio: 0.12, dur: 0.35 },
]
const totalDur = 0.55
const numSamples = Math.floor(SAMPLE_RATE * totalDur)
const samples = new Float32Array(numSamples)

for (const nota of notas) {
  const inicioMuestra = Math.floor(nota.inicio * SAMPLE_RATE)
  const durMuestras = Math.floor(nota.dur * SAMPLE_RATE)
  for (let i = 0; i < durMuestras; i++) {
    const idx = inicioMuestra + i
    if (idx >= numSamples) break
    const t = i / SAMPLE_RATE
    const envelope = Math.exp(-t * 6) // se apaga solo, nada de corte brusco
    samples[idx] += Math.sin(2 * Math.PI * nota.freq * t) * envelope * 0.5
  }
}

// pico a 0.9 para no saturar
let pico = 0
for (const s of samples) pico = Math.max(pico, Math.abs(s))
const escala = pico > 0 ? 0.9 / pico : 1

const bytesPorMuestra = 2
const dataSize = numSamples * bytesPorMuestra
const buffer = Buffer.alloc(44 + dataSize)

buffer.write('RIFF', 0)
buffer.writeUInt32LE(36 + dataSize, 4)
buffer.write('WAVE', 8)
buffer.write('fmt ', 12)
buffer.writeUInt32LE(16, 16)
buffer.writeUInt16LE(1, 20) // PCM
buffer.writeUInt16LE(1, 22) // mono
buffer.writeUInt32LE(SAMPLE_RATE, 24)
buffer.writeUInt32LE(SAMPLE_RATE * bytesPorMuestra, 28)
buffer.writeUInt16LE(bytesPorMuestra, 32)
buffer.writeUInt16LE(16, 34)
buffer.write('data', 36)
buffer.writeUInt32LE(dataSize, 40)

for (let i = 0; i < numSamples; i++) {
  const v = Math.max(-1, Math.min(1, samples[i] * escala))
  buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
}

writeFileSync(new URL('../src/assets/agent-done.wav', import.meta.url), buffer)
console.log('Escrito src/assets/agent-done.wav')
