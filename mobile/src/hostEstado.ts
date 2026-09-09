import type { RemoteHost } from '@/lib/relay'

/**
 * Cuanto tiempo sin noticias hace que un equipo "en linea" ya no se cree.
 *
 * El escritorio apaga la bandera al cerrarse bien, pero un cierre a la brava
 * -se acaba la bateria, lo mata el sistema- nunca llega a avisar. Sin este
 * limite, ese equipo se veria "conectado" para siempre.
 */
const SE_CREE_VIVO_MS = 2 * 60 * 1000

/** Compartido entre Agentes y Buscar carpetas: los dos muestran equipos. */
export function estaRealmenteEnLinea(host: RemoteHost): boolean {
  return host.online && Date.now() - new Date(host.last_seen).getTime() < SE_CREE_VIVO_MS
}
