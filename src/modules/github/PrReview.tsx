import { useCallback, useEffect, useState } from 'react'
import {
  githubOpenUrl,
  githubPrChecks,
  githubPrClose,
  githubPrDiff,
  githubPrMerge,
  githubPrReview,
  type Check,
  type PullRequest,
  type ReviewAction,
} from '@/lib/github'
import { cached, invalidate, TTL_CORTO } from './cache'
import { explicar } from './errores'

/**
 * Revisar un pull request sin salir de la app.
 *
 * Era el agujero grande del modulo: la lista de PR mandaba al navegador, que es
 * justo lo que Oruka quiere evitar. Aqui estan las tres cosas que hacen falta
 * para decidir —el estado del CI, el diff y las acciones de revision— en ese
 * orden, porque nadie aprueba nada sin saber antes si esta en verde.
 */

interface Props {
  repo: string
  pr: PullRequest
  onBack: () => void
  /** Para refrescar la lista cuando el PR deja de estar abierto. */
  onChanged: () => void
  /**
   * Para confirmar que la accion salio bien.
   *
   * Sin esto, publicar una revision no dejaba ni una senal: la caja de texto se
   * vaciaba y ya. Quien no ve respuesta vuelve a pulsar, y aqui cada pulsacion
   * es un comentario publico mas en el PR de alguien.
   */
  onAviso: (texto: string) => void
}

/** Lo que esta a punto de publicarse, en espera de confirmacion. */
type Pending =
  | { kind: 'review'; action: ReviewAction }
  | { kind: 'merge'; method: 'merge' | 'squash' | 'rebase' }
  | { kind: 'close' }

/**
 * Que decirle al usuario cuando la accion ya esta hecha.
 *
 * En pasado y nombrando el PR: «se ha enviado» no distingue entre lo que se
 * envio y lo que se quiso enviar, y aqui la diferencia es una publicacion con
 * tu nombre en el repositorio de alguien.
 */
function hecho(accion: Pending, numero: number): string {
  if (accion.kind === 'merge') return `El #${numero} se fusionó.`
  if (accion.kind === 'close') return `El #${numero} se cerró sin fusionar.`
  return {
    approve: `Aprobaste el #${numero}.`,
    'request-changes': `Pediste cambios en el #${numero}.`,
    comment: `Comentaste en el #${numero}.`,
  }[accion.action]
}

const REVISIONES: Array<{ id: ReviewAction; label: string; exigeTexto: boolean }> = [
  { id: 'approve', label: 'Aprobar', exigeTexto: false },
  { id: 'request-changes', label: 'Pedir cambios', exigeTexto: true },
  { id: 'comment', label: 'Comentar', exigeTexto: true },
]

export function PrReview({ repo, pr, onBack, onChanged, onAviso }: Props) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [body, setBody] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [borrarRama, setBorrarRama] = useState(true)

  const cargar = useCallback(() => {
    setError(null)
    cached(`checks:${repo}:${pr.number}`, TTL_CORTO, () => githubPrChecks(repo, pr.number))
      .then(setChecks)
      .catch(() => setChecks([]))
    cached(`diff:${repo}:${pr.number}`, TTL_CORTO, () => githubPrDiff(repo, pr.number))
      .then(setDiff)
      .catch((e: unknown) => setError(explicar(e)))
  }, [repo, pr.number])

  useEffect(cargar, [cargar])

  const ejecutar = (accion: Pending) => {
    setBusy(true)
    setError(null)
    const trabajo =
      accion.kind === 'review'
        ? githubPrReview(repo, pr.number, accion.action, body)
        : accion.kind === 'merge'
          ? githubPrMerge(repo, pr.number, accion.method, borrarRama)
          : githubPrClose(repo, pr.number)

    trabajo
      .then(() => {
        setPending(null)
        setBody('')
        invalidate(`prs:${repo}`)
        invalidate(`checks:${repo}:${pr.number}`)
        onAviso(hecho(accion, pr.number))
        // Fusionar o cerrar saca el PR de la lista: se vuelve a ella.
        if (accion.kind === 'review') cargar()
        else onChanged()
      })
      .catch((e: unknown) => setError(explicar(e)))
      .finally(() => setBusy(false))
  }

  const fallan = checks?.filter((c) => c.bucket === 'fail').length ?? 0
  const esperan = checks?.filter((c) => c.bucket === 'pending').length ?? 0

  return (
    <div className="pr">
      <header className="pr__head">
        <button className="gh__icon-btn" onClick={onBack} aria-label="Volver a la lista">
          <i className="codicon codicon-arrow-left" aria-hidden="true" />
        </button>
        <h2 className="pr__title">
          <span className="gh__pr-num">#{pr.number}</span> {pr.title}
        </h2>
        <button
          className="gh__icon-btn"
          title="Abrir en el navegador"
          aria-label="Abrir el pull request en el navegador"
          onClick={() => void githubOpenUrl(pr.url)}
        >
          <i className="codicon codicon-link-external" aria-hidden="true" />
        </button>
      </header>
      <p className="gh__pr-meta">
        {pr.author} · {pr.branch}
        {pr.draft && <span className="gh__badge">borrador</span>}
      </p>

      {error && <p className="gh__error">{error}</p>}

      {/* El CI va primero: es lo que decide si merece la pena leer el diff. */}
      <section>
        <h3 className="gh__subtitle">Comprobaciones</h3>
        {checks === null && <p className="gh__note">Consultando…</p>}
        {checks?.length === 0 && <p className="gh__note">Este repositorio no tiene CI.</p>}
        <ul className="pr__checklist">
          {checks?.map((c) => (
            <li key={c.name} className={`pr__check pr__check--${c.bucket}`}>
              <i
                className={`codicon codicon-${
                  c.bucket === 'pass'
                    ? 'pass-filled'
                    : c.bucket === 'fail'
                      ? 'error'
                      : 'circle-large-outline'
                }`}
                aria-hidden="true"
              />
              {c.url ? (
                <button className="pr__checkname" onClick={() => void githubOpenUrl(c.url)}>
                  {c.name}
                </button>
              ) : (
                <span className="pr__checkname">{c.name}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="gh__subtitle">Cambios</h3>
        {diff === null && <p className="gh__note">Cargando el diff…</p>}
        {diff !== null && diff.trim() === '' && <p className="gh__note">Sin cambios.</p>}
        {diff && diff.trim() !== '' && <pre className="pr__diff">{colorearDiff(diff)}</pre>}
      </section>

      <section>
        <h3 className="gh__subtitle">Tu revisión</h3>
        <textarea
          className="pr__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Qué has visto. Obligatorio para pedir cambios o comentar."
          rows={3}
        />
        <div className="gh__filters">
          {REVISIONES.map((r) => (
            <button
              key={r.id}
              className="gh__btn"
              disabled={busy || (r.exigeTexto && !body.trim())}
              title={r.exigeTexto && !body.trim() ? 'Escribe antes qué has visto' : undefined}
              onClick={() => setPending({ kind: 'review', action: r.id })}
            >
              {r.label}
            </button>
          ))}
        </div>

        <h3 className="gh__subtitle">Cerrar el asunto</h3>
        <div className="gh__filters">
          <button
            className="gh__btn"
            disabled={busy}
            onClick={() => setPending({ kind: 'merge', method: 'squash' })}
          >
            Fusionar aplastando
          </button>
          <button
            className="gh__btn"
            disabled={busy}
            onClick={() => setPending({ kind: 'merge', method: 'merge' })}
          >
            Fusionar
          </button>
          <button className="gh__btn" disabled={busy} onClick={() => setPending({ kind: 'close' })}>
            Cerrar sin fusionar
          </button>
        </div>
        <label className="pr__check-label">
          <input
            type="checkbox"
            checked={borrarRama}
            onChange={(e) => setBorrarRama(e.target.checked)}
          />
          Borrar la rama al fusionar
        </label>

        {pending && (
          <Confirmar
            pending={pending}
            pr={pr}
            repo={repo}
            fallan={fallan}
            esperan={esperan}
            borrarRama={borrarRama}
            busy={busy}
            onCancel={() => setPending(null)}
            onConfirm={() => ejecutar(pending)}
          />
        )}
      </section>
    </div>
  )
}

/**
 * El paso previo, que dice lo que va a pasar de verdad.
 *
 * Al fusionar avisa ademas del estado del CI: fusionar algo en rojo se puede,
 * pero tiene que ser una decision y no un descuido.
 */
function Confirmar({
  pending,
  pr,
  repo,
  fallan,
  esperan,
  borrarRama,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending
  pr: PullRequest
  repo: string
  fallan: number
  esperan: number
  borrarRama: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  let texto: string
  let boton: string

  if (pending.kind === 'review') {
    const como = {
      approve: 'Aprobarás',
      'request-changes': 'Pedirás cambios en',
      comment: 'Comentarás',
    }[pending.action]
    texto = `${como} el #${pr.number}. Se publica con tu nombre y le llega a ${pr.author}.`
    boton = 'Publicar'
  } else if (pending.kind === 'merge') {
    const rama = borrarRama ? ' Se borrará la rama.' : ''
    texto = `El #${pr.number} entrará en ${repo}.${rama}`
    boton = 'Fusionar'
  } else {
    texto = `El #${pr.number} se cerrará sin entrar. Se puede reabrir después.`
    boton = 'Cerrar'
  }

  const aviso =
    pending.kind === 'merge' && fallan > 0
      ? `Ojo: ${fallan} comprobación(es) en rojo.`
      : pending.kind === 'merge' && esperan > 0
        ? `Ojo: ${esperan} comprobación(es) sin terminar.`
        : null

  return (
    <p className="gh__confirm">
      <span>
        {texto}
        {aviso && <strong className="pr__aviso"> {aviso}</strong>}
      </span>
      <button className="gh__btn" disabled={busy} onClick={onConfirm}>
        {busy ? 'Un momento…' : boton}
      </button>
      <button className="gh__btn" disabled={busy} onClick={onCancel}>
        Cancelar
      </button>
    </p>
  )
}

/**
 * Colorea el diff por el primer caracter de cada linea.
 *
 * Un diff sin color es una pared: lo que se busca al mirarlo es justo qué entra
 * y qué sale. Se acota a 4000 lineas porque un PR gigante congelaria la vista, y
 * un PR asi no se revisa aqui de todas formas.
 */
function colorearDiff(diff: string) {
  return diff
    .split('\n')
    .slice(0, 4000)
    .map((linea, i) => {
      let clase = ''
      if (linea.startsWith('+++') || linea.startsWith('---') || linea.startsWith('diff --git'))
        clase = 'df-file'
      else if (linea.startsWith('@@')) clase = 'df-hunk'
      else if (linea.startsWith('+')) clase = 'df-add'
      else if (linea.startsWith('-')) clase = 'df-del'
      return (
        <span key={i} className={clase}>
          {linea}
          {'\n'}
        </span>
      )
    })
}
