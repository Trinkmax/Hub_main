import 'server-only'

import { z } from 'zod'
import { voidNotes } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-story'
import {
  appliedByOthers,
  documentActions,
} from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-view'
import { ivaExpectedFrom } from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva'
import {
  monthNoun,
  monthPeriods,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/months'
import { resolveBookMonth } from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/periods'
import {
  balanceMessage,
  type EntryLine,
  entryTotals,
  validateEntry,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_lib/manual-entry'
import { closeLines } from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/close-lines'
import {
  closeReview,
  ivaClosePlan,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/review'
import { invalidState } from '@/lib/accounting/action-state'
import { reverseDocument, voidDocument } from '@/lib/accounting/actions/documents'
import { closePeriod, reopenPeriod } from '@/lib/accounting/actions/periods'
import { reimputeLine } from '@/lib/accounting/actions/reimpute'
import { saveTaxSettings } from '@/lib/accounting/actions/taxes'
import { trialAnomalies } from '@/lib/accounting/anomalies'
import { tryLoadPostingContext } from '@/lib/accounting/context'
import { listAccounts } from '@/lib/accounting/queries/accounts'
import {
  getAccountSystemKeys,
  getPayrollMonthStatus,
  getTrialBalance,
} from '@/lib/accounting/queries/books'
import { getDocumentOrigin } from '@/lib/accounting/queries/document-origin'
import {
  type DocumentDetail,
  type DocumentLink,
  getDailyCloseCalendar,
  getDocument,
  getRecurringExpense,
} from '@/lib/accounting/queries/documents'
import { searchKey } from '@/lib/accounting/queries/parties'
import {
  type CloseChecklist,
  getCloseChecklist,
  listFiscalYears,
} from '@/lib/accounting/queries/periods'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  isReimputeTarget,
  REIMPUTE_CLOSED_MESSAGE,
  reimputeSchema,
  reimputeTargets,
} from '@/lib/accounting/reimpute'
import {
  closePeriodSchema,
  reopenSchema,
  reverseSchema,
  voidDocumentSchema,
} from '@/lib/accounting/schemas'
import { loadDocumentContext, loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import {
  parseDocumentForm,
  previewDocumentForm,
  withPreviewMeta,
} from '@/lib/accounting/server/document-forms'
import { DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import { getArcaVoucherCard } from '@/lib/arca/emit-queries'
import { addMonthsToYearMonth, endOfMonth, formatMonthLabel, monthOf } from '@/lib/dates'
import { documentExecutor, entryLines, failureText, ticketWarnings } from '../../document-action'
import type { TexTicketWarning } from '../../protocol'
import { resolveAccount, resolveParty } from '../../resolve'
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
  type TexExecutor,
  type TexTicketDraft,
  type TexToolContext,
  type TexToolResult,
  zodIssuesText,
} from '../types'
import {
  appliedText,
  appliedWordOf,
  bundleText,
  closePeriodValues,
  closeTicketWarnings,
  ENTRY_KIND_TITLE,
  ENTRY_KIND_WORDS,
  manualEntryFormValues,
  nextTaxSettings,
  pickReimputeTarget,
  reversalDate,
  reversalIvaText,
  TAX_BASE_WORDS,
  taxChangeRows,
  taxSettingsPayload,
} from './_contabilidad-values'

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

const CLOSES_SCREEN = 'Llevalo a libros.cierres con ir_a.'

/**
 * Un id de un comprobante o renglón. Sin `z.uuid()`: su patrón gasta tokens en cada pedido y la forma
 * exacta ya la controla el esquema de cada acción.
 */
const idField = (description: string) =>
  z
    .string()
    .regex(/^[0-9a-f-]{36}$/i)
    .describe(description)

/** Lo que se mira de un comprobante con ARCA: una factura ya emitida no se anula desde los libros. */
const ARCA_KINDS: ReadonlySet<string> = new Set([
  'sales_invoice',
  'sales_debit_note',
  'sales_credit_note',
])

function linkText(doc: DocumentLink): string {
  return `${doc.title} #${doc.seq}`
}

function comprobanteHref(ctx: TexToolContext, id: string | null | undefined): string | null {
  const link = texScreenHref(ctx.slug, 'comprobante', { id })
  return link.ok ? link.href : null
}

function cierresHref(ctx: TexToolContext): string | null {
  const link = texScreenHref(ctx.slug, 'libros.cierres')
  return link.ok ? link.href : null
}

async function emittedWithArca(tenantId: string, documentId: string): Promise<boolean> {
  const card = await settleQuery(getArcaVoucherCard(tenantId, documentId))
  return (
    card.ok &&
    card.data?.environment === 'produccion' &&
    (card.data.status === 'posted' || card.data.status === 'authorized')
  )
}

/**
 * La vista previa del asiento armada con el acceso de quien lo carga. `prepareDocument` no sirve acá:
 * pide acceso de carga y la contadora no lo tiene (`runPreviewDocument`), aunque sí puede grabar
 * asientos (`runPostDocument` y la base). El asiento, el hash y los avisos son los del mismo motor.
 */
async function prepareManualEntry(
  ctx: TexToolContext,
  values: Record<string, unknown>,
  ticket: Omit<TexTicketDraft, 'entry' | 'warnings'>,
  extraWarnings: readonly TexTicketWarning[],
): Promise<TexToolResult> {
  const withRef = { ...values, clientRef: crypto.randomUUID() }
  const parsed = parseDocumentForm('manual_entry', withPreviewMeta(withRef))
  if (!parsed.ok) return fail(failureText(invalidState(parsed.error)))
  const loaded = await loadDocumentContext(ctx.tenantId, parsed.value.refs)
  if (!loaded.ok) return fail(failureText(loaded.state))
  const state = previewDocumentForm('manual_entry', withRef, loaded.ctx, {
    firstOpenDate: loaded.firstOpenDate,
  })
  if (!state.ok) return fail(failureText(state))
  return {
    kind: 'prepared',
    prepared: {
      executor: 'contabilidad.asiento',
      payload: {
        form: 'manual_entry',
        values: withRef,
        previewHash: state.hash,
        warningsAck: state.warnings.map((w) => w.key),
      },
      ticket: {
        ...ticket,
        entry: entryLines(state.preview),
        warnings: [...ticketWarnings(state.warnings), ...extraWarnings],
      },
    },
  }
}

/** Lo mismo que lee la pantalla del cierre para decir qué falta mirar. */
async function closeSnapshot(ctx: TexToolContext, mes: string, checklist: CloseChecklist) {
  const period = resolveBookMonth({ mes }, ctx.today)
  const [calendar, trial, systemKeys, payroll, settings] = await Promise.all([
    settleQuery(getDailyCloseCalendar(ctx.tenantId, mes)),
    period.ok
      ? settleQuery(getTrialBalance(ctx.tenantId, { from: period.from, to: period.to }))
      : null,
    settleQuery(getAccountSystemKeys(ctx.tenantId)),
    settleQuery(getPayrollMonthStatus(ctx.tenantId, mes)),
    settleQuery(getAccountingSettings(ctx.tenantId)),
  ])
  const base = `/${ctx.slug}/administracion`
  const review = closeReview({
    month: mes,
    base,
    finished: (checklist.endsOn ?? endOfMonth(mes)) < ctx.today,
    canWrite: true,
    checklist,
    today: ctx.today,
    calendar: calendar.ok ? calendar.data : null,
    settings:
      settings.ok && settings.data
        ? { openingStatus: settings.data.openingStatus, cuit: settings.data.cuit }
        : null,
  })
  const plan = ivaClosePlan(checklist.iva, mes)
  const iva =
    plan.settles && checklist.iva
      ? { expected: ivaExpectedFrom(checklist.iva), optional: !plan.replaces }
      : null
  const anomalies = trial?.ok
    ? trialAnomalies(trial.data.rows, systemKeys.ok ? systemKeys.data : new Map())
    : null
  const lines = closeLines({
    month: mes,
    base,
    trial: trial?.ok
      ? { balanced: trial.data.balanced, differenceCents: trial.data.differenceCents }
      : null,
    oddAccounts: anomalies ? anomalies.size : null,
    review,
    payroll: payroll.ok ? payroll.data : null,
    iva: null,
    closed: false,
  })
  return { plan, iva, lines }
}

const voidPayload = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('void'), values: voidDocumentSchema }),
  z.object({ mode: z.literal('reverse'), values: reverseSchema }),
])

const closePayload = closePeriodSchema

export const contabilidadActionTools = [
  defineTool({
    name: 'preparar_asiento',
    description:
      'Prepara un asiento manual con Debe y Haber, para un ajuste o lo que no entra en ningún comprobante. No guarda nada: muestra un tique con el asiento para confirmar. Si no cuadra, no se arma.',
    input: z.object({
      concepto: z.string().min(1).max(200).describe('El concepto del asiento.'),
      respaldo: z
        .string()
        .min(1)
        .max(1000)
        .describe(
          'El papel que lo respalda: el contrato, el resumen, el n.º. Si no lo dijo, preguntale.',
        ),
      lineas: z
        .array(
          z.object({
            cuenta: z.string().min(1).describe('La cuenta: nombre, código o id.'),
            debe: pesosField('En pesos.').optional(),
            haber: pesosField('En pesos.').optional(),
            quien: z
              .string()
              .min(1)
              .optional()
              .describe('Proveedor, cliente o socio, si la cuenta lo pide: nombre o id.'),
            vence: dayField('Vencimiento, solo con proveedor o cliente.').optional(),
            leyenda: z.string().max(200).optional(),
          }),
        )
        .min(2)
        .max(60)
        .describe('Los renglones: cada uno en el Debe o en el Haber.'),
      fecha: dayField('Fecha yyyy-MM-dd. Si no la dijo, hoy.').optional(),
      tipo: z.enum(ENTRY_KIND_WORDS).optional().describe('Por defecto, ajuste.'),
      corrige: idField(
        'El id del comprobante de un mes cerrado que este ajuste corrige.',
      ).optional(),
    }),
    need: 'poster',
    mood: 'working',
    doing: () => 'Armando el asiento',
    done: () => 'Armé el asiento',
    run: async (input, ctx) => {
      const lines: EntryLine[] = input.lineas.map((line, index) => ({
        key: `l${index}`,
        accountId: null,
        debitCents: line.debe !== undefined ? pesosToCents(line.debe) : null,
        creditCents: line.haber !== undefined ? pesosToCents(line.haber) : null,
        partyId: null,
        dueDate: line.vence ?? null,
        memo: line.leyenda ?? '',
      }))
      // «El sistema no te debe permitir grabar» (Silvia): sin cuadrar, ni tique.
      const totals = entryTotals(lines)
      const unbalanced = balanceMessage(totals.debit, totals.credit)
      if (unbalanced) return fail(`${unbalanced} Preguntale qué renglón está mal.`)

      const accounts = new Map((await listAccounts(ctx.tenantId)).map((a) => [a.id, a]))
      const systemKeys: string[] = []
      for (const [index, said] of input.lineas.entries()) {
        const line = lines[index]
        if (!line) continue
        const found = await resolveAccount(ctx, said.cuenta)
        if (!found.ok) return fail(found.message)
        const account = accounts.get(found.value.id)
        if (!account?.manualSelectable) {
          return fail(`«${found.value.name}» no se usa en asientos manuales. Elegí otra.`)
        }
        line.accountId = account.id
        systemKeys.push(account.systemKey ?? '')
        if (account.requiresParty) {
          if (!said.quien) {
            return fail(`La cuenta «${account.name}» pide con quién: preguntale el nombre.`)
          }
          const party = await resolveParty(ctx, said.quien)
          if (!party.ok) return fail(party.message)
          line.partyId = party.value.id
        } else {
          line.dueDate = null
        }
      }

      const date = input.fecha ?? ctx.today
      const check = validateEntry({
        lines,
        date,
        description: input.concepto,
        backing: input.respaldo,
        requiresParty: (id) => (id ? (accounts.get(id)?.requiresParty ?? false) : false),
      })
      if (!check.ok) return fail(check.message)

      let corrects: DocumentDetail | null = null
      if (input.corrige) {
        corrects = await getDocument(ctx.tenantId, input.corrige)
        if (!corrects) return fail('No encontré ese comprobante.')
        if (corrects.status !== 'posted') {
          return fail('Ese comprobante está anulado: no hace falta ajustarlo.')
        }
        if (corrects.period?.status !== 'closed') {
          return fail('Ese comprobante es de un mes abierto: anulalo o corregilo desde su ficha.')
        }
      }

      const tipo = input.tipo ?? 'ajuste'
      return prepareManualEntry(
        ctx,
        manualEntryFormValues({
          kind: tipo,
          date,
          description: input.concepto,
          lines,
          correctsId: corrects?.id ?? null,
          backing: input.respaldo,
        }),
        {
          kind: 'asiento',
          title: ENTRY_KIND_TITLE[tipo],
          subtitle: null,
          rows: [
            { label: 'Concepto', value: input.concepto },
            { label: 'Fecha', value: dayText(date) ?? date },
            { label: 'Respaldo', value: input.respaldo },
            ...(corrects ? [{ label: 'Corrige', value: linkText(corrects) }] : []),
          ],
          total: { label: 'Total', value: money(Number(totals.debit)) },
          confirmLabel: 'Grabar el asiento',
        },
        systemKeys.some((key) => key.startsWith('vat_'))
          ? [
              {
                key: 'moves_vat',
                title:
                  'Este asiento mueve IVA, pero no entra al Libro IVA: ahí van solo los comprobantes.',
                body: null,
              },
            ]
          : [],
      )
    },
  }),

  defineTool({
    name: 'preparar_reimputacion',
    description:
      'Prepara cambiar la cuenta de un renglón de un comprobante de un mes abierto: no toca importes, proveedor ni IVA. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      comprobante: idField('El id del comprobante.'),
      cuenta_nueva: z.string().min(1).describe('A qué cuenta va: nombre, código o id.'),
      cuenta_actual: z
        .string()
        .min(1)
        .optional()
        .describe('Si tiene varios renglones: la cuenta que tiene ahora el que se cambia.'),
      renglon: idField('O el id del renglón, si lo tenés.').optional(),
      motivo: z.string().max(300).optional(),
    }),
    need: 'poster',
    mood: 'working',
    doing: () => 'Preparando el cambio de cuenta',
    done: () => 'Preparé el cambio de cuenta',
    run: async (input, ctx) => {
      const doc = await getDocument(ctx.tenantId, input.comprobante)
      if (!doc) return fail('No encontré ese comprobante.')
      if (doc.status !== 'posted') return fail('Ese comprobante está anulado.')
      if (doc.period?.status !== 'open') return fail(REIMPUTE_CLOSED_MESSAGE)

      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const posting = loaded.ctx
      const targets = reimputeTargets(doc, posting.accounts, [])
      if (targets.length === 0) {
        return fail(
          'Ese comprobante no tiene renglones para reimputar: las cajas, las partidas de proveedor y el IVA no se cambian.',
        )
      }
      const key = input.cuenta_actual ? searchKey(input.cuenta_actual) : null
      const pick = pickReimputeTarget(targets, {
        lineId: input.renglon,
        accountKey: key
          ? (name, code) => searchKey(name).includes(key) || code === input.cuenta_actual?.trim()
          : undefined,
      })
      if (!pick.ok) {
        return fail(
          `Tiene varios renglones: ${pick.options
            .map((t) => `${t.accountName} (${money(t.amountCents)})`)
            .join(', ')}. Preguntale cuál y mandá cuenta_actual.`,
        )
      }
      const { target } = pick

      const found = await resolveAccount(ctx, input.cuenta_nueva)
      if (!found.ok) return fail(found.message)
      const account = posting.accounts.get(found.value.id)
      if (!account || !isReimputeTarget(account)) {
        return fail(
          `A «${found.value.name}» no se puede reimputar: no puede ser una caja ni una cuenta de proveedores o clientes.`,
        )
      }
      if (account.id === target.accountId) {
        return fail(`Ese renglón ya está en «${account.name}».`)
      }

      const payload = reimputeSchema.safeParse({
        lineId: target.lineId,
        accountId: account.id,
        reason: input.motivo ?? null,
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'contabilidad.reimputar',
          payload: payload.data,
          ticket: {
            kind: 'reimputacion',
            title: 'Cambiar la cuenta',
            subtitle: linkText(doc),
            rows: [
              { label: 'De', value: target.accountName },
              { label: 'A', value: account.name },
              ...(input.motivo ? [{ label: 'Motivo', value: input.motivo }] : []),
            ],
            total: { label: 'Importe', value: money(target.amountCents) },
            entry: [],
            warnings: [],
            confirmLabel: 'Cambiar la cuenta',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_anulacion',
    description:
      'Prepara anular un comprobante cargado por error: si el mes está cerrado, con una anulación con fecha de un mes abierto. Una devolución o un descuento no se anulan: van con nota de crédito. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      comprobante: idField('El id del comprobante.'),
      motivo: z
        .string()
        .min(5)
        .max(300)
        .describe('Por qué, al menos 5 letras: lo ve la contadora. Si no lo dijo, preguntale.'),
      fecha: dayField('Solo mes cerrado: la fecha de la anulación. Si no la dijo, hoy.').optional(),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando la anulación',
    done: () => 'Preparé la anulación',
    run: async (input, ctx) => {
      const doc = await getDocument(ctx.tenantId, input.comprobante)
      if (!doc) return fail('No encontré ese comprobante.')
      if (doc.status !== 'posted') return fail('Ese comprobante ya está anulado.')
      if (doc.reversedBy?.status === 'posted') {
        return fail(`Ese comprobante ya se anuló con ${linkText(doc.reversedBy)}.`)
      }

      const base = documentActions(doc, true)
      if (ARCA_KINDS.has(doc.kind) && (await emittedWithArca(ctx.tenantId, doc.id))) {
        return fail(
          `${doc.title} ya está en ARCA: no se anula desde acá, se corrige emitiendo una nota de crédito, también con ARCA. Llevalo a la ficha del comprobante con ir_a.`,
        )
      }
      if (base.void && !ARCA_KINDS.has(doc.kind)) {
        for (const sibling of doc.bundleSiblings) {
          if (
            sibling.status === 'posted' &&
            ARCA_KINDS.has(sibling.kind) &&
            (await emittedWithArca(ctx.tenantId, sibling.id))
          ) {
            return fail(
              `Se cargó junto con ${linkText(sibling)}, que ya está en ARCA: anularlo anularía esa factura. Se corrige con una nota de crédito desde su ficha.`,
            )
          }
        }
      }
      if (!base.void && !base.reverse) {
        return fail(
          doc.period?.status === 'closed'
            ? 'Ese comprobante no se anula con fecha de hoy: lo corrige la contadora con un asiento de ajuste.'
            : 'Ese comprobante no se anula: se deshace reabriendo el mes. Llevalo a libros.cierres con ir_a.',
        )
      }

      const appliedCents = appliedByOthers(doc.kind)
        ? doc.allocations.reduce((sum, a) => (a.voidedOn ? sum : sum + a.amountCents), 0)
        : null
      const unallocate = Boolean(appliedCents && appliedCents > 0)
      const siblings = doc.bundleSiblings.filter((s) => s.status === 'posted').map(linkText)
      const [recurring, origin] = await Promise.all([
        doc.recurringExpenseId
          ? settleQuery(getRecurringExpense(ctx.tenantId, doc.recurringExpenseId))
          : null,
        settleQuery(getDocumentOrigin(ctx.tenantId, doc.id)),
      ])
      const notes = voidNotes(doc, {
        recurring: !doc.recurringExpenseId ? undefined : recurring?.ok ? recurring.data : 'error',
        origin: origin.ok ? origin.data : null,
      })
      const applied = appliedText(appliedCents, appliedWordOf(doc.kind))

      const rows = [
        { label: 'Fecha', value: dayText(doc.accountingDate) ?? doc.accountingDate },
        { label: 'Motivo', value: input.motivo },
      ]
      const total = { label: 'Total', value: money(doc.totalCents) }

      if (base.void) {
        const values = voidDocumentSchema.safeParse({
          documentId: doc.id,
          reason: input.motivo,
          withBundle: siblings.length > 0,
          unallocate,
        })
        if (!values.success) return fail(zodIssuesText(values.error))
        return {
          kind: 'prepared',
          prepared: {
            executor: 'contabilidad.anular',
            payload: { mode: 'void', values: values.data },
            ticket: {
              kind: 'anulacion',
              title: 'Anular',
              subtitle: linkText(doc),
              rows,
              total,
              entry: [],
              warnings: textWarnings([bundleText(siblings), applied, ...notes]),
              confirmLabel: 'Anular',
            },
          },
        }
      }

      const [firstOpenDate, settings] = await Promise.all([
        loadFirstOpenDate(ctx.tenantId),
        settleQuery(getAccountingSettings(ctx.tenantId)),
      ])
      const when = reversalDate({
        wanted: input.fecha,
        today: ctx.today,
        firstOpenDate,
        documentDate: doc.accountingDate,
      })
      if (!when.ok) return fail(when.message)
      const values = reverseSchema.safeParse({
        clientRef: crypto.randomUUID(),
        documentId: doc.id,
        reason: input.motivo,
        reversalDate: when.date,
        unallocate,
      })
      if (!values.success) return fail(zodIssuesText(values.error))
      const ivaText = reversalIvaText({
        hasFiscal: doc.fiscalVouchers.some((v) => !v.voided),
        ivaMode: settings.ok && settings.data ? settings.data.closedPeriodVoidIvaMode : null,
        date: when.date,
      })
      return {
        kind: 'prepared',
        prepared: {
          executor: 'contabilidad.anular',
          payload: { mode: 'reverse', values: values.data },
          ticket: {
            kind: 'anulacion',
            title: 'Anular con fecha de hoy',
            subtitle: linkText(doc),
            rows: [
              ...rows,
              { label: 'Se anula con fecha', value: dayText(when.date) ?? when.date },
            ],
            total,
            entry: [],
            warnings: textWarnings([
              `${formatMonthLabel(doc.accountingDate)} está cerrado y no cambia: se carga la anulación, el mismo comprobante al revés.`,
              ivaText,
              applied,
              ...notes,
            ]),
            confirmLabel: 'Anular',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_cierre_de_mes',
    description:
      'Prepara cerrar un mes que ya terminó: el tique dice los avisos que quedan y el IVA que se anota; después no se puede cargar nada con esa fecha. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      mes: monthField('Qué mes, yyyy-MM.'),
      anotar_iva: z
        .boolean()
        .optional()
        .describe('false solo si pide cerrar sin anotar el IVA del mes. Por defecto, se anota.'),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Revisando el cierre del mes',
    done: () => 'Revisé el cierre del mes',
    run: async (input, ctx) => {
      const checklist = await getCloseChecklist(ctx.tenantId, input.mes)
      const noun = monthNoun(input.mes)
      if (checklist.status === 'closed') return fail(`${noun} ya está cerrado.`)
      if (!checklist.canClose) {
        const blockers = checklist.blockers.map((b) => b.label).join(' ')
        return fail(
          `${noun} todavía no se puede cerrar. ${blockers || 'Falta algo antes de cerrarlo.'} ${CLOSES_SCREEN}`,
        )
      }
      const { plan, iva, lines } = await closeSnapshot(ctx, input.mes, checklist)
      const values = closePeriodSchema.safeParse(
        closePeriodValues({
          month: checklist.month,
          warningKeys: checklist.warningKeys,
          iva,
          generate: input.anotar_iva ?? true,
        }),
      )
      if (!values.success) return fail(zodIssuesText(values.error))
      const settles = values.data.ivaSettlement.generate
      const next = monthNoun(addMonthsToYearMonth(input.mes, 1))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'contabilidad.cerrar_mes',
          payload: values.data,
          ticket: {
            kind: 'cierre_de_mes',
            title: `Cerrar ${noun}`,
            subtitle: `Después no se puede cargar ni cambiar nada con fecha de ${noun}. Las correcciones van con una nota de crédito o un ajuste en ${next}.`,
            rows: [
              ...(checklist.entriesCount !== null
                ? [{ label: 'Asientos', value: String(checklist.entriesCount) }]
                : []),
              ...(checklist.debitTotalCents !== null
                ? [{ label: 'Debe = Haber', value: money(checklist.debitTotalCents) }]
                : []),
              ...(settles && plan.summary ? [{ label: 'IVA', value: plan.summary }] : []),
              ...(iva && !settles
                ? [{ label: 'IVA', value: 'Se cierra sin anotar el IVA del mes.' }]
                : []),
            ],
            total: null,
            entry: [],
            warnings: closeTicketWarnings(lines),
            confirmLabel: `Cerrar ${noun}`,
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_reapertura_de_mes',
    description:
      'Prepara reabrir el último mes cerrado, con motivo: vuelve a provisoria la numeración y anula su liquidación de IVA. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      mes: monthField('Qué mes, yyyy-MM.'),
      motivo: z
        .string()
        .min(5)
        .max(300)
        .describe('Por qué, al menos 5 letras: lo ve la contadora. Si no lo dijo, preguntale.'),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando la reapertura',
    done: () => 'Preparé la reapertura',
    run: async (input, ctx) => {
      const years = await listFiscalYears(ctx.tenantId)
      const months = monthPeriods(years.flatMap((y) => y.periods))
      const period = months.find((p) => monthOf(p.month) === input.mes)
      const noun = monthNoun(input.mes)
      if (!period) return fail(`${noun} no tiene libros todavía.`)
      if (period.status !== 'closed') return fail(`${noun} no está cerrado.`)
      const last = [...months].reverse().find((p) => p.status === 'closed')
      if (last && last.id !== period.id) {
        return fail(
          `Se reabre solo el último mes cerrado: ${monthNoun(monthOf(last.month))}. Los meses se reabren en orden.`,
        )
      }
      const year = years.find((y) => y.id === period.fiscalYearId)
      if (year?.status !== 'open') {
        return fail(
          `El ejercicio de ${noun} está cerrado: eso se decide en su pantalla. ${CLOSES_SCREEN}`,
        )
      }
      const payload = reopenSchema.safeParse({ month: period.month, reason: input.motivo })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'contabilidad.reabrir_mes',
          payload: payload.data,
          ticket: {
            kind: 'reapertura_de_mes',
            title: `Reabrir ${noun}`,
            subtitle: `Después lo vas a tener que cerrar de nuevo.`,
            rows: [{ label: 'Motivo', value: input.motivo }],
            total: null,
            entry: [],
            warnings: [
              {
                key: 'reopen',
                title: `Se borra la numeración de ${noun} (vuelve a ser provisoria) y se anula su liquidación de IVA.`,
                body: null,
              },
            ],
            confirmLabel: `Reabrir ${noun}`,
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_impuestos',
    description:
      'Prepara cambiar los porcentajes de los impuestos que se calculan solos o apagar el cálculo automático (Ajustes › Impuestos). No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      calcular_solos: z.boolean().optional().describe('false apaga el cálculo automático.'),
      ingresos_brutos: z.number().min(0).max(100).optional().describe('En %: 3 es 3 %.'),
      comercio_e_industria: z.number().min(0).max(100).optional().describe('En %: 0.7 es 0,7 %.'),
      impuesto_al_cheque: z.number().min(0).max(100).optional().describe('En %: 0.6 es 0,6 %.'),
      base: z
        .enum(TAX_BASE_WORDS)
        .optional()
        .describe(
          'Ingresos Brutos y Comercio e Industria: sobre lo facturado sin IVA, o todo lo vendido.',
        ),
    }),
    need: 'write',
    mood: 'working',
    doing: () => 'Preparando los impuestos',
    done: () => 'Preparé los impuestos',
    run: async (input, ctx) => {
      const loaded = await tryLoadPostingContext(ctx.tenantId)
      if (!loaded.ok) return fail(failureText(loaded.state))
      const current = loaded.ctx.settings.taxSettings ?? DEFAULT_TAX_SETTINGS
      const next = nextTaxSettings(current, {
        auto: input.calcular_solos,
        iibb: input.ingresos_brutos,
        municipal: input.comercio_e_industria,
        bankTax: input.impuesto_al_cheque,
        base: input.base,
      })
      const rows = taxChangeRows(current, next)
      if (rows.length === 0) return fail('Ya está así: no hay nada para cambiar.')
      const payload = taxSettingsPayload.safeParse(next)
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'contabilidad.impuestos',
          payload: payload.data,
          ticket: {
            kind: 'impuestos',
            title: 'Impuestos',
            subtitle: 'Valen desde ahora: lo que ya está cargado queda como está.',
            rows,
            total: null,
            entry: [],
            warnings:
              current.auto && !next.auto
                ? [
                    {
                      key: 'tax_off',
                      title:
                        'Apagado, nada se calcula solo: ni en cada cierre del día ni en cada pago con banco o billetera.',
                      body: null,
                    },
                  ]
                : [],
            confirmLabel: 'Guardar los impuestos',
          },
        },
      }
    },
  }),
]

function textWarnings(texts: ReadonlyArray<string | null>): TexTicketWarning[] {
  return texts.flatMap((text, index) =>
    text ? [{ key: `aviso_${index}`, title: text, body: null }] : [],
  )
}

export const contabilidadExecutors: Readonly<Record<string, TexExecutor>> = {
  'contabilidad.asiento': {
    // El camino de todo comprobante. Anular es de los dueños: la contadora graba y, si hace falta,
    // hace otro asiento, así que a ella no se le ofrece «Deshacer».
    run: async (raw, ctx) => {
      const result = await documentExecutor.run(raw, ctx)
      return result.ok && !ctx.access.write ? { ...result, undoUntil: null } : result
    },
  },

  'contabilidad.reimputar': simpleExecutor(
    reimputeSchema,
    (payload, ctx) => reimputeLine(ctx.slug, payload),
    (data, _payload, ctx) => ({ href: comprobanteHref(ctx, data.documentId) }),
  ),

  'contabilidad.anular': {
    run: async (raw, ctx) => {
      const parsed = voidPayload.safeParse(raw)
      if (!parsed.success) {
        return { ok: false, kind: 'failed', message: 'El tique está roto: armalo de nuevo.' }
      }
      const payload = parsed.data
      const state =
        payload.mode === 'void'
          ? await voidDocument(ctx.slug, payload.values)
          : await reverseDocument(ctx.slug, payload.values)
      if (state.ok) {
        return {
          ok: true,
          message: state.message,
          href: comprobanteHref(ctx, payload.values.documentId),
          point: null,
          undoUntil: null,
          data: state.data,
        }
      }
      // La base encontró pagos aplicados que no estaban a la vista: se pregunta otra vez.
      if (state.detail?.key === 'document_has_allocations' && !payload.values.unallocate) {
        return {
          ok: false,
          kind: 'review',
          message: state.message,
          warnings: [{ key: 'document_has_allocations', title: state.message, body: null }],
          payload: { ...payload, values: { ...payload.values, unallocate: true } },
        }
      }
      return { ok: false, kind: 'failed', message: failureText(state) }
    },
  },

  'contabilidad.cerrar_mes': {
    run: async (raw, ctx) => {
      const parsed = closePayload.safeParse(raw)
      if (!parsed.success) {
        return { ok: false, kind: 'failed', message: 'El tique está roto: armalo de nuevo.' }
      }
      const payload = parsed.data
      const state = await closePeriod(ctx.slug, payload)
      if (state.ok) {
        return {
          ok: true,
          message: state.message,
          href: cierresHref(ctx),
          point: null,
          undoUntil: null,
          data: state.data,
        }
      }
      // Aparecieron avisos nuevos mientras tanto: se muestran y se confirma de nuevo.
      if (state.code === 'needs_confirmation' && state.closeWarnings?.length) {
        return {
          ok: false,
          kind: 'review',
          message: 'Aparecieron avisos nuevos. Si igual querés cerrar, confirmá de nuevo.',
          warnings: state.closeWarnings.map((w) => ({ key: w.key, title: w.message, body: null })),
          payload: {
            ...payload,
            warningsAck: [
              ...new Set([...payload.warningsAck, ...state.closeWarnings.map((w) => w.key)]),
            ],
          },
        }
      }
      // Se cargó algo en el medio: el IVA cambió. Se vuelve a leer y la persona lo ve antes de seguir.
      if (state.code === 'preview_stale') {
        const mes = payload.month.slice(0, 7)
        const checklist = await getCloseChecklist(ctx.tenantId, mes)
        if (!checklist.canClose) {
          return { ok: false, kind: 'failed', message: failureText(state) }
        }
        const fresh = await closeSnapshot(ctx, mes, checklist)
        return {
          ok: false,
          kind: 'review',
          message: state.message,
          warnings: [
            {
              key: 'changed',
              title: 'Cambió algo en el mes mientras mirabas: revisá los números y cerrá de nuevo.',
              body: fresh.plan.summary || null,
            },
            ...closeTicketWarnings(fresh.lines),
          ],
          payload: closePeriodValues({
            month: checklist.month,
            warningKeys: checklist.warningKeys,
            iva: fresh.iva,
            generate: payload.ivaSettlement.generate,
          }),
        }
      }
      return { ok: false, kind: 'failed', message: failureText(state) }
    },
  },

  'contabilidad.reabrir_mes': simpleExecutor(
    reopenSchema,
    (payload, ctx) => reopenPeriod(ctx.slug, payload),
    (_data, _payload, ctx) => ({ href: cierresHref(ctx) }),
  ),

  'contabilidad.impuestos': simpleExecutor(
    taxSettingsPayload,
    (payload, ctx) => saveTaxSettings(ctx.slug, payload),
    (_data, _payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'ajustes', { tab: 'impuestos' })
      return { href: link.ok ? link.href : null }
    },
  ),
}
