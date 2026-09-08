import { useEffect, useState } from 'react'
import { createRelay, type RemoteHost } from '@/lib/relay'
import { getSupabase } from '@/lib/supabase'
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

/**
 * Cuanto tiempo sin noticias hace que un equipo "en linea" ya no se cree.
 *
 * El escritorio apaga la bandera al cerrarse bien, pero un cierre a la brava
 * -se acaba la bateria, lo mata el sistema- nunca llega a avisar. Sin este
 * limite, ese equipo se veria "conectado" para siempre.
 */
const SE_CREE_VIVO_MS = 2 * 60 * 1000

function estaRealmenteEnLinea(host: RemoteHost): boolean {
  return host.online && Date.now() - new Date(host.last_seen).getTime() < SE_CREE_VIVO_MS
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
 */
export function Hosts({ onAbrir }: { onAbrir: (destino: ChatTarget) => void }) {
  const [hosts, setHosts] = useState<RemoteHost[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let soltar: (() => void) | null = null
    let vivo = true

    void (async () => {
      try {
        const relay = createRelay(await getSupabase())
        const lista = await relay.listHosts()
        if (!vivo) return
        setHosts(lista)
        soltar = relay.onHostChange((host) => {
          setHosts((previa) => [host, ...(previa ?? []).filter((h) => h.id !== host.id)])
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
                <p className="group">{proyecto.name}</p>
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
                    <span className={`dot dot--${agente.actividad}`} aria-hidden="true" />
                    <span className="row__text">
                      <span className="row__title">{agente.cliName}</span>
                      <span className="row__hint">{COMO_VA[agente.actividad] ?? 'listo'}</span>
                    </span>
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
