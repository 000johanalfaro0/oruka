// Genera el aviso de "agente terminado" como WAV, sin dependencias.
// Se corre a mano (`node scripts/gen-notification-sound.mjs`) y el resultado
// se versiona en src/assets/agent-done.wav.
//
// Por que suena asi: dos senos pelados con corte brusco suenan a pitido de
// electrodomestico. Esto imita una campana suave de madera (tipo marimba):
// cada nota lleva armonicos que se apagan antes que el fundamental, la
// entrada sube en rampa para que no haya "clic", y el volumen queda bajo
// para que avise sin sobresaltar.
import { writeFileSync } from 'node:fs'

const SAMPLE_RATE = 44100

/** Dos notas en quinta ascendente: se percibe como "terminado", no como alarma. */
const NOTAS = [
  { freq: 587.33, inicio: 0.0, dur: 0.9 }, // Re5
  { freq: 880.0, inicio: 0.16, dur: 0.95 }, // La5
]

/**
 * Armonicos de cada nota: amplitud y velocidad a la que se apaga.
 *
 * Los agudos se apagan mas rapido que el grave, que es lo que hace que un
 * golpe en madera suene calido en vez de metalico.
 */
const ARMONICOS = [
  { mult: 1, amp: 1.0, decay: 3.2 },
  { mult: 2, amp: 0.26, decay: 6.0 },
  { mult: 3, amp: 0.09, decay: 9.0 },
  { mult: 4.7, amp: 0.035, decay: 13.0 },
]

/** Rampa de entrada. Sin ella se oye un "clic" al arrancar la muestra. */
const ATAQUE_S = 0.012
/** Desvanecido final, para que el archivo no termine en seco. */
const SALIDA_S = 0.08
/** Pico final de la mezcla. Por debajo de 1 a proposito: es un aviso, no un susto. */
const PICO = 0.55

const totalDur = 1.15
const numSamples = Math.floor(SAMPLE_RATE * totalDur)
const samples = new Float32Array(numSamples)

for (const nota of NOTAS) {
  const inicioMuestra = Math.floor(nota.inicio * SAMPLE_RATE)
  const durMuestras = Math.floor(nota.dur * SAMPLE_RATE)
  for (let i = 0; i < durMuestras; i++) {
    const idx = inicioMuestra + i
    if (idx >= numSamples) break
    const t = i / SAMPLE_RATE
    const ataque = t < ATAQUE_S ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATAQUE_S) : 1
    let v = 0
    for (const a of ARMONICOS) {
      v += Math.sin(2 * Math.PI * nota.freq * a.mult * t) * a.amp * Math.exp(-t * a.decay)
    }
    samples[idx] += v * ataque * 0.5
  }
}

// Desvanecido comun al final de la muestra.
const salidaMuestras = Math.floor(SALIDA_S * SAMPLE_RATE)
for (let i = 0; i < salidaMuestras; i++) {
  const idx = numSamples - salidaMuestras + i
  samples[idx] *= 1 - i / salidaMuestras
}

let pico = 0
for (const s of samples) pico = Math.max(pico, Math.abs(s))
const escala = pico > 0 ? PICO / pico : 1

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
