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

export async function createIdea(
  projectId: string,
  content: string,
  extra?: { type?: Idea['type']; premium?: boolean; source_label?: string | null },
): Promise<Idea> {
  const supabase = await getSupabase()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('No hay sesión activa.')

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
  if (error) throw new Error(error.message)

  // Que el proyecto suba en la lista al anadirle algo.
  await updateProject(projectId, {}).catch(() => {})
  return data as Idea
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
