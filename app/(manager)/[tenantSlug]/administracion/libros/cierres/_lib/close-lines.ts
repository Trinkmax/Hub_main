import { formatCents } from '@/lib/money'
import { monthNoun } from '../../_lib/months'
import { bookHref } from '../../_lib/periods'
import type { CloseReview, ReviewAction, ReviewRecurring, ReviewTone } from './review'

/**
 * El checklist del Cierre de mes, en renglones: una etiqueta (Listo · Revisar · Falta), qué pasa y el
 * botón para resolverlo. Puro: junta los avisos que ya existían (`closeReview`, que sigue siendo quien
 * decide qué se afirma) con lo que mira la contadora antes de cerrar: que Debe dé igual a Haber y que
 * ninguna cuenta tenga el saldo al revés.
 */

export type CloseLineTone = ReviewTone | 'info'

export type CloseLine = {
  key: string
  tone: CloseLineTone
  tag: string
  title: string
  detail: string | null
  actions: ReviewAction[]
  /** Los gastos fijos sin cargar, con su «Pagar». */
  recurring: ReviewRecurring[]
  more: string | null
  note: string | null
  help: { text: string; label: string; href: string } | null
}

const TAG: Readonly<Record<ReviewTone, string>> = {
  ok: 'Listo',
  warn: 'Revisar',
  late: 'Falta',
  muted: 'Para ver',
}

function line(
  key: string,
  tone: CloseLineTone,
  title: string,
  extra: Partial<Omit<CloseLine, 'key' | 'tone' | 'title'>> = {},
): CloseLine {
  return {
    key,
    tone,
    tag: tone === 'info' ? 'IVA' : TAG[tone],
    title,
    detail: null,
    actions: [],
    recurring: [],
    more: null,
    note: null,
    help: null,
    ...extra,
  }
}

export type CloseLinesInput = {
  /** `yyyy-MM`. */
  month: string
  /** `/<bar>/administracion`. */
  base: string
  /** `null` si no se pudo leer el balance: no se afirma que cuadra. */
  trial: { balanced: boolean; differenceCents: number } | null
  /** Cuentas con el saldo al revés; `null` si no se pudo mirar. */
  oddAccounts: number | null
  /** Los avisos del mes; `null` con el mes cerrado o si no se pudieron leer. */
  review: CloseReview | null
  /** La planilla de Sueldos del mes; `null` si no se pudo leer. */
  payroll: { employees: number; accrued: boolean } | null
  /** Qué hace el cierre con el IVA, en una oración. */
  iva: { text: string; href: string } | null
  closed: boolean
}

const SEE: Readonly<{ label: string }> = { label: 'Ver' }

/** Las cuentas con el saldo al revés, en palabras. */
export function oddAccountsText(count: number): string {
  return count === 1 ? '1 cuenta con saldo al revés' : `${count} cuentas con saldo al revés`
}

/** «Falta devengar sueldos de octubre», o `null` si no hay nada que decir. */
export function payrollLine(
  payroll: { employees: number; accrued: boolean } | null,
  month: string,
  base: string,
): CloseLine | null {
  if (!payroll || payroll.employees === 0) return null
  const noun = monthNoun(month)
  const href = bookHref(`${base}/sueldos`, { mes: month })
  return payroll.accrued
    ? line('payroll', 'ok', `Sueldos de ${noun} devengados.`, {
        actions: [{ kind: 'href', href, ...SEE }],
      })
    : line('payroll', 'late', `Falta devengar sueldos de ${noun}`, {
        actions: [{ kind: 'href', href, label: 'Ir a Sueldos' }],
      })
}

export function closeLines(input: CloseLinesInput): CloseLine[] {
  const { month, base, trial, oddAccounts, review, payroll, iva, closed } = input
  const sums = bookHref(`${base}/libros/sumas-y-saldos`, { mes: month })
  const lines: CloseLine[] = []

  if (closed && !review)
    lines.push(line('review', 'ok', 'Mes cerrado: no queda nada para revisar.'))

  if (trial) {
    lines.push(
      trial.balanced
        ? line('balance', 'ok', 'Debe = Haber', { actions: [{ kind: 'href', href: sums, ...SEE }] })
        : line(
            'balance',
            'late',
            `El balance no cuadra por ${formatCents(trial.differenceCents)}`,
            {
              detail: 'No debería pasar: avisanos.',
              actions: [{ kind: 'href', href: sums, ...SEE }],
            },
          ),
    )
  }
  if (oddAccounts !== null && oddAccounts > 0) {
    lines.push(
      line('odd', 'warn', oddAccountsText(oddAccounts), {
        actions: [
          {
            kind: 'href',
            href: bookHref(`${base}/libros/sumas-y-saldos`, { mes: month, raro: '1' }),
            ...SEE,
          },
        ],
      }),
    )
  }

  for (const row of review?.rows ?? []) {
    if (row.okText) lines.push(line(row.id, 'ok', row.okText))
    for (const item of row.items) {
      lines.push(
        line(item.key, item.tone, item.title, {
          detail: item.detail,
          actions: item.actions,
          recurring: item.recurring ?? [],
          more: item.more ?? null,
          note: item.note ?? null,
          help: item.help ?? null,
        }),
      )
    }
  }

  // Con la planilla de Sueldos en uso, el sistema sí sabe si se devengó; si no, queda el recordatorio.
  const payrollKnown = payrollLine(payroll, month, base)
  if (payrollKnown) {
    lines.push(payrollKnown)
  } else {
    const reminder = review?.rows.find((row) => row.payroll)?.payroll
    if (reminder) {
      lines.push(line('payroll', 'muted', reminder.text, { actions: [reminder.action] }))
    }
  }

  if (iva && !closed) {
    lines.push(
      line('iva', 'info', iva.text, {
        actions: [{ kind: 'href', href: iva.href, label: 'Ver la cuenta' }],
      }),
    )
  }
  return lines
}
