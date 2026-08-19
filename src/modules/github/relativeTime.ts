/**
 * Fechas en lenguaje de persona.
 *
 * GitHub devuelve ISO-8601 en UTC (`2026-08-18T00:56:14Z`). En una lista lo que
 * importa es si algo se movio hoy o hace medio ano, no el minuto exacto.
 */

const MINUTO = 60
const HORA = 60 * MINUTO
const DIA = 24 * HORA
const MES = 30 * DIA
const ANYO = 365 * DIA

export function relativeTime(iso: string, now: Date = new Date()): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const segundos = Math.floor((now.getTime() - then.getTime()) / 1000)
  // Un reloj adelantado no puede producir "hace -3 minutos".
  if (segundos < MINUTO) return 'hace un momento'
  if (segundos < HORA) return `hace ${plural(Math.floor(segundos / MINUTO), 'minuto')}`
  if (segundos < DIA) return `hace ${plural(Math.floor(segundos / HORA), 'hora')}`
  if (segundos < MES) return `hace ${plural(Math.floor(segundos / DIA), 'día')}`
  if (segundos < ANYO) return `hace ${plural(Math.floor(segundos / MES), 'mes', 'meses')}`
  return `hace ${plural(Math.floor(segundos / ANYO), 'año')}`
}

function plural(n: number, singular: string, muchos?: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${muchos ?? `${singular}s`}`
}
