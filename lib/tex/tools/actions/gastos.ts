import 'server-only'

import { z } from 'zod'
import { isPurchaseImputation } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import {
  paymentOutcome,
  payTicketRows,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-summary'
import {
  isInvoiceVoucher,
  QUICK_VOUCHER_LABELS,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import {
  autoTaxPlan,
  papelLabel,
  payStripBlock,
  rowActions,
  rowStatus,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import type { AccActionState, AccSimpleState } from '@/lib/accounting/action-state'
import { saveRecurringExpense, skipRecurringDue } from '@/lib/accounting/actions/master'
import {
  postPayrollAccrual,
  postPayrollMovement,
  saveEmployee,
  saveEmployeeSalary,
} from '@/lib/accounting/actions/payroll'
import { loadOpenItems, tryLoadPostingContext } from '@/lib/accounting/context'
import {
  accrualOffer,
  employeeBalanceCents,
  employeeSalarySchema,
  employeeSchema,
  monthWord,
  owedSentence,
  type PayrollAccrualInput,
  type PayrollEmployee,
  type PayrollMovementInput,
  payrollAccrualValues,
  payrollMovementValues,
  personalPartyId,
} from '@/lib/accounting/payroll'
import { listRecurringExpenses, type RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { getFormDefaults } from '@/lib/accounting/queries/forms'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { installmentLabel } from '@/lib/accounting/recurring-status'
import { recurringSchema, skipRecurringDueSchema } from '@/lib/accounting/schemas'
import { bankTaxOf } from '@/lib/accounting/taxes'
import type { PostingContext, TreasuryRef } from '@/lib/accounting/types'
import { endOfMonth, monthOf } from '@/lib/dates'
import { entryLines, failureText, prepareDocument, ticketWarnings } from '../../document-action'
import type { TexTicketWarning } from '../../protocol'
import { resolveAccount, resolveParty, resolveTreasury } from '../../resolve'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  dayField,
  dayText,
  defineTool,
  money,
  monthField,
  pesosField,
  pesosToCents,
  type TexExecution,
  type TexExecutor,
  type TexToolContext,
  type TexToolResult,
  zodIssuesText,
} from '../types'
import { withTicketWarnings } from './_caja-values'
import {
  EMPLOYEE_FREQUENCIES,
  type EmployeeChange,
  employeeValues,
  FREQUENCY_TEXT,
  FREQUENCY_WORDS,
  frequencyOf,
  matchByName,
  noMatchText,
  PAPER_WORDS,
  PAYROLL_KINDS_OF,
  quickVoucherOfPaper,
  type RecurringChange,
  recurringExpenseValues,
  recurringPaymentValues,
  recurringSavePayload,
  recurringSheetItem,
  voucherTypeOfPaper,
} from './_gastos-values'

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

/** «Deshacer» dura 10 minutos y solo para quien lo cargó (`acc_void_document`). */
const UNDO_WINDOW_MS = 10 * 60 * 1000

const IVA_RATES: Readonly<Record<'21' | '10.5' | '27', number>> = {
  '21': 2100,
  '10.5': 1050,
  '27': 2700,
}

const TICKET_BROKEN = 'El tique está roto: armalo de nuevo.'

/**
 * Con qué caja: la que dijo, la de siempre o, si hay una sola, esa. Si no, Tex pregunta: de dónde sale
 * la plata no se adivina.
 */
async function treasuryFor(
  ctx: TexToolContext,
  posting: PostingContext,
  wanted: string | undefined,
  usual: ReadonlyArray<string | null | undefined>,
  usable: (t: TreasuryRef) => boolean,
): Promise<{ ok: true; treasury: TreasuryRef } | { ok: false; message: string }> {
  const list = [...posting.treasuries.values()].filter((t) => t.active && usable(t))
  if (wanted) {
    const found = await resolveTreasury(ctx, wanted)
    if (!found.ok) return { ok: false, message: found.message }
    const treasury = list.find((t) => t.id === found.value.id)
    if (!treasury) {
      return { ok: false, message: `«${found.value.name}» no sirve para esto. Preguntale otra.` }
    }
    return { ok: true, treasury }
  }
  for (const id of usual) {
    const treasury = id ? list.find((t) => t.id === id) : undefined
    if (treasury) return { ok: true, treasury }
  }
  const [only] = list
  if (only && list.length === 1) return { ok: true, treasury: only }
  return {
    ok: false,
    message: `Preguntale con qué lo pagó: ${list.map((t) => t.name).join(', ') || 'no hay cajas activas'}.`,
  }
}

function bankTaxRows(
  cents: number,
  treasury: TreasuryRef,
  posting: PostingContext,
): Array<{ label: string; value: string }> {
  const tax = bankTaxOf(cents, treasury, posting.settings.taxSettings)
  return tax > 0 ? [{ label: 'Impuesto al cheque', value: `${money(tax)}, se anota solo` }] : []
}

/** El tique de un comprobante, pero para que lo ejecute otra acción: la de Sueldos. */
function withExecutor(
  result: TexToolResult,
  executor: string,
  extra: Record<string, unknown>,
): TexToolResult {
  if (result.kind !== 'prepared') return result
  return {
    kind: 'prepared',
    prepared: {
      ...result.prepared,
      executor,
      payload: { ...(result.prepared.payload as Record<string, unknown>), ...extra },
    },
  }
}

const payrollDocumentPayload = {
  values: z.record(z.string(), z.unknown()),
  previewHash: z.string(),
  warningsAck: z.array(z.string()),
  month: z.string(),
}

/**
 * Lo mismo que `documentExecutor`, para las dos acciones de Sueldos que hacen un comprobante: lo que
 * cambió mientras tanto o los avisos que solo ve la base vuelven al tique, con lo nuevo.
 */
function documentOutcome<P extends { warningsAck: string[] }>(
  state: AccActionState,
  payload: P,
  place: { href: string | null; point: string | null },
): TexExecution {
  if (state.ok) {
    const documentId = state.result.documents[0]?.id ?? null
    return {
      ok: true,
      message: state.message,
      documentId,
      href: place.href,
      point: place.point,
      undoUntil: documentId ? new Date(Date.now() + UNDO_WINDOW_MS).toISOString() : null,
      data: { replayed: state.result.replayed },
    }
  }
  if (state.code === 'needs_confirmation' && state.warnings) {
    return {
      ok: false,
      kind: 'review',
      message: state.message,
      warnings: ticketWarnings(state.warnings),
      payload: {
        ...payload,
        warningsAck: [...new Set([...payload.warningsAck, ...state.warnings.map((w) => w.key)])],
      },
    }
  }
  if (state.hash && state.preview) {
    return {
      ok: false,
      kind: 'review',
      message: state.message,
      warnings: [{ key: 'changed', title: state.message, body: null }],
      entry: entryLines(state.preview),
      payload: { ...payload, previewHash: state.hash },
    }
  }
  return { ok: false, kind: 'failed', message: failureText(state) }
}

function sueldosHref(ctx: TexToolContext, month: string): string | null {
  const link = texScreenHref(ctx.slug, 'sueldos', { mes: month })
  return link.ok ? link.href : null
}

// ─── Lo que recibe cada ejecutor ─────────────────────────────────────────────

const movementPayload = z.object({
  ...payrollDocumentPayload,
  employeeId: z.string(),
  employeeName: z.string(),
  kind: z.enum(['advance', 'payment']),
})

const accrualPayload = z.object(payrollDocumentPayload)

const employeePayload = z.object({
  employee: employeeSchema.nullable(),
  employeeId: z.uuid().nullable(),
  salary: employeeSalarySchema.omit({ employeeId: true }).nullable(),
})

/** Lo que se le manda a `saveRecurringExpense`, tal cual: en una edición viaja solo lo que está. */
const recurringPayload = z.record(z.string(), z.unknown())

export const gastosActionTools = [
  defineTool({
    name: 'preparar_gasto_fijo',
    description:
      'Prepara el alta o la edición de un gasto fijo (lo que se paga todos los meses): nombre, categoría, monto, vencimiento, papel, cuotas. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      gasto: z
        .string()
        .min(1)
        .optional()
        .describe('El gasto fijo a editar: nombre o id. Sin esto, es un alta.'),
      nombre: z.string().min(2).max(80).optional().describe('El nombre. En un alta, obligatorio.'),
      cuenta: z
        .string()
        .min(1)
        .optional()
        .describe('En qué se gasta: nombre o código de la cuenta. En un alta, obligatoria.'),
      monto: pesosField('En pesos. Si cambia todos los meses, el de la última vez.').optional(),
      dia: z.number().int().min(1).max(31).optional().describe('Qué día del mes vence.'),
      proximo_vencimiento: dayField(
        'El próximo vencimiento, si no es el que sale del día.',
      ).optional(),
      frecuencia: z.enum(FREQUENCY_WORDS).optional().describe('Por defecto, mensual.'),
      proveedor: z.string().min(1).optional().describe('A quién se le paga: nombre o id.'),
      papel: z.enum(PAPER_WORDS).optional().describe('Qué papel le dan.'),
      iva: z.enum(['21', '10.5', '27']).optional().describe('El IVA de siempre, con factura A.'),
      caja: z.string().min(1).optional().describe('Con qué se paga casi siempre: nombre o id.'),
      cuotas: z
        .object({
          total: z.number().int().min(1).max(120).optional(),
          actual: z.number().int().min(1).max(120).optional(),
          restantes: z.number().int().min(1).max(120).optional(),
        })
        .optional()
        .describe('Si es en cuotas: de cuántas es y por cuál va, o solo cuántas faltan.'),
      pausado: z.boolean().optional().describe('true: deja de avisar y sale de la planilla.'),
      nota: z.string().max(280).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el gasto fijo',
    done: () => 'Preparé el gasto fijo',
    run: async (input, ctx) => {
      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx

      let row: RecurringExpenseRow | null = null
      if (input.gasto) {
        const rows = await listRecurringExpenses(ctx.tenantId, {
          includeInactive: true,
          today: ctx.today,
        })
        const match = matchByName(rows, input.gasto)
        if (!match.ok) return fail(noMatchText(match, input.gasto))
        row = match.value
      } else {
        if (!input.nombre) return fail('Preguntale cómo se llama el gasto fijo.')
        if (!input.cuenta) return fail('Preguntale en qué se gasta (la categoría).')
        if (input.dia === undefined && !input.proximo_vencimiento) {
          return fail('Preguntale qué día vence.')
        }
      }
      if (row && row.breakdown.length > 0 && input.monto !== undefined) {
        return fail(
          `«${row.name}» tiene un detalle y el monto es su suma: se cambia en su ficha. Llevalo con ir_a a gasto_fijo, id ${row.id}.`,
        )
      }

      const change: RecurringChange = {
        name: input.nombre,
        amountCents: input.monto !== undefined ? pesosToCents(input.monto) : undefined,
        dueDay:
          input.dia ??
          (input.proximo_vencimiento ? Number(input.proximo_vencimiento.slice(8, 10)) : undefined),
        nextDueDate: input.proximo_vencimiento,
        frequency: input.frecuencia ? frequencyOf(input.frecuencia) : undefined,
        vatRateBp: input.iva ? IVA_RATES[input.iva] : undefined,
        active: input.pausado === undefined ? undefined : !input.pausado,
        notes: input.nota,
        installments: input.cuotas
          ? {
              total: input.cuotas.total,
              current: input.cuotas.actual,
              remaining: input.cuotas.restantes,
            }
          : undefined,
      }
      if (input.papel) {
        change.voucherType = voucherTypeOfPaper(input.papel, row?.voucherType ?? null)
      }

      if (input.cuenta) {
        const found = await resolveAccount(ctx, input.cuenta)
        if (!found.ok) return fail(found.message)
        const account = posting.accounts.get(found.value.id)
        if (!account || (!isPurchaseImputation(account) && account.id !== row?.accountId)) {
          return fail(`«${found.value.name}» no sirve para un gasto. Elegí otra con buscar_cuenta.`)
        }
        change.accountId = account.id
      }
      if (input.proveedor) {
        const found = await resolveParty(ctx, input.proveedor, ['supplier', 'other', 'tax_agency'])
        if (!found.ok) return fail(found.message)
        change.partyId = found.value.id
      }
      if (input.caja) {
        const found = await resolveTreasury(ctx, input.caja)
        if (!found.ok) return fail(found.message)
        change.treasuryAccountId = found.value.id
      }

      const { payload, form, errors } = recurringSavePayload(row, change, ctx.today)
      const [firstError] = Object.values(errors)
      if (firstError) return fail(firstError)
      const valid = recurringSchema.safeParse(payload)
      if (!valid.success) return fail(zodIssuesText(valid.error))

      const treasuryName = form.treasuryAccountId
        ? (posting.treasuries.get(form.treasuryAccountId)?.name ?? null)
        : null
      const partyName = form.partyId
        ? (posting.parties.get(form.partyId)?.tradeName ??
          posting.parties.get(form.partyId)?.name ??
          null)
        : null
      const lines: ReadonlyArray<{ on: boolean; label: string; value: string | null }> = [
        { on: input.nombre !== undefined, label: 'Nombre', value: row ? form.name : null },
        {
          on: input.cuenta !== undefined,
          label: 'En qué',
          value: form.accountId ? (posting.accounts.get(form.accountId)?.name ?? null) : null,
        },
        {
          on: input.monto !== undefined,
          label: 'Monto',
          value: form.amountCents === null ? 'Cambia todos los meses' : money(form.amountCents),
        },
        {
          on: input.frecuencia !== undefined,
          label: 'Cada cuánto',
          value: FREQUENCY_TEXT[form.frequency],
        },
        {
          on: input.dia !== undefined || input.proximo_vencimiento !== undefined,
          label: 'Próximo vencimiento',
          value: dayText(form.nextDueDate),
        },
        { on: input.proveedor !== undefined, label: 'A quién', value: partyName },
        {
          on: input.papel !== undefined,
          label: 'Papel',
          value: papelLabel(form.voucherType) ?? 'No sé o cambia',
        },
        { on: input.caja !== undefined, label: 'Con qué se paga', value: treasuryName },
        {
          on: input.cuotas !== undefined,
          label: 'Última cuota',
          value: dayText(payload.endsOn),
        },
        {
          on: input.pausado !== undefined,
          label: 'Estado',
          value: form.active ? (row ? 'Activo' : null) : 'En pausa',
        },
        { on: input.nota !== undefined, label: 'Nota', value: input.nota ?? null },
      ]
      // En un alta se lee entero; en una edición, solo lo que cambia.
      const rows = lines.flatMap((line) =>
        (row === null || line.on) && line.value !== null
          ? [{ label: line.label, value: line.value }]
          : [],
      )
      if (row && rows.length === 0) {
        return fail('No hay nada para cambiar: preguntale qué quiere cambiar.')
      }
      return {
        kind: 'prepared',
        prepared: {
          executor: 'gastos.gasto_fijo',
          payload,
          ticket: {
            kind: 'gasto_fijo',
            title: row ? 'Editar gasto fijo' : 'Nuevo gasto fijo',
            subtitle: form.name,
            rows,
            total: null,
            entry: [],
            warnings: [],
            confirmLabel: row ? 'Guardar los cambios' : 'Guardar el gasto fijo',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_pago_gasto_fijo',
    description:
      'Prepara tildar un gasto fijo como pagado: como la planilla, es un gasto o, en los impuestos que se devengan solos (Rentas, Municipalidad) o si ya tiene factura, un pago. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      gasto: z.string().min(1).describe('El gasto fijo: nombre o id.'),
      monto: pesosField('En pesos. Si no lo dijo, el del gasto fijo o lo que se debe.').optional(),
      caja: z.string().min(1).optional().describe('Con qué se pagó: nombre o id.'),
      papel: z.enum(PAPER_WORDS).optional().describe('Si no es el papel de siempre.'),
      punto_de_venta: z.number().int().min(0).max(99999).optional(),
      numero: z.number().int().min(1).max(99_999_999).optional(),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      nota: z.string().max(280).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el pago',
    done: () => 'Preparé el pago',
    run: async (input, ctx) => {
      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const [rows, payments] = await Promise.all([
        listRecurringExpenses(ctx.tenantId, { includeInactive: true, today: ctx.today }),
        listRecurringPayments(ctx.tenantId),
      ])
      const match = matchByName(rows, input.gasto)
      if (!match.ok) return fail(noMatchText(match, input.gasto))
      const row = match.value

      const item = recurringSheetItem(row, payments.get(row.id), ctx.today)
      const autoTax = autoTaxPlan({
        settings: posting.settings.taxSettings,
        accounts: [...posting.accounts.values()],
        parties: [...posting.parties.values()].map((p) => ({
          id: p.id,
          systemKey: p.systemKey ?? null,
          active: p.active,
        })),
      })
      const actions = rowActions(item, { canWrite: true, autoTax })
      const pay = actions.pay
      if (!pay) {
        if (autoTax[row.accountId] === null) {
          return fail(
            `«${row.name}» ya se devenga en cada cierre del día y se le paga a su organismo, pero el bar no lo tiene activo: se revisa en Ajustes › Medios de cobro.`,
          )
        }
        return fail(`«${row.name}»: ${rowStatus(item, ctx.today).title}. No hay nada para pagar.`)
      }
      if (pay.kind === 'document') {
        return fail(
          `«${row.name}» tiene una factura cargada: se paga desde el comprobante. Llevalo con ir_a a comprobante, id ${pay.documentId}.`,
        )
      }

      const date = input.fecha ?? ctx.today
      const ahead: TexTicketWarning[] = actions.payAhead
        ? [
            {
              key: 'pay_ahead',
              title: `Todavía no vence: paga por adelantado el vencimiento del ${dayText(row.nextDueDate)}.`,
              body: null,
            },
          ]
        : []
      const cuota = installmentLabel(item.line.installment)

      if (pay.kind === 'gasto') {
        const amountCents = input.monto !== undefined ? pesosToCents(input.monto) : row.amountCents
        if (amountCents === null) {
          return fail(`«${row.name}» no tiene monto: preguntale cuánto pagó.`)
        }
        const chosen = await treasuryFor(
          ctx,
          posting,
          input.caja,
          [row.treasuryAccountId],
          () => true,
        )
        if (!chosen.ok) return fail(chosen.message)
        const { treasury } = chosen
        const hasNumber = input.punto_de_venta !== undefined && input.numero !== undefined
        const built = recurringExpenseValues({
          row,
          posting,
          amountCents,
          treasuryId: treasury.id,
          voucher: quickVoucherOfPaper(input.papel),
          pointOfSale: input.punto_de_venta ?? null,
          number: input.numero ?? null,
          date,
          note: input.nota,
        })
        const block = payStripBlock({
          amountCents,
          target: built.target,
          voucher: built.voucher,
          hasNumber,
        })
        if (block) {
          // Tex no elige proveedores: la planilla sí (y lo deja guardado en el gasto fijo).
          if (built.target?.kind === 'account' && isInvoiceVoucher(built.voucher)) {
            return fail(
              `«${row.name}» no tiene proveedor y una factura lo pide. Con factura se carga desde la planilla de gastos fijos: al tildarlo y elegir el papel aparece «Proveedor» (de la lista o uno nuevo con su CUIT) y queda guardado para el mes que viene. Si no tiene factura, mandá papel sin_factura.`,
            )
          }
          return fail(
            `${block} Pedile lo que falta, o mandá papel sin_factura si no tiene ese papel.`,
          )
        }
        const [missing] = Object.values(built.missing)
        if (!built.values) return fail(missing ?? 'Falta un dato: revisalo en la planilla.')
        const prepared = await prepareDocument(ctx, 'quick_expense', built.values, {
          kind: 'pago_gasto_fijo',
          title: 'Pago de un gasto fijo',
          subtitle: row.name,
          rows: [
            ...(cuota ? [{ label: 'Cuota', value: cuota }] : []),
            ...(row.partyName ? [{ label: 'A quién', value: row.partyName }] : []),
            { label: 'Sale de', value: treasury.name },
            { label: 'Papel', value: QUICK_VOUCHER_LABELS[built.voucher] },
            { label: 'Fecha', value: dayText(date) ?? date },
            ...bankTaxRows(amountCents, treasury, posting),
            ...(input.nota ? [{ label: 'Nota', value: input.nota }] : []),
          ],
          total: { label: 'Total', value: money(amountCents) },
          confirmLabel: 'Cargar el pago',
        })
        return withTicketWarnings(prepared, ahead)
      }

      // Un pago: al organismo (Rentas, Municipalidad) o al proveedor de la factura cargada.
      const party = posting.parties.get(pay.partyId)
      const partyName = party?.tradeName ?? party?.name ?? row.name
      // Lo que el sistema recuerda: con qué se le pagó la última vez (si no dijo con qué).
      const defaults = input.caja
        ? null
        : await settleQuery(getFormDefaults(ctx.tenantId, pay.partyId))
      const chosen = await treasuryFor(
        ctx,
        posting,
        input.caja,
        [row.treasuryAccountId, defaults?.ok ? defaults.data.treasuryAccountId : null],
        () => true,
      )
      if (!chosen.ok) return fail(chosen.message)
      const { treasury } = chosen
      const items = await loadOpenItems(ctx.tenantId, { openItemsOf: [{ partyId: pay.partyId }] })
      const { values, plan, debtTotalCents, labelOf } = recurringPaymentValues({
        partyId: pay.partyId,
        items,
        today: ctx.today,
        date,
        treasuryId: treasury.id,
        amountCents: input.monto !== undefined ? pesosToCents(input.monto) : null,
        recurringExpenseId: pay.recurringId ?? null,
        documentId: pay.recurringId ? null : (item.doc?.id ?? null),
        note: input.nota,
      })
      if (plan.amountCents <= 0) {
        return fail(
          plan.debtCents > 0 && plan.creditAvailableCents > 0
            ? `Lo que tiene a favor con ${partyName} ya cubre esa deuda: no hace falta pagar nada. Se usa desde la hoja «Pago».`
            : `A ${partyName} no se le debe nada todavía: preguntale cuánto pagó y mandalo en monto.`,
        )
      }
      const outcome = paymentOutcome({ plan, debtTotalCents })
      const ticketLines = payTicketRows(plan.applications, labelOf)
      const prepared = await prepareDocument(ctx, 'payment', values, {
        kind: 'pago_gasto_fijo',
        title: 'Pago',
        subtitle: `${partyName} · ${row.name}`,
        rows: [
          ...ticketLines.rows.map((line) => ({ label: line.label, value: money(line.cents) })),
          ...(ticketLines.more > 0
            ? [{ label: `Y ${ticketLines.more} más`, value: money(ticketLines.moreCents) }]
            : []),
          ...(plan.creditUsedCents > 0
            ? [{ label: 'A favor que se usa', value: money(plan.creditUsedCents) }]
            : []),
          { label: 'Sale de', value: treasury.name },
          { label: 'Fecha', value: dayText(date) ?? date },
          { label: 'Cómo queda', value: outcome.sentence },
          ...bankTaxRows(plan.amountCents, treasury, posting),
          ...(input.nota ? [{ label: 'Nota', value: input.nota }] : []),
        ],
        total: { label: 'Pagás', value: money(plan.amountCents) },
        confirmLabel: 'Cargar el pago',
      })
      return withTicketWarnings(prepared, [
        ...ahead,
        ...outcome.details.map((title, index) => ({
          key: `pay_detail_${index}`,
          title,
          body: null,
        })),
      ])
    },
  }),

  defineTool({
    name: 'preparar_saltar_gasto_fijo',
    description:
      'Prepara marcar que este mes un gasto fijo no se paga (o ya se cargó por otro lado): avanza al próximo vencimiento sin cargar nada. No guarda nada: muestra un tique para confirmar.',
    input: z.object({ gasto: z.string().min(1).describe('El gasto fijo: nombre o id.') }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el salteo',
    done: () => 'Preparé el salteo',
    run: async (input, ctx) => {
      const [rows, payments] = await Promise.all([
        listRecurringExpenses(ctx.tenantId, { includeInactive: true, today: ctx.today }),
        listRecurringPayments(ctx.tenantId),
      ])
      const match = matchByName(rows, input.gasto)
      if (!match.ok) return fail(noMatchText(match, input.gasto))
      const row = match.value
      const item = recurringSheetItem(row, payments.get(row.id), ctx.today)
      const actions = rowActions(item, { canWrite: true })
      if (!actions.skip) {
        return fail(
          `«${row.name}» no se puede saltear: ${rowStatus(item, ctx.today).title}. Se saltea solo lo que vence este mes o ya venció y no se cargó.`,
        )
      }
      const payload = skipRecurringDueSchema.safeParse({ id: row.id, dueDate: row.nextDueDate })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'gastos.saltar',
          payload: payload.data,
          ticket: {
            kind: 'saltar_gasto_fijo',
            title: 'Este mes no se paga',
            subtitle: row.name,
            rows: [
              { label: 'Vencimiento', value: dayText(row.nextDueDate) ?? row.nextDueDate },
              ...(row.amountCents !== null
                ? [{ label: 'Monto', value: money(row.amountCents) }]
                : []),
            ],
            total: null,
            entry: [],
            warnings: [],
            confirmLabel: 'Saltear este mes',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_empleado',
    description:
      'Prepara el alta o la edición de un empleado y su sueldo, o darlo de baja. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      empleado: z
        .string()
        .min(1)
        .optional()
        .describe('A quién editar: nombre o id. Sin esto, es un alta.'),
      nombre: z.string().min(2).max(80).optional().describe('El nombre. En un alta, obligatorio.'),
      frecuencia: z
        .enum(['mensual', 'quincenal'])
        .optional()
        .describe('Cada cuánto cobra. Por defecto, mensual.'),
      sueldo: pesosField(
        'El sueldo del mes, en pesos. Los meses siguientes lo heredan.',
      ).optional(),
      mes: monthField(
        'Desde qué mes rige el sueldo, yyyy-MM. Si no lo dijo, el actual.',
      ).optional(),
      activo: z
        .boolean()
        .optional()
        .describe('false: lo da de baja. true: lo vuelve a dar de alta.'),
      nota: z.string().max(280).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el empleado',
    done: () => 'Preparé el empleado',
    run: async (input, ctx) => {
      const month = input.mes ?? monthOf(ctx.today)
      const report = await getPayrollReport(ctx.tenantId, month)

      let employee: PayrollEmployee | null = null
      if (input.empleado) {
        const match = matchByName(report.employees, input.empleado)
        if (!match.ok) return fail(noMatchText(match, input.empleado))
        employee = match.value
      } else {
        if (!input.nombre) return fail('Preguntale cómo se llama el empleado.')
        const same = matchByName(report.employees, input.nombre)
        if (same.ok && same.value.name.toLowerCase() === input.nombre.trim().toLowerCase()) {
          return fail(
            `Ya hay un empleado «${same.value.name}». Preguntale si es esa persona: para cambiarle algo, mandá empleado.`,
          )
        }
      }
      // Devengado el mes, sus sueldos quedan fijos: para cambiarlos hay que anular el asiento.
      if (input.sueldo !== undefined && report.accrual) {
        return fail(
          `Los sueldos de ${monthWord(month)} ya están devengados: para cambiarlos hay que anular el asiento. Id del comprobante: ${report.accrual.documentId}.`,
        )
      }

      const change: EmployeeChange = {
        name: input.nombre,
        frequency: input.frecuencia ? EMPLOYEE_FREQUENCIES[input.frecuencia] : undefined,
        active: input.activo,
        notes: input.nota,
      }
      const values = employeeValues(employee, change)
      const salary =
        input.sueldo !== undefined ? { month, salaryCents: pesosToCents(input.sueldo) } : null
      if (!values && !salary)
        return fail('No hay nada para cambiar: preguntale qué quiere cambiar.')

      const parsed = employeePayload.safeParse({
        employee: values,
        employeeId: employee?.id ?? null,
        salary,
      })
      if (!parsed.success) return fail(zodIssuesText(parsed.error))

      const leaving = employee?.active === true && input.activo === false
      const rows = [
        ...(input.nombre ? [{ label: 'Nombre', value: input.nombre }] : []),
        ...(input.frecuencia || !employee
          ? [{ label: 'Cobra', value: input.frecuencia === 'quincenal' ? 'Quincenal' : 'Mensual' }]
          : []),
        ...(salary
          ? [
              {
                label: 'Sueldo',
                value: `${money(salary.salaryCents)} desde ${monthWord(month)}`,
              },
            ]
          : []),
        ...(input.activo !== undefined && employee
          ? [{ label: 'Estado', value: input.activo ? 'De alta' : 'De baja' }]
          : []),
        ...(input.nota ? [{ label: 'Nota', value: input.nota }] : []),
      ]
      return {
        kind: 'prepared',
        prepared: {
          executor: 'gastos.empleado',
          payload: parsed.data,
          ticket: {
            kind: 'empleado',
            title: employee ? 'Editar empleado' : 'Nuevo empleado',
            subtitle: employee?.name ?? input.nombre ?? null,
            rows,
            total: null,
            entry: [],
            warnings: leaving
              ? [
                  {
                    key: 'employee_leaving',
                    title:
                      'Sale de la planilla de los meses que vienen. Lo que ya le pagaste queda igual.',
                    body: null,
                  },
                ]
              : [],
            confirmLabel: employee
              ? leaving
                ? 'Dar de baja'
                : 'Guardar los cambios'
              : 'Agregar el empleado',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_movimiento_sueldo',
    description:
      'Prepara un adelanto o un pago de sueldo a un empleado, con la caja de la que salió. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      empleado: z.string().min(1).describe('A quién: nombre o id.'),
      tipo: z.enum(['adelanto', 'pago']),
      monto: pesosField('En pesos. En un pago, si no lo dijo, lo que se le debe.').optional(),
      caja: z.string().min(1).optional().describe('De qué caja salió: nombre o id.'),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      mes: monthField('De qué mes es el sueldo, yyyy-MM. Si no lo dijo, el actual.').optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: (input) => (input.tipo === 'adelanto' ? 'Preparando el adelanto' : 'Preparando el pago'),
    done: (input) => (input.tipo === 'adelanto' ? 'Preparé el adelanto' : 'Preparé el pago'),
    run: async (input, ctx) => {
      const month = input.mes ?? monthOf(ctx.today)
      const [report, loaded] = await Promise.all([
        getPayrollReport(ctx.tenantId, month),
        tryLoadPostingContext(ctx.tenantId),
      ])
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const match = matchByName(report.employees, input.empleado)
      if (!match.ok) return fail(noMatchText(match, input.empleado))
      const employee = match.value

      const kind = PAYROLL_KINDS_OF[input.tipo]
      const balance = employeeBalanceCents(employee)
      const cents =
        input.monto !== undefined
          ? pesosToCents(input.monto)
          : kind === 'payment' && balance > 0
            ? balance
            : null
      if (cents === null) {
        return fail(
          kind === 'payment'
            ? `${owedSentence(balance, month)} Preguntale cuánto le pagó.`
            : 'Preguntale de cuánto fue el adelanto.',
        )
      }

      // Una tarjeta de la empresa no es una caja con plata: un sueldo no sale de ahí.
      const chosen = await treasuryFor(
        ctx,
        posting,
        input.caja,
        [],
        (t) => t.kind !== 'credit_card',
      )
      if (!chosen.ok) return fail(chosen.message)
      const { treasury } = chosen
      const date = input.fecha ?? ctx.today
      const values = payrollMovementValues(
        {
          kind,
          employeeName: employee.name,
          month,
          treasuryAccountId: treasury.id,
          amountCents: cents,
          date,
          personalPartyId: personalPartyId(posting),
        },
        posting,
      )
      const prepared = await prepareDocument(ctx, 'cash_movement', values, {
        kind: 'movimiento_sueldo',
        title: input.tipo === 'adelanto' ? 'Adelanto de sueldo' : 'Pago de sueldo',
        subtitle: `${employee.name} · ${monthWord(month)}`,
        rows: [
          { label: 'Saldo', value: owedSentence(balance, month) },
          { label: 'Sale de', value: treasury.name },
          { label: 'Fecha', value: dayText(date) ?? date },
          ...bankTaxRows(cents, treasury, posting),
        ],
        total: { label: 'Total', value: money(cents) },
        confirmLabel: input.tipo === 'adelanto' ? 'Registrar el adelanto' : 'Registrar el pago',
      })
      return withExecutor(prepared, 'gastos.movimiento_sueldo', {
        employeeId: employee.id,
        employeeName: employee.name,
        month,
        kind,
      })
    },
  }),

  defineTool({
    name: 'preparar_devengar_sueldos',
    description:
      'Prepara devengar los sueldos de un mes: el asiento de Sueldos y jornales contra Sueldos a pagar, que deja fijos los sueldos de ese mes. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      mes: monthField('Qué mes, yyyy-MM. Si no lo dijo, el actual.').optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el devengamiento',
    done: () => 'Preparé el devengamiento',
    run: async (input, ctx) => {
      const month = input.mes ?? monthOf(ctx.today)
      const mes = monthWord(month)
      const [report, loaded] = await Promise.all([
        getPayrollReport(ctx.tenantId, month),
        tryLoadPostingContext(ctx.tenantId),
      ])
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const offer = accrualOffer(report, ctx.today)
      if (offer.kind === 'done') return fail(`Los sueldos de ${mes} ya están devengados.`)
      if (offer.kind === 'future') return fail(`${mes} todavía no empezó: no se puede devengar.`)
      if (offer.kind === 'no_total') {
        return fail(`Para devengar ${mes}, primero hay que cargar los sueldos.`)
      }
      const partyId = personalPartyId(posting)
      if (!partyId) {
        return fail('Falta el partícipe «Personal» de los sueldos: se revisa en Ajustes.')
      }
      const values = payrollAccrualValues(
        { month, totalCents: offer.totalCents, personalPartyId: partyId },
        posting,
      )
      const prepared = await prepareDocument(ctx, 'manual_entry', values, {
        kind: 'devengar_sueldos',
        title: `Devengar ${mes}`,
        subtitle: 'Sueldos y jornales contra Sueldos a pagar',
        rows: [
          {
            label: 'Empleados',
            value: String(report.employees.filter((e) => e.salaryCents > 0).length),
          },
          { label: 'Fecha del asiento', value: dayText(endOfMonth(month)) ?? month },
        ],
        total: { label: 'Total', value: money(offer.totalCents) },
        confirmLabel: `Devengar ${mes}`,
      })
      return withExecutor(
        withTicketWarnings(prepared, [
          {
            key: 'accrual_once',
            title: `Los sueldos de ${mes} quedan fijos. Si la contadora ya los cargó en Libros, no lo hagas de nuevo.`,
            body: null,
          },
        ]),
        'gastos.devengar',
        { month },
      )
    },
  }),
]

export const gastosExecutors: Readonly<Record<string, TexExecutor>> = {
  'gastos.gasto_fijo': simpleExecutor(
    recurringPayload,
    (payload, ctx) => saveRecurringExpense(ctx.slug, payload),
    (data, _payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'gasto_fijo', { id: data.id })
      return { href: link.ok ? link.href : null }
    },
  ),

  'gastos.saltar': simpleExecutor(
    skipRecurringDueSchema,
    (payload, ctx) => skipRecurringDue(ctx.slug, payload),
    (data, _payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'gastos.fijos', { mes: monthOf(data.nextDueDate) })
      return { href: link.ok ? link.href : null, point: data.name }
    },
  ),

  'gastos.empleado': simpleExecutor(
    employeePayload,
    async (payload, ctx): Promise<AccSimpleState<{ id: string | null }>> => {
      let id = payload.employeeId
      let message = ''
      if (payload.employee) {
        const saved = await saveEmployee(ctx.slug, payload.employee)
        if (!saved.ok) return saved
        id = saved.data.id
        message = saved.message
      }
      if (payload.salary && id) {
        const salary = await saveEmployeeSalary(ctx.slug, { employeeId: id, ...payload.salary })
        if (!salary.ok) {
          return payload.employee
            ? { ...salary, message: `Se guardó el empleado, pero no el sueldo. ${salary.message}` }
            : salary
        }
        message = message || salary.message
      }
      return { ok: true, data: { id }, message }
    },
    (_data, payload, ctx) => ({
      href: sueldosHref(ctx, payload.salary?.month ?? monthOf(ctx.today)),
      point: payload.employee?.name ?? null,
    }),
  ),

  'gastos.movimiento_sueldo': {
    run: async (raw, ctx) => {
      const parsed = movementPayload.safeParse(raw)
      if (!parsed.success) return { ok: false, kind: 'failed', message: TICKET_BROKEN }
      const { values, previewHash, warningsAck, employeeId, employeeName, month, kind } =
        parsed.data
      // `postPayrollMovement` lo vuelve a validar con zod: acá solo se devuelve lo que armó el tique.
      const state = await postPayrollMovement(ctx.slug, {
        ...values,
        previewHash,
        warningsAck,
        employeeId,
        month,
        kind,
      } as unknown as PayrollMovementInput)
      return documentOutcome(state, parsed.data, {
        href: sueldosHref(ctx, month),
        point: employeeName,
      })
    },
  },

  'gastos.devengar': {
    run: async (raw, ctx) => {
      const parsed = accrualPayload.safeParse(raw)
      if (!parsed.success) return { ok: false, kind: 'failed', message: TICKET_BROKEN }
      const { values, previewHash, warningsAck, month } = parsed.data
      const state = await postPayrollAccrual(ctx.slug, {
        ...values,
        previewHash,
        warningsAck,
        month,
      } as unknown as PayrollAccrualInput)
      return documentOutcome(state, parsed.data, { href: sueldosHref(ctx, month), point: null })
    },
  },
}
