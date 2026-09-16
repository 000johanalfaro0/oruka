// Prueba del aviso sonoro: separar el trabajo del agente del eco de tus teclas.
//
// Se corre con `npm test`. Node lee el archivo .ts directamente.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fueTrabajoDelAgente } from '../src/lib/trabajoReal.ts'

/** El mismo umbral que usa la app. */
const MINIMO = 4000

test('escribir un mensaje largo no cuenta como trabajo del agente', () => {
  // Diez segundos tecleando: la terminal repinta cada tecla, asi que parece
  // que hay salida sin parar. La ultima tecla cae justo antes del final.
  const inicio = 0
  const fin = 10_000
  const ultimaTecla = 9_800

  const suena = fueTrabajoDelAgente({ inicio, fin, ultimaTecla, minimoMs: MINIMO })

  assert.equal(suena, false)
})

test('un agente que trabaja despues del Enter si avisa', () => {
  // Pulsas Enter y no vuelves a tocar el teclado. El agente habla 30 segundos.
  const inicio = 1_000
  const fin = 31_000
  const ultimaTecla = 1_000

  const suena = fueTrabajoDelAgente({ inicio, fin, ultimaTecla, minimoMs: MINIMO })

  assert.equal(suena, true)
})

test('escribir a mitad de una tarea larga no cancela el aviso', () => {
  // Le mandas algo mas mientras trabaja; despues sigue trabajando 20 segundos.
  const suena = fueTrabajoDelAgente({
    inicio: 0,
    fin: 60_000,
    ultimaTecla: 40_000,
    minimoMs: MINIMO,
  })

  assert.equal(suena, true)
})

test('un parpadeo corto de salida no avisa', () => {
  // Cambiar de pestana redimensiona la terminal y el CLI repinta su pantalla.
  const suena = fueTrabajoDelAgente({
    inicio: 0,
    fin: 900,
    ultimaTecla: 0,
    minimoMs: MINIMO,
  })

  assert.equal(suena, false)
})

test('una sesion donde nunca escribiste se mide desde el principio', () => {
  // ultimaTecla a 0 significa "nunca". No debe adelantar el punto de partida.
  const suena = fueTrabajoDelAgente({
    inicio: 100_000,
    fin: 105_000,
    ultimaTecla: 0,
    minimoMs: MINIMO,
  })

  assert.equal(suena, true)
})

test('justo en el umbral avisa', () => {
  const suena = fueTrabajoDelAgente({
    inicio: 0,
    fin: MINIMO,
    ultimaTecla: 0,
    minimoMs: MINIMO,
  })

  assert.equal(suena, true)
})
