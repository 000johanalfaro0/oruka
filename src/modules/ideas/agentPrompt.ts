import { STATUS_LABEL, type Idea, type Project } from './types'

/**
 * Empaqueta el bloc de notas completo de un proyecto como prompt para un agente.
 *
 * Es el puerto fiel de `_buildAgentPrompt` de Idearia, donde ya existia: alli
 * habia que copiarlo a mano para pegarlo en una terminal. Aqui alimenta el boton
 * "-> Agente", que es el motivo de fusionar las dos apps.
 */
export function buildAgentPrompt(project: Project, ideas: Idea[]): string {
  const sorted = [...ideas].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const isOrganized = (idea: Idea) =>
    idea.content.trim().toLowerCase().startsWith('organización ia')

  const organizedCount = sorted.filter(isOrganized).length
  const imageCount = sorted.filter((i) => i.type !== 'text').length

  const lines: string[] = [
    'Este es mi bloc de notas completo para un proyecto.',
    '',
    'Quiero que actúes como un agente experto y uses ABSOLUTAMENTE TODO lo que sigue como contexto. No excluyas ninguna idea, no descartes notas repetidas y no asumas que algo es poco importante. Algunas ideas están crudas y otras fueron organizadas por IA; ambas importan porque forman parte del historial de pensamiento del proyecto.',
    '',
    `Proyecto: ${project.title}`,
    `Estado actual: ${STATUS_LABEL[project.status]}`,
  ]

  const description = project.description?.trim()
  if (description) lines.push(`Descripción: ${description}`)

  lines.push(
    `Total de notas/ideas: ${sorted.length}`,
    `Notas nacidas de imagen: ${imageCount}`,
    `Notas organizadas por IA incluidas: ${organizedCount}`,
    '',
    'INSTRUCCIONES PARA EL AGENTE',
    '- Usá todas las notas listadas abajo.',
    '- Solo descartá una nota, requisito o idea si el bloc lo dice explícitamente con palabras como: descartar, eliminar, ya no va, cancelar o no usar.',
    '- Si algo parece viejo o contradictorio pero NO hay descarte explícito, mantenelo y señalá la contradicción.',
    '- Si hay contradicciones, señalalas en vez de borrar una versión.',
    '- Conservá los detalles concretos y las intenciones originales.',
    '- Primero sintetizá el contexto, después proponé un plan accionable.',
    '- Separá decisiones confirmadas, dudas abiertas, tareas y riesgos.',
    '',
    'BLOC DE NOTAS COMPLETO',
    '======================',
  )

  if (sorted.length === 0) {
    lines.push('Todavía no hay ideas cargadas.')
  } else {
    sorted.forEach((idea, i) => {
      const metadata = [
        idea.type !== 'text' ? `tipo: ${idea.type}` : null,
        idea.premium ? 'premium' : null,
        idea.source_label ? `origen: ${idea.source_label}` : null,
      ].filter(Boolean)

      lines.push('', `Nota ${i + 1}${isOrganized(idea) ? ' — organizada por IA' : ''}`)
      lines.push(`Fecha: ${idea.created_at}`)
      if (metadata.length > 0) lines.push(`Metadata: ${metadata.join(', ')}`)
      lines.push(idea.content.trim())
    })
  }

  return lines.join('\n').trim()
}

/** Texto plano del resultado organizado, para poder guardarlo como una idea mas. */
export function formatOrganized(result: {
  summary: string
  themes: Array<{ title: string; ideas: Array<{ original: string; refined: string }> }>
  direction: string
  connections: string[]
}): string {
  const lines = ['Organización IA', '', result.summary, '']
  for (const theme of result.themes) {
    lines.push(`## ${theme.title}`)
    for (const idea of theme.ideas) lines.push(`- ${idea.refined || idea.original}`)
    lines.push('')
  }
  if (result.direction) lines.push('Dirección sugerida', result.direction, '')
  if (result.connections.length > 0) {
    lines.push('Conexiones')
    for (const c of result.connections) lines.push(`- ${c}`)
  }
  return lines.join('\n').trim()
}
