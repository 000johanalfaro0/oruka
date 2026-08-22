import { useEffect, useState } from 'react'
import {
  githubBranchStatus,
  githubOpenUrl,
  githubPrCreate,
  githubPrs,
  githubRepoForPath,
  type BranchStatus,
  type PrFilter,
  type PullRequest,
} from '@/lib/github'
import { baseName } from '@/lib/paths'
import { bus } from '@/shell/bus'
import { cached, invalidate, TTL_CORTO, TTL_LARGO } from './cache'
import { PrReview } from './PrReview'
import { relativeTime } from './relativeTime'
import { explicar } from './errores'

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
  /** Para decir en voz alta que una accion publica salio bien. */
  onAviso: (texto: string) => void
}

export function PrPanel({ projectPath, onCopy, onAviso }: Props) {
  const [repo, setRepo] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [filter, setFilter] = useState<PrFilter>('all')
  const [prs, setPrs] = useState<PullRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** El PR abierto para revisar. `null` es la lista. */
  const [revisando, setRevisando] = useState<PullRequest | null>(null)
  const [rama, setRama] = useState<BranchStatus | null>(null)
  const [creando, setCreando] = useState(false)
  const [nonce, setNonce] = useState(0)

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

  // En que rama esta y si hay trabajo sin subir. Es la mitad del contexto que
  // faltaba: el panel sabia el repo, pero no donde estabas dentro de el.
  useEffect(() => {
    if (!projectPath) {
      setRama(null)
      return
    }
    let cancelled = false
    githubBranchStatus(projectPath)
      .then((r) => {
        if (!cancelled) setRama(r)
      })
      .catch(() => {
        if (!cancelled) setRama(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, nonce])

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
        if (!cancelled) setError(explicar(e))
      })
    return () => {
      cancelled = true
    }
  }, [repo, filter, nonce])

  const scope = projectPath ? baseName(projectPath) : 'sin proyecto activo'

  const refrescar = () => {
    // Sin argumento se olvida todo lo guardado. Es deliberado: fusionar o
    // cerrar cambia la lista, los checks y hasta la rama, y aqui vale mas
    // volver a preguntarlo todo que acertar qué invalidar.
    invalidate()
    setRevisando(null)
    setNonce((n) => n + 1)
  }

  if (revisando && repo) {
    return (
      <PrReview
        repo={repo}
        pr={revisando}
        onBack={() => setRevisando(null)}
        onChanged={refrescar}
        onAviso={onAviso}
      />
    )
  }

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

          {/* En qué rama estás y qué te falta por subir. Sin esto el panel
              sabía el repositorio pero no dónde estabas dentro de él. */}
          {rama && (
            <p className="gh__branch">
              <i className="codicon codicon-git-branch" aria-hidden="true" />
              <strong>{rama.branch}</strong>
              {rama.dirty && <span className="gh__badge gh__badge--wait">sin guardar</span>}
              {rama.ahead > 0 && <span className="gh__badge">{rama.ahead} por subir</span>}
              {rama.behind > 0 && <span className="gh__badge">{rama.behind} por bajar</span>}
              {!rama.upstream && <span className="gh__badge">sin publicar</span>}
            </p>
          )}

          {/* Abrir el PR desde aquí cierra el ciclo: trabajas en una rama y lo
              propones sin cambiar de aplicación. Solo si hay algo que proponer. */}
          {rama && rama.branch !== 'HEAD' && (rama.ahead > 0 || !rama.upstream) && !creando && (
            <button className="gh__btn" onClick={() => setCreando(true)}>
              Abrir un pull request desde {rama.branch}
            </button>
          )}
          {creando && projectPath && (
            <CrearPr
              cwd={projectPath}
              rama={rama?.branch ?? ''}
              onCancel={() => setCreando(false)}
              onCreado={() => {
                setCreando(false)
                refrescar()
              }}
            />
          )}

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
                  <button className="gh__pr-title" onClick={() => setRevisando(pr)}>
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
 * El formulario para proponer la rama actual.
 *
 * `gh` deduce la rama y el repositorio de la carpeta, asi que aqui solo hacen
 * falta el titulo y la descripcion. Abrir un PR avisa a quien revisa, o sea que
 * se ve fuera: por eso el boton dice lo que va a pasar y no un «Aceptar».
 */
function CrearPr({
  cwd,
  rama,
  onCancel,
  onCreado,
}: {
  cwd: string
  rama: string
  onCancel: () => void
  onCreado: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const crear = () => {
    setBusy(true)
    setError(null)
    githubPrCreate(cwd, titulo.trim(), cuerpo.trim(), base.trim())
      .then((url) => {
        if (url) void githubOpenUrl(url)
        onCreado()
      })
      .catch((e: unknown) => setError(explicar(e)))
      .finally(() => setBusy(false))
  }

  return (
    <form
      className="gh__access"
      onSubmit={(e) => {
        e.preventDefault()
        crear()
      }}
    >
      {error && <p className="gh__error">{error}</p>}
      <input
        className="gh__search"
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Qué hace este cambio"
        aria-label="Título del pull request"
      />
      <textarea
        className="pr__body"
        value={cuerpo}
        onChange={(e) => setCuerpo(e.target.value)}
        placeholder="Contexto para quien lo revise (opcional)"
        rows={3}
      />
      <div className="gh__invite-form">
        <input
          className="gh__search"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="rama destino (por defecto, la principal)"
          aria-label="Rama destino"
        />
        <button className="gh__btn" type="submit" disabled={!titulo.trim() || busy}>
          {busy ? 'Abriendo…' : `Proponer ${rama}`}
        </button>
        <button className="gh__btn" type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
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
