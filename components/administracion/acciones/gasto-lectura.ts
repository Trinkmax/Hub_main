/**
 * Lo que la foto del comprobante le completa a «Nuevo gasto» — PURO.
 *
 * Pedido de los socios (16/11/2026): «en la foto de la factura, poner IA». La foto se lee igual que en
 * la compra y en la tira de gastos fijos (primero el QR de ARCA; si no aparece, con IA) y acá se decide
 * qué se propone. Nada pisa lo que la persona ya eligió: el monto se completa solo si está vacío y el
 * proveedor solo si todavía no hay nada elegido. Lo que no se leyó no cambia nada.
 */
import {
  padNumber,
  padPos,
  type VoucherNumberValue,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/voucher-number-input'
import {
  type ExpenseTarget,
  type QuickVoucher,
  quickVoucherFromType,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import { supplierDefaultAccount } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/supplier-account'
import {
  type StripParty,
  stripSupplierFromQr,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import type { InvoiceRead } from '@/lib/accounting/invoice-read'

export type ReadParty = StripParty & { defaultAccountId: string | null }

export type QuickExpenseReadPatch = {
  /** El total del papel. `null`: no se leyó, o ya había un monto escrito. */
  amountCents: number | null
  /** De quién es. `null`: no se supo, o ya había algo elegido. */
  target: Extract<ExpenseTarget, { kind: 'party' | 'new' }> | null
  /** Qué papel es. `null`: no se supo. */
  voucher: QuickVoucher | null
  /** El número entero (las dos partes) o nada. */
  voucherNumber: VoucherNumberValue | null
  /** La fecha del papel, si cae entre el arranque de los libros y hoy. */
  date: string | null
}

export function quickExpenseFromRead(
  read: InvoiceRead,
  state: { amountCents: number | null; hasTarget: boolean },
  ctx: {
    parties: readonly ReadParty[]
    imputableAccountIds: ReadonlySet<string>
    booksStartDate: string | null
    today: string
  },
): QuickExpenseReadPatch {
  const supplier = state.hasTarget
    ? null
    : stripSupplierFromQr(read, ctx.parties, read.issuerName?.trim() ?? '')
  let target: QuickExpenseReadPatch['target'] = null
  if (supplier?.kind === 'party') {
    const party = ctx.parties.find((p) => p.id === supplier.partyId)
    target = {
      kind: 'party',
      partyId: supplier.partyId,
      accountId: supplierDefaultAccount(party?.defaultAccountId, ctx.imputableAccountIds),
    }
  } else if (supplier?.kind === 'new' && supplier.name.trim().length >= 2) {
    // Un CUIT que no está cargado y sin nombre (el QR no lo trae) no alcanza para proponer a nadie.
    target = {
      kind: 'new',
      name: supplier.name.trim(),
      taxId: supplier.taxId,
      ivaCondition: supplier.ivaCondition,
      accountId: null,
    }
  }

  const hasNumber = read.pointOfSale !== null && read.number !== null
  const inRange =
    read.date !== null &&
    read.date <= ctx.today &&
    (ctx.booksStartDate === null || read.date >= ctx.booksStartDate)
  return {
    amountCents:
      state.amountCents === null && read.totalCents !== null && read.totalCents > 0
        ? read.totalCents
        : null,
    target,
    voucher: quickVoucherFromType(read.voucherType),
    voucherNumber: hasNumber
      ? { pos: padPos(String(read.pointOfSale)), number: padNumber(String(read.number)) }
      : null,
    date: inRange ? read.date : null,
  }
}

/** ¿La lectura le cambió algo a la hoja? Si no, no hay nada que avisar. */
export function readPatchIsEmpty(patch: QuickExpenseReadPatch): boolean {
  return (
    patch.amountCents === null &&
    patch.target === null &&
    patch.voucher === null &&
    patch.voucherNumber === null &&
    patch.date === null
  )
}
