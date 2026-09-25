const PREVIEW_MAX_CHARS = 200

/** El que abre casi todas las secuencias de escape. */
const ESC = String.fromCharCode(27)
/** El pitido, que es como termina un titulo de ventana. */
const BEL = String.fromCharCode(7)

/**
 * Quita las secuencias de escape ANSI (color, movimiento de cursor) que trae
 * la foto cruda del PTY. Sin esto, la vista previa enseña codigos de control
 * en vez de texto legible.
 *
 * "cursor forward" (`ESC[NC`) es un caso aparte: algunas interfaces lo usan
 * para separar palabras en vez de un espacio real, y si solo se borrara
 * quedarian pegadas ("Isthisaproject..."). Por eso se convierte en N
 * espacios antes de borrar el resto de secuencias.
 */
function sinEscapes(texto: string): string {
  const cursorForward = new RegExp(`${ESC}\\[(\\d*)C`, 'g')
  const secuenciaOsc = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(${BEL}|${ESC}\\\\)`, 'g')
  const secuenciaCsi = new RegExp(`${ESC}[[\\]][0-9;?]*[a-zA-Z]`, 'g')
  const escapeSuelto = new RegExp(`${ESC}.`, 'g')

  return texto
    .replace(cursorForward, (_, n: string) => ' '.repeat(Number(n) || 1))
    .replace(secuenciaOsc, '')
    .replace(secuenciaCsi, '')
    .replace(escapeSuelto, '')
}

/** Recorta un fragmento de terminal a una sola linea, para la vista previa. */
export function toPreview(texto: string): string {
  const plano = sinEscapes(texto).replace(/\s+/g, ' ').trim()
  return plano.length > PREVIEW_MAX_CHARS ? plano.slice(-PREVIEW_MAX_CHARS) : plano
}
