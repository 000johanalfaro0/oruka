import { getSupabase } from '@/lib/supabase'
import type { Idea, Project, ProjectStatus } from './types'

/**
 * Toda la lectura y escritura de datos del modulo pasa por aqui.
 *
 * Los componentes no hablan con Supabase directamente: si algun dia cambia la
 * nube, se cambia este archivo y nada mas. Ademas permite probar las pantallas
 * con un repositorio falso, sin red.
 */

export async function listProjects(): Promise<Project[]> {
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Project[]
}

export async function createProject(title: string, description: string | null): Promise<Project> {
  const supabase = await getSupabase()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('No hay sesión activa.')

  const { data, error } = await supabase
    .from('projects')
    .insert({ title, description, user_id: userId })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Project
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'title' | 'description' | 'status' | 'scheduled_date'>>,
): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase
    .from('projects')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = await getSupabase()
  // Las ideas cuelgan del proyecto: se quitan primero para no dejar huerfanas.
  const { error: ideasError } = await supabase.from('ideas').delete().eq('project_id', id)
  if (ideasError) throw new Error(ideasError.message)
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listIdeas(projectId: string): Promise<Idea[]> {
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Idea[]
}

function chunkText(text: string, maxLen = 250): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text]
  let current = ''

  for (const s of sentences) {
    if ((current + s).length <= maxLen) {
      current += s
    } else {
      if (current.trim()) chunks.push(current.trim())
      if (s.length <= maxLen) {
        current = s
      } else {
        const words = s.split(' ')
        current = ''
        for (const w of words) {
          if ((current + ' ' + w).length <= maxLen) {
            current = current ? current + ' ' + w : w
          } else {
            if (current.trim()) chunks.push(current.trim())
            current = w
          }
        }
      }
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)]
}

export async function createIdea(
  projectId: string,
  content: string,
  extra?: { type?: Idea['type']; premium?: boolean; source_label?: string | null },
): Promise<Idea[]> {
  const supabase = await getSupabase()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('No hay sesión activa.')

  // 1. Intentar inserción completa
  try {
    const { data, error } = await supabase
      .from('ideas')
      .insert({
        project_id: projectId,
        user_id: userId,
        content,
        type: extra?.type ?? 'text',
        premium: extra?.premium ?? false,
        source_label: extra?.source_label ?? null,
      })
      .select()
      .single()

    if (!error && data) {
      await updateProject(projectId, {}).catch(() => {})
      return [data as Idea]
    }
    if (error && !error.message.includes('ideas_content_check')) {
      throw new Error(error.message)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('ideas_content_check')) {
      throw err
    }
  }

  // 2. Si la base de datos restringe la longitud, dividir automáticamente en fragmentos coherentes
  const chunks = chunkText(content, 250)
  const results: Idea[] = []

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('ideas')
      .insert({
        project_id: projectId,
        user_id: userId,
        content: chunk,
        type: extra?.type ?? 'text',
        premium: extra?.premium ?? false,
        source_label: extra?.source_label ?? null,
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    results.push(data as Idea)
  }

  await updateProject(projectId, {}).catch(() => {})
  return results
}

export async function deleteIdea(id: string): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.from('ideas').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setStatus(projectId: string, status: ProjectStatus): Promise<void> {
  return updateProject(projectId, { status })
}

export async function setScheduledDate(projectId: string, date: string | null): Promise<void> {
  return updateProject(projectId, { scheduled_date: date })
}
