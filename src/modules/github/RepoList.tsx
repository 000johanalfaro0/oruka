import { useEffect, useState } from 'react'
import { githubOpenUrl, githubRepos, type Repo } from '@/lib/github'
import { AccessPanel } from './AccessPanel'
import { cached, invalidate, TTL_LARGO } from './cache'
import { relativeTime } from './relativeTime'

/**
 * Los repositorios del usuario, propios o compartidos.
 *
 * Cada pestana pide su lista una vez y la recuerda: cambiar de una a otra no
 * vuelve a llamar a la red.
 */

type Scope = 'mine' | 'shared'

interface Props {
  onCopy: (text: string, label: string) => void
}

export function RepoList({ onCopy }: Props) {
  const [scope, setScope] = useState<Scope>('mine')
  const [repos, setRepos] = useState<Repo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  /** Cambiarlo fuerza a releer saltandose lo guardado. */
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // La cache vive fuera de React: al volver de otra ventana el modulo se
    // remonta, pero esto ya esta pedido y no se vuelve a lanzar `gh`.
    cached(`repos:${scope}`, TTL_LARGO, () => githubRepos(scope === 'shared'))
      .then((list) => {
        if (!cancelled) setRepos(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scope, nonce])

  const refrescar = () => {
    invalidate('repos:')
    setNonce((n) => n + 1)
  }
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? repos.filter(
        (r) =>
          r.name_with_owner.toLowerCase().includes(needle) ||
          (r.description ?? '').toLowerCase().includes(needle),
      )
    : repos

  return (
    <>
      <div className="gh__toolbar">
        <div className="gh__segmented" role="tablist">
          <button
            role="tab"
            aria-selected={scope === 'mine'}
            className={`gh__seg ${scope === 'mine' ? 'is-active' : ''}`}
            onClick={() => setScope('mine')}
          >
            Míos
          </button>
          <button
            role="tab"
            aria-selected={scope === 'shared'}
            className={`gh__seg ${scope === 'shared' ? 'is-active' : ''}`}
            onClick={() => setScope('shared')}
          >
            Compartidos
          </button>
        </div>
        <input
          className="gh__search"
          type="search"
          placeholder="Filtrar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filtrar repositorios"
        />
        {/* Lo guardado dura minutos: esto es la salida para cuando sabes que
            algo ha cambiado y no quieres esperar a que caduque. */}
        <button
          className="gh__icon-btn"
          onClick={refrescar}
          title="Volver a consultar"
          aria-label="Volver a consultar los repositorios"
          disabled={loading}
        >
          <i className="codicon codicon-refresh" aria-hidden="true" />
        </button>
      </div>

      {loading && <p className="gh__note">Cargando…</p>}
      {error && <p className="gh__error">{error}</p>}

      {!loading && !error && shown.length === 0 && (
        <p className="gh__note">
          {repos.length === 0
            ? scope === 'shared'
              ? 'No colaboras en ningún repositorio de otra persona.'
              : 'No hay repositorios.'
            : 'Nada coincide con el filtro.'}
        </p>
      )}

      <ul className="gh__list">
        {shown.map((repo) => (
          <li key={repo.name_with_owner} className="gh__repo">
            <div className="gh__repo-head">
              <button
                className="gh__repo-name"
                onClick={() => void githubOpenUrl(repo.url)}
                title="Abrir en el navegador"
              >
                {repo.name_with_owner}
              </button>
              {repo.private && <span className="gh__badge">privado</span>}
              {repo.fork && <span className="gh__badge">fork</span>}
              {repo.permission && repo.permission !== 'ADMIN' && (
                <span className="gh__badge">{repo.permission.toLowerCase()}</span>
              )}
              <span className="gh__spacer" />
              <button
                className="gh__icon-btn"
                title="Copiar enlace"
                aria-label={`Copiar enlace de ${repo.name_with_owner}`}
                onClick={() => onCopy(repo.url, repo.name_with_owner)}
              >
                <i className="codicon codicon-link" aria-hidden="true" />
              </button>
              <button
                className="gh__icon-btn"
                title={
                  repo.permission === 'ADMIN' ? 'Gestionar el acceso' : 'Ver quién tiene acceso'
                }
                aria-label={`Acceso a ${repo.name_with_owner}`}
                aria-expanded={expanded === repo.name_with_owner}
                onClick={() =>
                  setExpanded(expanded === repo.name_with_owner ? null : repo.name_with_owner)
                }
              >
                <i className="codicon codicon-organization" aria-hidden="true" />
              </button>
            </div>

            {repo.description && <p className="gh__repo-desc">{repo.description}</p>}
            <p className="gh__repo-meta">{relativeTime(repo.updated_at)}</p>

            {expanded === repo.name_with_owner && (
              <AccessPanel
                repo={repo.name_with_owner}
                canManage={repo.permission === 'ADMIN'}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
