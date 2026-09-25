// La vista previa de una sesion no puede enseñar codigos de control.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toPreview } from '../src/lib/vistaPrevia.ts'

test('quita las secuencias de escape ANSI de color', () => {
  const crudo = '\x1b[38;2;153;153;153mhola\x1b[0m mundo'
  assert.equal(toPreview(crudo), 'hola mundo')
})

test('quita el movimiento de cursor (cursor forward) sin dejar palabras pegadas', () => {
  // Estos menus separan palabras con "ESC[1C" en vez de espacios reales.
  const crudo = 'Is\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ctrust?'
  assert.equal(toPreview(crudo), 'Is this a project you trust?')
})

test('quita las secuencias OSC (titulo de ventana)', () => {
  const crudo = '\x1b]0;Claude Code\x07texto visible'
  assert.equal(toPreview(crudo), 'texto visible')
})

test('colapsa espacios y saltos de linea en uno solo', () => {
  assert.equal(toPreview('linea uno\n\n  linea dos'), 'linea uno linea dos')
})

test('sin escapes de por medio, el texto normal no cambia', () => {
  assert.equal(toPreview('todo listo'), 'todo listo')
})
