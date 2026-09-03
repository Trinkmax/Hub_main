import { describe, expect, it } from 'vitest'
import {
  BUCKET_LABELS,
  currentWeekStart,
  dateBucket,
  formatDayShort,
  isIsoDay,
  shiftWeeks,
  todayIso,
  weekEndOf,
  weekLabel,
  weekStartOf,
  weeksBetween,
} from '@/lib/marketing/week'

// El bar vive en Córdoba (UTC-3). Todo lo que sigue se calcula en ESE
// calendario aunque el server corra en UTC — que es lo que rompe los bordes.
describe('semana del checklist', () => {
  it('la semana arranca el lunes', () => {
    // 2026-09-03 es jueves → el lunes es el 31/08.
    expect(weekStartOf('2026-09-03')).toBe('2026-08-31')
    // Un lunes se devuelve a sí mismo.
    expect(weekStartOf('2026-08-31')).toBe('2026-08-31')
    // El domingo pertenece a la semana que ARRANCÓ el lunes anterior, no a la
    // siguiente: si no, el finde queda partido en dos.
    expect(weekStartOf('2026-09-06')).toBe('2026-08-31')
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07')
  })

  it('el domingo cierra la semana', () => {
    expect(weekEndOf('2026-08-31')).toBe('2026-09-06')
  })

  it('corre semanas para adelante y para atrás, incluso cruzando el mes', () => {
    expect(shiftWeeks('2026-08-31', 1)).toBe('2026-09-07')
    expect(shiftWeeks('2026-08-31', -1)).toBe('2026-08-24')
    expect(shiftWeeks('2026-08-31', 5)).toBe('2026-10-05')
  })

  it('cruza el cambio de año sin perder el lunes', () => {
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28')
    expect(shiftWeeks('2026-12-28', 1)).toBe('2027-01-04')
  })

  it('cuenta las semanas entre dos lunes', () => {
    expect(weeksBetween('2026-08-31', '2026-09-07')).toBe(1)
    expect(weeksBetween('2026-08-31', '2026-08-24')).toBe(-1)
    expect(weeksBetween('2026-08-31', '2026-08-31')).toBe(0)
  })

  it('etiqueta la semana en relación a hoy', () => {
    // Jueves 03/09/2026 a las 15 h de Córdoba.
    const now = new Date('2026-09-03T18:00:00.000Z')
    expect(weekLabel('2026-08-31', now)).toBe('Esta semana')
    expect(weekLabel('2026-09-07', now)).toBe('Próxima semana')
    expect(weekLabel('2026-08-24', now)).toBe('Semana anterior')
    expect(weekLabel('2026-09-14', now)).toBe('En 2 semanas')
    expect(weekLabel('2026-08-17', now)).toBe('Hace 2 semanas')
  })

  it('resuelve hoy y la semana en el reloj del bar, no en UTC', () => {
    // 02:30 UTC del 4 de septiembre = 23:30 del 3 en Córdoba: para el bar
    // TODAVÍA es el jueves 3 (la noche no terminó).
    const lateNight = new Date('2026-09-04T02:30:00.000Z')
    expect(todayIso(lateNight)).toBe('2026-09-03')
    expect(currentWeekStart(lateNight)).toBe('2026-08-31')
  })
})

describe('isIsoDay', () => {
  it('acepta sólo fechas reales en formato yyyy-MM-dd', () => {
    expect(isIsoDay('2026-09-03')).toBe(true)
    expect(isIsoDay('2026-2-3')).toBe(false)
    expect(isIsoDay('2026-13-01')).toBe(false)
    expect(isIsoDay('2026-02-30')).toBe(false)
    expect(isIsoDay('')).toBe(false)
    expect(isIsoDay(null)).toBe(false)
    expect(isIsoDay(20260903)).toBe(false)
  })
})

describe('dateBucket', () => {
  const today = '2026-09-03'

  it('sin fecha, la tarea es un pendiente sin compromiso → al fondo', () => {
    expect(dateBucket(null, today)).toBe('later')
  })

  it('lo vencido se separa para que no se pierda', () => {
    expect(dateBucket('2026-09-02', today)).toBe('past')
    expect(dateBucket('2026-01-01', today)).toBe('past')
  })

  it('hoy es su propio cajón', () => {
    expect(dateBucket(today, today)).toBe('today')
  })

  it('la ventana es móvil (7 y 14 días), no el calendario', () => {
    expect(dateBucket('2026-09-04', today)).toBe('this_week')
    // Día 6 desde hoy: último de "esta semana".
    expect(dateBucket('2026-09-09', today)).toBe('this_week')
    // Día 7: ya es "la próxima".
    expect(dateBucket('2026-09-10', today)).toBe('next_week')
    expect(dateBucket('2026-09-16', today)).toBe('next_week')
    expect(dateBucket('2026-09-17', today)).toBe('later')
  })

  it('cada cajón tiene su etiqueta en español', () => {
    expect(BUCKET_LABELS[dateBucket(null, today)]).toBe('Más adelante')
    expect(BUCKET_LABELS[dateBucket('2026-09-02', today)]).toBe('Fechas pasadas')
    expect(BUCKET_LABELS[dateBucket(today, today)]).toBe('Hoy')
  })
})

describe('formatDayShort', () => {
  it('muestra día y mes abreviado, igual en el server y en el browser', () => {
    // Sin Intl a propósito: el ICU de Node dice "03-sept" y el del browser
    // "3 sept" → mismatch de hidratación. Ver el comentario en week.ts.
    expect(formatDayShort('2026-09-03')).toBe('03 sep')
    expect(formatDayShort('2026-01-31')).toBe('31 ene')
    expect(formatDayShort('2026-12-01')).toBe('01 dic')
  })

  it('sin fecha lo dice explícito en vez de mostrar un hueco', () => {
    expect(formatDayShort(null)).toBe('Sin fecha')
  })
})
