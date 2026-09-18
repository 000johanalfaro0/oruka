// Que pasa al soltar cosas encima de la ventana de Oruka.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirQueAbrir } from '../src/lib/soltarCarpeta.ts'

/** Un disco de mentira: estas rutas son carpetas, el resto no. */
const carpetas = new Set(['C:\proyectos\oruka', 'C:\proyectos\web'])
const esCarpeta = (r) => carpetas.has(r)

test('soltar una carpeta la abre', () => {
  const r = decidirQueAbrir(['C:\proyectos\oruka'], esCarpeta)

  assert.deepEqual(r.carpetas, ['C:\proyectos\oruka'])
  assert.equal(r.aAbrir, 'C:\proyectos\oruka')
  assert.equal(r.aviso, '')
})

test('soltar varias carpetas las guarda todas pero solo abre la primera', () => {
  // Abrir cinco pestanas de golpe seria una sorpresa desagradable.
  const r = decidirQueAbrir(['C:\proyectos\web', 'C:\proyectos\oruka'], esCarpeta)

  assert.equal(r.carpetas.length, 2)
  assert.equal(r.aAbrir, 'C:\proyectos\web')
})

test('soltar un archivo suelto no abre nada y avisa', () => {
  const r = decidirQueAbrir(['C:\notas\plan.txt'], esCarpeta)

  assert.equal(r.aAbrir, null)
  assert.match(r.aviso, /no es una carpeta/i)
})

test('de una mezcla de archivos y carpetas se queda con las carpetas', () => {
  const r = decidirQueAbrir(
    ['C:\notas\plan.txt', 'C:\proyectos\oruka', 'C:\foto.png'],
    esCarpeta,
  )

  assert.deepEqual(r.carpetas, ['C:\proyectos\oruka'])
  assert.equal(r.aAbrir, 'C:\proyectos\oruka')
})

test('la misma carpeta soltada dos veces no se duplica', () => {
  const r = decidirQueAbrir(['C:\proyectos\oruka', 'C:\proyectos\oruka'], esCarpeta)

  assert.equal(r.carpetas.length, 1)
})

test('soltar nada no revienta', () => {
  const r = decidirQueAbrir([], esCarpeta)

  assert.equal(r.aAbrir, null)
  assert.equal(r.carpetas.length, 0)
})
