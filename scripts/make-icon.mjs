/**
 * Genera el PNG base del icono de Oruka sin dependencias.
 *
 * El dibujo es el grid de 4 agentes sobre el grafito de VS Code: es lo que la
 * app hace, y se lee bien incluso a 16 px en la barra de tareas.
 * A partir de este PNG, `tauri icon` produce el .ico y el resto de tamanos.
 */
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = 1024
const BG = [0x1f, 0x1f, 0x1f]
const ACCENT = [0x00, 0x78, 0xd4]
const DIM = [0x4e, 0xc9, 0xb0]

const px = Buffer.alloc(SIZE * SIZE * 4)

const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// Cuatro paneles, como el grid del workspace. El primero en accent: el activo.
const gap = 40
const margin = 150
const half = (SIZE - margin * 2 - gap) / 2
const panels = [
  { x: margin, y: margin, color: ACCENT },
  { x: margin + half + gap, y: margin, color: DIM },
  { x: margin, y: margin + half + gap, color: DIM },
  { x: margin + half + gap, y: margin + half + gap, color: ACCENT },
]

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    let color = null
    // Fondo redondeado; fuera de el, transparente.
    const onCanvas = inRoundedRect(x, y, 0, 0, SIZE - 1, SIZE - 1, 180)
    if (onCanvas) color = BG
    for (const p of panels) {
      if (inRoundedRect(x, y, p.x, p.y, p.x + half, p.y + half, 28)) color = p.color
    }
    if (color) {
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
      px[i + 3] = 255
    }
  }
}

// Scanlines con byte de filtro 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8    // bit depth
ihdr[9] = 6    // RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] ?? 'src-tauri/icons/source.png'
writeFileSync(out, png)
console.log(`icono base escrito: ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`)
