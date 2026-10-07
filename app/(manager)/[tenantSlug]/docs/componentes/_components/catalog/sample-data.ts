/**
 * Los datos de ejemplo del catálogo (kit HUB §6.5): nombres genéricos
 * («Distribuidora del Centro SA», «Factura A 0003-00001234»), nunca registros
 * reales. Puro y sin React: lo importan las familias (cliente) y el Route
 * Handler de la búsqueda de mentira (server).
 *
 * Las fechas se arman desde `today` (el día de Córdoba que calcula la página
 * una vez en el server), así el server y el cliente dibujan lo mismo.
 */

import type { AccountNode } from '@/components/accounting/account-tree'
import type { AgingBarBucket } from '@/components/accounting/aging-bar'
import type { LedgerRow } from '@/components/accounting/ledger-table'
import type { TreasuryOption } from '@/components/accounting/payment-methods-editor'
import { STANDARD_CHART } from '@/lib/accounting/chart'
import { addDays } from '@/lib/dates/civil'

// ─── Proveedores ─────────────────────────────────────────────────────────────

export type SampleSupplier = {
  id: string
  name: string
  condition: 'Responsable inscripto' | 'Monotributo' | 'Exento'
  category: string
  /** Saldo en centavos (lo que se les debe). */
  balanceCents: number
  /** Días de hoy al vencimiento: negativo es vencido; `null`, sin vencimiento. */
  dueInDays: number | null
  /** Pagado: el semáforo dice «Pagada». */
  settled?: boolean
}

export const SAMPLE_SUPPLIERS: readonly SampleSupplier[] = [
  {
    id: 'prov-1',
    name: 'Distribuidora del Centro SA',
    condition: 'Responsable inscripto',
    category: 'Bebidas',
    balanceCents: 124_000_000,
    dueInDays: -3,
  },
  {
    id: 'prov-2',
    name: 'Bebidas del Sur SRL',
    condition: 'Responsable inscripto',
    category: 'Bebidas',
    balanceCents: 86_000_000,
    dueInDays: 5,
  },
  {
    id: 'prov-3',
    name: 'Panificadora La Esquina',
    condition: 'Monotributo',
    category: 'Panadería',
    balanceCents: 4_350_000,
    dueInDays: 0,
  },
  {
    id: 'prov-4',
    name: 'Lácteos Serranos SA',
    condition: 'Responsable inscripto',
    category: 'Lácteos',
    balanceCents: 21_780_050,
    dueInDays: 18,
  },
  {
    id: 'prov-5',
    name: 'Frigorífico Norte SA',
    condition: 'Responsable inscripto',
    category: 'Carnes',
    balanceCents: 0,
    dueInDays: null,
    settled: true,
  },
  {
    id: 'prov-6',
    name: 'Verdulería Los Álamos',
    condition: 'Monotributo',
    category: 'Verdulería',
    balanceCents: 1_890_000,
    dueInDays: -41,
  },
  {
    id: 'prov-7',
    name: 'Café Molido SRL',
    condition: 'Responsable inscripto',
    category: 'Cafetería',
    balanceCents: 9_412_000,
    dueInDays: 12,
  },
  {
    id: 'prov-8',
    name: 'Limpieza Integral SRL',
    condition: 'Exento',
    category: 'Limpieza',
    balanceCents: 2_560_000,
    dueInDays: -75,
  },
]

/** El vencimiento de un proveedor de ejemplo como fecha civil, o `null`. */
export function supplierDueDate(supplier: SampleSupplier, today: string): string | null {
  return supplier.dueInDays === null ? null : addDays(today, supplier.dueInDays)
}

/** «Bebidas · Responsable inscripto»: la descripción de la opción en los pickers. */
export function supplierDescription(supplier: SampleSupplier): string {
  return `${supplier.category} · ${supplier.condition}`
}

/** Rubros para el Combobox estático (con grupos). */
export const SAMPLE_CATEGORIES: ReadonlyArray<{ value: string; label: string; group: string }> = [
  { value: 'bebidas', label: 'Bebidas', group: 'Insumos' },
  { value: 'cafeteria', label: 'Cafetería', group: 'Insumos' },
  { value: 'carnes', label: 'Carnes', group: 'Insumos' },
  { value: 'lacteos', label: 'Lácteos', group: 'Insumos' },
  { value: 'panaderia', label: 'Panadería', group: 'Insumos' },
  { value: 'verduleria', label: 'Verdulería', group: 'Insumos' },
  { value: 'descartables', label: 'Descartables y packaging', group: 'Insumos' },
  { value: 'limpieza', label: 'Limpieza e higiene', group: 'Servicios' },
  { value: 'mantenimiento', label: 'Mantenimiento', group: 'Servicios' },
  { value: 'musica', label: 'Música y derechos', group: 'Servicios' },
  { value: 'seguridad', label: 'Seguridad y monitoreo', group: 'Servicios' },
  { value: 'publicidad', label: 'Publicidad en redes', group: 'Comercialización' },
]

// ─── Plan de cuentas ─────────────────────────────────────────────────────────

/**
 * Las hojas de «Caja y bancos» las crea el asistente (el plan estándar no las
 * trae): acá van unas de ejemplo, con una inactiva para mostrar la etiqueta.
 */
const SAMPLE_TREASURY_ACCOUNTS: readonly AccountNode[] = [
  {
    id: '1.1.01.01',
    code: '1.1.01.01',
    name: 'Caja del local',
    postable: true,
    active: true,
    type: 'asset',
    normalSide: 'debit',
    description: 'El efectivo del local',
  },
  {
    id: '1.1.01.02',
    code: '1.1.01.02',
    name: 'Banco (cuenta corriente)',
    postable: true,
    active: true,
    type: 'asset',
    normalSide: 'debit',
    description: 'La cuenta corriente del bar',
  },
  {
    id: '1.1.01.03',
    code: '1.1.01.03',
    name: 'Billetera virtual',
    postable: true,
    active: true,
    type: 'asset',
    normalSide: 'debit',
    description: 'Cobros con QR y transferencias',
  },
  {
    id: '1.1.01.09',
    code: '1.1.01.09',
    name: 'Caja chica (cerrada)',
    postable: true,
    active: false,
    type: 'asset',
    normalSide: 'debit',
    description: 'Una caja que ya no se usa',
  },
]

/**
 * El plan de cuentas estándar (el mismo que siembra la base, `lib/accounting/chart.ts`)
 * como lo lee `AccountPicker`. El id es el código: no hay base detrás.
 */
export const SAMPLE_ACCOUNTS: readonly AccountNode[] = [
  ...STANDARD_CHART.map(
    (account): AccountNode => ({
      id: account.code,
      code: account.code,
      name: account.name,
      postable: account.postable,
      active: true,
      type: account.type,
      normalSide: account.normalSide,
      requiresParty: account.requiresParty,
      description: account.description,
    }),
  ),
  ...SAMPLE_TREASURY_ACCOUNTS,
]

const ACCOUNTS_BY_CODE = new Map(SAMPLE_ACCOUNTS.map((account) => [account.code, account]))

/** Una cuenta de ejemplo por código; tira si no existe (un código mal escrito es un error del catálogo). */
export function sampleAccount(code: string): AccountNode {
  const account = ACCOUNTS_BY_CODE.get(code)
  if (!account) throw new Error(`Catálogo: no hay cuenta de ejemplo «${code}»`)
  return account
}

// ─── Cajas y bancos ──────────────────────────────────────────────────────────

export const SAMPLE_TREASURIES: readonly TreasuryOption[] = [
  {
    id: 'caja-local',
    name: 'Caja del local',
    description: 'Efectivo',
    balanceCents: 31_250_000,
  },
  {
    id: 'banco',
    name: 'Banco (cuenta corriente)',
    description: 'CBU terminado en 0000',
    balanceCents: 412_870_000,
  },
  {
    id: 'billetera',
    name: 'Billetera virtual',
    description: 'Alias bar.de.ejemplo',
    balanceCents: 18_940_000,
  },
]

// ─── Libros ──────────────────────────────────────────────────────────────────

export type SampleLedger = {
  opening: number
  rows: LedgerRow[]
  totals: { debitCents: number; creditCents: number }
  closing: number
}

/**
 * El estado de cuenta de «Distribuidora del Centro SA» (Facturas / Pagos).
 * El saldo acumulado viene escrito como lo daría la función de ventana en SQL:
 * la tabla no suma nada en el navegador.
 */
export function sampleStatement(today: string, basePath: string): SampleLedger {
  const href = `${basePath}#ledger-table`
  return {
    opening: 12_000_000,
    rows: [
      {
        id: 'mov-1',
        date: addDays(today, -40),
        description: 'Factura A 0003-00001198',
        reference: 'Bebidas para el fin de semana',
        href,
        dueDate: addDays(today, -10),
        debitCents: 38_000_000,
        creditCents: null,
        balanceCents: 50_000_000,
      },
      {
        id: 'mov-2',
        date: addDays(today, -28),
        description: 'Pago 0001-00000207',
        reference: 'Transferencia',
        href,
        dueDate: null,
        debitCents: null,
        creditCents: 26_000_000,
        balanceCents: 24_000_000,
      },
      {
        id: 'mov-3',
        date: addDays(today, -20),
        description: 'Factura A 0003-00001234',
        href,
        dueDate: addDays(today, -3),
        debitCents: 86_000_000,
        creditCents: null,
        balanceCents: 110_000_000,
      },
      {
        id: 'mov-4',
        date: addDays(today, -12),
        description: 'Nota de crédito A 0003-00000045',
        reference: 'Devolución de cajones',
        href,
        dueDate: null,
        debitCents: null,
        creditCents: 4_000_000,
        balanceCents: 106_000_000,
      },
      {
        id: 'mov-5',
        date: addDays(today, -6),
        description: 'Factura A 0003-00001290',
        href,
        dueDate: addDays(today, 5),
        debitCents: 18_000_000,
        creditCents: null,
        balanceCents: 124_000_000,
      },
    ],
    totals: { debitCents: 142_000_000, creditCents: 30_000_000 },
    closing: 124_000_000,
  }
}

/** El mayor de «2.1.01.01 Proveedores»: saldo con D/A (acreedor, como corresponde a un pasivo). */
export function sampleLedger(today: string, basePath: string): SampleLedger {
  const href = `${basePath}#ledger-table`
  return {
    opening: -40_000_000,
    rows: [
      {
        id: 'may-1',
        date: addDays(today, -25),
        description: 'Compra · Factura A 0003-00001234',
        reference: 'Distribuidora del Centro SA',
        href,
        debitCents: null,
        creditCents: 86_000_000,
        balanceCents: -126_000_000,
      },
      {
        id: 'may-2',
        date: addDays(today, -18),
        description: 'Pago 0001-00000210',
        reference: 'Distribuidora del Centro SA',
        href,
        debitCents: 50_000_000,
        creditCents: null,
        balanceCents: -76_000_000,
      },
      {
        id: 'may-3',
        date: addDays(today, -9),
        description: 'Compra · Factura B 0002-00000771',
        reference: 'Panificadora La Esquina',
        href,
        debitCents: null,
        creditCents: 4_350_000,
        balanceCents: -80_350_000,
      },
      {
        id: 'may-4',
        date: addDays(today, -2),
        description: 'Nota de crédito A 0003-00000045',
        reference: 'Distribuidora del Centro SA',
        href,
        debitCents: 4_000_000,
        creditCents: null,
        balanceCents: -76_350_000,
      },
    ],
    totals: { debitCents: 54_000_000, creditCents: 90_350_000 },
    closing: -76_350_000,
  }
}

/** La antigüedad de la deuda con proveedores: los cinco tramos, con algo en cada uno. */
export const SAMPLE_AGING: readonly AgingBarBucket[] = [
  { bucket: 'current', cents: 52_000_000, count: 3 },
  { bucket: 'soon', cents: 18_000_000, count: 1 },
  { bucket: 'overdue-1-30', cents: 38_000_000, count: 2 },
  { bucket: 'overdue-31-60', cents: 9_500_000, count: 1 },
  { bucket: 'overdue-60-plus', cents: 6_500_000, count: 1 },
]

/** El CSV de la tabla de ejemplo, para que «Exportar» descargue algo de verdad (`;`, coma decimal y BOM). */
export function sampleSuppliersCsv(): string {
  const lines = [
    'Proveedor;Rubro;Condición;Saldo',
    ...SAMPLE_SUPPLIERS.map((supplier) => {
      const pesos = Math.trunc(supplier.balanceCents / 100)
      const cents = String(supplier.balanceCents % 100).padStart(2, '0')
      return `${supplier.name};${supplier.category};${supplier.condition};${pesos},${cents}`
    }),
  ]
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${lines.join('\r\n')}`)}`
}
