import { getSupabase } from '@/lib/supabase'
import type { Idea, OrganizedResult, Project } from './types'

/**
 * Las cuatro tareas de la funcion de IA.
 *
 * La funcion vive en Supabase y guarda ahi la clave de Gemini: nunca sale del
 * servidor ni pasa por la app.
 */
const FUNCTION = 'idearia-ai'

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.functions.invoke(FUNCTION, { body })
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

/** Agrupa las ideas en temas, sin descartar ninguna. */
export async function organize(project: Project, ideas: Idea[]): Promise<OrganizedResult> {
  const { result } = await invoke<{ result: OrganizedResult }>({
    task: 'organize',
    projectTitle: project.title,
    projectDescription: project.description ?? '',
    ideas: ideas.map((i) => ({
      content: i.content,
      type: i.type,
      premium: i.premium,
      sourceLabel: i.source_label,
      createdAt: i.created_at,
    })),
  })
  return result
}

/** Reconstruye un chat pegado en crudo como diálogo por turnos. */
export async function formatChat(rawChat: string): Promise<string> {
  const { text } = await invoke<{ text: string }>({ task: 'format_chat', rawChat })
  return text
}

/** Convierte una imagen en texto, o en un mockup ASCII. */
export async function fromImage(
  task: 'transcribe_image' | 'ascii_mockup',
  mimeType: string,
  imageBase64: string,
): Promise<string> {
  const { text } = await invoke<{ text: string }>({ task, mimeType, imageBase64 })
  return text
}
