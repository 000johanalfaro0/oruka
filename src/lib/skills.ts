import { invoke } from '@tauri-apps/api/core'

export interface Skill {
  id: string
  description: string
  content: string
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
