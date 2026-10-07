/**
 * El texto del toast después de guardar (H.5–H.11): plata primero, en verbos y
 * corto. «Gasto cargado · $ 3.600 · Coca-Cola · Caja», «Factura cargada ·
 * Coca-Cola · vence el 24/10», «Pago registrado · Coca-Cola · $ 1.179.500».
 *
 * Puro: sale del bundle que se guardó y del contexto con que se armó. Lleva
 * nombres de proveedores y cajas (es para la pantalla): nunca va a un log.
 */

import type {
  Cents,
  DocLine,
  PartyKey,
  PostingContext,
  ProposedBundle,
  ProposedDocument,
  VoucherType,
} from '@/lib/accounting/types'
import { formatDayMonth, weekdayName } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import type { DocumentForm } from './document-types'

const SEP = ' · '

/** «$ 3.600» si son pesos enteros, «$ 315.552,60» si tiene centavos. */
export function toastMoney(cents: Cents): string {
  return formatCents(cents, { decimals: cents % 100 === 0 ? 0 : 2 })
}

function joinParts(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join(SEP)
}

function partyName(
  key: PartyKey | null,
  ctx: Pick<PostingContext, 'parties'>,
  bundle: Pick<ProposedBundle, 'newParties'>,
): string | null {
  if (key === null) return null
  if ('id' in key) {
    const p = ctx.parties.get(key.id)
    return p ? (p.tradeName ?? p.name) : null
  }
  const np = bundle.newParties.find((n) => n.ref === key.ref)
  return np ? (np.tradeName ?? np.name) : null
}

function treasuryLines(doc: ProposedDocument): DocLine[] {
  return doc.lines.filter((l) => l.role === 'treasury' && l.treasuryAccountId !== null)
}

function treasuryName(
  line: DocLine | undefined,
  ctx: Pick<PostingContext, 'treasuries'>,
): string | null {
  if (!line?.treasuryAccountId) return null
  return ctx.treasuries.get(line.treasuryAccountId)?.name ?? null
}

function accountName(accountId: string | undefined, ctx: Pick<PostingContext, 'accounts'>) {
  if (!accountId) return null
  return ctx.accounts.get(accountId)?.name ?? null
}

/** El comprobante de compra con su género: «Factura cargada», «Tique cargado». */
function purchaseNoun(
  voucherType: VoucherType | null,
  kind: ProposedDocument['kind'],
): { noun: string; feminine: boolean } {
  if (kind === 'purchase_credit_note') return { noun: 'Nota de crédito', feminine: true }
  if (kind === 'purchase_debit_note') return { noun: 'Nota de débito', feminine: true }
  if (voucherType === null) return { noun: 'Compra', feminine: true }
  if (voucherType === 'ddjj_impuesto') return { noun: 'DDJJ', feminine: true }
  if (voucherType === 'tique') return { noun: 'Tique', feminine: false }
  if (voucherType.startsWith('tique_factura')) return { noun: 'Tique factura', feminine: false }
  if (voucherType.startsWith('factura')) return { noun: 'Factura', feminine: true }
  if (voucherType.startsWith('recibo')) return { noun: 'Recibo', feminine: false }
  if (voucherType === 'liquidacion') return { noun: 'Liquidación', feminine: true }
  return { noun: 'Comprobante', feminine: false }
}

/** El texto del toast para lo que se acaba de guardar. */
export function savedMessage(
  form: DocumentForm,
  bundle: ProposedBundle,
  ctx: Pick<PostingContext, 'parties' | 'treasuries' | 'accounts'>,
): string {
  const doc = bundle.documents[0]
  if (!doc) return 'Listo, quedó guardado.'
  const second = bundle.documents[1]
  const who = partyName(doc.party, ctx, bundle)

  switch (form) {
    case 'quick_expense': {
      // `expense` (sin factura) o `[purchase, payment]`: la caja está en el último documento.
      const last = bundle.documents[bundle.documents.length - 1] ?? doc
      const firstCost = doc.lines.find((l) => l.side === 'debit')
      return joinParts([
        'Gasto cargado',
        toastMoney(doc.totalCents),
        who ?? accountName(firstCost?.accountId, ctx),
        treasuryName(treasuryLines(last)[0], ctx),
      ])
    }
    case 'purchase':
    case 'purchase_credit_note': {
      const { noun, feminine } = purchaseNoun(doc.voucherType, doc.kind)
      const o = feminine ? 'a' : 'o'
      if (second?.kind === 'payment') return joinParts([`${noun} cargad${o} y pagad${o}`, who])
      const due =
        doc.kind !== 'purchase_credit_note' && doc.dueDate && doc.dueDate > doc.accountingDate
          ? `vence el ${formatDayMonth(doc.dueDate)}`
          : null
      return joinParts([`${noun} cargad${o}`, who, due])
    }
    case 'payment':
      return joinParts(['Pago registrado', who, toastMoney(doc.totalCents)])
    case 'sales_close': {
      const day = weekdayName(doc.accountingDate)
      const label = `Cierre del ${day ? `${day} ` : ''}${formatDayMonth(doc.accountingDate)} guardado`
      return joinParts([label, toastMoney(doc.totalCents)])
    }
    case 'collection': {
      const entered = treasuryLines(doc)
        .filter((l) => l.side === 'debit')
        .reduce((acc, l) => acc + l.amountCents, 0)
      return joinParts([
        'Cobro registrado',
        who,
        entered > 0 ? `entró ${toastMoney(entered)}` : null,
      ])
    }
    case 'wallet_check':
    case 'treasury_adjustment': {
      // La billetera puede no tener renglón de caja (todo explicado con descuentos): se busca en todo el envío.
      const line = bundle.documents.flatMap(treasuryLines)[0]
      const name = treasuryName(line, ctx)
      const title = name ? `Saldo de ${name} ajustado` : 'Saldo ajustado'
      if (form === 'wallet_check' || !line?.treasuryAccountId) return title
      // En la tarjeta de la empresa (una deuda) «faltar» y «sobrar» se leen al revés: solo la diferencia.
      const isCard = ctx.treasuries.get(line.treasuryAccountId)?.kind === 'credit_card'
      const what = isCard ? 'diferencia de' : line.side === 'credit' ? 'faltaban' : 'sobraban'
      return joinParts([title, `${what} ${toastMoney(line.amountCents)}`])
    }
    case 'sales_invoice': {
      const noun =
        doc.kind === 'sales_credit_note'
          ? 'Nota de crédito cargada'
          : doc.kind === 'sales_debit_note'
            ? 'Nota de débito cargada'
            : 'Factura de venta cargada'
      return joinParts([second?.kind === 'collection' ? `${noun} y cobrada` : noun, who])
    }
    case 'transfer': {
      const lines = treasuryLines(doc)
      const from = treasuryName(
        lines.find((l) => l.side === 'credit'),
        ctx,
      )
      const to = treasuryName(
        lines.find((l) => l.side === 'debit'),
        ctx,
      )
      return joinParts([
        'Plata movida',
        from && to ? `${from} → ${to}` : null,
        toastMoney(doc.totalCents),
      ])
    }
    case 'bank_expense':
      return joinParts([
        'Gasto bancario cargado',
        treasuryName(treasuryLines(doc)[0], ctx),
        toastMoney(doc.totalCents),
      ])
    case 'cash_movement': {
      const line = treasuryLines(doc)[0]
      return joinParts([
        line?.side === 'credit' ? 'Egreso registrado' : 'Ingreso registrado',
        treasuryName(line, ctx),
        toastMoney(doc.totalCents),
      ])
    }
    case 'manual_entry':
      return 'Asiento guardado'
  }
}
