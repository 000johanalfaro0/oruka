/**
 * Distinguir el trabajo de un agente del eco de tus propias teclas.
 *
 * La app no puede preguntarle al agente si esta ocupado: solo ve que la
 * terminal escupe texto. Y la terminal tambien escupe texto cuando **tu**
 * escribes, porque cada tecla se repinta en pantalla. Por eso escribir un
 * mensaje largo se leia como "el agente esta trabajando", y al soltar el
 * teclado sonaba el aviso de "termino".
 *
 * El dato que los separa es la ultima tecla que pulsaste:
 *
 * - Si estabas escribiendo, la ultima tecla cae justo antes del final del
 *   tramo. Queda un hueco de milisegundos: no fue trabajo.
 * - Si el agente trabajo, tu ultima tecla fue el Enter del principio. Desde
 *   ahi hasta el final hay segundos de salida que no venia de ti.
 */
export interface TramoDeTrabajo {
  /** Cuando la terminal empezo a hablar sin parar. */
  inicio: number
  /** Cuando se callo. */
  fin: number
  /** Ultima tecla enviada a esa terminal, o 0 si nunca se escribio en ella. */
  ultimaTecla: number
  /** Por debajo de esto un tramo es ruido, no una tarea. */
  minimoMs: number
}

/**
 * True solo si hubo salida sostenida que **no** venia del teclado.
 *
 * Se mide desde el ultimo de los dos momentos (el inicio del tramo o tu
 * ultima tecla), asi que escribir a mitad de una tarea larga no anula el
 * aviso: reinicia la cuenta, y si el agente sigue trabajando lo suficiente
 * el aviso suena igual.
 */
export function fueTrabajoDelAgente({ inicio, fin, ultimaTecla, minimoMs }: TramoDeTrabajo): boolean {
  const desde = Math.max(inicio, ultimaTecla)
  return fin - desde >= minimoMs
}
