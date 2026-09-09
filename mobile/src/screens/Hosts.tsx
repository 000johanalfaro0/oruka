import { useEffect, useRef, useState } from 'react'
import { createRelay, type Relay, type RemoteHost } from '@/lib/relay'
import { getSupabase } from '@/lib/supabase'
import { estaRealmenteEnLinea } from '../hostEstado'
import type { ChatTarget } from '../App'

/** «hace 3 min». Un movil no necesita la hora exacta: necesita saber si esto vive. */
function hace(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutos < 1) return 'ahora'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24)} d`
}

const COMO_VA: Record<string, string> = {
  trabajando: 'escribiendo',
  esperando: 'listo',
  terminado: 'detenido',
}

/**
 * Los equipos con Oruka abierta, y dentro de cada uno sus proyectos y agentes.
 *
 * Lo que se ve aqui es una foto que publica el PC, no una consulta a la
 * maquina: si el PC esta apagado, la foto es la ultima que dejo y se dice
 * cuando fue. Inventar que sigue vivo seria peor que decir que no se sabe.
 *
 * Las carpetas que hoy NO estan abiertas viven en su propio modulo (Buscar
 * carpetas): esto es para mirar lo que ya esta pasando, no para revolver
 * una lista de todo lo que existe.
 */
export function Hosts({ onAbrir }: { onAbrir: (destino: ChatTarget) => void }) {
  const [hosts, setHosts] = useState<RemoteHost[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** La ruta que se acaba de pedir cerrar, mientras se confirma. */
  const [pendiente, setPendiente] = useState<string | null>(null)
  const relayRef = useRef<Relay | null>(null)

  useEffect(() => {
    let soltar: (() => void) | null = null
    let vivo = true

    void (async () => {
      try {
        const relay = createRelay(await getSupabase())
        relayRef.current = relay
        const lista = await relay.listHosts()
        if (!vivo) return
        setHosts(lista)
        soltar = relay.onHostChange((host) => {
          setHosts((previa) => [host, ...(previa ?? []).filter((h) => h.id !== host.id)])
          setPendiente(null)
        })
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      vivo = false
      soltar?.()
    }
  }, [])

  /**
   * Pide cerrar una carpeta abierta.
   *
   * No se ejecuta aqui: se deja el pedido para que el PC lo recoja y decida.
   * Es la misma orden que escribirle a un agente, solo que esta la atiende el
   * workspace en vez de una sesion.
   */
  const cerrar = async (host: RemoteHost, path: string) => {
    const relay = relayRef.current
    if (!relay) return
    setPendiente(path)
    setError(null)
    try {
      await relay.sendInput(host.id, 'workspace', path, 'close_project')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPendiente(null)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!hosts) return <p className="empty">Buscando tus equipos…</p>

  if (hosts.length === 0) {
    return (
      <p className="empty">
        No hay ningún equipo conectado.
        <br />
        Abre Oruka en el ordenador y enciende el mando a distancia.
      </p>
    )
  }

  return (
    <>
      {hosts.map((host) => {
        const proyectos = host.state?.projects ?? []
        const enLinea = estaRealmenteEnLinea(host)
        return (
          <section className="card" key={host.id}>
            <div className="card__head">
              <span className={`dot${enLinea ? ' dot--online' : ''}`} aria-hidden="true" />
              <span className="card__name">{host.name}</span>
              <span className="card__meta">
                {enLinea ? 'conectado' : `visto ${hace(host.last_seen)}`}
              </span>
            </div>

            {proyectos.length === 0 && (
              <p className="empty">Sin proyectos abiertos en este equipo.</p>
            )}

            {proyectos.map((proyecto) => (
              <div key={proyecto.path}>
                <div className="group-row">
                  <p className="group">{proyecto.name}</p>
                  <button
                    type="button"
                    className="group__cerrar"
                    disabled={!enLinea || pendiente === proyecto.path}
                    title="Cerrar esta carpeta"
                    onClick={() => void cerrar(host, proyecto.path)}
                  >
                    ✕
                  </button>
                </div>
                {proyecto.agents.length === 0 && (
                  <p className="empty">Sin agentes en este proyecto.</p>
                )}
                {proyecto.agents.map((agente) => (
                  <button
                    type="button"
                    className="row"
                    key={agente.sessionId}
                    onClick={() =>
                      onAbrir({
                        hostId: host.id,
                        sessionId: agente.sessionId,
                        agentName: agente.cliName,
                        projectName: proyecto.name,
                      })
                    }
                  >
                    <span className="row__text">
                      <span className="row__title">{agente.cliName}</span>
                      <span className="row__hint">{COMO_VA[agente.actividad] ?? 'listo'}</span>
                    </span>
                    <span className={`dot dot--${agente.actividad}`} aria-hidden="true" />
                    <span className="row__chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </section>
        )
      })}
    </>
  )
}
