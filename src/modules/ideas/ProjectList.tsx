import { useEffect, useState } from 'react'
import * as repo from './repository'
import { STATUS_LABEL, type Project } from './types'

/** Lista de proyectos, con su chip de estado. Equivale al home de Idearia. */
export function ProjectList({ onOpen }: { onOpen: (project: Project) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  const load = () => {
    repo
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(String(e)))
  }

  useEffect(load, [])

  const create = async () => {
    const clean = title.trim()
    if (!clean) return
    try {
      const project = await repo.createProject(clean, null)
      setTitle('')
      setCreating(false)
      setProjects((prev) => (prev ? [project, ...prev] : [project]))
      onOpen(project)
    } catch (e) {
      setError(String(e))
    }
  }

  if (error) return <p className="ideas__error">{error}</p>
  if (!projects) return <p className="ideas__pending">Cargando proyectos…</p>

  return (
    <div className="ipl">
      <div className="ipl__head">
        <h2 className="ipl__title">
          Proyectos <span className="ipl__count">{projects.length}</span>
        </h2>
        {creating ? (
          <form
            className="ipl__new"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <input
              autoFocus
              value={title}
              placeholder="Título del proyecto"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => !title.trim() && setCreating(false)}
            />
            <button type="submit">Crear</button>
          </form>
        ) : (
          <button className="ipl__add" onClick={() => setCreating(true)}>
            <i className="codicon codicon-add" aria-hidden="true" />
            <span>Nuevo proyecto</span>
          </button>
        )}
      </div>

      <ul className="ipl__list">
        {projects.map((p) => (
          <li key={p.id}>
            <button className="ipl__item" onClick={() => onOpen(p)}>
              <span className="ipl__name">{p.title}</span>
              {p.description && <span className="ipl__desc">{p.description}</span>}
              {/* Fecha y estado en columnas propias, no apelotonadas en una:
                  asi se leen en vertical de un vistazo por toda la lista. */}
              <span className="ipl__date">
                {p.scheduled_date && (
                  <>
                    <i className="codicon codicon-calendar" aria-hidden="true" />
                    {p.scheduled_date}
                  </>
                )}
              </span>
              <span className="ipl__status">
                <span className={`chip chip--${p.status}`}>{STATUS_LABEL[p.status]}</span>
              </span>
            </button>
          </li>
        ))}
        {projects.length === 0 && <li className="ideas__pending">Aún no hay proyectos.</li>}
      </ul>
    </div>
  )
}
