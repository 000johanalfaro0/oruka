import { useEffect, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import './update-notice.css'

/**
 * «Hay una version nueva».
 *
 * La app pregunta al arrancar si existe algo mas reciente. Si lo hay, aparece
 * un aviso discreto abajo a la derecha; si no, no se pinta nada y el usuario ni
 * se entera de que se ha mirado.
 *
 * Tres decisiones que importan:
 *
 * 1. **No se actualiza sola.** Descargar y reiniciar en medio de tu trabajo,
 *    con agentes vivos en sus terminales, seria matarlos sin avisar. Se
 *    propone y decide el usuario.
 * 2. **Un fallo no se ve.** Si no hay red, o GitHub no responde, no pasa nada:
 *    el aviso simplemente no aparece. Molestar con un error por no haber podido
 *    comprobar algo que el usuario no ha pedido seria ruido.
 * 3. **Se puede posponer.** Cerrar el aviso lo calla hasta el proximo arranque.
 */
export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [estado, setEstado] = useState<'ofrecida' | 'bajando' | 'lista' | 'error'>('ofrecida')
  const [detalle, setDetalle] = useState<string>('')
  const [oculto, setOculto] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const hay = await check()
        if (hay) setUpdate(hay)
      } catch {
        // En silencio a proposito: ver el punto 2 de arriba.
      }
    })()
  }, [])

  if (!update || oculto) return null

  const instalar = async () => {
    setEstado('bajando')
    try {
      let total = 0
      let hechos = 0
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0
        if (ev.event === 'Progress') {
          hechos += ev.data.chunkLength
          setDetalle(total ? `${Math.round((hechos / total) * 100)}%` : '')
        }
        if (ev.event === 'Finished') setDetalle('')
      })
      setEstado('lista')
    } catch (e) {
      setEstado('error')
      setDetalle(String(e).slice(-160))
    }
  }

  return (
    <div className="upd" role="status">
      <div className="upd__body">
        <strong className="upd__title">
          {estado === 'lista' ? 'Actualización lista' : `Oruka ${update.version} disponible`}
        </strong>
        <span className="upd__hint">
          {estado === 'ofrecida' && `Tienes la ${update.currentVersion}.`}
          {estado === 'bajando' && `Descargando… ${detalle}`}
          {estado === 'lista' && 'Se aplica al reiniciar. Tus agentes se cerrarán.'}
          {estado === 'error' && detalle}
        </span>
      </div>
      <div className="upd__acts">
        {estado === 'ofrecida' && (
          <>
            <button className="upd__later" onClick={() => setOculto(true)}>
              Ahora no
            </button>
            <button className="upd__go" onClick={() => void instalar()}>
              Actualizar
            </button>
          </>
        )}
        {estado === 'lista' && (
          <button className="upd__go" onClick={() => void relaunch()}>
            Reiniciar
          </button>
        )}
        {estado === 'error' && (
          <button className="upd__later" onClick={() => setOculto(true)}>
            Cerrar
          </button>
        )}
      </div>
    </div>
  )
}
