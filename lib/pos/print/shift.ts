/**
 * El cierre de caja, en papel — PURO.
 *
 * La planilla que se imprime en la comandera al cerrar el turno, para verificar con el cajón adelante
 * y dejarla firmada. Sale del mismo resumen que muestra la pantalla (`buildShiftReport`): dice lo
 * mismo que se copia o se manda por WhatsApp, y abajo deja lugar para firmar.
 *
 * El formato definitivo lo van a pasar los dueños (16/11): cuando llegue, se cambia acá y solo acá.
 */
import type { ShiftReport } from '@/lib/pos/cash/report'
import { type PrintDoc, type PrintLine, p, ticketDateTime, ticketMoney } from './doc'

export type ShiftPrintContext = {
  barName: string
  timeZone: string
  /** Cuándo se imprime. */
  printedAt: string | number | Date
  /** Quién la imprime. */
  printedBy?: string | null
}

export function shiftDoc(report: ShiftReport, context: ShiftPrintContext): PrintDoc {
  const lines: PrintLine[] = []
  lines.push(p.center(context.barName, { size: 'lg', bold: true, upper: true }))
  lines.push(
    p.center(report.closed ? 'Cierre de caja' : 'Caja · turno abierto', {
      size: 'xl',
      upper: true,
    }),
  )
  lines.push(p.center(report.meta, { size: 'sm' }))
  lines.push(p.rule('double'))

  lines.push(p.center(ticketMoney(report.hero.cents), { size: 'xl' }))
  lines.push(p.center(report.hero.sentence, { size: 'sm' }))
  if (report.difference) {
    lines.push(p.space())
    // Si el arqueo no cuadra, va en negativo: es lo primero que tiene que ver quien controla.
    lines.push(
      report.difference.kind === 'exact'
        ? p.center(`Arqueo: ${report.difference.text}`, { bold: true, upper: true })
        : p.banner(`Arqueo: ${report.difference.text}`),
    )
  }

  for (const section of report.sections) {
    lines.push(p.rule('solid'))
    lines.push(p.text(section.title, { bold: true, upper: true }))
    for (const line of section.lines) {
      const strong = line.tone === 'strong' || line.tone === 'bad'
      if (line.value) lines.push(p.row(line.label, line.value, { bold: strong, dots: true }))
      else lines.push(p.text(line.label, { bold: strong }))
      if (line.detail) lines.push(p.text(line.detail, { size: 'sm', indent: true }))
    }
    if (section.foot) lines.push(p.text(section.foot, { size: 'sm' }))
  }

  if (report.note) {
    lines.push(p.rule('solid'))
    lines.push(p.text('Nota de quien cerró', { bold: true, upper: true, size: 'sm' }))
    lines.push(p.text(`«${report.note}»`))
  }

  lines.push(p.rule('double'))
  lines.push(p.blank('Contó'))
  lines.push(p.blank('Controló'))
  lines.push(p.space())
  const stamp = [
    `Impreso ${ticketDateTime(context.printedAt, context.timeZone)}`,
    context.printedBy ? `por ${context.printedBy}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  lines.push(p.center(stamp, { size: 'sm' }))
  return { title: report.closed ? 'Cierre de caja' : 'Caja', lines }
}

/**
 * El comprobante de un cierre a ciegas: lo que firma quien cerró sin ver los números del turno.
 * Dice lo único que esa persona sabe (cuánto contó, cuánto dejó de cambio y cuánto retira) y deja
 * lugar para las firmas. El resumen del turno no va en este papel: les llega a los socios.
 */
export function closeSlipDoc(
  input: {
    /** «Cerro, noche». */
    place: string
    /** «Jueves 12/11». */
    day: string
    closedBy: string | null
    closedAt: string | null
    countedCents: number
    leaveFloatCents: number
    note?: string | null
  },
  context: ShiftPrintContext,
): PrintDoc {
  const lines: PrintLine[] = []
  lines.push(p.center(context.barName, { size: 'lg', bold: true, upper: true }))
  lines.push(p.center('Cierre de caja', { size: 'xl', upper: true }))
  lines.push(p.center(input.place, { bold: true, upper: true }))
  lines.push(
    p.center(
      [
        input.day,
        input.closedAt ? `cerrado ${ticketDateTime(input.closedAt, context.timeZone)}` : null,
        input.closedBy ? `por ${input.closedBy}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      { size: 'sm' },
    ),
  )
  lines.push(p.rule('double'))
  lines.push(p.row('Se contó', ticketMoney(input.countedCents), { bold: true, dots: true }))
  lines.push(p.row('Queda de cambio', ticketMoney(input.leaveFloatCents), { dots: true }))
  lines.push(
    p.row('Se retira', ticketMoney(Math.max(0, input.countedCents - input.leaveFloatCents)), {
      bold: true,
      dots: true,
    }),
  )
  if (input.note?.trim()) {
    lines.push(p.rule('solid'))
    lines.push(p.text('Nota', { bold: true, upper: true, size: 'sm' }))
    lines.push(p.text(`«${input.note.trim()}»`))
  }
  lines.push(p.rule('double'))
  lines.push(p.blank('Contó'))
  lines.push(p.blank('Recibió'))
  lines.push(p.space())
  lines.push(
    p.center('El resumen del turno lo reciben los socios.', { size: 'sm' }),
    p.center(`Impreso ${ticketDateTime(context.printedAt, context.timeZone)}`, { size: 'sm' }),
  )
  return { title: 'Cierre de caja', lines }
}
