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
