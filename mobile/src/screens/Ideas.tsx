import { useEffect, useState } from 'react'
import { createIdea, listIdeas, listProjects } from '@/modules/ideas/repository'
import type { Idea, Project } from '@/modules/ideas/types'

/**
 * Las ideas, en el telefono.
 *
 * No se copia ni una consulta: se usa el mismo `repository.ts` del escritorio,
 * que es la unica puerta a esos datos. Si manana cambia la nube, cambia alli y
 * esto se entera solo.
 */
export function Ideas() {
  const [proyectos, setProyectos] = useState<Project[] | null>(null)
  const [abierto, setAbierto] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listProjects()
      .then((lista) => {
        if (vivo) setProyectos(lista)
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      vivo = false
    }
  }, [])

  if (error) return <p className="error">{error}</p>
  if (abierto) return <Detalle proyecto={abierto} onVolver={() => setAbierto(null)} />
  if (!proyectos) return <p className="empty">Cargando tus proyectos…</p>
  if (proyectos.length === 0) return <p className="empty">Todavía no tienes proyectos.</p>

  return (
    <section className="card">
      {proyectos.map((p) => (
        <button type="button" className="row" key={p.id} onClick={() => setAbierto(p)}>
          <span className="row__text">
            <span className="row__title">{p.title}</span>
            {p.description && <span className="row__hint">{p.description}</span>}
          </span>
          <span className="row__chevron" aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </section>
  )
}

/** Las ideas de un proyecto, y el campo para añadir una. */
function Detalle({ proyecto, onVolver }: { proyecto: Project; onVolver: () => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listIdeas(proyecto.id)
      .then((lista) => {
        if (vivo) setIdeas(lista)
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      vivo = false
    }
  }, [proyecto.id])

  const guardar = async () => {
    const contenido = texto.trim()
    if (!contenido) return
    setGuardando(true)
    setError(null)
    try {
      // Puede devolver varias: la base corta las ideas muy largas en trozos.
      const nuevas = await createIdea(proyecto.id, contenido)
      setIdeas((previas) => [...(previas ?? []), ...nuevas])
      setTexto('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="chat">
      <header className="topbar">
        <button type="button" className="topbar__back" onClick={onVolver} aria-label="Volver">
          ‹
        </button>
        <span className="topbar__title">{proyecto.title}</span>
      </header>

      <div className="body">
        {error && <p className="error">{error}</p>}
        {!ideas && <p className="empty">Cargando ideas…</p>}
        {ideas && ideas.length === 0 && <p className="empty">Este proyecto está vacío.</p>}
        {ideas && ideas.length > 0 && (
          <section className="card">
            {ideas.map((idea) => (
              <p className="idea" key={idea.id}>
                {idea.content}
                <span className="idea__date">
                  {new Date(idea.created_at).toLocaleDateString('es-ES')}
                </span>
              </p>
            ))}
          </section>
        )}
      </div>

      <div className="composer">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Apunta una idea…"
          rows={1}
        />
        <button
          type="button"
          disabled={guardando || texto.trim().length === 0}
          onClick={() => void guardar()}
        >
          Añadir
        </button>
      </div>
    </div>
  )
}
