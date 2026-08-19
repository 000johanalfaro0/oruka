import { useCallback, useEffect, useState } from 'react'
import { bus } from '@/shell/bus'
import {
  githubInvitations,
  githubOpenUrl,
  githubRespondInvitation,
  githubStatus,
  type GithubStatus,
  type Invitation,
} from '@/lib/github'
import { cached, invalidate, TTL_CORTO, TTL_LARGO } from './cache'
import { PrPanel } from './PrPanel'
import { RepoList } from './RepoList'
import './github.css'

/**
 * Modulo GitHub.
 *
 * El panel de PR sigue al proyecto activo del Workspace, y se entera por el bus:
 * no importa nada de ese modulo.
 */
export default function GithubModule() {
  const [project, setProject] = useState<string | null>(null)
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(
    () => bus.on('workspace.projectChanged', ({ projectPath }) => setProject(projectPath)),
    [],
  )

  useEffect(() => {
    cached('status', TTL_LARGO, githubStatus)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  /**
   * Copia al portapapeles y lo dice.
   *
   * Copiar es la clase de accion que no deja rastro visible: sin el aviso no se
   * sabe si funciono, y la gente acaba pulsando tres veces.
   */
  const copiar = useCallback((text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => setAviso(`Enlace de ${label} copiado`))
      .catch(() => setAviso('No se pudo copiar'))
  }, [])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 2200)
    return () => clearTimeout(t)
  }, [aviso])

  if (status && !status.authenticated) {
    return (
      <div className="gh gh--empty">
        <div className="gh__gate">
          <i className="codicon codicon-github" aria-hidden="true" />
          <h2 className="gh__title">GitHub sin conectar</h2>
          <p className="gh__note">{status.message ?? 'gh no tiene una sesión iniciada.'}</p>
          <p className="gh__note">
            Oruka usa <code>gh</code> y nunca ve tu token. Inicia sesión con{' '}
            <code>gh auth login</code> y vuelve aquí.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="gh">
      <section className="gh__repos">
        <div className="gh__head">
          <h2 className="gh__title">Repositorios</h2>
          {status?.user && <span className="gh__user">{status.user}</span>}
        </div>
        <Invitations />
        <RepoList onCopy={copiar} />
      </section>

      <aside className="gh__prs">
        <PrPanel projectPath={project} onCopy={copiar} />
      </aside>

      {aviso && (
        <p className="gh__toast" role="status">
          {aviso}
        </p>
      )}
    </div>
  )
}

/**
 * Invitaciones a colaborar que estan esperando respuesta.
 *
 * Solo aparece si hay alguna: lo normal es no tener ninguna, y un bloque vacio
 * permanente solo estorba.
 */
function Invitations() {
  const [items, setItems] = useState<Invitation[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [pregunta, setPregunta] = useState<{ inv: Invitation; accept: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cached('invitations', TTL_CORTO, githubInvitations)
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  const responder = (inv: Invitation, accept: boolean) => {
    setBusy(inv.id)
    setPregunta(null)
    setError(null)
    githubRespondInvitation(inv.id, accept)
      .then(() => {
        invalidate('invitations')
        setItems((list) => list.filter((i) => i.id !== inv.id))
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(null))
  }

  if (items.length === 0) return null

  return (
    <div className="gh__invites">
      <h3 className="gh__title">Invitaciones</h3>
      {error && <p className="gh__error">{error}</p>}
      <ul className="gh__list">
        {items.map((inv) => (
          <li key={inv.id} className="gh__invite">
            <p className="gh__invite-text">
              <strong>{inv.inviter}</strong> te invita a <strong>{inv.repo}</strong> con permiso de{' '}
              {inv.permission}.
            </p>

            {pregunta?.inv.id === inv.id ? (
              // Responder se ve desde fuera: quien invito se entera. Por eso el
              // segundo paso, en vez de aceptar de un clic sin querer.
              <p className="gh__confirm">
                <span>
                  {pregunta.accept
                    ? `¿Aceptar el acceso a ${inv.repo}?`
                    : `¿Rechazar la invitación a ${inv.repo}?`}
                </span>
                <button className="gh__btn" onClick={() => responder(inv, pregunta.accept)}>
                  Sí, {pregunta.accept ? 'aceptar' : 'rechazar'}
                </button>
                <button className="gh__btn" onClick={() => setPregunta(null)}>
                  Cancelar
                </button>
              </p>
            ) : (
              <p className="gh__invite-actions">
                <button
                  className="gh__btn"
                  disabled={busy === inv.id}
                  onClick={() => setPregunta({ inv, accept: true })}
                >
                  Aceptar
                </button>
                <button
                  className="gh__btn"
                  disabled={busy === inv.id}
                  onClick={() => setPregunta({ inv, accept: false })}
                >
                  Rechazar
                </button>
                {inv.url && (
                  <button className="gh__btn" onClick={() => void githubOpenUrl(inv.url)}>
                    Ver
                  </button>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
