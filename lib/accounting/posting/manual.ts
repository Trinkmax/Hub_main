/**
 * Asiento manual (`manual`: ajuste, sueldos, ajuste de cierre u otro, E.5.14)
 * y la plantilla «Sueldos del mes».
 *
 * Líneas libres: cuenta imputable y activa, un lado por línea, importe > 0;
 * partícipe y vencimiento solo en cuentas de control; al menos dos líneas y
 * cuadra (`entry_too_few_lines`, `entry_not_balanced`, de la validación). Las
 * líneas en cero se descartan. `fy_adjustment` es el ajuste de cierre de
 * ejercicio: fecha = último día del ejercicio (la validación lo exige si la
 * página manda `fiscalYearEndDate`). Un asiento que mueve IVA no entra al
 * libro IVA.
 *
 * **Sueldos del mes** (E13), con los tres números del resumen de la contadora:
 * neto a pagar = brutos − aportes (− cuota sindical, si se separa); cargas =
 * aportes + contribuciones. D Sueldos y jornales · D Contribuciones patronales
 * / H Sueldos a pagar [Personal] · H Cargas sociales a pagar [ARCA · seguridad
 * social] · H Sindicato y obra social a pagar [Sindicato]. Pagarlos no es otro
 * asiento manual: es «Pagar otra cosa» (E.5.5) sobre esas partidas.
 */

import {
  ackList,
  type BuildMeta,
  bundleOf,
  centsIssues,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  partyForPayable,
  postingError,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import type { ManualEntryInput, PayrollTemplateInput } from '@/lib/accounting/schemas'
import type {
  PostingContext,
  PostingError,
  PostingResult,
  WarningKey,
} from '@/lib/accounting/types'
import { formatMonthYear } from '@/lib/dates'

export type ManualEntryBuildInput = Omit<ManualEntryInput, 'clientRef' | 'previewHash'>
type ManualLineInput = ManualEntryBuildInput['lines'][number]

/** Asiento manual (E.5.14): las líneas en el orden en que se cargaron. */
export function buildManualEntry(
  input: ManualEntryBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues(
    input.lines.flatMap((l, i) => [
      [`lines.${i}.debitCents`, l.debitCents] as const,
      [`lines.${i}.creditCents`, l.creditCents] as const,
    ]),
  )
  input.lines.forEach((l, i) => {
    if ((l.debitCents ?? 0) > 0 && (l.creditCents ?? 0) > 0) {
      fatal.push(postingError('invalid_bundle', `lines.${i}`, { reason: 'line_both_sides' }))
    }
  })
  if (fatal.length > 0) return failed(fatal)

  const lines = new DocLineBuilder()
  for (const l of input.lines) {
    const debit = l.debitCents ?? 0
    const credit = l.creditCents ?? 0
    lines.add({
      role: 'manual',
      accountId: l.accountId,
      side: debit > 0 ? 'debit' : 'credit',
      amountCents: debit > 0 ? debit : credit,
      partyRef: l.partyId ? { id: l.partyId } : null,
      dueDate: l.dueDate,
      memo: l.memo ?? '',
    })
  }
  const built = lines.build()
  const total = sumCents(built.lines.filter((l) => l.side === 'debit').map((l) => l.amountCents))
  const doc = proposedDocument({
    ref: 'd1',
    kind: 'manual',
    entryKind: input.entryKind,
    issueDate: input.date,
    accountingDate: input.date,
    description: descriptionFor('manual', input.description),
    totalCents: total,
    correctsDocumentId: input.correctsDocumentId,
    warningsAck: ackList(input.warningsAck),
    lines: built.lines,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta)
}

// ─── Plantilla «Sueldos del mes» (E13) ───────────────────────────────────────

export type PayrollTemplateBuildInput = PayrollTemplateInput & {
  description?: string | null
  warningsAck?: readonly WarningKey[]
}

/** Las líneas del asiento de sueldos (para precargar la grilla del asiento manual). */
export function payrollTemplateLines(
  input: PayrollTemplateBuildInput,
  ctx: PostingContext,
): { ok: true; lines: ManualLineInput[] } | { ok: false; errors: PostingError[] } {
  const fatal = centsIssues([
    ['grossSalariesCents', input.grossSalariesCents],
    ['employerContributionsCents', input.employerContributionsCents],
    ['withheldContributionsCents', input.withheldContributionsCents],
    ['unionDuesCents', input.unionDuesCents],
  ])
  const net = input.grossSalariesCents - input.withheldContributionsCents - input.unionDuesCents
  if (net < 0)
    fatal.push(
      postingError('total_mismatch', 'withheldContributionsCents', {
        computed_cents: input.withheldContributionsCents + input.unionDuesCents,
        control_cents: input.grossSalariesCents,
      }),
    )
  const personal = partyForPayable(ctx, 'payroll_payable', 'payroll')
  const socialSecurity = partyForPayable(ctx, 'social_security_payable', 'tax_agency')
  const union = input.unionDuesCents > 0 ? partyForPayable(ctx, 'union_payable', 'other') : null
  if (!personal) fatal.push(postingError('party_required', 'grossSalariesCents'))
  if (!socialSecurity) fatal.push(postingError('party_required', 'withheldContributionsCents'))
  if (input.unionDuesCents > 0 && !union)
    fatal.push(postingError('party_required', 'unionDuesCents'))
  if (fatal.length > 0 || !personal || !socialSecurity) return { ok: false, errors: fatal }

  const line = (
    accountId: string,
    side: 'debit' | 'credit',
    cents: number,
    partyId: string | null,
    dueDate: string | null,
    memo: string,
  ): ManualLineInput => ({
    accountId,
    debitCents: side === 'debit' ? cents : null,
    creditCents: side === 'credit' ? cents : null,
    partyId,
    dueDate: partyId ? dueDate : null,
    memo,
  })
  const lines: ManualLineInput[] = [
    line(ctx.sys.salaries.id, 'debit', input.grossSalariesCents, null, null, 'Sueldos brutos'),
    line(
      ctx.sys.employer_contributions.id,
      'debit',
      input.employerContributionsCents,
      null,
      null,
      'Contribuciones patronales',
    ),
    line(
      ctx.sys.payroll_payable.id,
      'credit',
      net,
      personal.id,
      input.salariesDueDate,
      'Neto a pagar',
    ),
    line(
      ctx.sys.social_security_payable.id,
      'credit',
      input.withheldContributionsCents + input.employerContributionsCents,
      socialSecurity.id,
      input.socialSecurityDueDate,
      'Aportes y contribuciones (F.931)',
    ),
  ]
  if (union) {
    lines.push(
      line(
        ctx.sys.union_payable.id,
        'credit',
        input.unionDuesCents,
        union.id,
        null,
        'Cuota sindical',
      ),
    )
  }
  return { ok: true, lines }
}

/** «Sueldos del mes» (E13): un asiento manual de tipo `payroll` con las líneas de la plantilla. */
export function buildPayrollEntry(
  input: PayrollTemplateBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const template = payrollTemplateLines(input, ctx)
  if (!template.ok) return failed(template.errors)
  const month = formatMonthYear(input.date)
  return buildManualEntry(
    {
      warningsAck: [...(input.warningsAck ?? [])],
      entryKind: 'payroll',
      date: input.date,
      description: input.description?.trim() || `Sueldos de ${month}`,
      lines: template.lines,
      correctsDocumentId: null,
    },
    ctx,
    meta,
  )
}
