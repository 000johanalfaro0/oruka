import { storeGet, storeSet } from './store'

/**
 * Registro de sesiones recientes, para el panel de Sesiones.
 *
 * Ninguna CLI (Claude, Codex, Gemini, Opencode, Kilo) expone un id de
 * conversacion que se pueda pedir de vuelta: todas saben nada mas "continua lo
 * ultimo". Por eso esto guarda proyecto + CLI + modo + una vista previa del
 * ultimo texto visible, y retomar significa reabrir ese proyecto y dejar que
 * el propio CLI continue lo suyo ahi -no una conversacion exacta si hubo
 * varias con el mismo CLI en el mismo proyecto.
 *
 * Cerrar una pestana hoy borra todo rastro (los procesos son hijos de la app).
 * Este archivo es lo unico que sobrevive a eso.
 */

export interface SessionEntry {
  /** El sessionId del agente que genero esta entrada. */
  id: string
  projectPath: string
  projectName: string
  cliId: string
  cliName: string
  mode: string
  lastActiveAt: number
  /** Ultimo fragmento visible de la terminal, en una sola linea. */
  lastOutputPreview: string
}

const STORAGE_KEY = 'oruka.sessions'
const MAX_ENTRIES = 50
const PREVIEW_MAX_CHARS = 200

export async function loadSessions(): Promise<SessionEntry[]> {
  try {
    const raw = await storeGet(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as SessionEntry[]) : []
  } catch {
    return []
  }
}

const saveSessions = (list: SessionEntry[]) => storeSet(STORAGE_KEY, JSON.stringify(list))

/** Crea o actualiza una entrada, y la sube al frente de la lista. */
export async function touchSession(
  entry: Omit<SessionEntry, 'lastOutputPreview'>,
): Promise<void> {
  const list = await loadSessions()
  const previa = list.find((s) => s.id === entry.id)
  const sinEsta = list.filter((s) => s.id !== entry.id)
  const nueva: SessionEntry = { ...entry, lastOutputPreview: previa?.lastOutputPreview ?? '' }
  await saveSessions([nueva, ...sinEsta].slice(0, MAX_ENTRIES))
}

/** Recorta un fragmento de terminal a una sola linea, para la vista previa. */
export function toPreview(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim()
  return plano.length > PREVIEW_MAX_CHARS ? plano.slice(-PREVIEW_MAX_CHARS) : plano
}

/** Guarda la vista previa final de una sesion, sin tocar el resto. */
export async function recordPreview(id: string, preview: string): Promise<void> {
  if (!preview) return
  const list = await loadSessions()
  const idx = list.findIndex((s) => s.id === id)
  const actual = list[idx]
  if (!actual) return
  const siguiente = [...list]
  siguiente[idx] = { ...actual, lastOutputPreview: preview }
  await saveSessions(siguiente)
}

export async function forgetSession(id: string): Promise<void> {
  const list = await loadSessions()
  await saveSessions(list.filter((s) => s.id !== id))
}
