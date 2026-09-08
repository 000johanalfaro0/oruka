import { useEffect, useState } from 'react'
import {
  routerInstall,
  routerOpenPanel,
  routerStart,
  routerStatus,
  routerStop,
  type RouterStatus,
} from '@/lib/router'

/**
 * 9Router: instalar, prender, apagar, abrir su panel.
 *
 * Nada mas. Configurar proveedores pasa por el panel web del propio 9Router,
 * no por aqui -Oruka no reconstruye esa pantalla. Los otros CLIs todavia no
 * hablan a traves de este servicio.
 */
export function RouterSection() {
  const [status, setStatus] = useState<RouterStatus | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [salida, setSalida] = useState<{ texto: string; mal: boolean } | null>(null)
  const [password, setPassword] = useState<string | null>(null)

  const refresh = () => {
    routerStatus()
      .then(setStatus)
      .catch((e) => setSalida({ texto: String(e), mal: true }))
  }

  useEffect(refresh, [])

  const instalar = async () => {
    setConfirmar(false)
    setTrabajando(true)
    setSalida(null)
    try {
      const texto = await routerInstall()
      setSalida({ texto: texto.trim().slice(-400) || '9Router instalado.', mal: false })
      refresh()
    } catch (e) {
      setSalida({ texto: String(e).slice(-400), mal: true })
    } finally {
      setTrabajando(false)
    }
  }

  const encender = async () => {
    setTrabajando(true)
    setSalida(null)
    try {
      const pass = await routerStart()
      setPassword(pass)
      refresh()
    } catch (e) {
      setSalida({ texto: String(e).slice(-400), mal: true })
    } finally {
      setTrabajando(false)
    }
  }

  const apagar = async () => {
    setTrabajando(true)
    try {
      await routerStop()
      refresh()
    } catch (e) {
      setSalida({ texto: String(e).slice(-400), mal: true })
    } finally {
      setTrabajando(false)
    }
  }

  if (!status) return <p className="settings__pending">Comprobando…</p>

  return (
    <div>
      <div className="router-section__estado">
        <i
          className={`codicon codicon-${status.running ? 'pass-filled' : 'circle-large-outline'}`}
          aria-hidden="true"
        />
        <span>
          {!status.installed
            ? 'No instalado'
            : status.running
              ? `Corriendo · puerto ${status.port}`
              : 'Detenido'}
        </span>
      </div>

      {!status.installed && (
        <button className="cli__install" disabled={trabajando} onClick={() => setConfirmar(true)}>
          {trabajando ? 'Instalando…' : 'Instalar'}
        </button>
      )}

      {status.installed && !status.running && (
        <button className="cli__install" disabled={trabajando} onClick={() => void encender()}>
          {trabajando ? 'Arrancando…' : 'Prender'}
        </button>
      )}

      {status.installed && status.running && (
        <div className="router-section__acciones">
          <button className="cli__install" disabled={trabajando} onClick={() => void apagar()}>
            Apagar
          </button>
          <button className="settings__relaunch" onClick={() => void routerOpenPanel()}>
            <i className="codicon codicon-link-external" aria-hidden="true" />
            <span>Abrir panel de 9Router</span>
          </button>
        </div>
      )}

      {password && (
        <p className="settings__hint">
          Contraseña inicial del panel: <code>{password}</code> — solo se enseña una vez, guárdala.
        </p>
      )}

      {confirmar && (
        <div className="setup__confirm">
          <p>Se va a ejecutar en tu equipo, y puede tardar unos minutos:</p>
          <code>npm install -g 9router</code>
          <div className="setup__confirm-acts">
            <button className="setup__cancel" onClick={() => setConfirmar(false)}>
              Cancelar
            </button>
            <button className="setup__go" onClick={() => void instalar()}>
              Ejecutar
            </button>
          </div>
        </div>
      )}

      {salida && (
        <pre className={`setup__salida${salida.mal ? ' is-mal' : ''}`}>{salida.texto}</pre>
      )}
    </div>
  )
}
