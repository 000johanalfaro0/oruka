// El gasto de tokens de toda la sesion de Oruka, no de una sola terminal.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resumirGasto, formatearTokens } from '../src/lib/gastoTokens.ts'

const sesion = (sessionId, cliId, cliName) => ({ sessionId, cliId, cliName })

test('dos terminales del mismo CLI se suman, no se machacan', () => {
  // Este era el fallo: se guardaba una cifra por CLI y la ultima ganaba.
  const abiertas = [sesion('s1', 'codex', 'Codex'), sesion('s2', 'codex', 'Codex')]

  const r = resumirGasto({ s1: 10_000, s2: 7_000 }, abiertas)

  assert.equal(r.total, 17_000)
  assert.equal(r.porCli.length, 1)
  assert.equal(r.porCli[0].tokens, 17_000)
})

test('CLIs distintos van en renglones separados, de mas gasto a menos', () => {
  const abiertas = [sesion('s1', 'claude', 'Claude'), sesion('s2', 'codex', 'Codex')]

  const r = resumirGasto({ s1: 500, s2: 9_000 }, abiertas)

  assert.equal(r.porCli[0].cliId, 'codex')
  assert.equal(r.porCli[1].cliId, 'claude')
  assert.equal(r.total, 9_500)
})

test('una terminal cerrada deja de contar', () => {
  // Su gasto sigue en el mapa, pero ya no esta abierta: no se suma.
  const r = resumirGasto({ s1: 10_000, s2: 7_000 }, [sesion('s1', 'codex', 'Codex')])

  assert.equal(r.total, 10_000)
})

test('una terminal que todavia no ha gastado nada no ensucia la lista', () => {
  const r = resumirGasto({}, [sesion('s1', 'codex', 'Codex')])

  assert.equal(r.total, 0)
  assert.equal(r.porCli.length, 0)
})

test('los numeros se acortan para caber en el pie', () => {
  assert.equal(formatearTokens(0), '0')
  assert.equal(formatearTokens(940), '940')
  assert.equal(formatearTokens(16_440), '16,4 k')
  assert.equal(formatearTokens(234_100), '234 k')
  assert.equal(formatearTokens(1_250_000), '1,3 M')
})
