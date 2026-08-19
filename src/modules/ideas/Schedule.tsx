import { useEffect, useMemo, useState } from 'react'
import * as repo from './repository'
import { STATUS_LABEL, type Project } from './types'
import { DAY_NAMES, isSameDay, parseDay, toKey, weekLabel, weekOf, weeksBetween } from './week'

/**
 * Horario: el "cuando" del modulo, con forma de horario de facultad.
 *
 * Se ve **una semana entera y solo una**, de lunes a domingo, con el dia de hoy
 * marcado. Un calendario de mes obliga a buscar; una semana cabe de un vistazo
 * y es la unidad en la que se piensa al planificar.
 *
 * Nota sobre el dato: `scheduled_date` es una fecha **sin hora**, asi que las
 * columnas son dias y no hay franjas horarias. Ponerlas exigiria una columna
 * nueva en la base, que es compartida con Idearia.
 */
export function Schedule({ onOpen }: { onOpen: (project: Project) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Cuantas semanas nos hemos movido desde la actual. 0 es esta. */
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    repo
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(String(e)))
  }, [])

  const hoy = useMemo(() => new Date(), [])
  const days = useMemo(() => {
    const base = new Date(hoy)
    base.setDate(base.getDate() + offset * 7)
    return weekOf(base)
  }, [hoy, offset])

  /** Pinta el cambio ya y avisa si hay que deshacerlo. */
  const pintar = (id: string, date: string | null) =>
    setProjects((prev) =>
      prev ? prev.map((p) => (p.id === id ? { ...p, scheduled_date: date } : p)) : prev,
    )

  /**
   * Pone (o quita) la fecha de un proyecto, respetando que **un dia solo admite
   * un proyecto**.
   *
   * La base lo impone con un indice unico parcial sobre `(user_id,
   * scheduled_date)`. Por eso soltar sobre un dia ocupado no puede escribir sin
   * mas: hay que sacar antes al que estaba, o Postgres rechaza la escritura.
   *
   * Si los dos tenian fecha se intercambian; si el que llega venia de la
   * bandeja, el que estaba vuelve a la bandeja. En ambos casos el que sale se
   * aparca primero en `null`, porque el paso intermedio tambien tiene que
   * cumplir la regla.
   */
  const colocar = async (project: Project, date: string | null) => {
    if (!projects) return
    const origen = project.scheduled_date
    if (origen === date) return

    const ocupante =
      date === null ? undefined : projects.find((p) => p.scheduled_date === date && p.id !== project.id)

    // Optimista: arrastrar y ver la tarjeta volver medio segundo se siente roto
    // aunque el guardado acabe bien.
    if (ocupante) pintar(ocupante.id, origen)
    pintar(project.id, date)
    setError(null)

    try {
      if (ocupante) await repo.setScheduledDate(ocupante.id, null)
      await repo.setScheduledDate(project.id, date)
      if (ocupante && origen) await repo.setScheduledDate(ocupante.id, origen)
    } catch (e) {
      setError(String(e))
      // Devolver la pantalla a la verdad, que es lo que diga la base.
      repo.listProjects().then(setProjects).catch(() => {})
    }
  }

  if (!projects) return <p className="ideas__pending">Cargando…</p>

  const undated = projects.filter((p) => !p.scheduled_date)
  const dated = projects.filter((p) => p.scheduled_date)

  const semana = new Map<string, Project[]>()
  for (const d of days) semana.set(toKey(d), [])
  let fuera = 0
  for (const p of dated) {
    const celda = semana.get(p.scheduled_date as string)
    if (celda) celda.push(p)
    else fuera++
  }

  /** Salta a la semana del proyecto con fecha mas cercana que no se ve. */
  const irAlMasCercano = () => {
    const candidatos = dated
      .map((p) => parseDay(p.scheduled_date as string))
      .filter((d) => !days.some((x) => isSameDay(x, d)))
      .sort((a, b) => Math.abs(+a - +hoy) - Math.abs(+b - +hoy))
    if (candidatos[0]) setOffset(weeksBetween(hoy, candidatos[0]))
  }

  const soltarEn = (key: string) => {
    const p = projects.find((x) => x.id === dragging)
    setDragging(null)
    setOver(null)
    if (p && p.scheduled_date !== key) void colocar(p, key)
  }

  return (
    <div className="isc">
      <section className="isc__week">
        <header className="isc__bar">
          <div className="isc__nav">
            <button
              className="isc__step"
              onClick={() => setOffset((o) => o - 1)}
              aria-label="Semana anterior"
            >
              <i className="codicon codicon-chevron-left" aria-hidden="true" />
            </button>
            <button
              className="isc__step"
              onClick={() => setOffset((o) => o + 1)}
              aria-label="Semana siguiente"
            >
              <i className="codicon codicon-chevron-right" aria-hidden="true" />
            </button>
          </div>
          <h2 className="isc__range">{weekLabel(days)}</h2>
          {offset !== 0 && (
            <button className="isc__today" onClick={() => setOffset(0)}>
              Volver a esta semana
            </button>
          )}
          {offset === 0 && fuera > 0 && (
            <button className="isc__today" onClick={irAlMasCercano}>
              {fuera} fuera de esta semana
            </button>
          )}
        </header>

        {/* El aviso va aqui y no en lugar del horario: perder la pantalla
            entera por una escritura fallida deja sin saber que hacer. */}
        {error && (
          <p className="ideas__error isc__alert">
            {error}
            <button className="isc__today" onClick={() => setError(null)}>
              Entendido
            </button>
          </p>
        )}

        <div className="isc__grid">
          {days.map((day, i) => {
            const key = toKey(day)
            const esHoy = isSameDay(day, hoy)
            const lista = semana.get(key) ?? []
            return (
              <div
                key={key}
                className={`isc__col${esHoy ? ' is-today' : ''}${over === key ? ' is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(key)
                }}
                onDragLeave={() => setOver((o) => (o === key ? null : o))}
                onDrop={() => soltarEn(key)}
              >
                <div className="isc__colhead">
                  <span className="isc__dayname">{DAY_NAMES[i]}</span>
                  <span className="isc__daynum">{day.getDate()}</span>
                </div>

                <div className="isc__cell">
                  {lista.map((p) => (
                    <article
                      key={p.id}
                      className="isc__card"
                      draggable
                      onDragStart={() => setDragging(p.id)}
                      onDragEnd={() => setDragging(null)}
                    >
                      <button className="isc__name" onClick={() => onOpen(p)} title={p.title}>
                        {p.title}
                      </button>
                      <footer className="isc__cardfoot">
                        <span className={`chip chip--${p.status}`}>{STATUS_LABEL[p.status]}</span>
                        <button
                          className="isc__clear"
                          title="Quitar del horario"
                          aria-label={`Quitar ${p.title} del horario`}
                          onClick={() => void colocar(p, null)}
                        >
                          <i className="codicon codicon-close" aria-hidden="true" />
                        </button>
                      </footer>
                    </article>
                  ))}
                  {/* Cada dia admite un solo proyecto: la base lo impone con un
                      indice unico. Decirlo aqui evita el intento y el error. */}
                  {lista.length === 0 && <span className="isc__free">libre</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <aside
        className={`isc__tray${over === 'tray' ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver('tray')
        }}
        onDragLeave={() => setOver((o) => (o === 'tray' ? null : o))}
        onDrop={() => {
          const p = projects.find((x) => x.id === dragging)
          setDragging(null)
          setOver(null)
          if (p?.scheduled_date) void colocar(p, null)
        }}
      >
        <h2 className="isc__title">
          Sin fecha <span className="ipl__count">{undated.length}</span>
        </h2>
        <p className="isc__hint">
          Arrastra a un día para ponerlo en el horario. Cada día admite un solo
          proyecto: si el día ya tiene uno, se intercambian.
        </p>
        <ul>
          {undated.map((p) => (
            <li key={p.id}>
              <article
                className="isc__card"
                draggable
                onDragStart={() => setDragging(p.id)}
                onDragEnd={() => setDragging(null)}
              >
                <button className="isc__name" onClick={() => onOpen(p)} title={p.title}>
                  {p.title}
                </button>
                <footer className="isc__cardfoot">
                  <span className={`chip chip--${p.status}`}>{STATUS_LABEL[p.status]}</span>
                  {/* El arrastre es lo natural aqui, pero no vale con teclado ni
                      en una pantalla tactil: el selector de fecha es el camino
                      que siempre funciona. */}
                  <input
                    type="date"
                    value=""
                    aria-label={`Fecha para ${p.title}`}
                    onChange={(e) => void colocar(p, e.target.value || null)}
                  />
                </footer>
              </article>
            </li>
          ))}
          {undated.length === 0 && <li className="ideas__pending">Todos tienen fecha.</li>}
        </ul>
      </aside>
    </div>
  )
}
