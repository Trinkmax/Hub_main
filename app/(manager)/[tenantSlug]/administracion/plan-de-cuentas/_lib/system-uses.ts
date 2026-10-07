/**
 * «Cuentas del sistema» en criollo: para qué usa el motor cada `system_key` (§D, #16). El motor nunca
 * busca una cuenta por código ni por nombre: busca su uso. Cada uso apunta a una cuenta del plan y se
 * puede pasar a otra compatible (`acc_remap_system_account`).
 *
 * `Record<SystemAccountKey, …>`: si el motor suma una clave, esto no compila hasta que tenga su texto.
 */

import {
  isSystemAccountKey,
  SYSTEM_ACCOUNT_KEYS,
  type SystemAccountKey,
} from '@/lib/accounting/system-keys'

export type SystemUseGroup =
  | 'ventas'
  | 'compras'
  | 'iva'
  | 'impuestos'
  | 'cajas'
  | 'sueldos'
  | 'socios'
  | 'gastos'

export type SystemUse = {
  /** El uso, corto: va en la insignia «Usada por el sistema: …». */
  label: string
  /** Qué hace el sistema con esa cuenta. */
  use: string
  group: SystemUseGroup
}

export const SYSTEM_USE_GROUPS: ReadonlyArray<{
  value: SystemUseGroup
  title: string
  description: string
}> = [
  {
    value: 'ventas',
    title: 'Ventas y cobros',
    description: 'El cierre del día, las facturas de venta y lo que queda a cobrar.',
  },
  {
    value: 'compras',
    title: 'Compras y proveedores',
    description: 'Facturas de proveedores, pagos y la mercadería.',
  },
  {
    value: 'iva',
    title: 'IVA',
    description: 'El IVA de compras y ventas, y la liquidación de cada mes.',
  },
  {
    value: 'impuestos',
    title: 'Otros impuestos',
    description: 'Ingresos Brutos, Comercio e Industria, Ganancias y los impuestos del banco.',
  },
  {
    value: 'cajas',
    title: 'Cajas, bancos y diferencias',
    description: 'Lo que aparece al ajustar un saldo y los gastos e intereses del banco.',
  },
  {
    value: 'sueldos',
    title: 'Sueldos',
    description: 'El asiento mensual de sueldos y cargas sociales.',
  },
  {
    value: 'socios',
    title: 'Socios y patrimonio',
    description: 'Capital, aportes, la apertura y el cierre del ejercicio.',
  },
  {
    value: 'gastos',
    title: 'Otros gastos e ingresos',
    description: 'Gastos e ingresos frecuentes que el sistema tiene identificados.',
  },
]

export const SYSTEM_USES: Readonly<Record<SystemAccountKey, SystemUse>> = {
  // ─── Ventas y cobros ──────────────────────────────────────────────────────
  receivable_customers: {
    label: 'Clientes con cuenta corriente',
    use: 'Lo que te deben las empresas y los clientes a los que les vendés a cuenta: entra con la venta y sale cuando la cobrás.',
    group: 'ventas',
  },
  receivable_debit_cards: {
    label: 'Débito a acreditar',
    use: 'Lo vendido con tarjeta de débito hasta que el procesador te lo deposita.',
    group: 'ventas',
  },
  receivable_credit_cards: {
    label: 'Crédito a acreditar',
    use: 'Lo vendido con tarjeta de crédito hasta que el procesador te lo deposita.',
    group: 'ventas',
  },
  receivable_wallets: {
    label: 'Mercado Pago a acreditar',
    use: 'Lo vendido con QR o transferencia hasta que lo registrás como acreditado («Ajustar saldo» de la billetera).',
    group: 'ventas',
  },
  receivable_platforms: {
    label: 'Plataformas de delivery a cobrar',
    use: 'Lo que te deben PedidosYa, Rappi y las demás hasta que te liquidan.',
    group: 'ventas',
  },
  customer_deposits: {
    label: 'Señas de clientes',
    use: 'Las señas y anticipos que cobrás antes de la venta; se descuentan cuando se factura.',
    group: 'ventas',
  },
  sales_salon_invoiced: {
    label: 'Ventas del salón facturadas',
    use: 'El neto (sin IVA) de lo facturado en el salón, en cada cierre del día.',
    group: 'ventas',
  },
  sales_salon_uninvoiced: {
    label: 'Ventas del salón sin factura',
    use: 'Lo vendido en el salón que no se facturó, en cada cierre del día.',
    group: 'ventas',
  },
  sales_delivery_invoiced: {
    label: 'Ventas de delivery facturadas',
    use: 'El neto (sin IVA) de lo facturado por delivery.',
    group: 'ventas',
  },
  sales_delivery_uninvoiced: {
    label: 'Ventas de delivery sin factura',
    use: 'Lo vendido por delivery que no se facturó.',
    group: 'ventas',
  },
  sales_events_invoiced: {
    label: 'Ventas de eventos facturadas',
    use: 'El neto (sin IVA) de los eventos y empresas facturados.',
    group: 'ventas',
  },
  sales_events_uninvoiced: {
    label: 'Ventas de eventos sin factura',
    use: 'Los eventos que no se facturaron.',
    group: 'ventas',
  },
  fees_cards: {
    label: 'Comisiones de tarjetas',
    use: 'Los aranceles que descuentan las tarjetas al acreditar.',
    group: 'ventas',
  },
  fees_wallets: {
    label: 'Comisiones de Mercado Pago',
    use: 'Las comisiones que descuenta Mercado Pago.',
    group: 'ventas',
  },
  fees_platforms: {
    label: 'Comisiones de plataformas',
    use: 'Las comisiones que descuentan PedidosYa, Rappi y las demás.',
    group: 'ventas',
  },
  fees_other: {
    label: 'Otros cargos de cobro',
    use: 'Cargos de cobro que no son comisión: costo financiero de cuotas y cargos de la tarjeta de la empresa.',
    group: 'ventas',
  },
  bad_debt_allowance: {
    label: 'Previsión para incobrables',
    use: 'La regularizadora de los cobros dudosos; la carga la contadora.',
    group: 'ventas',
  },

  // ─── Compras y proveedores ────────────────────────────────────────────────
  payable_suppliers: {
    label: 'Proveedores',
    use: 'Lo que les debés a los proveedores, factura por factura: entra con cada factura y sale con cada pago.',
    group: 'compras',
  },
  other_payables: {
    label: 'Acreedores varios',
    use: 'Deudas con alguien identificado que no es proveedor.',
    group: 'compras',
  },
  supplier_advances: {
    label: 'Anticipos a proveedores',
    use: 'Los pagos a cuenta; la contadora los reclasifica al cierre.',
    group: 'compras',
  },
  prepaid_expenses: {
    label: 'Gastos pagados por adelantado',
    use: 'Seguros o alquileres pagados por varios meses.',
    group: 'compras',
  },
  purchases_food: {
    label: 'Compras de alimentos',
    use: 'Carne, verdura y almacén.',
    group: 'compras',
  },
  purchases_soft_drinks: {
    label: 'Compras de bebidas sin alcohol',
    use: 'Gaseosas, aguas y jugos.',
    group: 'compras',
  },
  purchases_alcohol: {
    label: 'Compras de bebidas con alcohol',
    use: 'Cervezas, vinos y bebidas blancas.',
    group: 'compras',
  },
  purchases_coffee: {
    label: 'Compras de café e infusiones',
    use: 'Café, té y yerba.',
    group: 'compras',
  },
  purchases_bakery: {
    label: 'Compras de panadería',
    use: 'Panes, facturas y tortas compradas.',
    group: 'compras',
  },
  purchases_packaging: {
    label: 'Compras de descartables',
    use: 'Vasos, envases y bolsas de delivery.',
    group: 'compras',
  },
  purchases_other: {
    label: 'Compras de otros insumos',
    use: 'Hielo y otros insumos de cocina y barra.',
    group: 'compras',
  },
  inventory: {
    label: 'Mercaderías (existencia)',
    use: 'La existencia al cierre del ejercicio; la carga la contadora.',
    group: 'compras',
  },
  inventory_variation: {
    label: 'Variación de existencias',
    use: 'El ajuste de existencias al cierre; lo carga la contadora.',
    group: 'compras',
  },

  // ─── IVA ──────────────────────────────────────────────────────────────────
  vat_credit: {
    label: 'IVA crédito fiscal',
    use: 'El IVA de las facturas A de tus compras: se descuenta del IVA que cobrás en la liquidación del mes.',
    group: 'iva',
  },
  vat_credit_pending: {
    label: 'IVA crédito fiscal a documentar',
    use: 'El IVA de comisiones ya descontadas (Mercado Pago, plataformas) hasta que llega su factura.',
    group: 'iva',
  },
  vat_debit: {
    label: 'IVA débito fiscal',
    use: 'El IVA de lo que facturás, en el cierre del día y en las facturas de venta.',
    group: 'iva',
  },
  vat_payable: {
    label: 'IVA a pagar',
    use: 'Lo que da la liquidación mensual del IVA, hasta que lo pagás.',
    group: 'iva',
  },
  vat_technical_balance: {
    label: 'IVA saldo técnico a favor',
    use: 'Lo que queda a favor cuando en un mes compraste más IVA del que vendiste; lo usa la liquidación de los meses siguientes.',
    group: 'iva',
  },
  vat_free_balance: {
    label: 'IVA saldo de libre disponibilidad',
    use: 'Las percepciones y retenciones de IVA que sobraron en la liquidación; sirven para pagar otros impuestos.',
    group: 'iva',
  },
  vat_perceptions: {
    label: 'Percepciones de IVA',
    use: 'El IVA extra que te cobra un proveedor en la factura; se descuenta en la liquidación del mes.',
    group: 'iva',
  },
  vat_withholdings: {
    label: 'Retenciones de IVA',
    use: 'El IVA que te retiene un cliente o un procesador al pagarte.',
    group: 'iva',
  },

  // ─── Otros impuestos ──────────────────────────────────────────────────────
  iibb_perceptions: {
    label: 'Percepciones de Ingresos Brutos',
    use: 'Ingresos Brutos que te cobra un proveedor en la factura.',
    group: 'impuestos',
  },
  iibb_withholdings: {
    label: 'Retenciones de Ingresos Brutos',
    use: 'Ingresos Brutos que te retienen al acreditar tarjetas, plataformas o clientes.',
    group: 'impuestos',
  },
  iibb_sircreb: {
    label: 'SIRCREB (bancos)',
    use: 'Lo que el banco descuenta de Ingresos Brutos sobre lo que entra a la cuenta.',
    group: 'impuestos',
  },
  iibb_sircupa: {
    label: 'SIRCUPA (billeteras)',
    use: 'Lo que Mercado Pago descuenta de Ingresos Brutos sobre lo que entra.',
    group: 'impuestos',
  },
  iibb_balance: {
    label: 'Ingresos Brutos a favor',
    use: 'Lo que sobró de la declaración de Ingresos Brutos; sirve para pagar.',
    group: 'impuestos',
  },
  iibb_payable: {
    label: 'Ingresos Brutos a pagar',
    use: 'La declaración mensual de Ingresos Brutos, hasta que la pagás.',
    group: 'impuestos',
  },
  iibb_expense: {
    label: 'Ingresos Brutos (gasto)',
    use: 'El Ingresos Brutos de cada mes, como gasto.',
    group: 'impuestos',
  },
  municipal_payable: {
    label: 'Comercio e Industria a pagar',
    use: 'La contribución municipal, hasta que la pagás.',
    group: 'impuestos',
  },
  municipal_tax_expense: {
    label: 'Comercio e Industria (gasto)',
    use: 'La contribución municipal de cada mes, como gasto.',
    group: 'impuestos',
  },
  income_tax_withholdings: {
    label: 'Retenciones de Ganancias',
    use: 'Ganancias que te retienen al cobrar.',
    group: 'impuestos',
  },
  income_tax_perceptions: {
    label: 'Percepciones de Ganancias',
    use: 'Ganancias que te cobra un proveedor en la factura.',
    group: 'impuestos',
  },
  income_tax_advances: {
    label: 'Anticipos de Ganancias',
    use: 'Los anticipos de Ganancias que pagás.',
    group: 'impuestos',
  },
  income_tax_payable: {
    label: 'Ganancias a pagar',
    use: 'La declaración y los anticipos de Ganancias, hasta que se pagan.',
    group: 'impuestos',
  },
  income_tax_expense: {
    label: 'Impuesto a las ganancias',
    use: 'El impuesto del ejercicio; lo carga la contadora.',
    group: 'impuestos',
  },
  bank_tax_credit: {
    label: 'Impuesto al cheque computable',
    use: 'La parte del impuesto a los débitos y créditos bancarios que se descuenta de Ganancias (en cada gasto bancario).',
    group: 'impuestos',
  },
  bank_tax_expense: {
    label: 'Impuesto al cheque (gasto)',
    use: 'La parte del impuesto a los débitos y créditos bancarios que no se descuenta.',
    group: 'impuestos',
  },
  other_taxes_payable: {
    label: 'Otros impuestos a pagar',
    use: 'Planes de pago de ARCA y otros tributos, hasta que se pagan.',
    group: 'impuestos',
  },
  other_taxes_expense: {
    label: 'Otros impuestos y tasas',
    use: 'Las percepciones municipales de las facturas y otros tributos, como gasto.',
    group: 'impuestos',
  },
  tax_penalties: {
    label: 'Intereses y multas fiscales',
    use: 'Los recargos por pagar impuestos tarde.',
    group: 'impuestos',
  },

  // ─── Cajas, bancos y diferencias ──────────────────────────────────────────
  cash_over: {
    label: 'Sobrantes de caja',
    use: 'Cuando al contar la caja hay más de lo que dice el sistema («Ajustar saldo»).',
    group: 'cajas',
  },
  cash_short: {
    label: 'Faltantes de caja',
    use: 'Cuando al contar la caja hay menos de lo que dice el sistema («Ajustar saldo»).',
    group: 'cajas',
  },
  reconciliation_differences: {
    label: 'Diferencias a conciliar',
    use: 'Lo que no se explica al ajustar el saldo de Mercado Pago o de un banco; la contadora lo reclasifica.',
    group: 'cajas',
  },
  bank_fees: {
    label: 'Gastos bancarios',
    use: 'Mantenimiento de cuenta y comisiones del banco, en cada gasto bancario.',
    group: 'cajas',
  },
  interest_income: {
    label: 'Intereses ganados',
    use: 'Los rendimientos de Mercado Pago, plazos fijos e intereses a favor.',
    group: 'cajas',
  },
  interest_expense: {
    label: 'Intereses pagados',
    use: 'Los intereses de préstamos, tarjetas y descubiertos.',
    group: 'cajas',
  },
  discounts_obtained: {
    label: 'Descuentos obtenidos',
    use: 'Las bonificaciones y diferencias chicas a favor al pagarle a un proveedor.',
    group: 'cajas',
  },
  bank_loans: {
    label: 'Préstamos bancarios',
    use: 'Los préstamos del banco a menos de un año.',
    group: 'cajas',
  },

  // ─── Sueldos ──────────────────────────────────────────────────────────────
  salaries: {
    label: 'Sueldos y jornales',
    use: 'Los sueldos brutos del asiento mensual de sueldos.',
    group: 'sueldos',
  },
  employer_contributions: {
    label: 'Contribuciones patronales',
    use: 'Las cargas sociales a cargo de la SAS, en el asiento de sueldos.',
    group: 'sueldos',
  },
  payroll_payable: {
    label: 'Sueldos a pagar',
    use: 'Los sueldos netos liquidados, hasta que se pagan.',
    group: 'sueldos',
  },
  social_security_payable: {
    label: 'Cargas sociales a pagar',
    use: 'Los aportes y contribuciones del F.931, hasta que se pagan.',
    group: 'sueldos',
  },
  union_payable: {
    label: 'Sindicato y obra social a pagar',
    use: 'Las cuotas sindicales y de obra social retenidas, hasta que se pagan.',
    group: 'sueldos',
  },
  payroll_provisions: {
    label: 'Provisión de SAC y vacaciones',
    use: 'El aguinaldo y las vacaciones que se van devengando; la carga la contadora.',
    group: 'sueldos',
  },

  // ─── Socios y patrimonio ──────────────────────────────────────────────────
  share_capital: {
    label: 'Capital social',
    use: 'El capital del estatuto.',
    group: 'socios',
  },
  capital_receivable: {
    label: 'Capital a integrar',
    use: 'El capital suscripto que los socios todavía no pusieron.',
    group: 'socios',
  },
  irrevocable_contributions: {
    label: 'Aportes irrevocables',
    use: 'Los aportes de los socios a cuenta de futuras suscripciones.',
    group: 'socios',
  },
  partners_current: {
    label: 'Cuentas particulares de socios',
    use: 'Los retiros y aportes de cada socio.',
    group: 'socios',
  },
  partner_loans: {
    label: 'Préstamos de socios',
    use: 'La plata que un socio le prestó a la SAS.',
    group: 'socios',
  },
  opening_equity: {
    label: 'Saldo de apertura a asignar',
    use: 'La diferencia del asiento de apertura; la contadora la pasa a capital o a resultados.',
    group: 'socios',
  },
  current_year_result: {
    label: 'Resultado del ejercicio',
    use: 'Ahí deja la refundición la ganancia o la pérdida al cerrar el ejercicio.',
    group: 'socios',
  },
  retained_earnings: {
    label: 'Resultados no asignados',
    use: 'Las ganancias o pérdidas de ejercicios anteriores.',
    group: 'socios',
  },
  legal_reserve: {
    label: 'Reserva legal',
    use: 'La reserva que define la reunión de socios.',
    group: 'socios',
  },

  // ─── Otros gastos e ingresos ──────────────────────────────────────────────
  other_income: {
    label: 'Ingresos varios',
    use: 'Los ingresos que no son ventas.',
    group: 'gastos',
  },
  misc_expenses: {
    label: 'Gastos varios',
    use: 'Lo que no entra en otra cuenta.',
    group: 'gastos',
  },
  maintenance: {
    label: 'Mantenimiento y reparaciones',
    use: 'Plomero, electricista y arreglos.',
    group: 'gastos',
  },
  cleaning: {
    label: 'Limpieza e higiene',
    use: 'Artículos de limpieza y fumigación.',
    group: 'gastos',
  },
  advertising_online: {
    label: 'Publicidad en redes',
    use: 'La pauta en Meta y Google, en pesos.',
    group: 'gastos',
  },
  advertising_other: {
    label: 'Otra publicidad',
    use: 'Volantes, cartelería y promociones.',
    group: 'gastos',
  },
  depreciation: {
    label: 'Amortizaciones',
    use: 'La amortización del ejercicio; la carga la contadora al cierre.',
    group: 'gastos',
  },
  accumulated_depreciation: {
    label: 'Amortización acumulada',
    use: 'La regularizadora general de los bienes de uso; la carga la contadora.',
    group: 'gastos',
  },
}

/** El uso de una clave que llega de la base (`null` si no es una clave del motor). */
export function systemUse(key: string | null | undefined): SystemUse | null {
  return isSystemAccountKey(key) ? SYSTEM_USES[key] : null
}

/** Las claves de un grupo, en el orden de `SYSTEM_USES`. */
export function systemKeysOf(group: SystemUseGroup): SystemAccountKey[] {
  return (Object.keys(SYSTEM_USES) as SystemAccountKey[]).filter(
    (key) => SYSTEM_USES[key].group === group,
  )
}

/** Todas las claves del motor (para verificar que no falte ninguna). */
export const ALL_SYSTEM_KEYS: readonly SystemAccountKey[] = SYSTEM_ACCOUNT_KEYS
