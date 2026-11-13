import { describe, expect, it } from 'vitest'
import {
  buildShiftReport,
  discountLabel,
  type ReportSection,
  type ShiftReport,
  shiftPlace,
  shiftShareText,
} from '@/lib/pos/cash/report'
import type { Shift, ShiftSnapshot, ShiftSummary } from '@/lib/pos/cash/types'
import {
  pesos,
  sampleClosed,
  sampleLive,
  sampleNightClosed,
  TIME_ZONE,
} from './pos-cashbox-samples'

/** `formatCentsShort` pega el signo al número con un espacio duro: así se escribe lo esperado. */
const nb = (text: string): string => text.replaceAll('$ ', '$ ')

function reportOf(snapshot: ShiftSnapshot, over: Partial<Shift> = {}): ShiftReport {
  const shift = { ...(snapshot.shift as Shift), ...over }
  return buildShiftReport({
    branchName: snapshot.branch.name,
    shift,
    summary: (shift.summary ?? snapshot.live) as ShiftSummary,
    timeZone: TIME_ZONE,
    registersCount: snapshot.registers.length,
  })
}

function section(report: ShiftReport, key: ReportSection['key']): ReportSection {
  const found = report.sections.find((candidate) => candidate.key === key)
  if (!found) throw new Error(`falta la sección ${key}`)
  return found
}

const line = (target: ReportSection, label: string) =>
  target.lines.find((candidate) => candidate.label === label)

describe('el turno resumido', () => {
  it('el titular es el del dueño: dónde, cuánto, cuántos y por persona', () => {
    const report = reportOf(sampleNightClosed())
    expect(report.headline).toBe(nb('Cerro, noche: $ 890.200 · 41 personas · $ 21.712 por persona'))
    expect(report.hero).toEqual({
      cents: pesos(890_200),
      sentence: nb('Es lo que consumieron 41 personas en 10 mesas: $ 21.712 por persona.'),
    })
    expect(report.meta).toBe('Viernes 13/11 · de 20:14 a 02:10 · abrió Caro, cerró Caro')
    expect(report.closed).toBe(true)
  })

  it('sin mesas cerradas, el titular es lo que entró', () => {
    const snapshot = sampleLive()
    const summary: ShiftSummary = {
      ...(snapshot.live as ShiftSummary),
      tables: 0,
      people: 0,
      consumption_cents: 0,
      per_person_cents: null,
    }
    const report = buildShiftReport({
      branchName: 'Cerro',
      shift: snapshot.shift as Shift,
      summary,
      timeZone: TIME_ZONE,
    })
    expect(report.headline).toBe(nb('Cerro, noche: $ 837.500 en 11 cobros'))
    expect(report.hero.sentence).toBe('Es lo que entró en 11 cobros.')
    expect(report.sections.some((candidate) => candidate.key === 'tables')).toBe(true)
  })

  it('un turno abierto dice desde cuándo y todavía no tiene arqueo', () => {
    const report = reportOf(sampleLive())
    expect(report.closed).toBe(false)
    expect(report.difference).toBeNull()
    expect(report.meta).toBe('Viernes 13/11 · abierto desde las 20:14 · abrió Caro')
    const drawer = section(report, 'drawer')
    expect(line(drawer, 'Tiene que haber')?.value).toBe(nb('$ 165.000'))
    expect(line(drawer, 'Se contó')).toBeUndefined()
    expect(line(section(report, 'tables'), 'Siguen abiertas')).toMatchObject({
      value: '9 mesas',
      detail: nb('$ 762.700 sin cobrar'),
    })
  })

  it('lo que entró va por medio, con el total y la factura', () => {
    const entered = section(reportOf(sampleNightClosed()), 'in')
    expect(entered.lines.map((candidate) => candidate.label)).toEqual([
      'Efectivo',
      'Transferencia',
      'QR',
      'Débito',
      'Crédito',
      'Total',
      'Con factura',
      'Sin factura',
    ])
    expect(line(entered, 'Efectivo')).toMatchObject({
      value: nb('$ 138.000'),
      detail: '4 cobros',
      inline: true,
    })
    expect(line(entered, 'Débito')?.detail).toBe('1 cobro')
    expect(line(entered, 'Total')).toMatchObject({ value: nb('$ 837.500'), tone: 'strong' })
    expect(line(entered, 'Con factura')?.value).toBe(nb('$ 711.300'))
    expect(line(entered, 'Sin factura')?.value).toBe(nb('$ 114.500'))
    expect(entered.foot).toBe(
      nb('Incluye $ 11.700 de propinas, que van aparte y $ 15.600 de recargo de crédito.'),
    )
  })

  it('con un solo medio no repite el total', () => {
    const closed = sampleClosed()
    const summary = closed.shift?.summary as ShiftSummary
    const onlyCash: ShiftSummary = {
      ...summary,
      by_method: summary.by_method.filter((row) => row.method === 'cash'),
    }
    const report = buildShiftReport({
      branchName: 'Cerro',
      shift: closed.shift as Shift,
      summary: onlyCash,
      timeZone: TIME_ZONE,
    })
    expect(line(section(report, 'in'), 'Total')).toBeUndefined()
  })

  it('el cajón cuenta la historia entera del arqueo', () => {
    const report = reportOf(sampleNightClosed())
    const drawer = section(report, 'drawer')
    expect(drawer.lines.map((candidate) => [candidate.label, candidate.value])).toEqual([
      ['Cambio con el que se abrió', nb('$ 15.000')],
      ['Cobros en efectivo', nb('+ $ 138.000')],
      ['Se sacó: Hielo', nb('− $ 8.000')],
      ['Entró: Cambio', nb('+ $ 20.000')],
      ['Tenía que haber', nb('$ 165.000')],
      ['Se contó', nb('$ 164.000')],
      ['Faltaron', nb('$ 1.000')],
      ['Quedó de cambio', nb('$ 15.000')],
      ['Se retiró', nb('$ 149.000')],
    ])
    expect(line(drawer, 'Faltaron')?.tone).toBe('bad')
    expect(line(drawer, 'Se sacó: Hielo')?.detail).toBe('Caro 21:40')
    expect(report.difference).toMatchObject({ kind: 'short', text: nb('Faltaron $ 1.000') })
  })

  it('si cuadró, lo dice sin monto', () => {
    const report = reportOf(sampleClosed())
    expect(report.difference).toMatchObject({ kind: 'exact', word: 'Cuadró' })
    expect(line(section(report, 'drawer'), 'Cuadró')).toMatchObject({
      value: null,
      detail: 'lo contado coincide',
      tone: 'good',
    })
  })

  it('si sobró, también lo dice', () => {
    const night = sampleNightClosed()
    const report = reportOf(night, {
      counted_cash_cents: pesos(165_500),
      difference_cents: pesos(500),
    })
    expect(line(section(report, 'drawer'), 'Sobraron')).toMatchObject({
      value: nb('$ 500'),
      tone: 'warn',
    })
  })

  it('avisa cuando al abrir había otra cantidad que la que dejó el turno anterior', () => {
    const night = sampleNightClosed()
    const summary: ShiftSummary = {
      ...(night.shift?.summary as ShiftSummary),
      opening_float_cents: pesos(12_000),
      opening_expected_cents: pesos(15_000),
    }
    const report = buildShiftReport({
      branchName: 'Cerro',
      shift: night.shift as Shift,
      summary,
      timeZone: TIME_ZONE,
    })
    expect(line(section(report, 'drawer'), 'Cambio con el que se abrió')).toMatchObject({
      value: nb('$ 12.000'),
      detail: nb('el turno anterior había dejado $ 15.000'),
      tone: 'warn',
    })
  })

  it('dice si un dueño corrigió algo después del cierre', () => {
    const night = sampleNightClosed()
    const shift = night.shift as Shift
    const summary = shift.summary as ShiftSummary
    const report = buildShiftReport({
      branchName: 'Cerro',
      shift,
      summary,
      timeZone: TIME_ZONE,
      liveAfter: { ...summary, expected_cash_cents: pesos(120_000) },
    })
    expect(section(report, 'drawer').foot).toBe(
      nb('Después del cierre se corrigió algún cobro: con eso tenía que haber $ 120.000.'),
    )
    const same = buildShiftReport({
      branchName: 'Cerro',
      shift,
      summary,
      timeZone: TIME_ZONE,
      liveAfter: summary,
    })
    expect(section(same, 'drawer').foot).toBeNull()
  })

  it('«para mirar» trae cada corrección, descuento, baja y anulación con quién fue', () => {
    const watch = section(reportOf(sampleNightClosed()), 'watch')
    expect(watch.foot).toBeNull()
    expect(watch.lines).toEqual([
      {
        label: 'Corrección · mesa 7',
        value: nb('$ 23.500'),
        detail: nb('Crédito → Efectivo · recargo $ 2.350 → $ 0 · Caro 23:12'),
      },
      {
        label: 'Descuento 10 % · mesa 12',
        value: nb('$ 18.300'),
        detail: '«Cumpleaños» · Caro',
      },
      {
        label: nb('Descuento $ 5.000 · mesa 3'),
        value: nb('$ 5.000'),
        detail: '«Demora» · pidió Luz, OK de Caro',
      },
      {
        label: 'Baja · 3 × Clásicas · mesa 5',
        value: nb('$ 33.000'),
        detail: '«Vino frío» · Luz · cocina ya lo había empezado',
        tone: 'warn',
      },
      {
        label: 'Cobro anulado · mesa 14',
        value: nb('$ 52.000'),
        detail: 'Efectivo · «Se cobró dos veces» · Caro',
      },
      {
        label: 'Retiro anulado: Proveedor de pan',
        value: nb('$ 80.000'),
        detail: '«Se anotó por error» · Caro',
      },
    ])
  })

  it('una noche limpia lo dice', () => {
    const watch = section(reportOf(sampleClosed()), 'watch')
    expect(watch.lines).toEqual([])
    expect(watch.foot).toBe('Nada: sin correcciones, descuentos, bajas ni anulaciones.')
  })

  it('las mesas: consumo, por persona, descuentos y la seña que no pasó por la caja', () => {
    const tables = section(reportOf(sampleNightClosed()), 'tables')
    expect(line(tables, 'Consumo de las mesas cerradas')).toMatchObject({
      value: nb('$ 890.200'),
      detail: '10 mesas · 41 personas',
    })
    expect(line(tables, 'Por persona')?.value).toBe(nb('$ 21.712'))
    expect(line(tables, 'Descuentos')?.value).toBe(nb('$ 23.300'))
    expect(line(tables, 'Seña ya cobrada · mesa 12')).toMatchObject({
      value: nb('$ 80.000'),
      detail: 'Cumple de Sofi · no pasó por la caja hoy',
    })
  })

  it('la nota de quien cerró viaja con el resumen', () => {
    expect(reportOf(sampleNightClosed()).note).toBe(
      'Faltó un billete de mil: lo revisamos mañana con la cámara.',
    )
    expect(reportOf(sampleClosed()).note).toBeNull()
  })
})

describe('el resumen como texto', () => {
  it('empieza por el titular y se lee de corrido', () => {
    const text = shiftShareText(reportOf(sampleNightClosed()))
    const lines = text.split('\n')
    expect(lines[0]).toBe(nb('Cerro, noche: $ 890.200 · 41 personas · $ 21.712 por persona'))
    expect(lines[1]).toBe('Viernes 13/11 · de 20:14 a 02:10 · abrió Caro, cerró Caro')
    expect(text).toContain(nb('\nEntró a la caja\n· Efectivo: $ 138.000 (4 cobros)\n'))
    expect(text).toContain(nb('· Faltaron: $ 1.000\n'))
    expect(text).toContain(
      nb(
        '· Corrección · mesa 7: $ 23.500 (Crédito → Efectivo · recargo $ 2.350 → $ 0 · Caro 23:12)',
      ),
    )
    expect(lines.at(-1)).toBe(
      'Nota de quien cerró: «Faltó un billete de mil: lo revisamos mañana con la cámara.»',
    )
  })

  it('no deja renglones con «null» ni «undefined»', () => {
    for (const snapshot of [sampleNightClosed(), sampleClosed(), sampleLive()]) {
      const text = shiftShareText(reportOf(snapshot))
      expect(text).not.toMatch(/null|undefined|NaN/)
    }
  })

  it('para WhatsApp, el titular y los títulos van en negrita', () => {
    const text = shiftShareText(reportOf(sampleClosed()), { bold: true })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^\*Cerro, mediodía: .+\*$/)
    expect(lines).toContain('*El cajón*')
    expect(lines).toContain('· Cuadró (lo contado coincide)')
  })
})

describe('cómo se dicen las cosas', () => {
  it('un descuento se lee como en la mesa', () => {
    expect(discountLabel('percent', 1000)).toBe('10 %')
    expect(discountLabel('percent', 1250)).toBe('12,5 %')
    expect(discountLabel('percent', 10000)).toBe('100 %')
    expect(discountLabel('amount', pesos(5_000))).toBe(nb('$ 5.000'))
  })

  it('el lugar lleva la caja solo si hay más de una', () => {
    expect(shiftPlace('Cerro', { label: 'Noche', register: 'Caja' })).toBe('Cerro, noche')
    expect(shiftPlace('Cerro', { label: 'Noche', register: 'Caja barra' }, 2)).toBe(
      'Cerro, caja barra, noche',
    )
    expect(shiftPlace('Cerro', { label: null, register: 'Caja' })).toBe('Cerro')
    expect(shiftPlace(' Cerro ', { label: '  ', register: 'Caja' })).toBe('Cerro')
  })
})
