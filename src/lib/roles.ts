import { invoke } from '@tauri-apps/api/core'
import { storeGet, storeSet } from './store'
import type { DetectedCli } from './agents'

/**
 * Reparto de papeles entre los agentes de un proyecto.
 *
 * La idea: si claude y codex trabajan sobre los mismos archivos, hoy son dos
 * desconocidos que se pisan. Cada CLI lee un archivo distinto dentro del
 * proyecto (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), asi que ahi es donde se le
 * cuenta quien es y quienes son los demas.
 *
 * Nada de esto es de fabrica. El manifiesto de cada CLI trae un rol **por
 * defecto**, igual que trae sus modos, pero lo que se escribe sale de lo que el
 * usuario haya configurado aqui y **solo para los CLIs que tiene instalados**:
 * a quien no tenga codex no se le escribe el papel de codex.
 */

/** Rol de fabrica que declara un manifiesto. */
export interface RoleSpec {
  file: string
  role: string
  brief: string
}

/** Un agente ya resuelto, listo para escribir. */
export interface RoleAgent {
  cli_id: string
  name: string
  file: string
  role: string
  brief: string
}

/** Lo que le pasaria a un archivo si se aplicara. */
export interface RoleChange {
  path: string
  file: string
  diff: string
  creates: boolean
}

/**
 * Lo que el usuario ha decidido sobre los roles.
 *
 * `overrides` guarda solo lo que se aparta del manifiesto: un CLI que no
 * aparece usa su rol de fabrica. `off` es la lista de los que el usuario ha
 * sacado del reparto aunque los tenga instalados.
 */
export interface RolesConfig {
  /** Si Oruka escribe los archivos al abrir un proyecto. */
  enabled: boolean
  overrides: Record<string, { role: string; brief: string }>
  off: string[]
}

const STORAGE_KEY = 'oruka.roles'

/**
 * Por defecto **no** escribe nada.
 *
 * Estos archivos son del usuario y suelen estar versionados. Que una app que
 * acabas de instalar te modifique el `CLAUDE.md` del equipo la primera vez que
 * abres una carpeta es justo lo que no queremos: se activa a proposito, desde
 * el Quick Setup o desde Ajustes.
 */
export const DEFAULT_CONFIG: RolesConfig = { enabled: false, overrides: {}, off: [] }

export async function loadConfig(): Promise<RolesConfig> {
  try {
    const raw = await storeGet(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<RolesConfig>
    return {
      enabled: parsed.enabled ?? false,
      overrides: parsed.overrides ?? {},
      off: parsed.off ?? [],
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export const saveConfig = (config: RolesConfig) => storeSet(STORAGE_KEY, JSON.stringify(config))

/**
 * Quien participa y con que papel, para este sistema y este usuario.
 *
 * Tres filtros, en este orden: que el CLI **este instalado**, que su manifiesto
 * declare un rol, y que el usuario no lo haya apartado. Un CLI propio anadido
 * desde el Quick Setup no trae rol y simplemente no participa, que es lo
 * correcto: no sabemos que archivo lee.
 */
export function resolveAgents(clis: DetectedCli[], config: RolesConfig): RoleAgent[] {
  return clis
    .filter((c) => c.found && c.role && !config.off.includes(c.id))
    .map((c) => {
      const spec = c.role as RoleSpec
      const mio = config.overrides[c.id]
      return {
        cli_id: c.id,
        name: c.name,
        file: spec.file,
        role: mio?.role ?? spec.role,
        brief: mio?.brief ?? spec.brief,
      }
    })
}

/** Que cambiaria en este proyecto, sin escribir nada. */
export const rolesPlan = (project: string, agents: RoleAgent[]) =>
  invoke<RoleChange[]>('roles_plan', { project, agents })

/** Escribe el reparto. Devuelve los archivos tocados. */
export const rolesApply = (project: string, agents: RoleAgent[]) =>
  invoke<string[]>('roles_apply', { project, agents })

/** Quita el bloque de Oruka y deja los archivos como estaban. */
export const rolesRevert = (project: string, agents: RoleAgent[]) =>
  invoke<string[]>('roles_revert', { project, agents })

/**
 * Escribe los roles de un proyecto recien abierto, si procede.
 *
 * Silenciosa a proposito en el caso normal: abrir una carpeta no puede acabar
 * en un aviso cada vez. Devuelve los archivos escritos por si quien llama
 * quiere contarlo, y `[]` cuando no habia nada que hacer, que es lo que pasa a
 * partir de la segunda vez gracias a la idempotencia del bloque.
 */
export async function syncProject(project: string, clis: DetectedCli[]): Promise<string[]> {
  const config = await loadConfig()
  if (!config.enabled) return []
  const agents = resolveAgents(clis, config)
  if (agents.length === 0) return []
  return rolesApply(project, agents)
}
