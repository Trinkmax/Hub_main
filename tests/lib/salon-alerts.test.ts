import { describe, expect, it } from 'vitest'
import {
  highestSeverity,
  mergeProfileAlerts,
  parseServiceAlerts,
  personScopedAlerts,
  resolveReservationAlerts,
  sortAlerts,
} from '@/lib/salon/alerts'

describe('parseServiceAlerts', () => {
  it('deja pasar los conocidos', () => {
    expect(parseServiceAlerts(['celiac', 'vegan'])).toEqual(['celiac', 'vegan'])
  })

  it('descarta basura sin explotar (fila vieja, enum nuevo sin deploy del front)', () => {
    expect(parseServiceAlerts(['celiac', 'kosher', 42, null])).toEqual(['celiac'])
  })

  it('tolera null y no-arrays: la columna puede venir vacía', () => {
    expect(parseServiceAlerts(null)).toEqual([])
    expect(parseServiceAlerts(undefined)).toEqual([])
    expect(parseServiceAlerts('celiac')).toEqual([])
  })
})

describe('sortAlerts', () => {
  it('lo que puede hacer daño va primero; dentro de cada grupo, orden del catálogo', () => {
    expect(sortAlerts(['baby_seat', 'vegan', 'celiac'])).toEqual(['celiac', 'vegan', 'baby_seat'])
  })

  it('dos críticos mantienen el orden del catálogo entre sí', () => {
    expect(sortAlerts(['allergy', 'celiac'])).toEqual(['celiac', 'allergy'])
  })
})

describe('resolveReservationAlerts', () => {
  it('une reserva y ficha sin repetir', () => {
    const r = resolveReservationAlerts(['baby_seat'], ['celiac'])
    expect(r.map((x) => x.alert)).toEqual(['celiac', 'baby_seat'])
  })

  it('marca cuáles vienen de la ficha', () => {
    const r = resolveReservationAlerts(['baby_seat'], ['celiac'])
    expect(r.find((x) => x.alert === 'celiac')?.fromProfile).toBe(true)
    expect(r.find((x) => x.alert === 'baby_seat')?.fromProfile).toBe(false)
  })

  it('si está en los dos lados, gana la reserva (no es "de la ficha")', () => {
    const r = resolveReservationAlerts(['celiac'], ['celiac'])
    expect(r).toHaveLength(1)
    expect(r[0]?.fromProfile).toBe(false)
  })

  it('reserva sin cliente linkeado: solo los suyos', () => {
    const r = resolveReservationAlerts(['celiac'], undefined)
    expect(r.map((x) => x.alert)).toEqual(['celiac'])
  })

  it('sin avisos devuelve vacío — el caso normal', () => {
    expect(resolveReservationAlerts([], [])).toEqual([])
  })
})

describe('highestSeverity', () => {
  it('sin avisos no hay tinte: la fila se ve igual que hoy', () => {
    expect(highestSeverity([])).toBeNull()
  })

  it('una celíaca manda sobre el resto', () => {
    expect(highestSeverity([{ alert: 'baby_seat' }, { alert: 'celiac' }])).toBe('critical')
  })

  it('solo logística → info', () => {
    expect(highestSeverity([{ alert: 'baby_seat' }, { alert: 'vegan' }])).toBe('info')
  })
})

describe('personScopedAlerts', () => {
  it('solo lo que es de la persona sube a la ficha', () => {
    expect(personScopedAlerts(['celiac', 'baby_seat', 'vegan'])).toEqual(['celiac', 'vegan'])
  })

  it('la silla del bebé no queda pegada al cliente para siempre', () => {
    expect(personScopedAlerts(['baby_seat'])).toEqual([])
  })
})

describe('mergeProfileAlerts', () => {
  it('suma lo nuevo sin perder lo que ya sabía la ficha', () => {
    expect(mergeProfileAlerts(['celiac'], ['vegan'])).toEqual(['celiac', 'vegan'])
  })

  it('no duplica', () => {
    expect(mergeProfileAlerts(['celiac'], ['celiac'])).toEqual(['celiac'])
  })

  it('nunca sube un aviso de visita a la ficha', () => {
    expect(mergeProfileAlerts([], ['baby_seat'])).toEqual([])
  })

  it('es aditivo a propósito: desmarcar en una reserva no borra la ficha', () => {
    // Sacar "celíaca" de la reserva del viernes no puede dejar sin aviso a las
    // otras 20 reservas de Melina. Para eso se edita la ficha.
    expect(mergeProfileAlerts(['celiac'], [])).toEqual(['celiac'])
  })
})
