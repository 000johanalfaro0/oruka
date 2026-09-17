/**
 * Que esta haciendo un agente, visto desde fuera.
 *
 * Se declara aqui, y no se importa del modulo, para no invertir la
 * dependencia: `lib` es la capa de abajo y no conoce a los modulos.
 */
export type EstadoDeAgente = 'trabajando' | 'esperando' | 'terminado'

/**
 * Cuando debe parpadear el cursor de una terminal.
 *
 * El cursor parpadeante sirve para una cosa: encontrar donde vas a escribir.
 * Mientras el agente trabaja no vas a escribir nada, el cursor se queda
 * aparcado debajo de la salida, y ese parpadeo constante al lado de un
 * contador que ya se mueve solo ("Working 7s...") es ruido puro.
 *
 * Asi que parpadea solo cuando el turno es tuyo. Con el agente terminado
 * tampoco: ahi ya no se escribe.
 */
export function debeParpadearElCursor(estado: EstadoDeAgente): boolean {
  return estado === 'esperando'
}
