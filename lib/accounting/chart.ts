/**
 * Plan de cuentas estándar (Sprint 1, §D): el MISMO plan que siembra
 * `private.acc_seed_chart` desde su `values (…)`, escrito como constante.
 *
 * Para qué sirve en TypeScript:
 * - los tests verifican que toda `system_key` que usa el motor existe y es
 *   imputable (accounting-system-keys.test.ts), y cuando exista la migración
 *   del seed, que este archivo y el SQL digan lo mismo;
 * - los fixtures de los tests arman un `PostingContext` realista sin base;
 * - la pantalla del plan muestra «Para qué se usa» aunque la contadora todavía
 *   no haya tocado nada.
 *
 * Los códigos son editables en la base (lo que no cambia es la `system_key`):
 * acá viven solo como semilla. Cuatro niveles (`R`, `R.S`, `R.S.GG`,
 * `R.S.GG.CC`); imputables las de nivel 4. Las hojas de «Caja y bancos»
 * (`1.1.01.NN`) y de las tarjetas de la empresa (`2.1.01.NN` desde la `.02`)
 * las crea el asistente, no el seed.
 */

import type { SystemAccountKey } from './system-keys'
import type { AccountType, Side } from './types'

export type ChartAccountSeed = {
  code: string
  name: string
  type: AccountType
  /** Lado normal: las regularizadoras van al revés de su tipo. */
  normalSide: Side
  /** Imputable (hoja). Las de nivel 1 a 3 son grupos. */
  postable: boolean
  systemKey: SystemAccountKey | null
  /** Cuenta de control: lleva partícipe y sus líneas son partidas. */
  requiresParty: boolean
  /** Aparece en «¿En qué?» y en la imputación de compras. */
  purchaseSelectable: boolean
  /** «Para qué se usa», en lenguaje de dueño (tooltip del selector). */
  description: string | null
}

type Flags = {
  key?: SystemAccountKey
  ctrl?: boolean
  cpra?: boolean
  desc?: string
}

const D: Side = 'debit'
const A: Side = 'credit'

/** Grupo (no imputable). */
function g(code: string, name: string, type: AccountType, side: Side, desc?: string) {
  return leafOrGroup(code, name, type, side, false, { desc })
}

/** Cuenta imputable. */
function c(code: string, name: string, type: AccountType, side: Side, flags: Flags = {}) {
  return leafOrGroup(code, name, type, side, true, flags)
}

function leafOrGroup(
  code: string,
  name: string,
  type: AccountType,
  normalSide: Side,
  postable: boolean,
  flags: Flags,
): ChartAccountSeed {
  return {
    code,
    name,
    type,
    normalSide,
    postable,
    systemKey: flags.key ?? null,
    requiresParty: flags.ctrl ?? false,
    purchaseSelectable: flags.cpra ?? false,
    description: flags.desc ?? null,
  }
}

/** En el orden de §D (que es el de nivel dentro de cada rama: padres antes que hijas). */
export const STANDARD_CHART: readonly ChartAccountSeed[] = [
  g('1', 'ACTIVO', 'asset', D),
  g('1.1', 'Activo corriente', 'asset', D),
  g(
    '1.1.01',
    'Caja y bancos',
    'asset',
    D,
    'Cada caja, cuenta bancaria y billetera tiene acá su cuenta',
  ),
  g('1.1.02', 'Créditos por ventas', 'asset', D),
  c('1.1.02.01', 'Deudores por ventas', 'asset', D, {
    key: 'receivable_customers',
    ctrl: true,
    desc: 'Lo que te deben empresas y clientes con cuenta corriente',
  }),
  c('1.1.02.02', 'Tarjetas de débito a cobrar', 'asset', D, {
    key: 'receivable_debit_cards',
    ctrl: true,
    desc: 'Ventas con débito que el procesador todavía no acreditó',
  }),
  c('1.1.02.03', 'Tarjetas de crédito a cobrar', 'asset', D, {
    key: 'receivable_credit_cards',
    ctrl: true,
    desc: 'Ventas con crédito que el procesador todavía no acreditó',
  }),
  c('1.1.02.04', 'Mercado Pago a acreditar', 'asset', D, {
    key: 'receivable_wallets',
    ctrl: true,
    desc: 'QR y transferencias vendidos que todavía no registraste como acreditados («Ajustar saldo» de Mercado Pago)',
  }),
  c('1.1.02.05', 'Plataformas de delivery a cobrar', 'asset', D, {
    key: 'receivable_platforms',
    ctrl: true,
    desc: 'Lo que te deben PedidosYa, Rappi y las demás; si una liquidación da negativo, acá queda lo que les debés',
  }),
  c('1.1.02.09', 'Previsión para deudores incobrables (regularizadora)', 'asset', A, {
    key: 'bad_debt_allowance',
    desc: 'Ajuste de la contadora por cobros dudosos',
  }),
  g('1.1.03', 'Créditos fiscales', 'asset', D),
  c('1.1.03.01', 'IVA crédito fiscal', 'asset', D, {
    key: 'vat_credit',
    desc: 'El IVA de las facturas A que te hacen los responsables inscriptos: se descuenta del IVA que cobrás',
  }),
  c('1.1.03.02', 'IVA crédito fiscal a documentar', 'asset', D, {
    key: 'vat_credit_pending',
    ctrl: true,
    desc: 'IVA de comisiones ya descontadas (Mercado Pago, plataformas) cuya factura mensual todavía no llegó',
  }),
  c('1.1.03.03', 'IVA saldo técnico a favor', 'asset', D, {
    key: 'vat_technical_balance',
    desc: 'Cuando en un mes compraste más IVA del que vendiste; se usa en los meses siguientes',
  }),
  c('1.1.03.04', 'IVA saldo de libre disponibilidad', 'asset', D, {
    key: 'vat_free_balance',
    desc: 'Percepciones y retenciones de IVA que sobraron; sirven para pagar IVA u otros impuestos',
  }),
  c('1.1.03.05', 'Percepciones de IVA sufridas', 'asset', D, {
    key: 'vat_perceptions',
    desc: 'IVA extra que te cobró un proveedor en la factura; se descuenta en la liquidación del mes',
  }),
  c('1.1.03.06', 'Retenciones de IVA sufridas', 'asset', D, {
    key: 'vat_withholdings',
    desc: 'IVA que te retuvo un cliente o un procesador al pagarte, con certificado',
  }),
  c('1.1.03.07', 'Percepciones de IIBB sufridas', 'asset', D, {
    key: 'iibb_perceptions',
    desc: 'Ingresos Brutos que te cobró un proveedor en la factura',
  }),
  c('1.1.03.08', 'Retenciones de IIBB sufridas (tarjetas y plataformas)', 'asset', D, {
    key: 'iibb_withholdings',
    desc: 'Ingresos Brutos que te retienen al acreditar tarjetas, plataformas o clientes',
  }),
  c('1.1.03.09', 'Recaudaciones IIBB SIRCREB (bancos)', 'asset', D, {
    key: 'iibb_sircreb',
    desc: 'Lo que el banco descuenta de Ingresos Brutos sobre los créditos de la cuenta',
  }),
  c('1.1.03.10', 'Recaudaciones IIBB SIRCUPA (billeteras)', 'asset', D, {
    key: 'iibb_sircupa',
    desc: 'Lo que Mercado Pago descuenta de Ingresos Brutos sobre lo que entra',
  }),
  c('1.1.03.11', 'IIBB saldo a favor', 'asset', D, {
    key: 'iibb_balance',
    desc: 'Lo que sobró de la declaración de Ingresos Brutos',
  }),
  c('1.1.03.12', 'Retenciones de Ganancias sufridas', 'asset', D, {
    key: 'income_tax_withholdings',
    desc: 'Ganancias que te retienen al cobrar, con certificado',
  }),
  c('1.1.03.13', 'Percepciones de Ganancias sufridas', 'asset', D, {
    key: 'income_tax_perceptions',
    desc: 'Ganancias que te cobra un proveedor en la factura',
  }),
  c('1.1.03.14', 'Anticipos de Ganancias', 'asset', D, {
    key: 'income_tax_advances',
    desc: 'Anticipos de Ganancias pagados',
  }),
  c('1.1.03.15', 'Impuesto ley 25.413 computable en Ganancias', 'asset', D, {
    key: 'bank_tax_credit',
    desc: 'La parte del impuesto al cheque que se descuenta de Ganancias (33 % por defecto)',
  }),
  g('1.1.04', 'Otros créditos', 'asset', D),
  c('1.1.04.01', 'Anticipos a proveedores', 'asset', D, {
    key: 'supplier_advances',
    desc: 'La contadora reclasifica acá los pagos a cuenta al cierre del ejercicio',
  }),
  c('1.1.04.02', 'Gastos pagados por adelantado', 'asset', D, {
    key: 'prepaid_expenses',
    cpra: true,
    desc: 'Seguros o alquileres pagados por varios meses',
  }),
  c('1.1.04.03', 'Fondos a rendir', 'asset', D, {
    desc: 'Plata entregada a alguien que después rinde con comprobantes',
  }),
  c('1.1.04.04', 'Préstamos al personal', 'asset', D, {
    desc: 'Adelantos o préstamos a empleados',
  }),
  c('1.1.04.05', 'Diferencias de cobro a conciliar', 'asset', D, {
    key: 'reconciliation_differences',
    desc: 'Lo que no se explica al ajustar el saldo de Mercado Pago o de un banco; la contadora lo reclasifica',
  }),
  g('1.1.05', 'Bienes de cambio', 'asset', D),
  c('1.1.05.01', 'Mercaderías (existencia)', 'asset', D, {
    key: 'inventory',
    desc: 'Existencia al cierre (la carga la contadora hasta el Sprint de Stock)',
  }),
  g('1.2', 'Activo no corriente', 'asset', D),
  g('1.2.01', 'Bienes de uso', 'asset', D),
  c('1.2.01.01', 'Instalaciones', 'asset', D, {
    cpra: true,
    desc: 'Obras e instalaciones del local',
  }),
  c('1.2.01.02', 'Muebles y útiles', 'asset', D, {
    cpra: true,
    desc: 'Mesas, sillas, vajilla que dura años',
  }),
  c('1.2.01.03', 'Equipamiento de cocina y barra', 'asset', D, {
    cpra: true,
    desc: 'Hornos, heladeras, cafeteras',
  }),
  c('1.2.01.04', 'Equipos de computación', 'asset', D, {
    cpra: true,
    desc: 'Computadoras, tablets, impresoras',
  }),
  c('1.2.01.05', 'Rodados', 'asset', D, { cpra: true, desc: 'Vehículos' }),
  c('1.2.01.06', 'Mejoras en inmuebles de terceros', 'asset', D, {
    cpra: true,
    desc: 'Reformas en el local alquilado',
  }),
  c('1.2.01.09', 'Amortización acumulada de bienes de uso (regularizadora)', 'asset', A, {
    key: 'accumulated_depreciation',
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02', 'Activos intangibles', 'asset', D),
  c('1.2.02.01', 'Software y licencias', 'asset', D, {
    cpra: true,
    desc: 'Licencias que duran más de un año',
  }),
  c('1.2.02.02', 'Gastos de organización', 'asset', D, {
    cpra: true,
    desc: 'Gastos de constitución de la SAS',
  }),
  c('1.2.02.09', 'Amortización acumulada de intangibles (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.03', 'Otros activos no corrientes', 'asset', D),
  c('1.2.03.01', 'Depósitos en garantía', 'asset', D, { desc: 'Depósito del alquiler' }),

  g('2', 'PASIVO', 'liability', A),
  g('2.1', 'Pasivo corriente', 'liability', A),
  g('2.1.01', 'Deudas comerciales', 'liability', A),
  c('2.1.01.01', 'Proveedores', 'liability', A, {
    key: 'payable_suppliers',
    ctrl: true,
    desc: 'Lo que les debés a los proveedores, factura por factura',
  }),
  g('2.1.02', 'Deudas fiscales', 'liability', A),
  c('2.1.02.01', 'IVA débito fiscal', 'liability', A, {
    key: 'vat_debit',
    desc: 'El IVA de lo que facturaste',
  }),
  c('2.1.02.02', 'IVA a pagar', 'liability', A, {
    key: 'vat_payable',
    ctrl: true,
    desc: 'Lo que da la liquidación mensual del IVA, hasta que se paga',
  }),
  c('2.1.02.03', 'IIBB a pagar', 'liability', A, {
    key: 'iibb_payable',
    ctrl: true,
    desc: 'La declaración de Ingresos Brutos del mes, hasta que se paga',
  }),
  c('2.1.02.04', 'Tasa municipal a pagar', 'liability', A, {
    key: 'municipal_payable',
    ctrl: true,
    desc: 'Tasa de comercio e industria',
  }),
  c('2.1.02.05', 'Ganancias a pagar', 'liability', A, {
    key: 'income_tax_payable',
    ctrl: true,
    desc: 'Declaración y anticipos de Ganancias',
  }),
  c('2.1.02.06', 'Otros impuestos a pagar', 'liability', A, {
    key: 'other_taxes_payable',
    ctrl: true,
    desc: 'Planes de pago y otros tributos',
  }),
  g('2.1.03', 'Deudas sociales', 'liability', A),
  c('2.1.03.01', 'Sueldos a pagar', 'liability', A, {
    key: 'payroll_payable',
    ctrl: true,
    desc: 'Sueldos netos liquidados que todavía no se pagaron',
  }),
  c('2.1.03.02', 'Cargas sociales a pagar (F.931)', 'liability', A, {
    key: 'social_security_payable',
    ctrl: true,
    desc: 'Aportes y contribuciones del F.931',
  }),
  c('2.1.03.03', 'Sindicato y obra social a pagar', 'liability', A, {
    key: 'union_payable',
    ctrl: true,
    desc: 'Cuotas sindicales y de obra social retenidas',
  }),
  c('2.1.03.04', 'Provisión SAC y vacaciones', 'liability', A, {
    key: 'payroll_provisions',
    desc: 'La carga la contadora',
  }),
  g('2.1.04', 'Otras deudas', 'liability', A),
  c('2.1.04.01', 'Anticipos de clientes (señas)', 'liability', A, {
    key: 'customer_deposits',
    ctrl: true,
    desc: 'Señas y anticipos cobrados antes de la venta',
  }),
  c('2.1.04.02', 'Cuentas particulares de socios', 'liability', A, {
    key: 'partners_current',
    ctrl: true,
    desc: 'Retiros y aportes de cada socio',
  }),
  c('2.1.04.03', 'Acreedores varios', 'liability', A, {
    key: 'other_payables',
    ctrl: true,
    desc: 'Otras deudas con un acreedor identificado',
  }),
  g('2.1.05', 'Deudas financieras', 'liability', A),
  c('2.1.05.01', 'Préstamos bancarios', 'liability', A, {
    key: 'bank_loans',
    desc: 'Préstamos del banco a menos de un año',
  }),
  c('2.1.05.02', 'Préstamos de socios', 'liability', A, {
    key: 'partner_loans',
    ctrl: true,
    desc: 'Plata que un socio le prestó a la SAS',
  }),
  g('2.2', 'Pasivo no corriente', 'liability', A),
  g('2.2.01', 'Deudas financieras a largo plazo', 'liability', A),
  c('2.2.01.01', 'Préstamos bancarios a largo plazo', 'liability', A, {
    desc: 'Cuotas a más de un año',
  }),

  g('3', 'PATRIMONIO NETO', 'equity', A),
  g('3.1', 'Aportes de los socios', 'equity', A),
  g('3.1.01', 'Capital', 'equity', A),
  c('3.1.01.01', 'Capital social', 'equity', A, {
    key: 'share_capital',
    desc: 'El capital del estatuto',
  }),
  c('3.1.01.02', 'Socios: capital a integrar (regularizadora)', 'equity', D, {
    key: 'capital_receivable',
    desc: 'Capital suscripto que los socios todavía no pusieron',
  }),
  c('3.1.01.03', 'Aportes irrevocables', 'equity', A, {
    key: 'irrevocable_contributions',
    desc: 'Aportes a cuenta de futuras suscripciones',
  }),
  g('3.2', 'Resultados', 'equity', A),
  g('3.2.01', 'Resultados acumulados', 'equity', A),
  c('3.2.01.01', 'Resultados no asignados', 'equity', A, {
    key: 'retained_earnings',
    desc: 'Ganancias o pérdidas de ejercicios anteriores',
  }),
  c('3.2.01.02', 'Resultado del ejercicio', 'equity', A, {
    key: 'current_year_result',
    desc: 'Lo deja la refundición al cerrar el ejercicio',
  }),
  c('3.2.01.03', 'Reserva legal', 'equity', A, {
    key: 'legal_reserve',
    desc: 'La define la asamblea',
  }),
  c('3.2.01.04', 'Saldo de apertura a asignar', 'equity', A, {
    key: 'opening_equity',
    desc: 'La diferencia del asiento de apertura; la contadora la pasa a capital o resultados',
  }),

  g('4', 'INGRESOS', 'income', A),
  g('4.1', 'Ventas', 'income', A),
  g('4.1.01', 'Ventas del salón', 'income', A),
  c('4.1.01.01', 'Ventas salón: facturadas', 'income', A, {
    key: 'sales_salon_invoiced',
    desc: 'Neto de lo facturado en el salón (concilia con el Libro IVA ventas)',
  }),
  c('4.1.01.02', 'Ventas salón: sin factura', 'income', A, {
    key: 'sales_salon_uninvoiced',
    desc: 'Lo vendido en el salón que no se facturó (sin IVA débito)',
  }),
  g('4.1.02', 'Ventas de delivery', 'income', A),
  c('4.1.02.01', 'Ventas delivery: facturadas', 'income', A, {
    key: 'sales_delivery_invoiced',
    desc: 'Neto de lo facturado por delivery',
  }),
  c('4.1.02.02', 'Ventas delivery: sin factura', 'income', A, {
    key: 'sales_delivery_uninvoiced',
    desc: 'Lo vendido por delivery que no se facturó',
  }),
  g('4.1.03', 'Ventas de eventos y empresas', 'income', A),
  c('4.1.03.01', 'Ventas eventos: facturadas', 'income', A, {
    key: 'sales_events_invoiced',
    desc: 'Eventos y empresas facturados',
  }),
  c('4.1.03.02', 'Ventas eventos: sin factura', 'income', A, {
    key: 'sales_events_uninvoiced',
    desc: 'Eventos que no se facturaron',
  }),
  g('4.2', 'Otros ingresos', 'income', A),
  g('4.2.01', 'Otros ingresos', 'income', A),
  c('4.2.01.01', 'Sobrantes de caja', 'income', A, {
    key: 'cash_over',
    desc: 'Cuando al contar la caja hay más de lo que dice el sistema',
  }),
  c('4.2.01.02', 'Intereses y rendimientos', 'income', A, {
    key: 'interest_income',
    desc: 'Rendimientos de Mercado Pago, plazos fijos',
  }),
  c('4.2.01.03', 'Descuentos obtenidos', 'income', A, {
    key: 'discounts_obtained',
    desc: 'Bonificaciones y diferencias chicas a favor al pagar',
  }),
  c('4.2.01.04', 'Ingresos varios', 'income', A, {
    key: 'other_income',
    desc: 'Ingresos que no son ventas',
  }),

  g('5', 'EGRESOS', 'expense', D),
  g('5.1', 'Costo de ventas', 'expense', D),
  g('5.1.01', 'Compras de mercadería', 'expense', D),
  c('5.1.01.01', 'Compras: alimentos', 'expense', D, {
    key: 'purchases_food',
    cpra: true,
    desc: 'Carne, verdura, almacén',
  }),
  c('5.1.01.02', 'Compras: bebidas sin alcohol', 'expense', D, {
    key: 'purchases_soft_drinks',
    cpra: true,
    desc: 'Gaseosas, aguas, jugos',
  }),
  c('5.1.01.03', 'Compras: bebidas con alcohol', 'expense', D, {
    key: 'purchases_alcohol',
    cpra: true,
    desc: 'Cervezas, vinos, bebidas blancas',
  }),
  c('5.1.01.04', 'Compras: café e infusiones', 'expense', D, {
    key: 'purchases_coffee',
    cpra: true,
    desc: 'Café, té, yerba',
  }),
  c('5.1.01.05', 'Compras: panadería y pastelería', 'expense', D, {
    key: 'purchases_bakery',
    cpra: true,
    desc: 'Panes, facturas, tortas compradas',
  }),
  c('5.1.01.06', 'Compras: descartables y packaging', 'expense', D, {
    key: 'purchases_packaging',
    cpra: true,
    desc: 'Vasos, envases, bolsas de delivery',
  }),
  c('5.1.01.07', 'Compras: otros insumos', 'expense', D, {
    key: 'purchases_other',
    cpra: true,
    desc: 'Hielo y otros insumos de cocina y barra',
  }),
  c('5.1.01.09', 'Variación de existencias', 'expense', D, {
    key: 'inventory_variation',
    desc: 'La carga la contadora al cierre',
  }),
  g('5.2', 'Gastos de comercialización', 'expense', D),
  g('5.2.01', 'Comisiones y costos de cobro', 'expense', D),
  c('5.2.01.01', 'Comisiones de tarjetas', 'expense', D, {
    key: 'fees_cards',
    desc: 'Aranceles de débito y crédito',
  }),
  c('5.2.01.02', 'Comisiones de Mercado Pago', 'expense', D, {
    key: 'fees_wallets',
    desc: 'Comisión de QR y otras de Mercado Pago',
  }),
  c('5.2.01.03', 'Comisiones de plataformas de delivery', 'expense', D, {
    key: 'fees_platforms',
    desc: 'Comisión de PedidosYa, Rappi y las demás',
  }),
  c('5.2.01.04', 'Costo financiero y otros cargos de cobro', 'expense', D, {
    key: 'fees_other',
    cpra: true,
    desc: 'Cargos de cobro que no son comisión',
  }),
  g('5.2.02', 'Publicidad', 'expense', D),
  c('5.2.02.01', 'Publicidad en redes (Meta, Google)', 'expense', D, {
    key: 'advertising_online',
    cpra: true,
    desc: 'Pauta en redes, en pesos',
  }),
  c('5.2.02.02', 'Otra publicidad y promociones', 'expense', D, {
    key: 'advertising_other',
    cpra: true,
    desc: 'Volantes, cartelería, promociones',
  }),
  g('5.2.03', 'Impuestos sobre las ventas', 'expense', D),
  c('5.2.03.01', 'Impuesto sobre los Ingresos Brutos', 'expense', D, {
    key: 'iibb_expense',
    cpra: true,
    desc: 'La declaración mensual de IIBB',
  }),
  c('5.2.03.02', 'Tasa de comercio e industria', 'expense', D, {
    key: 'municipal_tax_expense',
    cpra: true,
    desc: 'La tasa municipal',
  }),
  g('5.3', 'Gastos de administración y operación', 'expense', D),
  g('5.3.01', 'Personal', 'expense', D),
  c('5.3.01.01', 'Sueldos y jornales', 'expense', D, {
    key: 'salaries',
    desc: 'Sueldos brutos (asiento mensual de la contadora)',
  }),
  c('5.3.01.02', 'Contribuciones patronales', 'expense', D, {
    key: 'employer_contributions',
    desc: 'Las cargas a cargo de la SAS',
  }),
  c('5.3.01.03', 'ART y seguro de vida obligatorio', 'expense', D, {
    cpra: true,
    desc: 'Seguro de riesgos del trabajo',
  }),
  c('5.3.01.04', 'Personal eventual y extras', 'expense', D, {
    cpra: true,
    desc: 'Extras de eventos, changas',
  }),
  g('5.3.02', 'Local y servicios', 'expense', D),
  c('5.3.02.01', 'Alquiler', 'expense', D, { cpra: true, desc: 'El alquiler del local' }),
  c('5.3.02.02', 'Expensas', 'expense', D, { cpra: true, desc: 'Expensas del local' }),
  c('5.3.02.03', 'Energía eléctrica', 'expense', D, { cpra: true, desc: 'Luz (EPEC)' }),
  c('5.3.02.04', 'Gas', 'expense', D, { cpra: true, desc: 'Gas natural o envasado' }),
  c('5.3.02.05', 'Agua', 'expense', D, { cpra: true, desc: 'Agua' }),
  c('5.3.02.06', 'Internet y telefonía', 'expense', D, {
    cpra: true,
    desc: 'Internet, celulares',
  }),
  c('5.3.02.07', 'Mantenimiento y reparaciones', 'expense', D, {
    key: 'maintenance',
    cpra: true,
    desc: 'Plomero, electricista, arreglos',
  }),
  c('5.3.02.08', 'Limpieza e higiene', 'expense', D, {
    key: 'cleaning',
    cpra: true,
    desc: 'Artículos de limpieza, fumigación',
  }),
  c('5.3.02.09', 'Seguros', 'expense', D, { cpra: true, desc: 'Seguro del local' }),
  c('5.3.02.10', 'Seguridad y monitoreo', 'expense', D, {
    cpra: true,
    desc: 'Alarma, vigilancia',
  }),
  c('5.3.02.11', 'Música y derechos (SADAIC, AADI-CAPIF)', 'expense', D, {
    cpra: true,
    desc: 'Derechos de música',
  }),
  g('5.3.03', 'Administración', 'expense', D),
  c('5.3.03.01', 'Honorarios profesionales', 'expense', D, {
    cpra: true,
    desc: 'Contadora, abogados, diseño',
  }),
  c('5.3.03.02', 'Software y suscripciones', 'expense', D, {
    cpra: true,
    desc: 'Thinkeon, HUB, apps',
  }),
  c('5.3.03.03', 'Librería y papelería', 'expense', D, {
    cpra: true,
    desc: 'Papel, rollos de ticketera',
  }),
  c('5.3.03.04', 'Gastos bancarios', 'expense', D, {
    key: 'bank_fees',
    cpra: true,
    desc: 'Mantenimiento de cuenta y comisiones del banco',
  }),
  c('5.3.03.05', 'Faltantes de caja', 'expense', D, {
    key: 'cash_short',
    desc: 'Cuando al contar la caja hay menos de lo que dice el sistema',
  }),
  c('5.3.03.06', 'Movilidad, fletes y envíos', 'expense', D, {
    cpra: true,
    desc: 'Taxis, fletes, cadetería',
  }),
  c('5.3.03.07', 'Amortizaciones', 'expense', D, {
    key: 'depreciation',
    desc: 'La carga la contadora al cierre',
  }),
  c('5.3.03.08', 'Gastos varios', 'expense', D, {
    key: 'misc_expenses',
    cpra: true,
    desc: 'Lo que no entra en otra cuenta',
  }),
  g('5.3.04', 'Impuestos y tasas', 'expense', D),
  c('5.3.04.01', 'Impuesto sobre débitos y créditos bancarios', 'expense', D, {
    key: 'bank_tax_expense',
    desc: 'La parte del impuesto al cheque que no se computa en Ganancias',
  }),
  c('5.3.04.02', 'Otros impuestos y tasas', 'expense', D, {
    key: 'other_taxes_expense',
    cpra: true,
    desc: 'Percepciones municipales y otros tributos',
  }),
  c('5.3.04.03', 'Intereses y multas fiscales', 'expense', D, {
    key: 'tax_penalties',
    cpra: true,
    desc: 'Recargos por pagar tarde',
  }),
  g('5.4', 'Resultados financieros', 'expense', D),
  g('5.4.01', 'Gastos financieros', 'expense', D),
  c('5.4.01.01', 'Intereses pagados', 'expense', D, {
    key: 'interest_expense',
    cpra: true,
    desc: 'Intereses de préstamos y tarjetas',
  }),
  g('5.5', 'Impuesto a las ganancias', 'expense', D),
  g('5.5.01', 'Impuesto a las ganancias', 'expense', D),
  c('5.5.01.01', 'Impuesto a las ganancias', 'expense', D, {
    key: 'income_tax_expense',
    desc: 'El impuesto del ejercicio (lo carga la contadora)',
  }),
]

// ─── Ayudas sobre códigos ────────────────────────────────────────────────────

/** Formato de `acc_accounts.code` (aac_code_fmt): números con o sin puntos, hasta 24. */
export const ACCOUNT_CODE_RE = /^[0-9]+(\.[0-9]+)*$/

/** `'1.1.03.01'` → 4. */
export function chartLevel(code: string): number {
  return code.split('.').length
}

/** `'1.1.03.01'` → `'1.1.03'`; la raíz no tiene padre (`null`). */
export function chartParentCode(code: string): string | null {
  const at = code.lastIndexOf('.')
  return at === -1 ? null : code.slice(0, at)
}

/** Lado natural de un tipo: activo y egreso deudores; pasivo, patrimonio e ingreso acreedores. */
export function naturalSide(type: AccountType): Side {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit'
}

/** ¿Es regularizadora? (su lado normal va al revés del de su tipo). */
export function isContraAccount(account: { type: AccountType; normalSide: Side }): boolean {
  return account.normalSide !== naturalSide(account.type)
}

const BY_CODE: ReadonlyMap<string, ChartAccountSeed> = new Map(
  STANDARD_CHART.map((a) => [a.code, a]),
)

const BY_SYSTEM_KEY: ReadonlyMap<SystemAccountKey, ChartAccountSeed> = new Map(
  STANDARD_CHART.flatMap((a) => (a.systemKey ? [[a.systemKey, a] as const] : [])),
)

/** La cuenta del plan estándar con ese código, o `undefined`. */
export function chartAccountByCode(code: string): ChartAccountSeed | undefined {
  return BY_CODE.get(code)
}

/** La cuenta del plan estándar con esa clave del sistema, o `undefined`. */
export function chartAccountBySystemKey(key: SystemAccountKey): ChartAccountSeed | undefined {
  return BY_SYSTEM_KEY.get(key)
}
