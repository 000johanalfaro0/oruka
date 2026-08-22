import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import './update-notice.css'

/**
 * La version, y el aviso de que hay una nueva. En la barra de estado.
 *
 * Estaba flotando en una esquina y se pedia aqui, junto al nombre del modulo:
 * es donde la vista ya va a buscar el estado de la app.
 *
 * Tres decisiones:
 *
 * 1. **Se puede comprobar a mano.** Mirar solo al arrancar hace que un fallo
 *    sea indistinguible de «no hay nada nuevo»: no se puede repetir la prueba
 *    sin cerrar la app. Pulsando la version se comprueba en el momento.
 * 2. **No se actualiza sola.** Descargar y reiniciar con agentes vivos en sus
 *    terminales seria matarlos sin avisar. Se propone y decide la persona.
 * 3. **El fallo se ve, pero solo si lo pediste.** Al arrancar, un error de red
 *    se traga en silencio; si pulsaste tu, se dice lo que paso. Molestar por
 *    algo que nadie pidio es ruido; callar algo que si pediste es peor.
 */
type Estado =
  | { que: 'quieto' }
  | { que: 'mirando' }
  | { que: 'aldia' }
  | { que: 'hay'; update: Update }
  | { que: 'bajando'; pct: string }
  | { que: 'lista' }
  | { que: 'error'; motivo: string }

export function UpdateNotice() {
  const [version, setVersion] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>({ que: 'quieto' })

  useEffect(() => {
    void invoke<string>('app_version')
      .then(setVersion)
      .catch(() => {})
  }, [])

  const mirar = useCallback(async (aMano: boolean) => {
    setEstado({ que: 'mirando' })
    try {
      const hay = await check()
      setEstado(hay ? { que: 'hay', update: hay } : { que: 'aldia' })
    } catch (e) {
      // Al arrancar no se dice nada; si lo pediste tu, si.
      setEstado(aMano ? { que: 'error', motivo: String(e).slice(-120) } : { que: 'quieto' })
    }
  }, [])

  // Una mirada al arrancar. Silenciosa si falla.
  useEffect(() => {
    void mirar(false)
  }, [mirar])

  const instalar = async (update: Update) => {
    setEstado({ que: 'bajando', pct: '' })
    try {
      let total = 0
      let hechos = 0
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0
        if (ev.event === 'Progress') {
          hechos += ev.data.chunkLength
          setEstado({ que: 'bajando', pct: total ? `${Math.round((hechos / total) * 100)}%` : '' })
        }
      })
      setEstado({ que: 'lista' })
    } catch (e) {
      setEstado({ que: 'error', motivo: String(e).slice(-120) })
    }
  }

  return (
    <>
      <button
        className="statusbar__item upd__version"
        onClick={() => void mirar(true)}
        disabled={estado.que === 'mirando' || estado.que === 'bajando'}
        title="Comprobar si hay una versión nueva"
      >
        v{version ?? '—'}
      </button>

      {estado.que === 'mirando' && <span className="statusbar__item upd__nota">comprobando…</span>}

      {estado.que === 'aldia' && <span className="statusbar__item upd__nota">al día</span>}

      {estado.que === 'hay' && (
        <button
          className="statusbar__item upd__hay"
          onClick={() => void instalar(estado.update)}
          title={`Descargar e instalar la ${estado.update.version}`}
        >
          <i className="codicon codicon-arrow-circle-up" aria-hidden="true" />
          {estado.update.version} disponible
        </button>
      )}

      {estado.que === 'bajando' && (
        <span className="statusbar__item upd__nota">descargando… {estado.pct}</span>
      )}

      {estado.que === 'lista' && (
        <button className="statusbar__item upd__hay" onClick={() => void relaunch()}>
          <i className="codicon codicon-debug-restart" aria-hidden="true" />
          Reiniciar para aplicar
        </button>
      )}

      {estado.que === 'error' && (
        <span className="statusbar__item upd__mal" title={estado.motivo}>
          <i className="codicon codicon-warning" aria-hidden="true" />
          no se pudo comprobar
        </span>
      )}
    </>
  )
}
