import { useEffect, useRef, useState } from 'react'
import { createRelay, type Relay, type RemoteHost } from '@/lib/relay'
import { getSupabase } from '@/lib/supabase'
import { estaRealmenteEnLinea } from '../hostEstado'

/** Una carpeta cerrada, con el equipo al que pertenece -por si dos equipos tienen una con el mismo nombre. */
interface Resultado {
  host: RemoteHost
  path: string
  name: string
}

/**
 * Buscar y abrir una carpeta que hoy NO esta abierta en ningun equipo.
 *
 * Modulo aparte, no una lista escondida dentro de Agentes: esto es una
 * herramienta -encontrar algo puntual entre todo lo que hay- no una vista de
 * lo que esta pasando ahora mismo. Por eso no vuelca nada hasta que se
 * escribe: cruza las carpetas cerradas de todos los equipos a la vez.
 */
export function BuscarCarpetas() {
  const [hosts, setHosts] = useState<RemoteHost[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
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

  const abrir = async (resultado: Resultado) => {
    const relay = relayRef.current
    if (!relay) return
    setPendiente(resultado.path)
    setError(null)
    try {
      await relay.sendInput(resultado.host.id, 'workspace', resultado.path, 'open_project')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPendiente(null)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!hosts) return <p className="empty">Buscando tus equipos…</p>

  const total = hosts.reduce((n, h) => n + (h.state?.closedProjects?.length ?? 0), 0)
  const termino = busqueda.trim().toLowerCase()
  const resultados: Resultado[] = termino
    ? hosts.flatMap((host) =>
        (host.state?.closedProjects ?? [])
          .filter((c) => c.name.toLowerCase().includes(termino))
          .map((c) => ({ host, path: c.path, name: c.name })),
      )
    : []

  return (
    <>
      <input
        type="search"
        className="cerradas__buscar buscar__campo"
        placeholder="Escribe el nombre de una carpeta…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        autoFocus
      />

      {total === 0 && (
        <p className="empty">
          No hay carpetas cerradas para buscar.
          <br />
          Todo lo que Oruka conoce ya esta abierto.
        </p>
      )}

      {total > 0 && !termino && (
        <p className="empty">
          {total} carpeta{total === 1 ? '' : 's'} para buscar, entre todos tus equipos.
        </p>
      )}

      {termino && resultados.length === 0 && (
        <p className="empty">Ninguna carpeta coincide con «{busqueda}».</p>
      )}

      {resultados.map((r) => {
        const enLinea = estaRealmenteEnLinea(r.host)
        return (
          <button
            type="button"
            className="row"
            key={`${r.host.id}:${r.path}`}
            disabled={!enLinea || pendiente === r.path}
            onClick={() => void abrir(r)}
          >
            <span className="row__text">
              <span className="row__title">{r.name}</span>
              <span className="row__hint">{r.host.name}</span>
            </span>
            <span className="row__hint">{pendiente === r.path ? 'abriendo…' : 'abrir'}</span>
          </button>
        )
      })}
    </>
  )
}
