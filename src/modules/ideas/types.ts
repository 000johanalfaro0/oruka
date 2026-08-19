/** Calcado del esquema real de Supabase, sin inventar campos. */

export type ProjectStatus = 'starting' | 'building' | 'done'

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  starting: 'Iniciando',
  building: 'En construcción',
  done: 'Hecho',
}

export interface Project {
  id: string
  user_id: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
  status: ProjectStatus
  scheduled_date: string | null
}

export type IdeaType = 'text' | 'image_transcription' | 'ascii_mockup'

export interface Idea {
  id: string
  project_id: string
  user_id: string
  content: string
  created_at: string
  type: IdeaType
  premium: boolean
  source_label: string | null
}

/** Lo que devuelve la tarea `organize` de la funcion de IA. */
export interface OrganizedResult {
  summary: string
  themes: Array<{ title: string; ideas: Array<{ original: string; refined: string }> }>
  direction: string
  connections: string[]
}
