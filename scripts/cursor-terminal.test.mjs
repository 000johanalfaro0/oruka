// El cursor de la terminal solo parpadea cuando le toca escribir al usuario.
import test from 'node:test'
import assert from 'node:assert/strict'
import { debeParpadearElCursor } from '../src/lib/cursorTerminal.ts'

test('mientras el agente trabaja, el cursor no parpadea', () => {
  assert.equal(debeParpadearElCursor('trabajando'), false)
})

test('cuando el agente espera tu respuesta, si parpadea', () => {
  assert.equal(debeParpadearElCursor('esperando'), true)
})

test('con el agente terminado tampoco parpadea', () => {
  // Ya no se escribe ahi: el proceso murio.
  assert.equal(debeParpadearElCursor('terminado'), false)
})
