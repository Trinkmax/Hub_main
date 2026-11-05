import 'server-only'

import { z } from 'zod'
import { ACCOUNT_TYPE_LABELS } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/labels'
import { ivaSummary, rateRows } from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva'
import { ivaHero } from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva-story'
import {
  earlierOpenMonth,
  focusMonth,
  monthPeriods,
  monthState,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/months'
import {
  monthAvailability,
  monthAvailabilityMessage,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/periods'
import {
  TRIAL_LEVELS,
  type TrialLevel,
  visibleTrialRows,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/trial'
import {
  closeHeadline,
  closeReview,
  type ReviewChecklist,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/review'
import { lineDetail } from '@/app/(manager)/[tenantSlug]/administracion/libros/mayor/_lib/ledger-rows'
import { trialAnomalies } from '@/lib/accounting/anomalies'
import {
  type AccountRow,
  compareAccountCodes,
  listAccounts,
} from '@/lib/accounting/queries/accounts'
import {
  getAccountSystemKeys,
  getImputationFlags,
  getIvaBook,
  getIvaBookTotals,
  getIvaPosition,
  getJournal,
  getJournalSummary,
  getLedger,
  getTrialBalance,
  type ImputationFlag,
  type IvaBookRow,
  type IvaBookTotals,
  type IvaPosition,
  type JournalEntryRow,
  type JournalLine,
  type JournalSummary,
  type LedgerPage,
  type LedgerRow,
  type TrialBalance,
  type TrialBalanceRow,
} from '@/lib/accounting/queries/books'
import { type DailyCloseCalendar, getDailyCloseCalendar } from '@/lib/accounting/queries/documents'
import { documentTitle, PERIOD_STATUS_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'
import { searchKey } from '@/lib/accounting/queries/parties'
import {
  type CloseChecklist,
  type FiscalYearRow,
  getCloseChecklist,
  listFiscalYears,
  type PeriodRow,
} from '@/lib/accounting/queries/periods'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import {
  cents,
  isRecord,
  isUuid,
  queryError,
  readerClient,
  settleQuery,
  str,
  strOrNull,
} from '@/lib/accounting/queries/shared'
import { isReimputableLine, REIMPUTABLE_ROLES } from '@/lib/accounting/reimpute'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { isoDayInCordoba, monthOf } from '@/lib/dates'
import { resolveAccount } from '../../resolve'
import { capped, dayText, defineTool, money, monthField, type TexToolContext } from '../types'
import {
  cappedBySize,
  compact,
  moneyIf,
  newestFirst,
  periodFields,
  plain,
  shortText,
  sideBalance,
  texMonth,
  texPeriod,
} from './common'
import { partyOf } from './compras'

/** Lo que se muestra de una lista. */
const LIST_MAX = 40
/** Lo que se muestra del diario: un asiento de un cierre tiene muchas líneas. */
const JOURNAL_MAX_CHARS = 11_000
/** Son dos listas en una respuesta: cada una con su parte. */
const FLAGS_MAX_CHARS = 8_000
const REVERSED_MAX_CHARS = 3_500
/** Lo que se lee del mayor: lo más que da la base en una página. */
const LEDGER_READ = 500

function accountWords(code: string, name: string): string {
  return `${code} ${name}`
}

// ─── Lo puro: sumas y saldos ─────────────────────────────────────────────────

/**
 * El nivel más detallado que entra en la respuesta. La base trae el plan entero (226 cuentas en el
 * estándar): se prefiere ver todos los rubros con menos detalle antes que un balance cortado.
 */
export function trialLevelThatFits(rows: readonly TrialBalanceRow[], max: number): TrialLevel {
  const fits = (level: TrialLevel) =>
    visibleTrialRows(rows, { level, includeZero: false }).length <= max
  if (fits('todo')) return 'todo'
  for (const level of [...TRIAL_LEVELS].reverse()) if (fits(level)) return level
  return 1
}

export function trialRow(row: TrialBalanceRow) {
  const opening = row.openingDebitCents - row.openingCreditCents
  return compact({
    id: row.isVirtual ? null : row.accountId,
    cuenta: row.isVirtual ? row.name : accountWords(row.code, row.name),
    grupo: row.postable || row.isVirtual ? null : true,
    saldo_inicial: opening === 0 ? null : sideBalance(opening),
    debe: moneyIf(row.periodDebitCents),
    haber: moneyIf(row.periodCreditCents),
    saldo: sideBalance(row.closingDebitCents - row.closingCreditCents),
  })
}

export function trialData(trial: TrialBalance, label: string, level: TrialLevel | null) {
  const used = level ?? trialLevelThatFits(trial.rows, LIST_MAX)
  const rows = visibleTrialRows(trial.rows, { level: used, includeZero: false })
  const { filas, hay_mas } = capped(rows.map(trialRow), LIST_MAX)
  const { totals } = trial
  return compact({
    periodo: label,
    nivel: used === 'todo' ? 'todas las cuentas con movimiento o saldo' : used,
    cuadra: trial.balanced,
    no_cuadra_por: moneyIf(trial.differenceCents),
    debe_del_periodo: money(totals.periodDebitCents),
    haber_del_periodo: money(totals.periodCreditCents),
    saldos_deudores: money(totals.closingDebitCents),
    saldos_acreedores: money(totals.closingCreditCents),
    filas,
    hay_mas,
  })
}

// ─── Lo puro: mayor ──────────────────────────────────────────────────────────

/** Un renglón de comprobante, con lo que hace falta para saber si se puede reimputar. */
export type ReimputableLine = {
  id: string
  documentId: string
  accountId: string
  role: string
  side: 'debit' | 'credit'
  amountCents: number
  partyId: string | null
  treasuryAccountId: string | null
}

/**
 * El renglón de comprobante de cada fila del mayor, si se puede reimputar. El mayor lista líneas del
 * asiento, y lo que se reimputa es el renglón del comprobante: se aparean por comprobante, cuenta,
 * lado e importe, y dos renglones iguales se reparten en orden. En un mes cerrado no se reimputa
 * (`firstOpenDate`: el primer día abierto), así que ahí no se ofrece ningún id.
 */
export function ledgerLineIds(
  rows: readonly LedgerRow[],
  lines: readonly ReimputableLine[],
  accounts: ReadonlyMap<string, Pick<AccountRow, 'requiresParty' | 'isTreasury'>>,
  firstOpenDate: string | null,
): Array<string | null> {
  const free = lines.filter((line) => {
    const account = accounts.get(line.accountId)
    return account !== undefined && isReimputableLine(line, account)
  })
  return rows.map((row) => {
    if (row.rowKind !== 'line' || !row.documentId || !row.accountId) return null
    if (firstOpenDate !== null && row.entryDate !== null && row.entryDate < firstOpenDate) {
      return null
    }
    const side = row.debitCents > 0 ? 'debit' : 'credit'
    const amount = side === 'debit' ? row.debitCents : row.creditCents
    const at = free.findIndex(
      (line) =>
        line.documentId === row.documentId &&
        line.accountId === row.accountId &&
        line.side === side &&
        line.amountCents === amount,
    )
    if (at === -1) return null
    const [found] = free.splice(at, 1)
    return found?.id ?? null
  })
}

export function ledgerRow(row: LedgerRow, lineId: string | null, isGroup: boolean) {
  return compact({
    fecha: dayText(row.entryDate),
    comprobante: row.documentLabel,
    comprobante_id: row.documentId,
    renglon_id: lineId,
    // Sin repetir el comprobante; en un grupo, de qué cuenta es.
    detalle: shortText(lineDetail(row, isGroup), 70),
    debe: moneyIf(row.debitCents),
    haber: moneyIf(row.creditCents),
    saldo: sideBalance(row.runningBalanceCents),
  })
}

/** Lo de la cuenta en el período, del más nuevo al más viejo, con los totales de TODO el período. */
export function ledgerData(
  page: LedgerPage,
  label: string,
  lineIds: ReadonlyArray<string | null>,
  firstOpenDate: string | null,
) {
  const isGroup = page.account ? !page.account.postable : false
  const lines = page.rows.filter((row) => row.rowKind === 'line')
  const { filas, hay_mas } = newestFirst(
    lines.map((row, index) => ledgerRow(row, lineIds[index] ?? null, isGroup)),
    LIST_MAX,
  )
  const totals = page.periodTotals
  return compact({
    cuenta: page.account
      ? { id: page.account.id, cuenta: accountWords(page.account.code, page.account.name) }
      : null,
    periodo: label,
    saldo_al_empezar: totals ? sideBalance(totals.openingCents) : null,
    debe: totals ? money(totals.debitCents) : null,
    haber: totals ? money(totals.creditCents) : null,
    saldo_al_terminar: totals ? sideBalance(totals.closingCents) : null,
    cuantos: page.totalRows,
    filas,
    hay_mas,
    nota: page.nextCursor
      ? `Son más de ${LEDGER_READ} movimientos: pedí un período más corto para ver los últimos.`
      : null,
    reimputar:
      firstOpenDate === null
        ? null
        : `Lo anterior al ${dayText(firstOpenDate)} es de un mes cerrado: no se reimputa y no trae renglon_id.`,
  })
}

// ─── Lo puro: diario ─────────────────────────────────────────────────────────

function journalLineText(line: JournalLine): string {
  const debit = line.debitCents > 0
  const party = line.partyName ? ` · ${line.partyName}` : ''
  return `${debit ? 'D' : 'H'} ${line.accountCode} ${line.accountName}${party} ${money(debit ? line.debitCents : line.creditCents)}`
}

export function journalRow(row: JournalEntryRow) {
  return compact({
    id: row.entryId,
    numero: row.number,
    provisorio: row.numberIsProvisional ? true : null,
    fecha: dayText(row.entryDate),
    comprobante: row.documentLabel,
    comprobante_id: row.documentId,
    detalle: shortText(row.description, 70),
    lineas: row.lines.map(journalLineText),
  })
}

export function journalData(
  rows: readonly JournalEntryRow[],
  summary: JournalSummary,
  label: string,
) {
  const { filas, hay_mas } = cappedBySize(rows.map(journalRow), LIST_MAX, JOURNAL_MAX_CHARS)
  const more = hay_mas || summary.entries > filas.length
  return compact({
    periodo: label,
    asientos: summary.entries,
    debe: money(summary.debitCents),
    haber: money(summary.creditCents),
    cuadra: summary.balanced,
    numeros_provisorios: summary.hasProvisional ? true : null,
    filas,
    hay_mas: more,
    nota: more ? 'Son los primeros, en orden: pedí un período más corto para ver el resto.' : null,
  })
}

// ─── Lo puro: IVA ────────────────────────────────────────────────────────────

/** La posición del mes. Mientras el mes está abierto es una estimación, y se dice. */
export function ivaPositionData(p: IvaPosition, month: string) {
  const hero = ivaHero(p, month)
  const byRate = (rows: Readonly<Record<string, number>>) =>
    rateRows(rows).map((row) => ({ alicuota: vatRateLabel(row.bp), iva: money(row.cents) }))
  return compact({
    mes: month,
    estado: p.status === 'closed' ? 'Cerrado' : 'Abierto',
    estimado: p.status === 'open' ? true : null,
    resultado: plain(hero.short),
    texto: plain(hero.brief),
    ...(p.applies
      ? {
          a_pagar: moneyIf(p.toPayCents),
          a_favor: moneyIf(p.inFavorCents),
          debito_fiscal: money(p.debitFiscal.totalCents),
          credito_fiscal: money(p.creditFiscal.totalCents),
          debito_por_alicuota: byRate(p.debitFiscal.byRate),
          credito_por_alicuota: byRate(p.creditFiscal.byRate),
          percepciones: moneyIf(p.perceptionsCents),
          retenciones: moneyIf(p.withholdingsCents),
          saldo_tecnico_anterior: moneyIf(p.technicalBalancePrevCents),
          libre_disponibilidad_anterior: moneyIf(p.freeBalancePrevCents),
          iva_de_comisiones_a_documentar: moneyIf(p.pendingDocumentationCents),
          libros_coinciden_con_el_mayor: p.reconciliation.matches,
          asientos_que_explican_la_diferencia:
            p.reconciliation.differencesCount > 0 ? p.reconciliation.differencesCount : null,
          liquidacion_id: p.settlementDocumentId,
        }
      : {}),
  })
}

export function ivaBookRow(row: IvaBookRow) {
  const sums = ivaSummary(row.amounts)
  return compact({
    comprobante_id: row.documentId,
    fecha: dayText(row.voucherDate),
    comprobante: documentTitle({
      kind: '',
      voucherType: row.voucherType,
      pointOfSale: row.pointOfSale,
      number: row.numberFrom,
    }),
    nombre: row.counterpartyName,
    neto: moneyIf(sums.netCents),
    iva: moneyIf(sums.vatCents),
    percepciones: moneyIf(sums.perceptionsCents),
    otros: moneyIf(sums.otherCents),
    total: money(sums.totalCents),
  })
}

export function ivaBookData(
  rows: readonly IvaBookRow[],
  totalRows: number,
  totals: IvaBookTotals,
  month: string,
) {
  const sums = ivaSummary(totals.amounts)
  const { filas, hay_mas } = capped(rows.map(ivaBookRow), LIST_MAX)
  return compact({
    libro: totals.book === 'purchases' ? 'IVA compras' : 'IVA ventas',
    mes: month,
    cuantos: totals.count ?? totalRows,
    neto: money(sums.netCents),
    iva: money(sums.vatCents),
    percepciones: moneyIf(sums.perceptionsCents),
    otros: moneyIf(sums.otherCents),
    total: money(sums.totalCents),
    credito_computable: totals.book === 'purchases' ? money(sums.computableCents) : null,
    filas,
    hay_mas,
  })
}

// ─── Lo puro: buscar una cuenta ──────────────────────────────────────────────

function accountRank(account: AccountRow, key: string, code: string): number | null {
  if (account.code === code) return 0
  if (code && account.code.startsWith(code)) return 1
  const name = searchKey(account.name)
  if (name === key) return 0
  if (name.startsWith(key)) return 2
  if (name.includes(` ${key}`)) return 3
  return name.includes(key) ? 4 : null
}

/** Por nombre o código, lo más parecido primero y, a igual parecido, las que se pueden imputar. */
export function searchAccounts(accounts: readonly AccountRow[], wanted: string): AccountRow[] {
  const key = searchKey(wanted)
  const code = /^[\d.]+$/.test(wanted.trim()) ? wanted.trim() : ''
  return accounts
    .map((account) => ({ account, rank: accountRank(account, key, code) }))
    .filter((x): x is { account: AccountRow; rank: number } => x.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.account.postable) - Number(a.account.postable) ||
        compareAccountCodes(a.account.code, b.account.code),
    )
    .map((x) => x.account)
}

export function accountRow(account: AccountRow, parents: ReadonlyMap<string, string>) {
  return compact({
    id: account.id,
    codigo: account.code,
    nombre: account.name,
    tipo: ACCOUNT_TYPE_LABELS[account.type],
    imputable: account.postable,
    grupo: account.parentId ? parents.get(account.parentId) : null,
    pide_participe: account.requiresParty ? true : null,
    es_caja: account.isTreasury ? true : null,
    para_que: shortText(account.description, 80),
  })
}

// ─── Lo puro: cuentas dudosas ────────────────────────────────────────────────

export function imputationFlagRow(flag: ImputationFlag) {
  return compact({
    comprobante_id: flag.documentId,
    renglon_id: flag.documentLineId,
    fecha: dayText(flag.accountingDate),
    participe: flag.partyName,
    importe: money(flag.amountCents),
    esta_en: accountWords(flag.accountCode, flag.accountName),
    cuenta_id: flag.accountId,
    va_siempre_a: accountWords(flag.usualAccountCode, flag.usualAccountName),
    cuenta_habitual_id: flag.usualAccountId,
  })
}

/**
 * Lo que parece mal imputado: renglones que no fueron a la cuenta de siempre de su proveedor y saldos
 * que dan al revés de lo que esa cuenta debería dar. No afirma que sean errores: son para mirar.
 */
export function suspectsData(
  flags: readonly ImputationFlag[],
  trial: TrialBalance,
  systemKeys: ReadonlyMap<string, string | null>,
  label: string,
) {
  const anomalies = trialAnomalies(trial.rows, systemKeys)
  const reversed = trial.rows.flatMap((row) => {
    const anomaly = anomalies.get(row.accountId)
    return anomaly
      ? [
          {
            id: row.accountId,
            cuenta: accountWords(row.code, row.name),
            saldo: sideBalance(row.closingDebitCents - row.closingCreditCents),
            por_que: anomaly.sentence,
          },
        ]
      : []
  })
  return {
    periodo: label,
    renglones_en_otra_cuenta: cappedBySize(flags.map(imputationFlagRow), LIST_MAX, FLAGS_MAX_CHARS),
    saldos_al_reves: cappedBySize(reversed, LIST_MAX, REVERSED_MAX_CHARS),
  }
}

// ─── Lo puro: el estado de los meses ─────────────────────────────────────────

const MONTH_STATE_WORDS = {
  closed: 'Cerrado',
  open: 'Abierto',
  to_close: 'Falta cerrar',
  current: 'En curso',
  future: 'Todavía no empezó',
} as const

/** El día en Córdoba: `closedAt` es un instante, y de noche ya es otro día en UTC. */
function closedDay(period: Pick<PeriodRow, 'closedAt'>): string | null {
  return period.closedAt ? dayText(isoDayInCordoba(period.closedAt)) : null
}

export function monthsData(periods: readonly PeriodRow[], today: string) {
  return monthPeriods(periods)
    .filter((period) => period.startsOn <= today || period.status === 'closed')
    .map((period) =>
      compact({
        mes: period.month.slice(0, 7),
        estado: MONTH_STATE_WORDS[monthState(period, today)],
        cerrado_el: closedDay(period),
        asientos: period.entriesCount,
      }),
    )
}

type ReviewParts = {
  month: string
  today: string
  canWrite: boolean
  base: string
  period: PeriodRow
  earlierOpen: string | null
  checklist: ReviewChecklist & Pick<CloseChecklist, 'iva' | 'entriesCount' | 'debitTotalCents'>
  calendar: DailyCloseCalendar | null
  settings: { openingStatus: 'pending' | 'posted' | 'skipped'; cuit: string | null } | null
}

/** Qué falta para cerrar un mes: lo mismo que dice Cierre de mes, renglón por renglón. */
export function monthReviewData(parts: ReviewParts) {
  const { month, period, today, canWrite, base, checklist, calendar, settings } = parts
  const review = closeReview({
    month,
    base,
    finished: period.endsOn < today,
    canWrite,
    checklist,
    today,
    calendar,
    settings,
  })
  const headline = closeHeadline({
    month,
    period,
    today,
    canWrite,
    checklist,
    blockersCount: review.blockersCount,
    blockerWords: review.blockerWords,
    earlierOpen: parts.earlierOpen,
    path: `${base}/libros/cierres`,
  })
  return compact({
    titulo: plain([headline.lead, headline.rest].filter(Boolean).join(' ')),
    se_puede_cerrar: checklist.canClose,
    antes_hay_que_cerrar: parts.earlierOpen,
    revision: review.rows.map((row) =>
      compact({
        que: row.title,
        estado: row.pill,
        bien: row.okText ? plain(row.okText) : null,
        avisos:
          row.items.length > 0
            ? row.items.map((item) =>
                plain(
                  [item.title, item.detail, item.more].filter(Boolean).join(': ').slice(0, 240),
                ),
              )
            : null,
      }),
    ),
    datos: review.info.length > 0 ? review.info.map(plain) : null,
    asientos: checklist.entriesCount,
    debe_y_haber: checklist.debitTotalCents === null ? null : money(checklist.debitTotalCents),
    iva: checklist.iva ? plain(ivaHero(checklist.iva, month).short) : null,
  })
}

// ─── Las lecturas ────────────────────────────────────────────────────────────

/**
 * Los renglones de comprobante de unas cuentas en unos comprobantes. No hay una función de consulta
 * que los traiga sin el comprobante entero: se leen con la sesión de la persona (la RLS de lectores) y
 * con el bar explícito, como las lecturas de `lib/accounting/queries`.
 */
async function reimputableLinesOf(
  ctx: TexToolContext,
  documentIds: readonly string[],
): Promise<ReimputableLine[]> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return []
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_document_lines')
    .select('id, document_id, account_id, role, side, amount_cents, party_id, treasury_account_id')
    .eq('tenant_id', ctx.tenantId)
    .in('document_id', ids)
    .in('role', [...REIMPUTABLE_ROLES])
    .order('line_no', { ascending: true })
    .limit(1000)
  if (error) throw queryError('acc_document_lines', error)
  return ((data ?? []) as unknown[]).filter(isRecord).map((row) => ({
    id: str(row.id),
    documentId: str(row.document_id),
    accountId: str(row.account_id),
    role: str(row.role),
    side: row.side === 'credit' ? 'credit' : 'debit',
    amountCents: cents(row.amount_cents),
    partyId: strOrNull(row.party_id),
    treasuryAccountId: strOrNull(row.treasury_account_id),
  }))
}

// ─── Las herramientas ────────────────────────────────────────────────────────

/** Los libros, el IVA, las cuentas y el cierre de los meses. */
export const librosReadTools = [
  defineTool({
    name: 'ver_sumas_y_saldos',
    description:
      'El balance de sumas y saldos de un período: Debe, Haber y saldo de cada cuenta y si cuadra. Las filas con «grupo» ya suman a sus cuentas.',
    input: z.object({
      ...periodFields,
      nivel: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('Hasta qué nivel del plan; si no se dice, el más detallado que entre.'),
    }),
    need: 'read',
    doing: () => 'Mirando sumas y saldos',
    done: () => 'Miré sumas y saldos',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      const trial = await getTrialBalance(ctx.tenantId, { from: period.from, to: period.to })
      const level = (TRIAL_LEVELS as readonly number[]).includes(input.nivel ?? 0)
        ? (input.nivel as TrialLevel)
        : null
      return { kind: 'data', data: trialData(trial, period.label, level) }
    },
  }),

  defineTool({
    name: 'ver_mayor',
    description:
      'Los movimientos de una cuenta en un período, del más nuevo al más viejo, con su saldo y, donde se puede, el id del renglón para reimputar. Se puede filtrar por proveedor o cliente.',
    input: z.object({
      cuenta: z.string().min(1).describe('El nombre, el código o el id de la cuenta.'),
      participe: z
        .string()
        .min(1)
        .optional()
        .describe('El nombre o el id, en una cuenta corriente.'),
      ...periodFields,
    }),
    need: 'read',
    doing: () => 'Mirando el mayor',
    done: () => 'Miré el mayor',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      // Con un id también vale un grupo, que suma sus cuentas; por nombre, solo las imputables.
      let accountId = input.cuenta
      if (!isUuid(accountId)) {
        const found = await resolveAccount(ctx, input.cuenta)
        if (!found.ok) return { kind: 'error', message: found.message }
        accountId = found.value.id
      }
      let partyId: string | null = null
      if (input.participe) {
        const found = await partyOf(ctx, input.participe)
        if (!found.ok) return { kind: 'error', message: found.message }
        partyId = found.value.id
      }
      const page = await getLedger(ctx.tenantId, {
        accountId,
        partyId,
        from: period.from,
        to: period.to,
        limit: LEDGER_READ,
      })
      if (!page.account) {
        return { kind: 'error', message: 'No hay esa cuenta. Buscala con buscar_cuenta.' }
      }
      const lines = page.rows.filter((row) => row.rowKind === 'line')
      // Solo los comprobantes de lo que se va a ver: el resto no llega a Tex.
      const shown = lines.slice(-LIST_MAX)
      const [docLines, accounts, firstOpenDate] = await Promise.all([
        reimputableLinesOf(
          ctx,
          shown.flatMap((row) => (row.documentId ? [row.documentId] : [])),
        ),
        listAccounts(ctx.tenantId, { includeInactive: true }),
        loadFirstOpenDate(ctx.tenantId),
      ])
      const ids = ledgerLineIds(
        lines,
        docLines,
        new Map(accounts.map((account) => [account.id, account])),
        firstOpenDate,
      )
      return { kind: 'data', data: ledgerData(page, period.label, ids, firstOpenDate) }
    },
  }),

  defineTool({
    name: 'ver_diario',
    description:
      'El libro diario de un período: los asientos en orden, con sus líneas y su comprobante, y los totales de Debe y Haber.',
    input: z.object(periodFields),
    need: 'read',
    doing: () => 'Mirando el diario',
    done: () => 'Miré el diario',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      const range = { from: period.from, to: period.to }
      const [page, summary] = await Promise.all([
        getJournal(ctx.tenantId, { ...range, limit: LIST_MAX }),
        getJournalSummary(ctx.tenantId, range),
      ])
      return { kind: 'data', data: journalData(page.rows, summary, period.label) }
    },
  }),

  defineTool({
    name: 'ver_posicion_iva',
    description:
      'La posición de IVA de un mes: a pagar o a favor, débito y crédito fiscal por alícuota, percepciones y retenciones. Con el mes abierto es una estimación.',
    input: z.object({
      mes: monthField('Mes yyyy-MM. Si no se dice, el actual.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando el IVA',
    done: () => 'Miré el IVA',
    run: async (input, ctx) => {
      const month = texMonth(input.mes, ctx.today)
      if (!month.ok) return { kind: 'error', message: month.message }
      const position = await getIvaPosition(ctx.tenantId, month.month)
      return { kind: 'data', data: ivaPositionData(position, month.month) }
    },
  }),

  defineTool({
    name: 'ver_libro_iva',
    description:
      'El libro IVA compras o ventas de un mes: sus comprobantes con neto, IVA y total, y los totales del libro.',
    input: z.object({
      libro: z.enum(['compras', 'ventas']).describe('IVA compras o IVA ventas.'),
      mes: monthField('Mes yyyy-MM. Si no se dice, el actual.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando el libro IVA',
    done: () => 'Miré el libro IVA',
    run: async (input, ctx) => {
      const month = texMonth(input.mes, ctx.today)
      if (!month.ok) return { kind: 'error', message: month.message }
      const book = input.libro === 'compras' ? 'purchases' : 'sales'
      const [page, totals] = await Promise.all([
        getIvaBook(ctx.tenantId, { book, month: month.month, limit: LIST_MAX + 1 }),
        getIvaBookTotals(ctx.tenantId, { book, month: month.month }),
      ])
      return {
        kind: 'data',
        data: ivaBookData(page.rows, page.totalRows, totals, month.month),
      }
    },
  }),

  defineTool({
    name: 'buscar_cuenta',
    description:
      'Busca una cuenta del plan por nombre o código y da su id. Usala para elegir una cuenta: en las que no son imputables no se carga nada.',
    input: z.object({
      buscar: z.string().min(1).max(60).describe('Parte del nombre, o el código.'),
    }),
    need: 'read',
    doing: () => 'Buscando la cuenta',
    done: () => 'Busqué la cuenta',
    run: async (input, ctx) => {
      const accounts = await listAccounts(ctx.tenantId)
      const parents = new Map(accounts.map((account) => [account.id, account.name]))
      const found = searchAccounts(accounts, input.buscar)
      return {
        kind: 'data',
        data: capped(
          found.map((account) => accountRow(account, parents)),
          LIST_MAX,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_cuentas_dudosas',
    description:
      'Lo que parece mal imputado en un período: renglones que no fueron a la cuenta de siempre de su proveedor, con el id del renglón, y cuentas con el saldo al revés. Son para mirar, no siempre son errores.',
    input: z.object(periodFields),
    need: 'read',
    doing: () => 'Revisando las cuentas',
    done: () => 'Revisé las cuentas',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      const range = { from: period.from, to: period.to }
      const [flags, trial, systemKeys] = await Promise.all([
        getImputationFlags(ctx.tenantId, range),
        getTrialBalance(ctx.tenantId, range),
        getAccountSystemKeys(ctx.tenantId),
      ])
      return { kind: 'data', data: suspectsData(flags, trial, systemKeys, period.label) }
    },
  }),

  defineTool({
    name: 'ver_estado_de_meses',
    description:
      'Qué meses están cerrados y qué falta para cerrar uno. Si no se dice el mes, el que toca cerrar.',
    input: z.object({
      mes: monthField('Mes yyyy-MM.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando los meses',
    done: () => 'Miré los meses',
    run: async (input, ctx) => {
      const years: FiscalYearRow[] = await listFiscalYears(ctx.tenantId)
      const periods = years.flatMap((year) => year.periods)
      const year =
        years.find((y) => y.startDate <= ctx.today && ctx.today <= y.endDate) ??
        years.at(-1) ??
        null
      const asked = input.mes ? texMonth(input.mes, ctx.today) : null
      if (asked && !asked.ok) return { kind: 'error', message: asked.message }
      const month = asked?.ok ? asked.month : focusMonth(periods, ctx.today)
      const head = {
        ejercicio: year
          ? {
              desde: dayText(year.startDate),
              hasta: dayText(year.endDate),
              estado: PERIOD_STATUS_LABELS[year.status],
            }
          : null,
        meses: monthsData(year?.periods ?? [], ctx.today),
      }
      const settings = await settleQuery(getAccountingSettings(ctx.tenantId))
      const settingsData = settings.ok ? settings.data : null
      const period = periods.find((p) => p.kind === 'month' && monthOf(p.month) === month) ?? null
      const availability = monthAvailability(month, ctx.today, settingsData?.booksStartDate)
      if (!period || availability !== 'ok') {
        return {
          kind: 'data',
          data: {
            ...head,
            mes_mirado: {
              mes: month,
              estado:
                availability === 'ok'
                  ? 'Ese mes todavía no tiene libros.'
                  : monthAvailabilityMessage(availability, month, settingsData?.booksStartDate),
            },
          },
        }
      }
      if (period.status === 'closed') {
        return {
          kind: 'data',
          data: {
            ...head,
            mes_mirado: compact({
              mes: month,
              estado: 'Cerrado',
              cerrado_el: closedDay(period),
              asientos: period.entriesCount,
            }),
          },
        }
      }
      const [checklist, calendar] = await Promise.all([
        getCloseChecklist(ctx.tenantId, period.month),
        settleQuery(getDailyCloseCalendar(ctx.tenantId, month)),
      ])
      const earlier = earlierOpenMonth(periods, month)
      return {
        kind: 'data',
        data: {
          ...head,
          mes_mirado: {
            mes: month,
            estado: MONTH_STATE_WORDS[monthState(period, ctx.today)],
            ...monthReviewData({
              month,
              today: ctx.today,
              canWrite: ctx.access.write,
              base: `/${ctx.slug}/administracion`,
              period,
              earlierOpen: earlier ? monthOf(earlier.month) : null,
              checklist,
              calendar: calendar.ok ? calendar.data : null,
              settings: settingsData
                ? { openingStatus: settingsData.openingStatus, cuit: settingsData.cuit }
                : null,
            }),
          },
        },
      }
    },
  }),
]
