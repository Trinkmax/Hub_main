import { describe, expect, it } from 'vitest'
import { vatFromNet } from '@/lib/accounting/iva'
import type {
  DocLine,
  FiscalAmounts,
  FiscalVoucher,
  FiscalVoucherType,
  PartyRef,
  ProposedBundle,
  ProposedDocument,
} from '@/lib/accounting/types'
import {
  expectedDocumentTotal,
  findPossibleDuplicate,
  isAllowedComposition,
  lineRule,
  possibleDuplicateWarning,
  reconcileFiscal,
  rolesForKind,
  treasuryNegativeWarnings,
  validateBundle,
  validateDates,
  validateDocument,
  validateParty,
  validateVoucher,
} from '@/lib/accounting/validate'
import { afipVoucherCode } from '@/lib/accounting/voucher-types'
import { buildCoreFixture, doc, line } from './accounting-core-context'

const f = buildCoreFixture()
const { ctx } = f
const id = (key: Parameters<typeof f.party>[0]) => ({ id: f.party(key).id })

function fvPurchase(
  party: PartyRef,
  voucherType: FiscalVoucherType,
  pointOfSale: number,
  number: number,
  date: string,
  amounts: FiscalAmounts,
  isCreditNote = false,
): FiscalVoucher {
  return {
    book: 'purchases',
    voucherType,
    afipVoucherCode: afipVoucherCode(voucherType),
    isCreditNote,
    voucherDate: date,
    pointOfSale,
    numberFrom: number,
    numberTo: null,
    channel: null,
    counterparty: {
      party: { id: party.id },
      name: party.name,
      docType: 80,
      docNumber: party.taxId ?? '0',
      ivaCondition: party.ivaCondition,
    },
    amounts,
  }
}

function fvSales(
  voucherType: FiscalVoucherType,
  pointOfSale: number,
  from: number,
  to: number,
  channel: 'salon' | 'delivery' | 'events',
  amounts: FiscalAmounts,
  party?: PartyRef,
): FiscalVoucher {
  return {
    book: 'sales',
    voucherType,
    afipVoucherCode: afipVoucherCode(voucherType),
    isCreditNote: voucherType.startsWith('nota_credito'),
    voucherDate: '2026-10-06',
    pointOfSale,
    numberFrom: from,
    numberTo: to,
    channel,
    counterparty: party
      ? {
          party: { id: party.id },
          name: party.name,
          docType: 80,
          docNumber: party.taxId ?? '',
          ivaCondition: party.ivaCondition,
        }
      : {
          party: null,
          name: 'Consumidor final',
          docType: 99,
          docNumber: '0',
          ivaCondition: 'consumidor_final',
        },
    amounts,
  }
}

const payable = f.sys('payable_suppliers')

/** E1 · Factura A 0003-00001290 de Coca-Cola. */
function e1(): ProposedDocument {
  const coca = f.party('cocacola')
  return doc({
    kind: 'purchase',
    voucherType: 'factura_a',
    afipVoucherCode: 1,
    party: { id: coca.id },
    issueDate: '2026-10-03',
    accountingDate: '2026-10-03',
    dueDate: '2026-10-24',
    pointOfSale: 3,
    number: 1290,
    totalCents: 86_000_000,
    controlAccountId: payable.id,
    lines: [
      line({
        lineNo: 1,
        role: 'net',
        accountId: f.sys('purchases_soft_drinks').id,
        side: 'debit',
        amountCents: 71_074_380,
        vatRateBp: 2100,
        baseCents: 71_074_380,
      }),
      line({
        lineNo: 2,
        role: 'vat',
        accountId: f.sys('vat_credit').id,
        side: 'debit',
        amountCents: 14_925_620,
        vatRateBp: 2100,
        baseCents: 71_074_380,
        vatComputedCents: 14_925_620,
        taxKind: 'iva',
      }),
      line({
        lineNo: 3,
        role: 'control',
        accountId: payable.id,
        side: 'credit',
        amountCents: 86_000_000,
        partyRef: { id: coca.id },
        dueDate: '2026-10-24',
      }),
    ],
    fiscalVouchers: [
      fvPurchase(coca, 'factura_a', 3, 1290, '2026-10-03', {
        net_21_cents: 71_074_380,
        vat_21_cents: 14_925_620,
        total_cents: 86_000_000,
        vat_computable_cents: 14_925_620,
      }),
    ],
  })
}

/** E2 · Factura A de la carnicería con percepciones. */
function e2(): ProposedDocument {
  const carn = f.party('carniceria')
  return doc({
    kind: 'purchase',
    voucherType: 'factura_a',
    afipVoucherCode: 1,
    party: { id: carn.id },
    pointOfSale: 5,
    number: 777,
    totalCents: 23_100_000,
    lines: [
      line({
        lineNo: 1,
        role: 'net',
        accountId: f.sys('purchases_food').id,
        side: 'debit',
        amountCents: 20_000_000,
        vatRateBp: 1050,
        baseCents: 20_000_000,
      }),
      line({
        lineNo: 2,
        role: 'vat',
        accountId: f.sys('vat_credit').id,
        side: 'debit',
        amountCents: 2_100_000,
        vatRateBp: 1050,
        baseCents: 20_000_000,
        vatComputedCents: 2_100_000,
      }),
      line({
        lineNo: 3,
        role: 'perception',
        accountId: f.sys('iibb_perceptions').id,
        side: 'debit',
        amountCents: 400_000,
        taxKind: 'iibb',
        jurisdictionCode: 904,
      }),
      line({
        lineNo: 4,
        role: 'perception',
        accountId: f.sys('vat_perceptions').id,
        side: 'debit',
        amountCents: 600_000,
        taxKind: 'iva',
      }),
      line({
        lineNo: 5,
        role: 'control',
        accountId: payable.id,
        side: 'credit',
        amountCents: 23_100_000,
        partyRef: { id: carn.id },
      }),
    ],
    fiscalVouchers: [
      fvPurchase(carn, 'factura_a', 5, 777, '2026-10-03', {
        net_105_cents: 20_000_000,
        vat_105_cents: 2_100_000,
        perc_iibb_cents: 400_000,
        perc_iva_cents: 600_000,
        total_cents: 23_100_000,
        vat_computable_cents: 2_100_000,
      }),
    ],
  })
}

/** E3 · Factura C del plomero monotributista. */
function e3(): ProposedDocument {
  const plomero = f.party('plomero')
  return doc({
    kind: 'purchase',
    voucherType: 'factura_c',
    afipVoucherCode: 11,
    party: { id: plomero.id },
    pointOfSale: 2,
    number: 45,
    totalCents: 4_500_000,
    lines: [
      line({
        lineNo: 1,
        role: 'gross',
        accountId: f.sys('maintenance').id,
        side: 'debit',
        amountCents: 4_500_000,
      }),
      line({
        lineNo: 2,
        role: 'control',
        accountId: payable.id,
        side: 'credit',
        amountCents: 4_500_000,
        partyRef: { id: plomero.id },
      }),
    ],
    fiscalVouchers: [
      fvPurchase(plomero, 'factura_c', 2, 45, '2026-10-03', {
        undiscriminated_cents: 4_500_000,
        total_cents: 4_500_000,
      }),
    ],
  })
}

/** E4 · $ 4.500 en efectivo sin comprobante. */
function e4(): ProposedDocument {
  return doc({
    kind: 'expense',
    voucherType: 'sin_comprobante',
    totalCents: 450_000,
    lines: [
      line({
        lineNo: 1,
        role: 'gross',
        accountId: f.sys('purchases_soft_drinks').id,
        side: 'debit',
        amountCents: 450_000,
      }),
      line({
        lineNo: 2,
        role: 'treasury',
        accountId: f.treasury('caja').accountId,
        side: 'credit',
        amountCents: 450_000,
        treasuryAccountId: f.treasury('caja').id,
      }),
    ],
  })
}

/** E5 · Nuevo gasto con Factura A: [purchase, payment] + imputación. */
function e5(): ProposedBundle {
  const may = f.party('mayorista')
  return {
    clientRef: '00000000-0000-4000-8000-000000000777',
    newParties: [],
    documents: [
      doc({
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_a',
        afipVoucherCode: 1,
        party: { id: may.id },
        pointOfSale: 3,
        number: 4521,
        totalCents: 1_210_000,
        lines: [
          line({
            lineNo: 1,
            role: 'net',
            accountId: f.sys('cleaning').id,
            side: 'debit',
            amountCents: 1_000_000,
            vatRateBp: 2100,
            baseCents: 1_000_000,
          }),
          line({
            lineNo: 2,
            role: 'vat',
            accountId: f.sys('vat_credit').id,
            side: 'debit',
            amountCents: 210_000,
            vatRateBp: 2100,
            baseCents: 1_000_000,
            vatComputedCents: 210_000,
          }),
          line({
            lineNo: 3,
            role: 'control',
            accountId: payable.id,
            side: 'credit',
            amountCents: 1_210_000,
            partyRef: { id: may.id },
            dueDate: '2026-10-03',
          }),
        ],
        fiscalVouchers: [
          fvPurchase(may, 'factura_a', 3, 4521, '2026-10-03', {
            net_21_cents: 1_000_000,
            vat_21_cents: 210_000,
            total_cents: 1_210_000,
            vat_computable_cents: 210_000,
          }),
        ],
      }),
      doc({
        ref: 'd2',
        kind: 'payment',
        party: { id: may.id },
        totalCents: 1_210_000,
        lines: [
          line({
            lineNo: 1,
            role: 'control',
            accountId: payable.id,
            side: 'debit',
            amountCents: 1_210_000,
            partyRef: { id: may.id },
          }),
          line({
            lineNo: 2,
            role: 'treasury',
            accountId: f.treasury('mp').accountId,
            side: 'credit',
            amountCents: 1_210_000,
            treasuryAccountId: f.treasury('mp').id,
          }),
        ],
      }),
    ],
    allocations: [
      {
        debit: { doc: 'd2', lineNo: 1 },
        credit: { doc: 'd1', lineNo: 3 },
        amountCents: 1_210_000,
        kind: 'payment',
      },
    ],
  }
}

/** E6 · NC A por bonificación sobre E1. */
function e6(): ProposedDocument {
  const coca = f.party('cocacola')
  return doc({
    kind: 'purchase_credit_note',
    voucherType: 'nota_credito_a',
    afipVoucherCode: 3,
    party: { id: coca.id },
    pointOfSale: 3,
    number: 77,
    totalCents: 6_050_000,
    lines: [
      line({
        lineNo: 1,
        role: 'control',
        accountId: payable.id,
        side: 'debit',
        amountCents: 6_050_000,
        partyRef: { id: coca.id },
      }),
      line({
        lineNo: 2,
        role: 'net',
        accountId: f.sys('purchases_soft_drinks').id,
        side: 'credit',
        amountCents: 5_000_000,
        vatRateBp: 2100,
        baseCents: 5_000_000,
      }),
      line({
        lineNo: 3,
        role: 'vat',
        accountId: f.sys('vat_credit').id,
        side: 'credit',
        amountCents: 1_050_000,
        vatRateBp: 2100,
        baseCents: 5_000_000,
        vatComputedCents: 1_050_000,
      }),
    ],
    fiscalVouchers: [
      fvPurchase(
        coca,
        'nota_credito_a',
        3,
        77,
        '2026-10-03',
        {
          net_21_cents: 5_000_000,
          vat_21_cents: 1_050_000,
          total_cents: 6_050_000,
          vat_computable_cents: 1_050_000,
        },
        true,
      ),
    ],
  })
}

/** E7 · pago a Coca-Cola con dos medios. */
function e7(): ProposedDocument {
  const coca = f.party('cocacola')
  return doc({
    kind: 'payment',
    party: { id: coca.id },
    accountingDate: '2026-10-20',
    issueDate: '2026-10-20',
    totalCents: 90_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'control',
        accountId: payable.id,
        side: 'debit',
        amountCents: 90_000_000,
        partyRef: { id: coca.id },
      }),
      line({
        lineNo: 2,
        role: 'treasury',
        accountId: f.treasury('banco').accountId,
        side: 'credit',
        amountCents: 50_000_000,
        treasuryAccountId: f.treasury('banco').id,
      }),
      line({
        lineNo: 3,
        role: 'treasury',
        accountId: f.treasury('mp').accountId,
        side: 'credit',
        amountCents: 40_000_000,
        treasuryAccountId: f.treasury('mp').id,
      }),
    ],
  })
}

/** E7 · IIBB de octubre compensando SIRCUPA y retenciones. */
function e7Compensation(): ProposedDocument {
  const rentas = f.party('rentas')
  return doc({
    kind: 'payment',
    party: { id: rentas.id },
    totalCents: 380_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'control',
        accountId: f.sys('iibb_payable').id,
        side: 'debit',
        amountCents: 380_000_000,
        partyRef: { id: rentas.id },
      }),
      line({
        lineNo: 2,
        role: 'compensation',
        accountId: f.sys('iibb_sircupa').id,
        side: 'credit',
        amountCents: 140_000_000,
        taxKind: 'sircupa',
      }),
      line({
        lineNo: 3,
        role: 'compensation',
        accountId: f.sys('iibb_withholdings').id,
        side: 'credit',
        amountCents: 60_000_000,
        taxKind: 'ret_iibb',
      }),
      line({
        lineNo: 4,
        role: 'treasury',
        accountId: f.treasury('banco').accountId,
        side: 'credit',
        amountCents: 180_000_000,
        treasuryAccountId: f.treasury('banco').id,
      }),
    ],
  })
}

/** E8 · cierre del lunes 05/10. */
function e8(): ProposedDocument {
  const mp = f.party('mercadopago')
  const recv = (
    lineNo: number,
    key: 'transfer' | 'qr' | 'debit' | 'credit' | 'pedidosya' | 'rappi',
    amount: number,
  ) => {
    const method = f.method(key)
    const party = ctx.parties.get(method.partyId ?? '') ?? mp
    return line({
      lineNo,
      role: 'receivable',
      accountId: party.receivableAccountId,
      side: 'debit',
      amountCents: amount,
      partyRef: { id: party.id },
      salesMethodId: method.id,
      dueDate: '2026-10-05',
    })
  }
  return doc({
    kind: 'sales_close',
    issueDate: '2026-10-05',
    accountingDate: '2026-10-05',
    totalCents: 170_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'treasury',
        accountId: f.treasury('caja').accountId,
        side: 'debit',
        amountCents: 34_950_000,
        treasuryAccountId: f.treasury('caja').id,
        salesMethodId: f.method('cash').id,
      }),
      line({
        lineNo: 2,
        role: 'cash_diff',
        accountId: f.sys('cash_short').id,
        side: 'debit',
        amountCents: 50_000,
      }),
      recv(3, 'transfer', 18_000_000),
      recv(4, 'qr', 22_000_000),
      recv(5, 'debit', 41_000_000),
      recv(6, 'credit', 33_000_000),
      recv(7, 'pedidosya', 15_000_000),
      recv(8, 'rappi', 6_000_000),
      line({
        lineNo: 9,
        role: 'sales_invoiced',
        accountId: f.sys('sales_salon_invoiced').id,
        side: 'credit',
        amountCents: 100_000_000,
        channel: 'salon',
      }),
      line({
        lineNo: 10,
        role: 'sales_uninvoiced',
        accountId: f.sys('sales_salon_uninvoiced').id,
        side: 'credit',
        amountCents: 28_000_000,
        channel: 'salon',
      }),
      line({
        lineNo: 11,
        role: 'sales_invoiced',
        accountId: f.sys('sales_delivery_invoiced').id,
        side: 'credit',
        amountCents: 15_000_000,
        channel: 'delivery',
      }),
      line({
        lineNo: 12,
        role: 'sales_uninvoiced',
        accountId: f.sys('sales_delivery_uninvoiced').id,
        side: 'credit',
        amountCents: 2_850_000,
        channel: 'delivery',
      }),
      line({
        lineNo: 13,
        role: 'vat',
        accountId: f.sys('vat_debit').id,
        side: 'credit',
        amountCents: 24_150_000,
        vatRateBp: 2100,
        baseCents: 115_000_000,
        vatComputedCents: vatFromNet(115_000_000, 2100),
      }),
    ],
    fiscalVouchers: [
      fvSales('factura_b', 3, 14_501, 14_662, 'salon', {
        net_21_cents: 100_000_000,
        vat_21_cents: 21_000_000,
        total_cents: 121_000_000,
      }),
      fvSales('factura_b', 4, 2_101, 2_130, 'delivery', {
        net_21_cents: 15_000_000,
        vat_21_cents: 3_150_000,
        total_cents: 18_150_000,
      }),
    ],
  })
}

/** E8b · cierre con NC, Factura A en cuenta corriente y tres canales. */
function e8b(): ProposedDocument {
  const empresa = f.party('empresaX')
  const recv = (lineNo: number, key: 'transfer' | 'qr' | 'debit' | 'pedidosya', amount: number) => {
    const method = f.method(key)
    const party = ctx.parties.get(method.partyId ?? '')
    if (!party) throw new Error(key)
    return line({
      lineNo,
      role: 'receivable',
      accountId: party.receivableAccountId,
      side: 'debit',
      amountCents: amount,
      partyRef: { id: party.id },
      salesMethodId: method.id,
    })
  }
  return doc({
    kind: 'sales_close',
    issueDate: '2026-10-06',
    accountingDate: '2026-10-06',
    totalCents: 70_100_000,
    lines: [
      line({
        lineNo: 1,
        role: 'treasury',
        accountId: f.treasury('caja').accountId,
        side: 'debit',
        amountCents: 20_000_000,
        treasuryAccountId: f.treasury('caja').id,
        salesMethodId: f.method('cash').id,
      }),
      recv(2, 'transfer', 10_000_000),
      recv(3, 'qr', 5_000_000),
      recv(4, 'debit', 15_000_000),
      recv(5, 'pedidosya', 8_000_000),
      line({
        lineNo: 6,
        role: 'receivable',
        accountId: empresa.receivableAccountId,
        side: 'debit',
        amountCents: 12_100_000,
        partyRef: { id: empresa.id },
        salesMethodId: f.method('customerAccount').id,
        dueDate: '2026-11-05',
      }),
      line({
        lineNo: 7,
        role: 'sales_invoiced',
        accountId: f.sys('sales_salon_invoiced').id,
        side: 'credit',
        amountCents: 29_000_000,
        channel: 'salon',
      }),
      line({
        lineNo: 8,
        role: 'sales_uninvoiced',
        accountId: f.sys('sales_salon_uninvoiced').id,
        side: 'credit',
        amountCents: 14_910_000,
        channel: 'salon',
      }),
      line({
        lineNo: 9,
        role: 'sales_invoiced',
        accountId: f.sys('sales_delivery_invoiced').id,
        side: 'credit',
        amountCents: 5_000_000,
        channel: 'delivery',
      }),
      line({
        lineNo: 10,
        role: 'sales_uninvoiced',
        accountId: f.sys('sales_delivery_uninvoiced').id,
        side: 'credit',
        amountCents: 1_950_000,
        channel: 'delivery',
      }),
      line({
        lineNo: 11,
        role: 'sales_invoiced',
        accountId: f.sys('sales_events_invoiced').id,
        side: 'credit',
        amountCents: 10_000_000,
        channel: 'events',
      }),
      line({
        lineNo: 12,
        role: 'vat',
        accountId: f.sys('vat_debit').id,
        side: 'credit',
        amountCents: 9_240_000,
        vatRateBp: 2100,
        baseCents: 44_000_000,
        vatComputedCents: 9_240_000,
      }),
    ],
    fiscalVouchers: [
      fvSales('factura_b', 3, 14_663, 14_720, 'salon', {
        net_21_cents: 30_000_000,
        vat_21_cents: 6_300_000,
        total_cents: 36_300_000,
      }),
      fvSales('nota_credito_b', 3, 45, 45, 'salon', {
        net_21_cents: 1_000_000,
        vat_21_cents: 210_000,
        total_cents: 1_210_000,
      }),
      fvSales(
        'factura_a',
        3,
        89,
        89,
        'events',
        { net_21_cents: 10_000_000, vat_21_cents: 2_100_000, total_cents: 12_100_000 },
        empresa,
      ),
      fvSales('factura_b', 4, 2_131, 2_140, 'delivery', {
        net_21_cents: 5_000_000,
        vat_21_cents: 1_050_000,
        total_cents: 6_050_000,
      }),
    ],
  })
}

/** E9 · acreditación de crédito con liquidación. */
function e9(): ProposedDocument {
  const posnet = f.party('posnetCredito')
  return doc({
    kind: 'collection',
    voucherType: 'liquidacion',
    party: { id: posnet.id },
    issueDate: '2026-10-15',
    accountingDate: '2026-10-15',
    pointOfSale: 0,
    number: 4512,
    totalCents: 33_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'treasury',
        accountId: f.treasury('banco').accountId,
        side: 'debit',
        amountCents: 31_555_260,
        treasuryAccountId: f.treasury('banco').id,
      }),
      line({
        lineNo: 2,
        role: 'deduction',
        accountId: f.sys('fees_cards').id,
        side: 'debit',
        amountCents: 594_000,
        taxKind: 'comision',
      }),
      line({
        lineNo: 3,
        role: 'deduction',
        accountId: f.sys('vat_credit').id,
        side: 'debit',
        amountCents: 124_740,
        taxKind: 'iva_comision',
      }),
      line({
        lineNo: 4,
        role: 'deduction',
        accountId: f.sys('iibb_withholdings').id,
        side: 'debit',
        amountCents: 396_000,
        taxKind: 'ret_iibb',
      }),
      line({
        lineNo: 5,
        role: 'deduction',
        accountId: f.sys('income_tax_withholdings').id,
        side: 'debit',
        amountCents: 330_000,
        taxKind: 'ret_ganancias',
        certificateNumber: '0001-00004567',
      }),
      line({
        lineNo: 6,
        role: 'control',
        accountId: posnet.receivableAccountId,
        side: 'credit',
        amountCents: 33_000_000,
        partyRef: { id: posnet.id },
      }),
    ],
    fiscalVouchers: [
      fvPurchase(posnet, 'liquidacion', 0, 4512, '2026-10-15', {
        net_21_cents: 594_000,
        vat_21_cents: 124_740,
        total_cents: 718_740,
        vat_computable_cents: 124_740,
      }),
    ],
  })
}

/** E10b · liquidación con neto negativo: le debemos a PedidosYa. */
function e10b(): ProposedDocument {
  const pya = f.party('pedidosya')
  return doc({
    kind: 'collection',
    party: { id: pya.id },
    accountingDate: '2026-10-20',
    issueDate: '2026-10-20',
    totalCents: 21_780_000,
    lines: [
      line({
        lineNo: 1,
        role: 'deduction',
        accountId: f.sys('fees_platforms').id,
        side: 'debit',
        amountCents: 18_000_000,
        taxKind: 'comision',
      }),
      line({
        lineNo: 2,
        role: 'deduction',
        accountId: f.sys('vat_credit_pending').id,
        side: 'debit',
        amountCents: 3_780_000,
        taxKind: 'iva_comision',
        partyRef: { id: pya.id },
      }),
      line({
        lineNo: 3,
        role: 'control',
        accountId: pya.receivableAccountId,
        side: 'credit',
        amountCents: 21_780_000,
        partyRef: { id: pya.id },
      }),
    ],
  })
}

/** E12 · resumen del Banco Nación con Ley 25.413, en el libro IVA. */
function e12(): ProposedDocument {
  const banco = f.party('bancoNacion')
  const t = f.treasury('banco')
  return doc({
    kind: 'bank_expense',
    voucherType: 'resumen_bancario',
    pointOfSale: 1,
    number: 202_610,
    accountingDate: '2026-10-31',
    issueDate: '2026-10-31',
    totalCents: 1_518_000,
    lines: [
      line({
        lineNo: 1,
        role: 'net',
        accountId: f.sys('bank_fees').id,
        side: 'debit',
        amountCents: 800_000,
        vatRateBp: 2100,
        baseCents: 800_000,
      }),
      line({
        lineNo: 2,
        role: 'vat',
        accountId: f.sys('vat_credit').id,
        side: 'debit',
        amountCents: 168_000,
        vatRateBp: 2100,
        baseCents: 800_000,
        vatComputedCents: 168_000,
      }),
      line({
        lineNo: 3,
        role: 'other_tax',
        accountId: f.sys('bank_tax_credit').id,
        side: 'debit',
        amountCents: 59_400,
        taxKind: 'ley_25413_credito',
      }),
      line({
        lineNo: 4,
        role: 'other_tax',
        accountId: f.sys('bank_tax_expense').id,
        side: 'debit',
        amountCents: 120_600,
        taxKind: 'ley_25413_credito',
      }),
      line({
        lineNo: 5,
        role: 'other_tax',
        accountId: f.sys('bank_tax_credit').id,
        side: 'debit',
        amountCents: 39_600,
        taxKind: 'ley_25413_debito',
      }),
      line({
        lineNo: 6,
        role: 'other_tax',
        accountId: f.sys('bank_tax_expense').id,
        side: 'debit',
        amountCents: 80_400,
        taxKind: 'ley_25413_debito',
      }),
      line({
        lineNo: 7,
        role: 'other_tax',
        accountId: f.sys('iibb_sircreb').id,
        side: 'debit',
        amountCents: 250_000,
        taxKind: 'sircreb',
      }),
      line({
        lineNo: 8,
        role: 'treasury',
        accountId: t.accountId,
        side: 'credit',
        amountCents: 1_518_000,
        treasuryAccountId: t.id,
      }),
    ],
    fiscalVouchers: [
      fvPurchase(banco, 'resumen_bancario', 1, 202_610, '2026-10-31', {
        net_21_cents: 800_000,
        vat_21_cents: 168_000,
        total_cents: 968_000,
        vat_computable_cents: 168_000,
      }),
    ],
  })
}

/** E13 · sueldos del mes (asiento manual de la plantilla). */
function e13(): ProposedDocument {
  return doc({
    kind: 'manual',
    entryKind: 'payroll',
    accountingDate: '2026-10-31',
    issueDate: '2026-10-31',
    totalCents: 558_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'manual',
        accountId: f.sys('salaries').id,
        side: 'debit',
        amountCents: 450_000_000,
      }),
      line({
        lineNo: 2,
        role: 'manual',
        accountId: f.sys('employer_contributions').id,
        side: 'debit',
        amountCents: 108_000_000,
      }),
      line({
        lineNo: 3,
        role: 'manual',
        accountId: f.sys('payroll_payable').id,
        side: 'credit',
        amountCents: 373_500_000,
        partyRef: id('personal'),
        dueDate: '2026-11-05',
      }),
      line({
        lineNo: 4,
        role: 'manual',
        accountId: f.sys('social_security_payable').id,
        side: 'credit',
        amountCents: 184_500_000,
        partyRef: id('arcaSs'),
        dueDate: '2026-11-09',
      }),
    ],
  })
}

/** E14 · asiento de apertura del 01/10/2026. */
function e14(): ProposedDocument {
  return doc({
    kind: 'opening',
    issueDate: '2026-10-01',
    accountingDate: '2026-10-01',
    totalCents: 209_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'opening',
        accountId: f.treasury('caja').accountId,
        side: 'debit',
        amountCents: 15_000_000,
      }),
      line({
        lineNo: 2,
        role: 'opening',
        accountId: f.treasury('mp').accountId,
        side: 'debit',
        amountCents: 82_000_000,
      }),
      line({
        lineNo: 3,
        role: 'opening',
        accountId: f.treasury('banco').accountId,
        side: 'debit',
        amountCents: 100_000_000,
      }),
      line({
        lineNo: 4,
        role: 'opening',
        accountId: f.sys('receivable_credit_cards').id,
        side: 'debit',
        amountCents: 12_000_000,
        partyRef: id('posnetCredito'),
        dueDate: '2026-10-05',
      }),
      line({
        lineNo: 5,
        role: 'opening',
        accountId: payable.id,
        side: 'credit',
        amountCents: 38_000_000,
        partyRef: id('cocacola'),
        dueDate: '2026-10-21',
        reference: 'Factura A 0003-00001234',
      }),
      line({
        lineNo: 6,
        role: 'opening',
        accountId: f.sys('share_capital').id,
        side: 'credit',
        amountCents: 100_000_000,
      }),
      line({
        lineNo: 7,
        role: 'opening',
        accountId: f.sys('opening_equity').id,
        side: 'credit',
        amountCents: 71_000_000,
      }),
    ],
  })
}

/** E15a · liquidación de IVA de octubre (la genera su RPC; acá solo se valida el documento). */
function e15a(): ProposedDocument {
  return doc({
    kind: 'iva_settlement',
    entryKind: 'iva_settlement',
    party: id('arca'),
    accountingDate: '2026-10-31',
    issueDate: '2026-10-31',
    totalCents: 131_040_000,
    lines: [
      line({
        lineNo: 1,
        role: 'settlement',
        accountId: f.sys('vat_debit').id,
        side: 'debit',
        amountCents: 131_040_000,
      }),
      line({
        lineNo: 2,
        role: 'settlement',
        accountId: f.sys('vat_credit').id,
        side: 'credit',
        amountCents: 41_000_000,
      }),
      line({
        lineNo: 3,
        role: 'settlement',
        accountId: f.sys('vat_perceptions').id,
        side: 'credit',
        amountCents: 600_000,
      }),
      line({
        lineNo: 4,
        role: 'settlement',
        accountId: f.sys('vat_withholdings').id,
        side: 'credit',
        amountCents: 300_000,
      }),
      line({
        lineNo: 5,
        role: 'settlement',
        accountId: f.sys('vat_payable').id,
        side: 'credit',
        amountCents: 89_140_000,
        partyRef: id('arca'),
        dueDate: '2026-11-20',
      }),
    ],
  })
}

/** E17 · «Ajustar saldo de Mercado Pago» el 12/10. */
function e17(): ProposedDocument {
  const mp = f.party('mercadopago')
  const qr = f.method('qr').id
  const transfer = f.method('transfer').id
  return doc({
    kind: 'collection',
    party: { id: mp.id },
    accountingDate: '2026-10-12',
    issueDate: '2026-10-12',
    countedCents: 88_200_000,
    expectedBookCents: 50_000_000,
    totalCents: 40_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'treasury',
        accountId: f.treasury('mp').accountId,
        side: 'debit',
        amountCents: 38_200_000,
        treasuryAccountId: f.treasury('mp').id,
      }),
      line({
        lineNo: 2,
        role: 'deduction',
        accountId: f.sys('fees_wallets').id,
        side: 'debit',
        amountCents: 330_000,
        taxKind: 'comision',
        salesMethodId: qr,
      }),
      line({
        lineNo: 3,
        role: 'deduction',
        accountId: f.sys('vat_credit_pending').id,
        side: 'debit',
        amountCents: 69_300,
        taxKind: 'iva_comision',
        partyRef: { id: mp.id },
        salesMethodId: qr,
      }),
      line({
        lineNo: 4,
        role: 'deduction',
        accountId: f.sys('iibb_sircupa').id,
        side: 'debit',
        amountCents: 630_000,
        taxKind: 'sircupa',
        salesMethodId: transfer,
      }),
      line({
        lineNo: 5,
        role: 'deduction',
        accountId: f.sys('iibb_sircupa').id,
        side: 'debit',
        amountCents: 770_000,
        taxKind: 'sircupa',
        salesMethodId: qr,
      }),
      line({
        lineNo: 6,
        role: 'deduction',
        accountId: f.sys('reconciliation_differences').id,
        side: 'debit',
        amountCents: 700,
        taxKind: 'diferencia',
      }),
      line({
        lineNo: 7,
        role: 'control',
        accountId: mp.receivableAccountId,
        side: 'credit',
        amountCents: 40_000_000,
        partyRef: { id: mp.id },
      }),
    ],
  })
}

/** E18 · arqueo de caja con faltante. */
function e18(): ProposedDocument {
  const caja = f.treasury('caja')
  return doc({
    kind: 'treasury_adjustment',
    accountingDate: '2026-10-31',
    issueDate: '2026-10-31',
    countedCents: 45_000_000,
    expectedBookCents: 45_230_000,
    totalCents: 230_000,
    lines: [
      line({
        lineNo: 1,
        role: 'adjustment_split',
        accountId: f.sys('cash_short').id,
        side: 'debit',
        amountCents: 230_000,
        taxKind: 'diferencia',
      }),
      line({
        lineNo: 2,
        role: 'treasury',
        accountId: caja.accountId,
        side: 'credit',
        amountCents: 230_000,
        treasuryAccountId: caja.id,
      }),
    ],
  })
}

/** E11 · depósito del efectivo (Mover plata). */
function e11(): ProposedDocument {
  return doc({
    kind: 'transfer',
    totalCents: 50_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'treasury',
        accountId: f.treasury('banco').accountId,
        side: 'debit',
        amountCents: 50_000_000,
        treasuryAccountId: f.treasury('banco').id,
      }),
      line({
        lineNo: 2,
        role: 'treasury',
        accountId: f.treasury('caja').accountId,
        side: 'credit',
        amountCents: 50_000_000,
        treasuryAccountId: f.treasury('caja').id,
      }),
    ],
  })
}

/** E21 · Máximo retira $ 100.000 de la caja. */
function e21(): ProposedDocument {
  return doc({
    kind: 'cash_movement',
    totalCents: 10_000_000,
    lines: [
      line({
        lineNo: 1,
        role: 'counterpart',
        accountId: f.sys('partners_current').id,
        side: 'debit',
        amountCents: 10_000_000,
        partyRef: id('maximo'),
      }),
      line({
        lineNo: 2,
        role: 'treasury',
        accountId: f.treasury('caja').accountId,
        side: 'credit',
        amountCents: 10_000_000,
        treasuryAccountId: f.treasury('caja').id,
      }),
    ],
  })
}

function errorsOf(d: ProposedDocument) {
  return validateDocument(d, ctx).errors.map((e) => e.key)
}

describe('los ejemplos de E pasan todas las reglas (matriz, totales y conciliación)', () => {
  const cases: Array<[string, () => ProposedDocument]> = [
    ['E1 Factura A', e1],
    ['E2 Factura A con percepciones', e2],
    ['E3 Factura C de monotributista', e3],
    ['E4 gasto sin comprobante', e4],
    ['E6 nota de crédito A', e6],
    ['E7 pago con dos medios', e7],
    ['E7 IIBB compensando saldos', e7Compensation],
    ['E8 cierre del día', e8],
    ['E8b cierre con NC, A y tres canales', e8b],
    ['E9 acreditación con liquidación', e9],
    ['E10b liquidación con neto negativo', e10b],
    ['E11 movimiento entre cuentas', e11],
    ['E12 gasto bancario en el libro IVA', e12],
    ['E13 sueldos', e13],
    ['E14 apertura', e14],
    ['E15a liquidación de IVA', e15a],
    ['E17 ajuste de saldo de Mercado Pago', e17],
    ['E18 arqueo con faltante', e18],
    ['E21 retiro de un socio', e21],
  ]
  for (const [name, build] of cases) {
    it(name, () => {
      expect(validateDocument(build(), ctx).errors).toEqual([])
    })
  }

  it('E5: el bundle [purchase, payment] con su imputación', () => {
    const result = validateBundle(e5(), ctx)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('totales por tipo (C.3.5)', () => {
    expect(expectedDocumentTotal(e8())).toBe(170_000_000)
    expect(expectedDocumentTotal(e8b())).toBe(70_100_000)
    expect(expectedDocumentTotal(e9())).toBe(33_000_000)
    expect(expectedDocumentTotal(e14())).toBe(209_000_000)
    expect(expectedDocumentTotal(e11())).toBe(50_000_000)
  })
})

describe('matriz de roles (espejo de acc_line_rule)', () => {
  it('las NC invierten todos los lados', () => {
    expect(lineRule('purchase', 'control')?.sides).toEqual(['credit'])
    expect(lineRule('purchase_credit_note', 'control')?.sides).toEqual(['debit'])
    expect(lineRule('sales_credit_note', 'sales_invoiced')?.sides).toEqual(['debit'])
  })

  it('cada tipo admite solo sus roles', () => {
    expect(rolesForKind('expense')).toEqual(['gross', 'treasury'])
    expect(rolesForKind('transfer')).toEqual(['treasury'])
    expect(lineRule('expense', 'net')).toBeNull()
    expect(lineRule('payment', 'deduction')).toBeNull()
  })

  it('rol o lado que no corresponde → invalid_line_role', () => {
    const d = e4()
    const bad = {
      ...d,
      lines: d.lines.map((l) => (l.role === 'treasury' ? { ...l, side: 'debit' as const } : l)),
    }
    expect(errorsOf(bad)).toContain('invalid_line_role')
  })

  it('una cuenta que no es de la regla del rol → line_account_invalid', () => {
    const d = e1()
    d.lines[0] = { ...(d.lines[0] as DocLine), accountId: f.sys('sales_salon_invoiced').id }
    expect(errorsOf(d)).toContain('line_account_invalid')
  })

  it('una B no admite neto ni IVA', () => {
    const d = e1()
    d.voucherType = 'factura_b'
    expect(errorsOf(d)).toContain('vat_not_allowed_for_voucher')
  })

  it('compensar con un proveedor que no es organismo → compensation_not_allowed', () => {
    const d = e7Compensation()
    d.party = id('cocacola')
    d.lines[0] = { ...(d.lines[0] as DocLine), accountId: payable.id, partyRef: id('cocacola') }
    expect(errorsOf(d)).toContain('compensation_not_allowed')
  })

  it('el IVA de una compra va a crédito fiscal solo si computa', () => {
    // SAS monotributista: la Factura A de un RI no computa → el IVA va al costo.
    const mono = { ...ctx, settings: { ...ctx.settings, ivaCondition: 'monotributo' as const } }
    expect(validateDocument(e1(), mono).errors.map((e) => e.key)).toContain('line_account_invalid')
    const toCost = e1()
    toCost.lines[1] = {
      ...(toCost.lines[1] as DocLine),
      accountId: f.sys('purchases_soft_drinks').id,
    }
    const fv = toCost.fiscalVouchers[0]
    if (fv) fv.amounts = { ...fv.amounts, vat_computable_cents: 0 }
    expect(validateDocument(toCost, mono).errors).toEqual([])
    // Con la SAS responsable inscripta, mandar el IVA al costo es un error.
    expect(errorsOf(toCost)).toContain('line_account_invalid')
  })

  it('el IVA bancario va a crédito fiscal solo si el gasto entra al libro IVA', () => {
    const outOfBook = {
      ...e12(),
      voucherType: null,
      pointOfSale: null,
      number: null,
      fiscalVouchers: [],
    }
    expect(errorsOf(outOfBook)).toContain('line_account_invalid')
    outOfBook.lines = outOfBook.lines.map((l) =>
      l.role === 'vat' ? { ...l, accountId: f.sys('bank_fees').id } : l,
    )
    expect(errorsOf(outOfBook)).toEqual([])
  })

  it('compensar más que el saldo disponible (si el formulario trae los saldos)', () => {
    const balances = new Map([
      [f.sys('iibb_sircupa').id, 100_000_000],
      [f.sys('iibb_withholdings').id, 60_000_000],
    ])
    const errors = validateDocument(e7Compensation(), ctx, [], {
      compensationBalances: balances,
    }).errors
    expect(errors.map((e) => e.key)).toEqual(['compensation_exceeds_balance'])
    expect(errors[0]?.detail).toMatchObject({
      available_cents: 100_000_000,
      account_code: '1.1.03.10',
    })
    expect(validateDocument(e7Compensation(), ctx).errors).toEqual([])
  })

  it('el IVA de la comisión a documentar es del partícipe del documento', () => {
    const d = e10b()
    d.lines[1] = { ...(d.lines[1] as DocLine), partyRef: id('rappi') }
    expect(errorsOf(d)).toContain('control_party_mismatch')
  })

  it('arqueo de banco contra faltante de caja → adjustment_account_invalid', () => {
    const d = e18()
    const banco = f.treasury('banco')
    d.lines[1] = {
      ...(d.lines[1] as DocLine),
      accountId: banco.accountId,
      treasuryAccountId: banco.id,
    }
    expect(errorsOf(d)).toContain('adjustment_account_invalid')
  })
})

describe('cuentas, partícipes y cajas en los renglones', () => {
  it('cuenta de control sin partícipe, y partícipe donde no va', () => {
    const d = e1()
    d.lines[2] = { ...(d.lines[2] as DocLine), partyRef: null, dueDate: null }
    expect(errorsOf(d)).toContain('account_requires_party')
    const e = e4()
    e.lines[0] = { ...(e.lines[0] as DocLine), partyRef: id('cocacola') }
    expect(errorsOf(e)).toContain('party_not_allowed')
  })

  it('la línea de control lleva EL partícipe del documento', () => {
    const d = e1()
    d.lines[2] = { ...(d.lines[2] as DocLine), partyRef: id('carniceria') }
    expect(errorsOf(d)).toContain('control_party_mismatch')
  })

  it('cuenta inexistente, de grupo o desactivada', () => {
    const d = e4()
    d.lines[0] = { ...(d.lines[0] as DocLine), accountId: '00000000-0000-4000-8000-999999999999' }
    expect(errorsOf(d)).toContain('account_not_found')
    const g = e4()
    g.lines[0] = { ...(g.lines[0] as DocLine), accountId: f.acc('5.1.01').id }
    expect(errorsOf(g)).toContain('account_not_postable')
    const local = buildCoreFixture()
    const soft = local.sys('purchases_soft_drinks')
    ;(local.ctx.accounts as Map<string, typeof soft>).set(soft.id, { ...soft, active: false })
    const inactive = e4()
    inactive.lines[0] = { ...(inactive.lines[0] as DocLine), accountId: soft.id }
    expect(validateDocument(inactive, local.ctx).errors.map((e) => e.key)).toContain(
      'account_inactive',
    )
  })

  it('caja que no coincide con su cuenta → treasury_mismatch', () => {
    const d = e4()
    d.lines[1] = { ...(d.lines[1] as DocLine), treasuryAccountId: f.treasury('banco').id }
    expect(errorsOf(d)).toContain('treasury_mismatch')
  })

  it('medio de cobro incoherente en el cierre → sales_method_mismatch', () => {
    const d = e8()
    d.lines[2] = { ...(d.lines[2] as DocLine), salesMethodId: f.method('debit').id }
    expect(errorsOf(d)).toContain('sales_method_mismatch')
  })

  it('IVA calculado que no es round_half_up(base × tasa) → vat_computed_mismatch', () => {
    const d = e1()
    d.lines[1] = { ...(d.lines[1] as DocLine), vatComputedCents: 14_925_619 }
    expect(errorsOf(d)).toContain('vat_computed_mismatch')
  })

  it('mismas cajas en un movimiento → same_treasury', () => {
    const d = e11()
    const caja = f.treasury('caja')
    d.lines[0] = {
      ...(d.lines[0] as DocLine),
      accountId: caja.accountId,
      treasuryAccountId: caja.id,
    }
    expect(errorsOf(d)).toContain('same_treasury')
  })
})

describe('cuadre, totales y conciliación fiscal', () => {
  it('descuadrado → entry_not_balanced con los totales', () => {
    const d = e4()
    d.lines[1] = { ...(d.lines[1] as DocLine), amountCents: 449_999 }
    const errors = validateDocument(d, ctx).errors
    expect(errors.find((e) => e.key === 'entry_not_balanced')?.detail).toEqual({
      debit_cents: 450_000,
      credit_cents: 449_999,
    })
  })

  it('un asiento manual necesita dos líneas', () => {
    const d = e13()
    d.lines = d.lines.slice(0, 1)
    expect(errorsOf(d)).toContain('entry_too_few_lines')
  })

  it('total del documento distinto de los renglones → total_mismatch', () => {
    const d = e1()
    d.totalCents = 86_000_001
    expect(errorsOf(d)).toContain('total_mismatch')
  })

  it('conciliación con el libro IVA: un centavo de diferencia → fiscal_mismatch', () => {
    const d = e1()
    const fv = d.fiscalVouchers[0]
    if (!fv) throw new Error('sin comprobante')
    fv.amounts = { ...fv.amounts, vat_computable_cents: 0 }
    expect(reconcileFiscal(d, ctx)).toBe('vat_computable')
    expect(errorsOf(d)).toContain('fiscal_mismatch')
  })

  it('cierre del día: lo sin factura tiene que ser vendido − facturado', () => {
    const d = e8()
    const unInvoiced = d.lines.find((l) => l.role === 'sales_uninvoiced' && l.channel === 'salon')
    const invoiced = d.lines.find((l) => l.role === 'sales_invoiced' && l.channel === 'salon')
    if (!unInvoiced || !invoiced) throw new Error('falta')
    unInvoiced.amountCents -= 1
    invoiced.amountCents += 1
    expect(reconcileFiscal(d, ctx)).toBe('sales_invoiced_salon')
  })

  it('un cierre del día sin filas facturadas igual concilia', () => {
    const noRows = { ...e8(), fiscalVouchers: [] }
    expect(reconcileFiscal(noRows, ctx)).toBe('sales_invoiced_salon')
    expect(errorsOf(noRows)).toContain('fiscal_mismatch')
    // Todo sin factura: vendido 10.000.000 en efectivo → H Ventas salón: sin factura.
    const allUninvoiced = doc({
      kind: 'sales_close',
      totalCents: 10_000_000,
      lines: [
        line({
          lineNo: 1,
          role: 'treasury',
          accountId: f.treasury('caja').accountId,
          side: 'debit',
          amountCents: 10_000_000,
          treasuryAccountId: f.treasury('caja').id,
          salesMethodId: f.method('cash').id,
        }),
        line({
          lineNo: 2,
          role: 'sales_uninvoiced',
          accountId: f.sys('sales_salon_uninvoiced').id,
          side: 'credit',
          amountCents: 10_000_000,
          channel: 'salon',
        }),
      ],
    })
    expect(validateDocument(allUninvoiced, ctx).errors).toEqual([])
    const wrongChannel = {
      ...allUninvoiced,
      lines: allUninvoiced.lines.map((l) =>
        l.role === 'sales_uninvoiced'
          ? { ...l, channel: 'delivery' as const, accountId: f.sys('sales_delivery_uninvoiced').id }
          : l,
      ),
    }
    expect(reconcileFiscal(wrongChannel, ctx)).toMatch(/^sales_uninvoiced_/)
  })

  it('comprobante fiscal obligatorio en una compra con factura, prohibido en un gasto', () => {
    const d = e1()
    d.fiscalVouchers = []
    expect(errorsOf(d)).toContain('fiscal_voucher_missing')
    const e = e4()
    e.fiscalVouchers = e1().fiscalVouchers
    expect(errorsOf(e)).toContain('fiscal_voucher_not_allowed')
  })

  it('libro IVA de compras sin CUIT de la contraparte → party_tax_id_required', () => {
    const d = e1()
    const fv = d.fiscalVouchers[0]
    if (!fv) throw new Error('sin comprobante')
    fv.counterparty = { ...fv.counterparty, docType: 99, docNumber: '0' }
    expect(errorsOf(d)).toContain('party_tax_id_required')
  })

  it('una fila de ventas sin «hasta» → range_required; al revés → range_invalid', () => {
    const d = e8()
    const fv = d.fiscalVouchers[0]
    if (!fv) throw new Error('sin fila')
    expect(errorsOf({ ...d, fiscalVouchers: [{ ...fv, numberTo: null }] })).toContain(
      'range_required',
    )
    expect(errorsOf({ ...d, fiscalVouchers: [{ ...fv, numberTo: 14_000 }] })).toContain(
      'range_invalid',
    )
  })

  it('arqueo: lo contado menos el libro tiene que ser lo que entra o sale de la caja', () => {
    expect(errorsOf({ ...e17(), countedCents: 88_200_001 })).toContain('balance_check_mismatch')
    expect(errorsOf({ ...e18(), countedCents: 45_000_001 })).toContain('balance_check_mismatch')
  })
})

describe('fechas (C.3.3 pasos 5.2 y 5.3)', () => {
  it('antes del arranque, futura, y el manual hasta fin de mes', () => {
    expect(
      validateDates({ ...e4(), accountingDate: '2026-09-30', issueDate: '2026-09-30' }, ctx)
        .errors[0]?.key,
    ).toBe('date_before_start')
    expect(
      validateDates({ ...e4(), accountingDate: '2026-11-01', issueDate: '2026-11-01' }, ctx)
        .errors[0]?.key,
    ).toBe('date_in_future')
    const manualCtx = { ...ctx, today: '2026-10-20' }
    expect(
      validateDates({ ...e13(), accountingDate: '2026-10-31', issueDate: '2026-10-31' }, manualCtx)
        .errors,
    ).toEqual([])
  })

  it('mes cerrado con el primer día abierto, y ajustes de cierre en el último día del ejercicio', () => {
    expect(
      validateDates({ ...e4(), accountingDate: '2026-10-15', issueDate: '2026-10-15' }, ctx, {
        firstOpenDate: '2026-11-01',
      }).errors[0],
    ).toEqual({ key: 'period_closed', field: 'accountingDate', detail: { month: '2026-10' } })
    expect(
      validateDates({ ...e13(), entryKind: 'fy_adjustment' }, ctx, {
        fiscalYearEndDate: '2026-12-31',
      }).errors[0]?.key,
    ).toBe('fy_adjustment_date')
  })

  it('compra registrada más de 60 días después de la emisión → aviso late_registration', () => {
    const late = { ...e1(), issueDate: '2026-07-20', accountingDate: '2026-10-03' }
    expect(validateDates(late, ctx).warnings[0]?.key).toBe('late_registration')
  })

  it('vencimiento anterior a la emisión', () => {
    expect(validateDates({ ...e1(), dueDate: '2026-10-01' }, ctx).errors[0]?.key).toBe(
      'due_before_issue',
    )
  })
})

describe('partícipe y tipo de comprobante (C.3.3 pasos 5.1 y 5.4)', () => {
  it('obligatorio, tipo compatible, activo, DDJJ solo con organismo', () => {
    expect(
      validateParty({ kind: 'purchase', party: null, voucherType: 'factura_a' }, ctx).errors[0]
        ?.key,
    ).toBe('party_required')
    expect(
      validateParty({ kind: 'sales_invoice', party: id('cocacola'), voucherType: 'factura_a' }, ctx)
        .errors[0]?.key,
    ).toBe('party_kind_mismatch')
    expect(
      validateParty({ kind: 'purchase', party: id('cocacola'), voucherType: 'ddjj_impuesto' }, ctx)
        .errors[0]?.key,
    ).toBe('ddjj_requires_tax_agency')
    expect(
      validateParty({ kind: 'purchase', party: id('rentas'), voucherType: 'ddjj_impuesto' }, ctx)
        .errors,
    ).toEqual([])
    expect(
      validateParty({ kind: 'expense', party: null, voucherType: 'sin_comprobante' }, ctx).errors,
    ).toEqual([])
  })

  it('matriz de E.3: C de un RI rechazada, B con aviso, M con aviso', () => {
    const ri = validateParty(
      { kind: 'purchase', party: id('cocacola'), voucherType: 'factura_c' },
      ctx,
    ).party
    expect(
      validateVoucher({ ref: 'd1', kind: 'purchase', voucherType: 'factura_c' }, ri).errors[0]?.key,
    ).toBe('invalid_voucher_for_condition')
    expect(
      validateVoucher({ ref: 'd1', kind: 'purchase', voucherType: 'factura_b' }, ri).warnings,
    ).toEqual([{ key: 'voucher_condition', document: 'd1', detail: { voucher_type: 'factura_b' } }])
    expect(
      validateVoucher({ ref: 'd1', kind: 'purchase', voucherType: 'factura_m' }, ri).warnings[0]
        ?.key,
    ).toBe('voucher_m')
    expect(
      validateVoucher({ ref: 'd1', kind: 'expense', voucherType: 'factura_a' }, ri).errors[0]?.key,
    ).toBe('invalid_voucher_for_kind')
  })

  it('un gasto de contado con proveedor no pasa por la matriz (no frena «Nuevo gasto»)', () => {
    const ri = validateParty(
      { kind: 'expense', party: id('cocacola'), voucherType: 'sin_comprobante' },
      ctx,
    ).party
    expect(
      validateVoucher({ ref: 'd1', kind: 'expense', voucherType: 'sin_comprobante' }, ri),
    ).toEqual({
      errors: [],
      warnings: [],
    })
  })
})

describe('bundle: composición, imputaciones y avisos', () => {
  it('composiciones permitidas (C.3.2)', () => {
    expect(isAllowedComposition(['purchase', 'payment'])).toBe(true)
    expect(isAllowedComposition(['sales_close', 'collection', 'collection'])).toBe(true)
    expect(isAllowedComposition(['sales_invoice', 'collection'])).toBe(true)
    expect(isAllowedComposition(['collection', 'treasury_adjustment'])).toBe(true)
    expect(isAllowedComposition(['payment', 'purchase'])).toBe(false)
    expect(isAllowedComposition(['expense', 'expense'])).toBe(false)
    expect(isAllowedComposition(['iva_settlement'])).toBe(false)
  })

  it('lo que generan sus RPC no entra por acc_post_bundle → kind_not_allowed', () => {
    const bundle: ProposedBundle = {
      clientRef: 'x',
      newParties: [],
      documents: [e15a()],
      allocations: [],
    }
    expect(validateBundle(bundle, ctx).errors.map((e) => e.key)).toEqual(['kind_not_allowed'])
  })

  it('imputación por más de lo abierto, del mismo lado o de otro partícipe', () => {
    const over = e5()
    const a = over.allocations[0]
    if (!a) throw new Error('sin imputación')
    a.amountCents = 1_210_001
    expect(validateBundle(over, ctx).errors.map((e) => e.key)).toContain('allocation_exceeds_open')

    const sameSide = e5()
    const s = sameSide.allocations[0]
    if (!s) throw new Error('sin imputación')
    s.debit = { doc: 'd1', lineNo: 3 }
    expect(validateBundle(sameSide, ctx).errors.map((e) => e.key)).toContain(
      'allocation_side_mismatch',
    )

    const missing = e5()
    const m = missing.allocations[0]
    if (!m) throw new Error('sin imputación')
    m.credit = { lineId: '00000000-0000-4000-8000-000000000404' }
    expect(validateBundle(missing, ctx).errors.map((e) => e.key)).toContain('item_not_found')
  })

  it('caja que queda en negativo: avisa solo si el bundle le saca plata', () => {
    const big = e4()
    big.lines = big.lines.map((l) => ({ ...l, amountCents: 20_000_000 }))
    big.totalCents = 20_000_000
    expect(treasuryNegativeWarnings([big], ctx)).toEqual([
      {
        key: 'treasury_negative',
        detail: {
          treasury_id: f.treasury('caja').id,
          treasury_name: 'Caja',
          balance_after_cents: -5_000_000,
        },
      },
    ])
    // El banco admite descubierto.
    expect(treasuryNegativeWarnings([e7()], ctx).map((w) => w.detail?.treasury_name)).toEqual([])
    expect(treasuryNegativeWarnings([e4()], ctx)).toEqual([])
  })

  it('posible duplicado: gasto sin número igual a otro en 24 h', () => {
    const recent = [
      {
        kind: 'expense' as const,
        partyId: null,
        accountId: f.sys('purchases_soft_drinks').id,
        totalCents: 450_000,
        accountingDate: '2026-10-02',
        number: null,
        label: 'Compras: bebidas sin alcohol',
      },
    ]
    const candidate = {
      kind: 'expense' as const,
      partyId: null,
      accountId: f.sys('purchases_soft_drinks').id,
      totalCents: 450_000,
      accountingDate: '2026-10-03',
      number: null,
    }
    const match = findPossibleDuplicate(candidate, recent)
    expect(match?.label).toBe('Compras: bebidas sin alcohol')
    if (!match) throw new Error('tenía que encontrar el duplicado')
    expect(possibleDuplicateWarning(match, 'd1')).toEqual({
      key: 'possible_duplicate',
      document: 'd1',
      detail: {
        amount_cents: 450_000,
        party_name: 'Compras: bebidas sin alcohol',
        date: '2026-10-02',
      },
    })
    expect(findPossibleDuplicate({ ...candidate, accountingDate: '2026-10-05' }, recent)).toBeNull()
    expect(findPossibleDuplicate({ ...candidate, totalCents: 450_001 }, recent)).toBeNull()
    expect(findPossibleDuplicate({ ...candidate, number: 12 }, recent)).toBeNull()
  })
})
