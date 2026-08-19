/**
 * Memoria del modulo entre visitas.
 *
 * El shell **desmonta** el modulo que no esta activo, asi que todo lo guardado
 * en `useState` desaparece al cambiar de ventana. Sin esto, cada vuelta a
 * GitHub relanzaba `gh auth status`, la lista de repos y las invitaciones, y
 * cada una es un proceso nuevo: la app se arrastraba al ir y venir.
 *
 * Vive fuera de React a proposito, para sobrevivir al desmontaje. Es memoria,
 * no disco: al cerrar la app se va, que es justo lo que se quiere de algo que
 * puede estar desactualizado.
 */

interface Entry {
  at: number
  /**
   * Se guarda la promesa, no el valor: asi dos montajes simultaneos comparten
   * una sola llamada en vez de lanzar dos.
   */
  value: Promise<unknown>
}

const store = new Map<string, Entry>()

/** Lo normal: dos minutos. Suficiente para ir y volver sin pedirlo de nuevo. */
export const TTL_CORTO = 2 * 60 * 1000
/** Para lo que casi nunca cambia, como quien eres o que repos tienes. */
export const TTL_LARGO = 10 * 60 * 1000

/**
 * Devuelve lo guardado si sigue fresco, y si no lo pide y lo guarda.
 *
 * Si la llamada falla, la entrada se retira: un error no se cachea, o un fallo
 * de red dejaria el modulo roto durante minutos.
 */
export function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>

  const value = load().catch((e: unknown) => {
    store.delete(key)
    throw e
  })
  store.set(key, { at: Date.now(), value })
  return value
}

/**
 * Olvida lo guardado. Sin argumento, todo; con uno, lo que empiece por ahi.
 *
 * Hay que llamarlo tras cada escritura: si invitas a alguien y la lista sigue
 * mostrando la de hace un minuto, parece que no ha funcionado.
 */
export function invalidate(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
