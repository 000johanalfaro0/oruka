import { useCallback, useEffect, useState } from 'react'
import {
  githubCancelInvitation,
  githubCollaborators,
  githubInvite,
  githubOpenUrl,
  githubRemoveCollaborator,
  githubSentInvitations,
  PERMISOS,
  type Collaborator,
  type Permiso,
  type SentInvitation,
} from '@/lib/github'
import { cached, invalidate, TTL_CORTO } from './cache'
import { relativeTime } from './relativeTime'

/**
 * Quien tiene acceso a un repo, y como cambiarlo.
 *
 * Las tres acciones de aqui —invitar, cambiar permiso y quitar— **se notan
 * fuera de esta maquina**: a la otra persona le llega un correo, o se queda sin
 * acceso de golpe. Ninguna se ejecuta de un solo clic: todas pasan por una
 * confirmacion que dice con nombre y apellidos lo que va a ocurrir.
 *
 * Si el usuario no administra el repo solo se muestra la lista: GitHub
 * rechazaria las escrituras, y ensenar botones que siempre fallan es peor que
 * no ensenarlos.
 */

interface Props {
  repo: string
  /** Si el usuario puede gestionar el acceso. Solo ADMIN puede. */
  canManage: boolean
}

/** Lo que esta a punto de pasar, en espera de confirmacion. */
type Pending =
  | { kind: 'invite'; login: string; permission: Permiso; existing: boolean }
  | { kind: 'remove'; login: string }
  | { kind: 'cancel'; invitation: SentInvitation }

export function AccessPanel({ repo, canManage }: Props) {
  const [people, setPeople] = useState<Collaborator[] | null>(null)
  const [sent, setSent] = useState<SentInvitation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [login, setLogin] = useState('')
  const [permission, setPermission] = useState<Permiso>('push')
  const [pending, setPending] = useState<Pending | null>(null)

  const cargar = useCallback(() => {
    cached(`colabs:${repo}`, TTL_CORTO, () => githubCollaborators(repo))
      .then(setPeople)
      .catch((e: unknown) => setError(String(e)))
    // Las invitaciones pendientes solo las ve quien administra el repo. Si no
    // puede, no se piden: devolveria un 403 y ensuciaria la pantalla con un
    // error que no le importa a nadie.
    if (canManage) {
      cached(`enviadas:${repo}`, TTL_CORTO, () => githubSentInvitations(repo))
        .then(setSent)
        .catch(() => setSent([]))
    }
  }, [repo, canManage])

  useEffect(cargar, [cargar])

  const ejecutar = (accion: Pending) => {
    setBusy(true)
    setError(null)
    const trabajo =
      accion.kind === 'invite'
        ? githubInvite(repo, accion.login, accion.permission)
        : accion.kind === 'remove'
          ? githubRemoveCollaborator(repo, accion.login)
          : githubCancelInvitation(repo, accion.invitation.id)

    trabajo
      .then(() => {
        setPending(null)
        if (accion.kind === 'invite') setLogin('')
        // Sin esto, `cargar()` devolveria la lista de hace un minuto y pareceria
        // que la invitacion no ha surtido efecto.
        invalidate(`colabs:${repo}`)
        invalidate(`enviadas:${repo}`)
        cargar()
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  const pedirInvitacion = () => {
    const limpio = login.trim().replace(/^@/, '')
    if (!limpio) return
    // Si ya colabora, esto no invita: le cambia el permiso. Decirlo cambia por
    // completo lo que la persona cree que esta haciendo.
    const existing = (people ?? []).some((p) => p.login.toLowerCase() === limpio.toLowerCase())
    setPending({ kind: 'invite', login: limpio, permission, existing })
  }

  return (
    <div className="gh__access">
      {error && <p className="gh__error">{error}</p>}

      {people === null && <p className="gh__note">Cargando…</p>}

      {people && (
        <ul className="gh__people">
          {people.map((p) => (
            <li key={p.login} className="gh__person">
              <i className="codicon codicon-account" aria-hidden="true" />
              <button className="gh__person-name" onClick={() => void githubOpenUrl(p.url)}>
                {p.login}
              </button>
              {p.permission && <span className="gh__badge">{p.permission.toLowerCase()}</span>}
              <span className="gh__spacer" />
              {canManage && (
                <button
                  className="gh__icon-btn"
                  title={`Quitar el acceso a ${p.login}`}
                  aria-label={`Quitar el acceso a ${p.login}`}
                  disabled={busy}
                  onClick={() => setPending({ kind: 'remove', login: p.login })}
                >
                  <i className="codicon codicon-trash" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sent.length > 0 && (
        <>
          <h4 className="gh__subtitle">Invitaciones sin contestar</h4>
          <ul className="gh__people">
            {sent.map((inv) => (
              <li key={inv.id} className="gh__person">
                <i className="codicon codicon-mail" aria-hidden="true" />
                <span>{inv.invitee}</span>
                <span className="gh__badge">{inv.permission}</span>
                <span className="gh__muted">{relativeTime(inv.created_at)}</span>
                <span className="gh__spacer" />
                <button
                  className="gh__icon-btn"
                  title="Retirar la invitación"
                  aria-label={`Retirar la invitación a ${inv.invitee}`}
                  disabled={busy}
                  onClick={() => setPending({ kind: 'cancel', invitation: inv })}
                >
                  <i className="codicon codicon-close" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {canManage && !pending && (
        <>
          <form
            className="gh__invite-form"
            onSubmit={(e) => {
              e.preventDefault()
              pedirInvitacion()
            }}
          >
            <input
              className="gh__search"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="usuario de GitHub"
              aria-label={`Añadir a alguien a ${repo}`}
              spellCheck={false}
            />
            <select
              className="gh__select"
              value={permission}
              onChange={(e) => setPermission(e.target.value as Permiso)}
              aria-label="Nivel de acceso"
            >
              {PERMISOS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button className="gh__btn" type="submit" disabled={!login.trim() || busy}>
              Añadir
            </button>
          </form>
          <p className="gh__hint">{PERMISOS.find((p) => p.id === permission)?.hint}</p>
        </>
      )}

      {pending && (
        <Confirm
          pending={pending}
          repo={repo}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => ejecutar(pending)}
        />
      )}

      {!canManage && people && (
        <p className="gh__hint">Solo quien administra el repositorio puede cambiar el acceso.</p>
      )}
    </div>
  )
}

/**
 * El paso que evita el arrepentimiento.
 *
 * Dice a quien afecta y que va a pasar, con esas palabras. Un «¿seguro?» a secas
 * no informa de nada.
 */
function Confirm({
  pending,
  repo,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending
  repo: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  let texto: string
  let boton: string

  if (pending.kind === 'invite') {
    const nivel = PERMISOS.find((p) => p.id === pending.permission)?.label ?? pending.permission
    texto = pending.existing
      ? `${pending.login} ya colabora en ${repo}. Su acceso pasará a ${nivel}.`
      : `Se enviará a ${pending.login} una invitación a ${repo} con acceso de ${nivel}. Le llegará un correo.`
    boton = pending.existing ? 'Cambiar acceso' : 'Enviar invitación'
  } else if (pending.kind === 'remove') {
    texto = `${pending.login} dejará de tener acceso a ${repo} inmediatamente.`
    boton = 'Quitar acceso'
  } else {
    texto = `Se retirará la invitación de ${pending.invitation.invitee} a ${repo}.`
    boton = 'Retirar'
  }

  return (
    <p className="gh__confirm">
      <span>{texto}</span>
      <button className="gh__btn" disabled={busy} onClick={onConfirm}>
        {busy ? 'Un momento…' : boton}
      </button>
      <button className="gh__btn" disabled={busy} onClick={onCancel}>
        Cancelar
      </button>
    </p>
  )
}
