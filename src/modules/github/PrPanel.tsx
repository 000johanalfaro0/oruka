import { useEffect, useState } from 'react'
import {
  githubOpenUrl,
  githubPrs,
  githubRepoForPath,
  type PrFilter,
  type PullRequest,
} from '@/lib/github'
import { baseName } from '@/lib/paths'
import { bus } from '@/shell/bus'
import { cached, TTL_CORTO, TTL_LARGO } from './cache'
import { relativeTime } from './relativeTime'

/**
 * Los PR del proyecto activo del Workspace.
 *
 * La carpeta se convierte en repo por su `origin`, no por el nombre: dos
 * carpetas pueden llamarse igual y apuntar a repos distintos, y una carpeta
 * puede no ser de GitHub. Si el `origin` no lleva a GitHub, se dice y ya.
 */

const FILTROS: Array<{ id: PrFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'mine', label: 'Míos' },
  { id: 'assigned', label: 'Asignados' },
  { id: 'review', label: 'Revisión' },
]

interface Props {
  projectPath: string | null
  onCopy: (text: string, label: string) => void
}

export function PrPanel({ projectPath, onCopy }: Props) {
  const [repo, setRepo] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [filter, setFilter] = useState<PrFilter>('all')
  const [prs, setPrs] = useState<PullRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // La carpeta activa manda: al cambiar de proyecto se vuelve a resolver.
  useEffect(() => {
    if (!projectPath) {
      setRepo(null)
      return
    }
    let cancelled = false
    setResolving(true)
    setRepo(null)
    cached(`origin:${projectPath}`, TTL_LARGO, () => githubRepoForPath(projectPath))
      .then((r) => {
        if (!cancelled) setRepo(r)
      })
      .catch(() => {
        if (!cancelled) setRepo(null)
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  useEffect(() => {
    if (!repo) {
      setPrs(null)
      return
    }
    let cancelled = false
    setError(null)
    setPrs(null)
    cached(`prs:${repo}:${filter}`, TTL_CORTO, () => githubPrs(repo, filter))
      .then((list) => {
        if (!cancelled) setPrs(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [repo, filter])

  const scope = projectPath ? baseName(projectPath) : 'sin proyecto activo'

  return (
    <>
      <h2 className="gh__title">
        PR <span className="gh__scope">{scope}</span>
      </h2>

      {!projectPath && (
        <p className="gh__note">Abre un proyecto en el Workspace para ver sus PR aquí.</p>
      )}

      {projectPath && resolving && <p className="gh__note">Buscando el repositorio…</p>}

      {projectPath && !resolving && !repo && (
        <p className="gh__note">
          Esta carpeta no apunta a GitHub. Su <code>origin</code> falta o va a otro sitio.
        </p>
      )}

      {repo && (
        <>
          <p className="gh__repo-meta">{repo}</p>
          <div className="gh__filters" role="tablist">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={`gh__chip ${filter === f.id ? 'is-active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && <p className="gh__error">{error}</p>}
          {!error && prs === null && <p className="gh__note">Cargando…</p>}
          {prs?.length === 0 && <p className="gh__note">Ningún PR abierto con este filtro.</p>}

          <ul className="gh__list">
            {prs?.map((pr) => (
              <li key={pr.number} className="gh__pr">
                <div className="gh__pr-head">
                  <button className="gh__pr-title" onClick={() => void githubOpenUrl(pr.url)}>
                    <span className="gh__pr-num">#{pr.number}</span> {pr.title}
                  </button>
                  <button
                    className="gh__icon-btn"
                    title="Copiar enlace"
                    aria-label={`Copiar enlace del PR ${pr.number}`}
                    onClick={() => onCopy(pr.url, `#${pr.number}`)}
                  >
                    <i className="codicon codicon-link" aria-hidden="true" />
                  </button>
                  <button
                    className="gh__icon-btn"
                    title="Abrir con un agente"
                    aria-label={`Abrir el PR ${pr.number} con un agente`}
                    onClick={() => abrirConAgente(projectPath, repo, pr)}
                  >
                    <i className="codicon codicon-sparkle" aria-hidden="true" />
                  </button>
                </div>
                <p className="gh__pr-meta">
                  {pr.author} · {pr.branch} · {relativeTime(pr.updated_at)}
                </p>
                <p className="gh__pr-tags">
                  {pr.draft && <span className="gh__badge">borrador</span>}
                  {pr.review_decision && (
                    <span className={`gh__badge gh__badge--${reviewTone(pr.review_decision)}`}>
                      {reviewLabel(pr.review_decision)}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * Manda abrir el proyecto y lanzarle un agente con el PR por delante.
 *
 * GitHub no sabe lanzar agentes ni quiere: solo pide, y el Workspace decide con
 * que CLI y en que hueco. Primero se cambia de modulo para que el usuario vea
 * lo que ha pedido, y la peticion espera si el Workspace aun no esta cargado.
 */
function abrirConAgente(projectPath: string | null, repo: string, pr: PullRequest) {
  if (!projectPath) return
  bus.emit('shell.activateModule', { moduleId: 'workspace' })
  bus.request('workspace.openWithAgent', {
    projectPath,
    prompt: `Revisa el pull request #${pr.number} de ${repo}: «${pr.title}» (rama ${pr.branch}). ${pr.url}`,
  })
}

/** El vocabulario de GitHub, dicho en corto y en castellano. */
function reviewLabel(decision: string): string {
  switch (decision) {
    case 'APPROVED':
      return 'aprobado'
    case 'CHANGES_REQUESTED':
      return 'cambios pedidos'
    case 'REVIEW_REQUIRED':
      return 'falta revisión'
    default:
      return decision.toLowerCase()
  }
}

/** Que color le toca. Los tonos salen de los tokens, aqui solo se elige cual. */
function reviewTone(decision: string): string {
  switch (decision) {
    case 'APPROVED':
      return 'ok'
    case 'CHANGES_REQUESTED':
      return 'alert'
    default:
      return 'wait'
  }
}
