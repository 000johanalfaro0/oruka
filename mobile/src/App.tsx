import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { Login } from './screens/Login'
import { Pair } from './screens/Pair'
import { Hosts } from './screens/Hosts'
import { Chat } from './screens/Chat'
import { Ideas } from './screens/Ideas'
import { APK_URL, useUpdateCheck } from './updateCheck'

/** El agente que se esta mirando, con lo justo para pintar la cabecera. */
export interface ChatTarget {
  hostId: string
  sessionId: string
  agentName: string
  projectName: string
}

/**
 * La app del telefono.
 *
 * Dos sitios y nada mas: los agentes y las ideas. Un movil no es un escritorio
 * y meterle las cuatro ventanas de Oruka seria pelear con la pantalla; lo que
 * se hace desde el sofa es mirar como va un agente y contestarle.
 */
export function App() {
  const [estado, setEstado] = useState<'comprobando' | 'fuera' | 'dentro'>('comprobando')
  /**
   * Como se entra. El QR va primero porque es lo que se pide desde el sofa;
   * el correo se queda como salida de emergencia si la camara no coopera.
   */
  const [puerta, setPuerta] = useState<'qr' | 'correo'>('qr')
  const [pestana, setPestana] = useState<'agentes' | 'ideas'>('agentes')
  const [chat, setChat] = useState<ChatTarget | null>(null)
  const { versionNueva } = useUpdateCheck()

  useEffect(() => {
    void (async () => {
      try {
        const supabase = await getSupabase()
        const { data } = await supabase.auth.getSession()
        setEstado(data.session ? 'dentro' : 'fuera')
      } catch {
        // Sin credenciales o sin red: se pide entrar, que ya lo explica.
        setEstado('fuera')
      }
    })()
  }, [])

  if (estado === 'comprobando') return <div className="splash">Abriendo Oruka…</div>
  if (estado === 'fuera') {
    return puerta === 'qr' ? (
      <Pair onEntrar={() => setEstado('dentro')} onUsarCorreo={() => setPuerta('correo')} />
    ) : (
      <Login onEntrar={() => setEstado('dentro')} onUsarQr={() => setPuerta('qr')} />
    )
  }

  // El chat ocupa la pantalla entera: el teclado ya se come la mitad.
  if (chat) return <Chat target={chat} onVolver={() => setChat(null)} />

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__title">{pestana === 'agentes' ? 'Agentes' : 'Ideas'}</span>
      </header>

      {versionNueva && (
        <a className="update-banner" href={APK_URL}>
          Hay una versión nueva ({versionNueva}) · toca para bajarla
        </a>
      )}

      <main className="body">
        {pestana === 'agentes' ? <Hosts onAbrir={setChat} /> : <Ideas />}
      </main>

      <nav className="tabs">
        <button
          type="button"
          className={`tab${pestana === 'agentes' ? ' tab--on' : ''}`}
          onClick={() => setPestana('agentes')}
        >
          Agentes
        </button>
        <button
          type="button"
          className={`tab${pestana === 'ideas' ? ' tab--on' : ''}`}
          onClick={() => setPestana('ideas')}
        >
          Ideas
        </button>
      </nav>
    </div>
  )
}
