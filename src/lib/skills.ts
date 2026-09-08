import { invoke } from '@tauri-apps/api/core'
import type { MissingRequirement } from './mcp'

/** Lo que una skill necesita en el PATH para servir de algo. */
export interface SkillRequires {
  bin: string
  name: string
  winget: string | null
  brew: string | null
  npm: string | null
  url: string
}

export interface Skill {
  id: string
  description: string
  content: string
  /**
   * El programa que la skill le manda usar al agente, si necesita uno.
   *
   * Una skill siempre se escribe bien, asi que sin esto parece puesta y util.
   * El fallo salia despues, cuando el agente ejecutaba lo que dice y no
   * existia en el equipo.
   */
  requires: SkillRequires | null
}

export interface CliSkillState {
  cli_id: string
  target: string | null
  installed: string[]
  unsupported: string | null
}

export const skillsCatalog = () => invoke<Skill[]>('skills_catalog')
export const skillsState = (cliIds: string[]) => invoke<CliSkillState[]>('skills_state', { cliIds })
export const skillsPreview = (cliId: string, skill: Skill, remove: boolean) =>
  invoke<string>('skills_preview', { cliId, skill, remove })
export const skillsApply = (cliId: string, skill: Skill, remove: boolean) =>
  invoke<string>('skills_apply', { cliId, skill, remove })

/** Skills cuyo programa base no esta en este equipo. */
export const skillsMissing = () => invoke<MissingRequirement[]>('skills_missing')

export const skillsInstallRequirement = (skillId: string) =>
  invoke<string>('skills_install_requirement', { skillId })
