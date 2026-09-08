import { useEffect, useState, type MouseEvent } from 'react'
import { bus } from '@/shell/bus'
import { forgetSession, loadSessions, type SessionEntry } from '@/lib/sessions'
import './sessions.css'

/**
 * Panel de Sesiones: trabajo reciente en cualquier proyecto, con un clic para
 * retomarlo.
 *
 * "Retomar" reabre el proyecto y le pide a ese CLI que continue lo ultimo
 * suyo ahi (su propio `resume`, ej. `--continue`). Ninguna CLI guarda un id de
 * conversacion exacto que se pueda pedir de vuelta, asi que esto no garantiza
 * volver a UNA conversacion si hubo varias con el mismo CLI en el mismo
 * proyecto -vuelve a la ultima.
 */
export default function SessionsModule() {
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null)

  const load = () => {
    loadSessions().then(setSessions)
  }

  useEffect(load, [])

  const abrir = (s: SessionEntry) => {
    bus.emit('shell.activateModule', { moduleId: 'workspace' })
    bus.request('workspace.openWithAgent', {
      projectPath: s.projectPath,
      cli: s.cliId,
      resume: true,
    })
  }

  const olvidar = async (e: MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation()
    await forgetSession(id)
    load()
  }

  return (
    <div className="ses">
      <div className="ses__head">
        <h1 className="ses__title">Sesiones</h1>
        <span className="ses__count">{sessions?.length ?? 0}</span>
      </div>

      <ul className="ses__list">
        {sessions?.map((s) => (
          <li key={s.id} className="ses__item">
            <button className="ses__open" onClick={() => abrir(s)}>
              <span className="ses__project">{s.projectName}</span>
              <span className="ses__cli">
                {s.cliName}
                {s.mode ? ` · ${s.mode}` : ''}
              </span>
              {s.lastOutputPreview && (
                <span className="ses__preview">{s.lastOutputPreview}</span>
              )}
              <span className="ses__when">{hace(s.lastActiveAt)}</span>
            </button>
            <button
              className="ses__forget"
              title="Olvidar esta sesión"
              onClick={(e) => void olvidar(e, s.id)}
            >
              <i className="codicon codicon-close" aria-hidden="true" />
            </button>
          </li>
        ))}
        {sessions?.length === 0 && <li className="ses__empty">Aún no hay sesiones recientes.</li>}
      </ul>
    </div>
  )
}

/** "hace 5 min", "hace 3 h", "hace 2 d" - nada mas fino hace falta aqui. */
function hace(timestamp: number): string {
  const ms = Date.now() - timestamp
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} d`
}
