/**
 * Cuantos tokens llevas gastados en toda la sesion de Oruka.
 *
 * Cada CLI escribe su propio total en su terminal ("tokens used 16.440") y
 * Oruka lo va leyendo de la salida. El numero que escribe **es de esa terminal
 * sola**: si abres dos Codex, cada uno cuenta desde cero por su cuenta.
 *
 * Por eso aqui se guarda una cifra por terminal y se suman despues. Guardar
 * una sola cifra por CLI, machacandola, daba el total de la ultima terminal
 * que hablo, no el gasto real.
 *
 * Aviso de lo que NO es este numero: es lo que han gastado las terminales que
 * Oruka ha visto desde que se abrio. No es tu cuota semanal ni lo que llevas
 * gastado en la cuenta. Eso solo lo sabe el propio CLI, y solo lo dice si le
 * escribes `/usage` dentro.
 */

/** Lo que lleva gastado cada terminal, por su identificador de sesion. */
export type GastoPorSesion = Record<string, number>

/** Una terminal viva: que sesion es y de que CLI. */
export interface SesionAbierta {
  sessionId: string
  cliId: string
  cliName: string
}

/** El gasto de un CLI, listo para pintar. */
export interface GastoDeCli {
  cliId: string
  cliName: string
  tokens: number
}

export interface ResumenDeGasto {
  /** Un renglon por CLI, de mas gasto a menos. */
  porCli: GastoDeCli[]
  /** La suma de todo. */
  total: number
}

/**
 * Suma el gasto de todas las terminales abiertas, agrupado por CLI.
 *
 * Solo cuenta las que siguen abiertas: una terminal cerrada ya no se ve en
 * ningun sitio, y seguir sumando su gasto seria contar algo que el usuario ya
 * no puede mirar.
 */
export function resumirGasto(
  gasto: GastoPorSesion,
  sesiones: readonly SesionAbierta[],
): ResumenDeGasto {
  const porCli = new Map<string, GastoDeCli>()
  let total = 0

  for (const sesion of sesiones) {
    const tokens = gasto[sesion.sessionId] ?? 0
    if (tokens <= 0) continue
    total += tokens
    const previo = porCli.get(sesion.cliId)
    if (previo) previo.tokens += tokens
    else porCli.set(sesion.cliId, { cliId: sesion.cliId, cliName: sesion.cliName, tokens })
  }

  return {
    porCli: [...porCli.values()].sort((a, b) => b.tokens - a.tokens),
    total,
  }
}

/**
 * El numero, corto para caber en la barra de estado.
 *
 * Una cifra de siete digitos en un pie de 24 pixeles no se lee; "1,2 M" si.
 */
export function formatearTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) {
    const miles = tokens / 1000
    // Sin decimal a partir de 100: "234 k" se lee mejor que "234,1 k".
    return `${miles >= 100 ? Math.round(miles) : miles.toFixed(1).replace('.', ',')} k`
  }
  return `${(tokens / 1_000_000).toFixed(1).replace('.', ',')} M`
}
