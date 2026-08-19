/**
 * Semanas y dias para el horario.
 *
 * Todo esto existe por una trampa concreta: `scheduled_date` es una fecha sin
 * hora (`2026-08-19`), y `new Date('2026-08-19')` la interpreta como medianoche
 * **UTC**. En un huso negativo —el de aqui es -05:00— eso cae en el dia
 * anterior, asi que un proyecto del miercoles se pintaria el martes. Por eso se
 * parte la cadena a mano y se construye la fecha con componentes locales, y por
 * eso al guardar tampoco se usa `toISOString()`, que vuelve a pasar por UTC.
 */

/** Lunes primero, que es como se lee un horario aqui. */
export const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** `2026-08-19` a fecha local, sin que se escape un dia por el huso. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** De fecha a `2026-08-19`, con los componentes locales. */
export function toKey(date: Date): string {
  const mes = String(date.getMonth() + 1).padStart(2, '0')
  const dia = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mes}-${dia}`
}

export function addDays(date: Date, days: number): Date {
  const copia = new Date(date)
  copia.setDate(copia.getDate() + days)
  return copia
}

/** El lunes de la semana a la que pertenece esa fecha. */
export function startOfWeek(date: Date): Date {
  const copia = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay() da 0 el domingo; con la semana empezando en lunes, el domingo es
  // el septimo dia y hay que retroceder seis, no adelantar uno.
  const desplazamiento = (copia.getDay() + 6) % 7
  return addDays(copia, -desplazamiento)
}

/** Los siete dias de la semana de esa fecha, de lunes a domingo. */
export function weekOf(date: Date): Date[] {
  const lunes = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => addDays(lunes, i))
}

export function isSameDay(a: Date, b: Date): boolean {
  return toKey(a) === toKey(b)
}

/**
 * El rango de la semana, dicho corto.
 *
 * El mes se repite solo cuando la semana cambia de mes, y el ano solo cuando
 * cambia de ano: «18 – 24 de agosto de 2026» se lee mejor que repetirlo todo, y
 * en las semanas que cruzan si hace falta decirlo.
 */
export function weekLabel(days: Date[]): string {
  const desde = days[0]
  const hasta = days[days.length - 1]
  // Siempre llega la semana entera; si algun dia no, mejor un texto vacio que
  // una fecha inventada.
  if (!desde || !hasta) return ''
  const mes = (d: Date) => d.toLocaleDateString('es', { month: 'long' })

  if (desde.getFullYear() !== hasta.getFullYear()) {
    return `${desde.getDate()} de ${mes(desde)} de ${desde.getFullYear()} – ${hasta.getDate()} de ${mes(hasta)} de ${hasta.getFullYear()}`
  }
  if (desde.getMonth() !== hasta.getMonth()) {
    return `${desde.getDate()} de ${mes(desde)} – ${hasta.getDate()} de ${mes(hasta)} de ${hasta.getFullYear()}`
  }
  return `${desde.getDate()} – ${hasta.getDate()} de ${mes(desde)} de ${desde.getFullYear()}`
}

/** Cuantas semanas hay entre dos fechas. Negativo si la segunda es anterior. */
export function weeksBetween(from: Date, to: Date): number {
  const a = startOfWeek(from).getTime()
  const b = startOfWeek(to).getTime()
  return Math.round((b - a) / (7 * 24 * 60 * 60 * 1000))
}
