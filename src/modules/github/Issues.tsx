import { useEffect, useState } from 'react'
import { githubIssues, githubOpenUrl, type Issue } from '@/lib/github'
import { bus } from '@/shell/bus'
import { cached, TTL_CORTO } from './cache'
import { relativeTime } from './relativeTime'
import { explicar } from './errores'

/**
 * Lo que te han asignado.
 *
 * Un equipo reparte el trabajo en issues, no en pull requests: el PR es el
 * final del camino y el issue es el principio. Sin esto el modulo solo servia
 * para revisar lo que ya estaba hecho.
 *
 * El boton de agente es el puente que faltaba: en vez de leer el issue, copiar
 * el numero y explicarselo a mano a un agente, se abre el proyecto con el texto
 * ya delante.
 */

interface Props {
  /** La carpeta del proyecto activo, si la hay. Sin ella no se puede lanzar. */
  projectPath: string | null
  /** El repo de esa carpeta, para saber que issues son «de aqui». */
  repoActivo: string | null
}

export function Issues({ projectPath, repoActivo }: Props) {
  const [items, setItems] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [soloEste, setSoloEste] = useState(true)

  useEffect(() => {
    cached('issues', TTL_CORTO, githubIssues)
      .then(setItems)
      .catch((e: unknown) => setError(explicar(e)))
  }, [])

  if (error) return <p className="gh__error">{error}</p>
  if (!items) return <p className="gh__note">Cargando…</p>
  if (items.length === 0) {
    return <p className="gh__note">No tienes ningún issue asignado.</p>
  }

  const deEste = repoActivo ? items.filter((i) => i.repo === repoActivo) : []
  // Filtrar por el proyecto abierto solo tiene sentido si hay alguno aqui.
  const filtrar = soloEste && deEste.length > 0
  const mostrados = filtrar ? deEste : items

  return (
    <>
      <div className="gh__head">
        <h3 className="gh__subtitle">Asignados a ti</h3>
        {deEste.length > 0 && repoActivo && (
          <button className="gh__chip" onClick={() => setSoloEste((v) => !v)}>
            {filtrar ? `todos (${items.length})` : `solo ${repoActivo.split('/')[1] ?? repoActivo}`}
          </button>
        )}
      </div>

      <ul className="gh__list">
        {mostrados.map((issue) => (
          <li key={`${issue.repo}#${issue.number}`} className="gh__pr">
            <div className="gh__pr-head">
              <button className="gh__pr-title" onClick={() => void githubOpenUrl(issue.url)}>
                <span className="gh__pr-num">#{issue.number}</span> {issue.title}
              </button>
              {projectPath && issue.repo === repoActivo && (
                <button
                  className="gh__icon-btn"
                  title="Empezarlo con un agente"
                  aria-label={`Empezar el issue ${issue.number} con un agente`}
                  onClick={() => empezarConAgente(projectPath, issue)}
                >
                  <i className="codicon codicon-sparkle" aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="gh__pr-meta">
              {issue.repo} · {relativeTime(issue.updated_at)}
            </p>
            {issue.labels.length > 0 && (
              <p className="gh__pr-tags">
                {issue.labels.map((l) => (
                  <span key={l} className="gh__badge">
                    {l}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Abre el proyecto y le lanza un agente con el issue por delante.
 *
 * Se le da el numero y el titulo, no el cuerpo entero: el agente sabe leer el
 * issue por su cuenta si lo necesita, y el prompt viaja por la linea de
 * comandos, que en Windows tiene un limite.
 */
function empezarConAgente(projectPath: string, issue: Issue) {
  bus.emit('shell.activateModule', { moduleId: 'workspace' })
  bus.request('workspace.openWithAgent', {
    projectPath,
    prompt: `Trabaja en el issue #${issue.number} de ${issue.repo}: «${issue.title}». ${issue.url}`,
  })
}
