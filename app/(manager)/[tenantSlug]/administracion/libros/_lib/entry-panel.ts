import type { AccountOption } from '@/components/administracion/account-combobox'
import type { DocumentAttachment } from '@/lib/accounting/queries/attachments'
import type { ImputationFlag, LineReimputation } from '@/lib/accounting/queries/books'
import type { DocumentDetail, EntryDetail } from '@/lib/accounting/queries/documents'
import { type ReimputeTarget, reimputeTargets } from '@/lib/accounting/reimpute'
import { appliedByOthers, documentActions } from '../../comprobantes/_lib/document-view'
import type { AppliedWord } from '../../comprobantes/[id]/_components/document-actions'

/**
 * El panel lateral del asiento, en datos: lo que se ve al tocar una fila del Mayor o del Diario
 * (Silvia, min. 12: «entrar al asiento contable que originó ese movimiento en el mayor y cambiarle el
 * número de cuenta»). Puro: arma todo con lo que ya leyó la acción, y lo prueban los tests.
 */

export type EntryPanelLine = {
  id: string
  accountId: string
  accountCode: string
  accountName: string
  side: 'debit' | 'credit'
  amountCents: number
  partyName: string | null
  memo: string | null
  /** «Agua» cuando el proveedor va siempre a «Energía eléctrica». */
  usual: { accountId: string; accountName: string; partyName: string | null } | null
}

export type EntryPanelVoid = {
  title: string
  siblings: string[]
  appliedCents: number | null
  appliedWord: AppliedWord
  notes: string[]
}

export type EntryPanelData = {
  entry: {
    id: string
    number: number | null
    provisional: boolean
    date: string
    description: string
    kind: string
    status: 'posted' | 'voided'
    isMirror: boolean
    createdByName: string
    createdAt: string
    debitCents: number
    creditCents: number
    voidedAt: string | null
    voidedByName: string | null
    voidReason: string | null
  }
  document: {
    id: string
    seq: number
    title: string
    partyName: string | null
    /** Lo que escribió quien cargó (en un asiento manual, el respaldo). */
    notes: string | null
    /** «Respaldo» en un asiento manual; «Detalle» en lo demás. */
    notesLabel: string
    /** `yyyy-MM`: a dónde lleva «Reabrilo». */
    month: string
    periodOpen: boolean
  }
  lines: EntryPanelLine[]
  targets: ReimputeTarget[]
  reimputations: LineReimputation[]
  attachments: DocumentAttachment[]
  /** La foto no se pudo leer: el texto para mostrar en su lugar. */
  attachmentsError: string | null
  /** `null`: «Anular» no se ofrece acá (se ve en la ficha, o no corresponde). */
  voidable: EntryPanelVoid | null
  /** El plan para el buscador; viene una sola vez por pantalla. */
  accounts: AccountOption[] | null
}

/** Los que pueden haberse emitido con ARCA: se corrigen desde su ficha, que mira ARCA antes. */
const ARCA_KINDS: ReadonlySet<string> = new Set([
  'sales_invoice',
  'sales_debit_note',
  'sales_credit_note',
])

function linkText(link: { title: string; seq: number }): string {
  return `${link.title} #${link.seq}`
}

function appliedWordOf(kind: DocumentDetail['kind']): AppliedWord {
  if (kind === 'purchase' || kind === 'purchase_debit_note') return 'pagos'
  if (kind === 'sales_invoice' || kind === 'sales_debit_note' || kind === 'sales_close') {
    return 'cobros'
  }
  return 'pagos o cobros'
}

/** «Anular» desde el panel: lo mismo que ofrece la ficha, con sus avisos. */
export function entryPanelVoid(
  doc: DocumentDetail,
  canWrite: boolean,
  notes: readonly string[],
): EntryPanelVoid | null {
  if (!documentActions(doc, canWrite).void) return null
  if (ARCA_KINDS.has(doc.kind) || doc.bundleSiblings.some((s) => ARCA_KINDS.has(s.kind))) {
    return null
  }
  return {
    title: doc.title,
    siblings: doc.bundleSiblings.filter((s) => s.status === 'posted').map(linkText),
    appliedCents: appliedByOthers(doc.kind)
      ? doc.allocations.reduce((sum, a) => (a.voidedOn ? sum : sum + a.amountCents), 0)
      : null,
    appliedWord: appliedWordOf(doc.kind),
    notes: [...notes],
  }
}

export function buildEntryPanel(input: {
  doc: DocumentDetail
  entry: EntryDetail
  canWrite: boolean
  /** La cuenta de cada renglón, para saber si se puede reimputar. */
  accounts: ReadonlyMap<string, { requiresParty: boolean; isTreasury: boolean }>
  flags: readonly ImputationFlag[]
  reimputations: readonly LineReimputation[]
  attachments: readonly DocumentAttachment[]
  attachmentsError: string | null
  voidNotes: readonly string[]
  options: AccountOption[] | null
}): EntryPanelData {
  const { doc, entry, flags } = input
  const ownFlags = flags.filter((f) => f.documentId === doc.id)
  const usualOf = new Map(ownFlags.map((f) => [f.accountId, f]))
  const periodOpen = doc.period ? doc.period.status === 'open' : entry.periodStatus === 'open'
  return {
    entry: {
      id: entry.id,
      number: entry.number ?? entry.provisionalNumber,
      provisional: entry.number === null,
      date: entry.entryDate,
      description: entry.description,
      kind: entry.kind,
      status: entry.status,
      isMirror: entry.isMirror,
      createdByName: entry.createdByName,
      createdAt: entry.createdAt,
      debitCents: entry.debitCents,
      creditCents: entry.creditCents,
      voidedAt: entry.voidedAt,
      voidedByName: entry.voidedByName,
      voidReason: entry.voidReason,
    },
    document: {
      id: doc.id,
      seq: doc.seq,
      title: doc.title,
      partyName: doc.partyName,
      notes: doc.notes,
      notesLabel: doc.kind === 'manual' ? 'Respaldo' : 'Detalle',
      month: entry.entryDate.slice(0, 7),
      periodOpen,
    },
    lines: entry.lines.map((line) => {
      const flag = usualOf.get(line.accountId)
      return {
        id: line.id,
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        side: line.side,
        amountCents: line.amountCents,
        partyName: line.partyName,
        memo: line.memo,
        usual: flag
          ? {
              accountId: flag.usualAccountId,
              accountName: flag.usualAccountName,
              partyName: flag.partyName,
            }
          : null,
      }
    }),
    targets: reimputeTargets(doc, input.accounts, ownFlags),
    reimputations: [...input.reimputations],
    attachments: [...input.attachments],
    attachmentsError: input.attachmentsError,
    voidable: entryPanelVoid(doc, input.canWrite, input.voidNotes),
    accounts: input.options,
  }
}
