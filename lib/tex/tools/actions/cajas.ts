import 'server-only'

import { z } from 'zod'
import {
  BANK_OTHERS_MAX,
  BANK_ROWS,
  type BankAmountField,
  bankProgress,
  bookBlock,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/gasto-bancario/_lib/bank-rows'
import {
  type CountReason,
  countModeOf,
  countSubmitLabel,
  countVerdict,
  walletToExplain,
} from '@/components/administracion/acciones/ajustar-vista'
import {
  accountQuestion,
  MOTIVE_ACCOUNT,
  motiveStillValid,
  movementSubmitLabel,
  otherWarning,
  situations,
  voucherTotalLabel,
} from '@/components/administracion/acciones/movimiento-vista'
import { markTreasuryChecked } from '@/lib/accounting/actions/documents'
import { loadOpenItems, tryLoadPostingContext } from '@/lib/accounting/context'
import { getTreasuryCheck, type TreasuryCheck } from '@/lib/accounting/queries/forms'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { markTreasuryCheckedSchema } from '@/lib/accounting/schemas'
import { isSystemAccountKey } from '@/lib/accounting/system-keys'
import { bankTaxOf } from '@/lib/accounting/taxes'
import type { OpenItemRef, PostingContext, VatRateBp } from '@/lib/accounting/types'
import { isImputationAccount } from '@/lib/accounting/validate'
import { voucherDisplay } from '@/lib/accounting/voucher-types'
import { failureText, prepareDocument } from '../../document-action'
import type { TexTicketWarning } from '../../protocol'
import { resolveAccount, resolveParty, resolveTreasury } from '../../resolve'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  dayField,
  dayText,
  defineTool,
  money,
  pesosField,
  pesosToCents,
  type TexExecutor,
  type TexToolResult,
  zodIssuesText,
} from '../types'
import {
  type BankAmounts,
  type BankVoucher,
  bankExpenseTotalCents,
  bankExpenseValues,
  bankRate,
  bankVatCents,
  breakdownTotal,
  countDecision,
  countedBookCents,
  isCounterpartAccount,
  isPartnerAccount,
  MOVEMENT_KINDS,
  MOVEMENT_PAIRS,
  movementValues,
  systemBalanceText,
  treasuryAdjustmentValues,
  WALLET_BREAKDOWN_ROWS,
  walletBreakdown,
  walletCheckValues,
  withTicketWarnings,
} from './_caja-values'

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

const IVA_RATES: Readonly<Record<'21' | '10.5' | '27', VatRateBp>> = {
  '21': 2100,
  '10.5': 1050,
  '27': 2700,
}

/** El impuesto al cheque que el motor suma solo en el mismo envío, para decirlo en el tique. */
function bankTaxRows(
  cents: number,
  treasury: Parameters<typeof bankTaxOf>[1],
  posting: PostingContext,
): Array<{ label: string; value: string }> {
  const tax = bankTaxOf(cents, treasury, posting.settings.taxSettings)
  return tax > 0 ? [{ label: 'Impuesto al cheque', value: `${money(tax)}, se anota solo` }] : []
}

/** Las ventas en camino de una billetera, como las lee la hoja: con su abierto de hoy. */
async function walletItemsOf(
  tenantId: string,
  check: TreasuryCheck,
): Promise<Array<OpenItemRef & { methodName: string }>> {
  const pending = check.openWalletItems.filter((item) => item.openCents > 0)
  if (pending.length === 0) return []
  const refs = await loadOpenItems(tenantId, { lineIds: pending.map((item) => item.lineId) })
  const byId = new Map(refs.map((ref) => [ref.lineId, ref]))
  return pending.flatMap((item) => {
    const ref = byId.get(item.lineId)
    return ref && ref.openCents > 0 && ref.side === 'debit'
      ? [{ ...ref, methodName: item.method }]
      : []
  })
}

const COUNT_REASONS: Readonly<Record<'gastos_del_banco' | 'intereses' | 'otra', CountReason>> = {
  gastos_del_banco: 'bank_fees',
  intereses: 'interest',
  otra: 'other',
}

const REASON_WORDS: Readonly<Record<CountReason, string>> = {
  bank_fees: 'gastos_del_banco',
  interest: 'intereses',
  other: 'otra',
}

export const cajasActionTools = [
  defineTool({
    name: 'preparar_transferencia',
    description:
      'Prepara mover plata de una caja, banco o billetera a otra (depositar el efectivo, pasar de Mercado Pago al banco). No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      desde: z.string().min(1).describe('De dónde sale: el nombre de la caja o su id.'),
      hacia: z.string().min(1).describe('A dónde va: el nombre de la caja o su id.'),
      monto: pesosField('En pesos.'),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      nota: z.string().max(200).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando la transferencia',
    done: () => 'Preparé la transferencia',
    run: async (input, ctx) => {
      const from = await resolveTreasury(ctx, input.desde)
      if (!from.ok) return { kind: 'error', message: from.message }
      const to = await resolveTreasury(ctx, input.hacia)
      if (!to.ok) return { kind: 'error', message: to.message }
      const cents = pesosToCents(input.monto)
      const date = input.fecha ?? ctx.today
      return prepareDocument(
        ctx,
        'transfer',
        {
          fromTreasuryId: from.value.id,
          toTreasuryId: to.value.id,
          amountCents: cents,
          date,
          notes: input.nota ?? null,
        },
        {
          kind: 'transferencia',
          title: 'Mover plata',
          subtitle: `${from.value.name} → ${to.value.name}`,
          rows: [
            { label: 'Sale de', value: from.value.name },
            { label: 'Entra a', value: to.value.name },
            { label: 'Fecha', value: dayText(date) ?? date },
            ...(input.nota ? [{ label: 'Nota', value: input.nota }] : []),
          ],
          total: { label: 'Total', value: money(cents) },
          confirmLabel: 'Mover la plata',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_movimiento',
    description:
      'Prepara plata que entró o salió de una caja y no es venta, compra, gasto ni pago: un socio que sacó o puso, una seña, un préstamo, un rendimiento. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      que: z
        .enum(MOVEMENT_KINDS)
        .describe(
          'Qué pasó. otra_salida y otra_entrada, solo si no es ninguna de las otras y no es un gasto ni una venta.',
        ),
      caja: z
        .string()
        .min(1)
        .optional()
        .describe('De qué caja salió o a cuál entró: nombre o id. En «rindio» se puede omitir.'),
      monto: pesosField('En pesos.'),
      quien: z
        .string()
        .min(1)
        .optional()
        .describe('El socio, o con quién si la cuenta lo pide: nombre o id.'),
      cuenta: z
        .string()
        .min(1)
        .optional()
        .describe(
          'De qué es o en qué se fue: nombre o código. Hace falta en otra_salida y otra_entrada.',
        ),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      nota: z.string().max(280).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el movimiento',
    done: () => 'Preparé el movimiento',
    run: async (input, ctx) => {
      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const { direction, motive } = MOVEMENT_PAIRS[input.que]

      // Una tarjeta de la empresa no es una caja con plata: no entra acá.
      const usable = [...posting.treasuries.values()].filter(
        (t) => t.active && t.kind !== 'credit_card',
      )
      const parties = [...posting.parties.values()]
      const senas = parties.find((p) => p.systemKey === 'senas' && p.active) ?? null
      const available = situations({ treasuries: usable, hasDeposits: senas !== null })
      const picked = available.find((s) => s.direction === direction && s.motive === motive)
      if (!picked) {
        return fail(
          motive === 'mp_yield'
            ? 'El bar no tiene una billetera cargada: no hay nada que pueda rendir.'
            : 'Este bar no tiene el partícipe de señas. Preguntale cómo quiere anotar esa plata.',
        )
      }

      let treasuryId: string
      if (input.caja) {
        const found = await resolveTreasury(ctx, input.caja)
        if (!found.ok) return fail(found.message)
        treasuryId = found.value.id
      } else {
        const wallets = usable.filter((t) => t.kind === 'wallet')
        const only = motive === 'mp_yield' && wallets.length === 1 ? wallets[0] : undefined
        if (!only) {
          return fail(
            motive === 'mp_yield'
              ? `Preguntale qué billetera rindió: ${wallets.map((t) => t.name).join(', ')}.`
              : `Preguntale ${direction === 'out' ? 'de qué caja salió' : 'a qué caja entró'}: ${usable.map((t) => t.name).join(', ')}.`,
          )
        }
        treasuryId = only.id
      }
      const treasury = posting.treasuries.get(treasuryId)
      if (!treasury || treasury.kind === 'credit_card') {
        return fail(
          'Una tarjeta de la empresa no es una caja con plata: esto se anota en una caja, un banco o una billetera.',
        )
      }
      if (!motiveStillValid(direction, motive, treasury.kind, available)) {
        return fail(`«${treasury.name}» no es una billetera: lo que rinde es una billetera.`)
      }

      // La cuenta que le corresponde a cada situación; con «otra», la dice la persona.
      const suggested = MOTIVE_ACCOUNT[motive]
      let account = suggested && isSystemAccountKey(suggested) ? posting.sys[suggested] : null
      if (input.cuenta) {
        const found = await resolveAccount(ctx, input.cuenta)
        if (!found.ok) return fail(found.message)
        account = posting.accounts.get(found.value.id) ?? null
      }
      if (!account) {
        return fail(
          `Preguntale ${accountQuestion(direction)} ${otherWarning(direction, motive) ?? ''}`.trim(),
        )
      }
      if (!isCounterpartAccount(account)) {
        return fail(
          `«${account.name}» no se puede usar acá: no puede ser una cuenta de caja ni de IVA. Elegí otra con buscar_cuenta.`,
        )
      }

      let partyId: string | null = null
      let partyName: string | null = null
      if (account.requiresParty) {
        if (motive === 'deposit_received' && senas) {
          partyId = senas.id
          partyName = senas.tradeName ?? senas.name
        } else {
          const partner = isPartnerAccount(account)
          if (!input.quien) return fail(partner ? 'Preguntale qué socio.' : 'Preguntale con quién.')
          const found = await resolveParty(ctx, input.quien, partner ? ['partner'] : undefined)
          if (!found.ok) return fail(found.message)
          if (!partner && posting.parties.get(found.value.id)?.systemKey) {
            return fail(
              `«${found.value.name}» es un partícipe del sistema: no se elige acá. Preguntale con quién fue.`,
            )
          }
          partyId = found.value.id
          partyName = found.value.name
        }
      }

      const cents = pesosToCents(input.monto)
      const date = input.fecha ?? ctx.today
      return prepareDocument(
        ctx,
        'cash_movement',
        movementValues({
          kind: input.que,
          treasuryId: treasury.id,
          account,
          partyId,
          cents,
          date,
          note: input.nota,
        }),
        {
          kind: 'movimiento',
          title: picked.what,
          subtitle: treasury.name,
          rows: [
            ...(partyName ? [{ label: 'Quién', value: partyName }] : []),
            ...(motive === 'other'
              ? [{ label: direction === 'in' ? 'De qué' : 'En qué', value: account.name }]
              : []),
            { label: 'Fecha', value: dayText(date) ?? date },
            ...(direction === 'out' ? bankTaxRows(cents, treasury, posting) : []),
            ...(input.nota ? [{ label: 'Nota', value: input.nota }] : []),
          ],
          total: { label: voucherTotalLabel(direction, treasury.name), value: money(cents) },
          confirmLabel: movementSubmitLabel(direction, money(cents)),
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_gasto_bancario',
    description:
      'Prepara las comisiones e impuestos que debitó solo el banco, la billetera o la tarjeta, copiados del resumen. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      caja: z.string().min(1).describe('El banco, billetera o tarjeta: nombre o id.'),
      comisiones: pesosField('Comisiones y mantenimiento, sin el IVA: se suma solo.').optional(),
      iva: z
        .enum(['21', '10.5', '27'])
        .optional()
        .describe('IVA de las comisiones. Por defecto, 21.'),
      cheque_debitos: pesosField(
        'Impuesto al cheque sobre lo que salió (Ley 25.413 débitos).',
      ).optional(),
      cheque_creditos: pesosField(
        'Impuesto al cheque sobre lo que entró (Ley 25.413 créditos).',
      ).optional(),
      ingresos_brutos: pesosField('Ingresos Brutos (SIRCREB, retención IIBB).').optional(),
      intereses: pesosField('Intereses.').optional(),
      percepcion_iva: pesosField('IVA cobrado por adelantado (percepción RG 2408).').optional(),
      comisiones_sin_iva: pesosField('Comisiones que el resumen no grava con IVA.').optional(),
      otros: z
        .array(z.object({ cuenta: z.string().min(1), monto: pesosField() }))
        .max(BANK_OTHERS_MAX)
        .optional()
        .describe('Otros conceptos: la cuenta (nombre o código) y el importe.'),
      comprobante: z
        .object({
          tipo: z.enum(['resumen_bancario', 'factura_a', 'otro_comprobante']),
          punto_de_venta: z.number().int().min(0).max(99999),
          numero: z.number().int().min(1).max(99_999_999),
        })
        .optional()
        .describe('Solo si tiene el comprobante del banco: así se recupera el IVA.'),
      total_resumen: pesosField('El total que dice el resumen, para controlar la suma.').optional(),
      fecha: dayField('La del resumen o la del último débito. Si no la dijo, hoy.').optional(),
      nota: z.string().max(1000).optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando los gastos del banco',
    done: () => 'Preparé los gastos del banco',
    run: async (input, ctx) => {
      const found = await resolveTreasury(ctx, input.caja)
      if (!found.ok) return fail(found.message)
      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const treasury = posting.treasuries.get(found.value.id)
      // El efectivo no tiene débitos del banco: bancos, billeteras, tarjetas y otras cuentas.
      if (!treasury || treasury.kind === 'cash') {
        return fail(
          `«${found.value.name}» es efectivo: no tiene débitos del banco. Preguntale de qué banco o billetera fue.`,
        )
      }

      const amounts: BankAmounts = {}
      const said: ReadonlyArray<[BankAmountField, number | undefined]> = [
        ['feesNetCents', input.comisiones],
        ['ley25413DebitCents', input.cheque_debitos],
        ['ley25413CreditCents', input.cheque_creditos],
        ['sircrebCents', input.ingresos_brutos],
        ['interestCents', input.intereses],
        ['vatPerceptionCents', input.percepcion_iva],
        ['feesNoVatCents', input.comisiones_sin_iva],
      ]
      for (const [field, pesos] of said) {
        if (pesos !== undefined) amounts[field] = pesosToCents(pesos)
      }

      const others: Array<{ accountId: string; amountCents: number; name: string }> = []
      for (const other of input.otros ?? []) {
        const account = await resolveAccount(ctx, other.cuenta)
        if (!account.ok) return fail(account.message)
        const ref = posting.accounts.get(account.value.id)
        if (!ref || !isImputationAccount(ref)) {
          return fail(`«${account.value.name}» no se puede usar como concepto. Elegí otra cuenta.`)
        }
        others.push({
          accountId: account.value.id,
          amountCents: pesosToCents(other.monto),
          name: account.value.name,
        })
      }

      const voucher: BankVoucher | null = input.comprobante
        ? {
            voucherType: input.comprobante.tipo,
            pointOfSale: input.comprobante.punto_de_venta,
            number: input.comprobante.numero,
          }
        : null
      if (voucher) {
        const block = bookBlock({
          hasTreasury: true,
          bankHasCuit: Boolean(
            treasury.bankPartyId && posting.parties.get(treasury.bankPartyId)?.taxId,
          ),
          feesNetCents: amounts.feesNetCents ?? null,
        })
        if (block === 'no_cuit') {
          return fail(
            'Falta el CUIT del banco para recuperar el IVA: se carga en Ajustes › Medios de cobro. Ofrecele cargarlo sin el comprobante.',
          )
        }
        if (block === 'no_fees') {
          return fail(
            'No cargaste comisiones con IVA: no hay IVA para recuperar. Cargalo sin el comprobante.',
          )
        }
      }

      const rate = bankRate(voucher, input.iva ? IVA_RATES[input.iva] : 2100)
      const total = bankExpenseTotalCents({ amounts, vatRateBp: rate, others })
      if (input.total_resumen !== undefined) {
        const progress = bankProgress(total, pesosToCents(input.total_resumen), money)
        if (progress.kind !== 'match') {
          return fail(
            `No coincide con el total del resumen. ${progress.text} Preguntale qué falta.`,
          )
        }
      }

      const date = input.fecha ?? ctx.today
      const vat = bankVatCents(amounts.feesNetCents ?? 0, rate)
      return prepareDocument(
        ctx,
        'bank_expense',
        bankExpenseValues({
          treasuryId: treasury.id,
          date,
          amounts,
          vatRateBp: rate,
          voucher,
          others: others.map(({ accountId, amountCents }) => ({ accountId, amountCents })),
          note: input.nota,
        }),
        {
          kind: 'gasto_bancario',
          title: 'Gastos del banco',
          subtitle: `${treasury.name} · ${dayText(date) ?? date}`,
          rows: [
            ...BANK_ROWS.flatMap((row) => {
              const value = amounts[row.field]
              if (value === undefined || value <= 0) return []
              const line = { label: row.label, value: money(value) }
              return row.field === 'feesNetCents' && vat > 0
                ? [line, { label: `IVA ${vatRateLabel(rate)}`, value: money(vat) }]
                : [line]
            }),
            ...others.map((o) => ({ label: o.name, value: money(o.amountCents) })),
            ...(voucher
              ? [
                  {
                    label: 'Comprobante',
                    value: voucherDisplay(voucher.voucherType, voucher.pointOfSale, voucher.number),
                  },
                ]
              : []),
            ...(input.nota ? [{ label: 'Nota', value: input.nota }] : []),
          ],
          total: { label: 'Total debitado', value: money(total) },
          confirmLabel: 'Guardar gastos del banco',
        },
      )
    },
  }),

  defineTool({
    name: 'preparar_arqueo',
    description:
      'Prepara contar una caja, banco, billetera o tarjeta: compara lo que hay con lo que dice el sistema y deja la diferencia anotada o la caja verificada. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      caja: z.string().min(1).describe('Qué caja contó: nombre o id.'),
      hay: z
        .number()
        .min(-100_000_000_000)
        .max(100_000_000_000)
        .describe('Cuánto hay de verdad, en pesos. En la tarjeta de la empresa, lo que debe.'),
      fecha: dayField('Fecha del conteo yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      motivo: z
        .enum(['gastos_del_banco', 'intereses', 'otra'])
        .optional()
        .describe('Por qué hay diferencia, si el tique lo pregunta (bancos y otras cuentas).'),
      ventas_en_camino: z
        .enum(['entraron', 'no_entraron'])
        .optional()
        .describe('Solo billeteras: si las ventas en camino ya entraron todas o todavía ninguna.'),
      descuentos: z
        .object({
          comision: pesosField().optional(),
          iva_comision: pesosField().optional(),
          ingresos_brutos: pesosField().optional(),
          otros: pesosField().optional(),
          certificado: z.string().max(40).optional(),
        })
        .optional()
        .describe('Solo billeteras, si tiene el reporte: lo que se quedó. Si no, se estima.'),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando el conteo',
    done: () => 'Preparé el conteo',
    run: async (input, ctx) => {
      const found = await resolveTreasury(ctx, input.caja)
      if (!found.ok) return fail(found.message)
      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const treasury = posting.treasuries.get(found.value.id)
      if (!treasury) return fail(`No encontré «${found.value.name}». Mirá las cajas con ver_cajas.`)

      const date = input.fecha ?? ctx.today
      if (date > ctx.today) return fail('La fecha del conteo no puede ser futura: preguntale cuál.')
      const check = await getTreasuryCheck(ctx.tenantId, { treasuryId: treasury.id, asOf: date })
      if (!check) return fail(`No pude leer el saldo de «${treasury.name}».`)

      const name = treasury.name
      const mode = countModeOf(treasury)
      const counted = pesosToCents(input.hay)
      const countedBook = countedBookCents(mode, counted)
      const book = check.bookCents

      const items = mode === 'wallet' ? await walletItemsOf(ctx.tenantId, check) : []
      const pendingAll = items.reduce((sum, item) => sum + item.openCents, 0)
      if (items.length > 0 && input.ventas_en_camino === undefined) {
        return fail(
          `${name} tiene ${items.length === 1 ? '1 venta' : `${items.length} ventas`} en camino por ${money(pendingAll)}. Preguntale si ya entraron todas o todavía ninguna y mandalo en ventas_en_camino. Si entró solo una parte, llevalo a caja.cuenta con ir_a: ahí se destildan.`,
        )
      }
      const ticked = input.ventas_en_camino === 'entraron' ? items : []
      const pendingTicked = ticked.reduce((sum, item) => sum + item.openCents, 0)

      const decision = countDecision({
        mode,
        bookCents: book,
        countedBook,
        ticked: ticked.length,
        reason: input.motivo ? COUNT_REASONS[input.motivo] : null,
      })
      const { diff, plan, reason, options } = decision
      const verdict = countVerdict({
        mode,
        name,
        diff,
        countedCents: counted,
        ticked: ticked.length,
        pendingTicked,
        countedOn: date !== ctx.today ? date : null,
      })
      const rows = [
        { label: 'El sistema dice', value: systemBalanceText(mode, book) },
        { label: mode === 'card' ? 'Debés' : 'Hay', value: money(counted) },
        { label: 'Fecha del conteo', value: dayText(date) ?? date },
      ]
      const head = { kind: 'arqueo', title: `Contar ${name}`, subtitle: verdict.sentence }
      const lastCounted = check.lastCheckedOn ?? check.lastAdjustmentDate
      const warnings: TexTicketWarning[] = [
        ...(verdict.note ? [{ key: 'count_note', title: verdict.note, body: null }] : []),
        ...(!lastCounted && book === 0 && mode !== 'card' && pendingAll === 0
          ? [
              {
                key: 'first_count',
                title: '¿Es la primera vez?',
                body: 'Si todavía no cargaste lo que había al arrancar, hacelo primero: contada ahora, toda la plata quedaría como sobrante.',
              },
            ]
          : []),
      ]

      if (plan === 'check') {
        const parsed = markTreasuryCheckedSchema.safeParse({
          treasuryAccountId: treasury.id,
          countedCents: countedBook,
          expectedBookCents: book,
          asOf: date,
        })
        if (!parsed.success) return fail(zodIssuesText(parsed.error))
        return {
          kind: 'prepared',
          prepared: {
            executor: 'cajas.arqueo_coincide',
            payload: parsed.data,
            ticket: {
              ...head,
              rows,
              total: { label: 'Resultado', value: 'Coincide' },
              entry: [],
              warnings: [],
              confirmLabel: countSubmitLabel('check', 0),
            },
          },
        }
      }

      if (plan === 'bank_fees') {
        return fail(
          `Son gastos del banco: cargalos con preparar_gasto_bancario en ${name}, con total_resumen ${money(Math.abs(diff))}. Después se vuelve a contar y tiene que coincidir.`,
        )
      }

      const resultTotal = verdict.label
        ? { label: verdict.label, value: money(Math.abs(diff)) }
        : null

      if (plan === 'adjust') {
        if (reason === null) {
          return fail(
            `En ${name} hay una diferencia de ${money(Math.abs(diff))}: el sistema dice ${systemBalanceText(mode, book)} y hay ${money(counted)}. Preguntale por qué y mandalo en motivo: ${options
              .map((o) => `${REASON_WORDS[o.value]} (${o.title})`)
              .join(', ')}.`,
          )
        }
        const prepared = await prepareDocument(
          ctx,
          'treasury_adjustment',
          treasuryAdjustmentValues({
            treasuryId: treasury.id,
            date,
            countedBook,
            bookCents: book,
            reason,
            interestAccountId: posting.sys.interest_income.id,
          }),
          {
            ...head,
            rows,
            total: resultTotal,
            confirmLabel: countSubmitLabel('adjust', 0),
          },
        )
        return withTicketWarnings(prepared, warnings)
      }

      // Billetera: lo mismo que «Ajustar saldo de Mercado Pago».
      if (ticked.length > 0 && diff < 0) {
        return fail(
          'Hay menos plata que antes: que revise el número o, si todavía no le entró, mandá ventas_en_camino no_entraron. Si pagó algo desde ahí, primero se carga ese gasto.',
        )
      }
      if (ticked.length > 0 && diff === 0) {
        return fail(
          'La app dice lo mismo que el sistema: no entró nada. Si es así, mandá ventas_en_camino no_entraron.',
        )
      }
      const said = input.descuentos
      const breakdown = walletBreakdown(
        check.estimates,
        said
          ? {
              ...(said.comision !== undefined ? { comision: pesosToCents(said.comision) } : {}),
              ...(said.iva_comision !== undefined
                ? { iva_comision: pesosToCents(said.iva_comision) }
                : {}),
              ...(said.ingresos_brutos !== undefined
                ? { sircupa: pesosToCents(said.ingresos_brutos) }
                : {}),
              ...(said.otros !== undefined ? { otro: pesosToCents(said.otros) } : {}),
            }
          : null,
      )
      const explained = breakdownTotal(breakdown)
      const kept = ticked.length > 0 ? pendingTicked - diff : null
      if (kept !== null && kept >= 0 && explained > kept) {
        return fail(
          `Los descuentos (${money(explained)}) son más de lo que se quedó ${name} (${money(kept)}). Pedile los importes del reporte y mandalos en descuentos.`,
        )
      }
      const toExplain = walletToExplain({ diff, ticked: ticked.length, pendingTicked })
      const unexplained = toExplain !== null ? toExplain - explained : null
      const prepared = await prepareDocument(
        ctx,
        'wallet_check',
        walletCheckValues({
          treasuryId: treasury.id,
          date,
          countedBook,
          bookCents: book,
          items: ticked,
          breakdown,
          certificate: said?.certificado,
          otherFeesAccountId: posting.sys.fees_other.id,
        }),
        {
          ...head,
          rows: [
            ...rows,
            ...(ticked.length > 0
              ? [
                  {
                    label:
                      ticked.length === 1
                        ? '1 venta en camino'
                        : `${ticked.length} ventas en camino`,
                    value: money(pendingTicked),
                  },
                ]
              : []),
            ...(ticked.length > 0 || diff < 0
              ? WALLET_BREAKDOWN_ROWS.flatMap((row) => {
                  const amount = breakdown[row.key]
                  return amount !== null && amount > 0
                    ? [{ label: row.label, value: money(amount) }]
                    : []
                })
              : []),
          ],
          total: resultTotal,
          confirmLabel: countSubmitLabel('wallet', ticked.length),
        },
      )
      return withTicketWarnings(prepared, [
        ...warnings,
        ...(unexplained !== null && unexplained > 0
          ? [
              {
                key: 'wallet_unexplained',
                title: `Quedan ${money(unexplained)} sin explicar: van aparte para que los revise la contadora.`,
                body: null,
              },
            ]
          : []),
      ])
    },
  }),
]

export const cajasExecutors: Readonly<Record<string, TexExecutor>> = {
  'cajas.arqueo_coincide': simpleExecutor(
    markTreasuryCheckedSchema,
    (payload, ctx) => markTreasuryChecked(ctx.slug, payload),
    (_data, payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'caja.cuenta', { id: payload.treasuryAccountId })
      return { href: link.ok ? link.href : null }
    },
  ),
}
