/**
 * Plan de cuentas estándar (migración #16, `…_acc_chart_flex_seed`): el MISMO plan que siembra
 * `private.acc_seed_chart` desde su `values (…)`, escrito como constante. Inspirado en el modelo de
 * plan de cuentas de la contadora (5 niveles: `1.0.00.00.000` grupos … `1.1.01.01.001` imputables;
 * 1 Activo, 2 Pasivo, 3 Patrimonio neto, 4 Resultado del ejercicio con 4.1 Ingresos y 4.2 Egresos
 * adentro, 5 Compras) y adaptado a una SAS gastronómica responsable inscripta de Córdoba.
 *
 * Para qué sirve en TypeScript:
 * - los tests verifican que toda `system_key` que usa el motor existe y es imputable, y que este
 *   archivo y el SQL de la siembra digan exactamente lo mismo (accounting-system-keys.test.ts);
 * - los fixtures de los tests arman un `PostingContext` realista sin base;
 * - la pantalla del plan muestra «Para qué se usa» aunque la contadora todavía no haya tocado nada.
 *
 * Todo el plan es configurable en la base (#16): el código es una etiqueta libre (formato y único por
 * bar), un grupo se mueve con todo su subárbol, bajo un grupo de resultados (ingreso o egreso) la
 * cuenta puede ser de cualquiera de los dos tipos, se importa un plan pegado
 * (`acc_import_accounts`) y una clave del sistema se pasa a otra cuenta compatible
 * (`acc_remap_system_account`). Lo que no cambia es la `system_key`: acá los códigos viven solo como
 * semilla. Las hojas de «Caja y bancos» (`1.1.01.01.001`, `.002`…) y las tarjetas de la empresa (en
 * «Deudas comerciales», `2.1.01.01.004`…) las crea el asistente, no el seed.
 */

import type { SystemAccountKey } from './system-keys'
import type { AccountType, Side } from './types'

export type ChartAccountSeed = {
  code: string
  name: string
  type: AccountType
  /** Lado normal: las regularizadoras van al revés de su tipo. */
  normalSide: Side
  /** Imputable (hoja). */
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

/** En orden de código: cada madre antes que sus hijas. */
export const STANDARD_CHART: readonly ChartAccountSeed[] = [
  g('1.0.00.00.000', 'ACTIVO', 'asset', D),
  g('1.1.00.00.000', 'Activo corriente', 'asset', D),
  g('1.1.01.00.000', 'Caja, bancos y valores a depositar', 'asset', D),
  g(
    '1.1.01.01.000',
    'Caja y bancos',
    'asset',
    D,
    'Cada caja, cuenta bancaria y billetera tiene acá su cuenta (las crea el asistente: Caja .001, Mercado Pago .002, banco .003…)',
  ),
  g('1.1.01.03.000', 'Valores', 'asset', D),
  c('1.1.01.03.001', 'Valores a depositar', 'asset', D, {
    desc: 'Cheques recibidos que todavía no depositaste',
  }),
  g('1.1.01.04.000', 'Fondos fijos y moneda extranjera', 'asset', D),
  c('1.1.01.04.001', 'Fondos a rendir', 'asset', D, {
    desc: 'Plata entregada a alguien que después rinde con comprobantes',
  }),
  c('1.1.01.04.002', 'Moneda extranjera', 'asset', D, {
    desc: 'Dólares u otra moneda de la SAS, valuados en pesos (los carga la contadora)',
  }),
  g('1.1.02.00.000', 'Inversiones corrientes', 'asset', D),
  g('1.1.02.01.000', 'Depósitos a plazo fijo', 'asset', D),
  c('1.1.02.01.001', 'Plazos fijos en pesos', 'asset', D, {
    desc: 'Plazos fijos a menos de un año',
  }),
  c('1.1.02.01.002', 'Plazos fijos en dólares', 'asset', D, {
    desc: 'Plazos fijos en moneda extranjera, valuados en pesos',
  }),
  g('1.1.03.00.000', 'Créditos', 'asset', D),
  g('1.1.03.01.000', 'Créditos por ventas', 'asset', D),
  c('1.1.03.01.001', 'Deudores por ventas', 'asset', D, {
    key: 'receivable_customers',
    ctrl: true,
    desc: 'Lo que te deben empresas y clientes con cuenta corriente',
  }),
  c('1.1.03.01.003', 'Tarjetas de crédito a cobrar', 'asset', D, {
    key: 'receivable_credit_cards',
    ctrl: true,
    desc: 'Ventas con crédito que el procesador todavía no acreditó',
  }),
  c('1.1.03.01.004', 'Tarjetas de débito a cobrar', 'asset', D, {
    key: 'receivable_debit_cards',
    ctrl: true,
    desc: 'Ventas con débito que el procesador todavía no acreditó',
  }),
  c('1.1.03.01.005', 'Mercado Pago a acreditar', 'asset', D, {
    key: 'receivable_wallets',
    ctrl: true,
    desc: 'QR y transferencias vendidos que todavía no registraste como acreditados («Ajustar saldo» de Mercado Pago)',
  }),
  c('1.1.03.01.006', 'Plataformas de delivery a cobrar', 'asset', D, {
    key: 'receivable_platforms',
    ctrl: true,
    desc: 'Lo que te deben PedidosYa, Rappi y las demás; si una liquidación da negativo, acá queda lo que les debés',
  }),
  c('1.1.03.01.009', 'Previsión para deudores incobrables (regularizadora)', 'asset', A, {
    key: 'bad_debt_allowance',
    desc: 'Ajuste de la contadora por cobros dudosos',
  }),
  g('1.1.03.02.000', 'Otros créditos', 'asset', D),
  c('1.1.03.02.001', 'Gastos pagados por adelantado', 'asset', D, {
    key: 'prepaid_expenses',
    cpra: true,
    desc: 'Seguros o alquileres pagados por varios meses',
  }),
  c('1.1.03.02.002', 'Diferencias de cobro a conciliar', 'asset', D, {
    key: 'reconciliation_differences',
    desc: 'Lo que no se explica al ajustar el saldo de Mercado Pago o de un banco; la contadora lo reclasifica',
  }),
  c('1.1.03.02.004', 'Deudores varios', 'asset', D, {
    desc: 'Otros que le deben plata a la SAS (no por ventas)',
  }),
  c('1.1.03.02.005', 'Anticipos y préstamos al personal', 'asset', D, {
    desc: 'Adelantos de sueldo o préstamos a empleados',
  }),
  c('1.1.03.02.010', 'Anticipos a proveedores', 'asset', D, {
    key: 'supplier_advances',
    desc: 'La contadora reclasifica acá los pagos a cuenta al cierre del ejercicio',
  }),
  g('1.1.03.04.000', 'Anticipos de impuestos y créditos fiscales', 'asset', D),
  c('1.1.03.04.003', 'Anticipos de Ganancias', 'asset', D, {
    key: 'income_tax_advances',
    desc: 'Anticipos de Ganancias pagados',
  }),
  c('1.1.03.04.006', 'Retenciones de Ganancias sufridas', 'asset', D, {
    key: 'income_tax_withholdings',
    desc: 'Ganancias que te retienen al cobrar, con certificado',
  }),
  c('1.1.03.04.008', 'Retenciones y percepciones municipales sufridas', 'asset', D, {
    desc: 'Comercio e Industria que te retienen o perciben; se descuenta de la contribución del mes',
  }),
  c('1.1.03.04.011', 'Saldo a favor de Ganancias', 'asset', D, {
    desc: 'Lo que sobró de la declaración jurada de Ganancias',
  }),
  c('1.1.03.04.013', 'IVA saldo técnico a favor', 'asset', D, {
    key: 'vat_technical_balance',
    desc: 'Cuando en un mes compraste más IVA del que vendiste; se usa en los meses siguientes',
  }),
  c('1.1.03.04.014', 'Retenciones de IIBB sufridas (tarjetas y plataformas)', 'asset', D, {
    key: 'iibb_withholdings',
    desc: 'Ingresos Brutos que te retienen al acreditar tarjetas, plataformas o clientes',
  }),
  c('1.1.03.04.016', 'Retenciones de seguridad social (SUSS) sufridas', 'asset', D, {
    desc: 'Aportes que te retiene un cliente al pagarte, con certificado',
  }),
  c('1.1.03.04.022', 'IIBB Córdoba saldo a favor', 'asset', D, {
    key: 'iibb_balance',
    desc: 'Lo que sobró de la declaración de Ingresos Brutos (Rentas Córdoba)',
  }),
  c('1.1.03.04.026', 'Impuesto ley 25.413 computable en Ganancias', 'asset', D, {
    key: 'bank_tax_credit',
    desc: 'La parte del impuesto al cheque que se descuenta de Ganancias (33 % por defecto)',
  }),
  c('1.1.03.04.028', 'IVA crédito fiscal', 'asset', D, {
    key: 'vat_credit',
    desc: 'El IVA de las facturas A que te hacen los responsables inscriptos: se descuenta del IVA que cobrás',
  }),
  c('1.1.03.04.029', 'Retenciones de IVA sufridas', 'asset', D, {
    key: 'vat_withholdings',
    desc: 'IVA que te retuvo un cliente o un procesador al pagarte, con certificado',
  }),
  c('1.1.03.04.030', 'Percepciones de IIBB sufridas', 'asset', D, {
    key: 'iibb_perceptions',
    desc: 'Ingresos Brutos que te cobró un proveedor en la factura',
  }),
  c('1.1.03.04.031', 'IVA crédito fiscal a documentar', 'asset', D, {
    key: 'vat_credit_pending',
    ctrl: true,
    desc: 'IVA de comisiones ya descontadas (Mercado Pago, plataformas) cuya factura mensual todavía no llegó',
  }),
  c('1.1.03.04.032', 'IVA saldo de libre disponibilidad', 'asset', D, {
    key: 'vat_free_balance',
    desc: 'Percepciones y retenciones de IVA que sobraron; sirven para pagar IVA u otros impuestos',
  }),
  c('1.1.03.04.033', 'Percepciones de IVA sufridas', 'asset', D, {
    key: 'vat_perceptions',
    desc: 'IVA extra que te cobró un proveedor en la factura; se descuenta en la liquidación del mes',
  }),
  c('1.1.03.04.034', 'Recaudaciones IIBB SIRCREB (bancos)', 'asset', D, {
    key: 'iibb_sircreb',
    desc: 'Lo que el banco descuenta de Ingresos Brutos sobre los créditos de la cuenta',
  }),
  c('1.1.03.04.035', 'Recaudaciones IIBB SIRCUPA (billeteras)', 'asset', D, {
    key: 'iibb_sircupa',
    desc: 'Lo que Mercado Pago descuenta de Ingresos Brutos sobre lo que entra',
  }),
  c('1.1.03.04.036', 'Percepciones de Ganancias sufridas', 'asset', D, {
    key: 'income_tax_perceptions',
    desc: 'Ganancias que te cobra un proveedor en la factura',
  }),
  g('1.1.04.00.000', 'Bienes de cambio', 'asset', D),
  c('1.1.04.01.000', 'Mercaderías (existencia)', 'asset', D, {
    key: 'inventory',
    desc: 'Existencia al cierre (la carga la contadora hasta el Sprint de Stock)',
  }),
  g('1.2.00.00.000', 'Activo no corriente', 'asset', D),
  g('1.2.02.00.000', 'Bienes de uso', 'asset', D),
  g('1.2.02.01.000', 'Equipamiento de cocina y barra', 'asset', D),
  c('1.2.02.01.001', 'Equipamiento de cocina y barra', 'asset', D, {
    cpra: true,
    desc: 'Hornos, heladeras, cafeteras, freidoras',
  }),
  c('1.2.02.01.002', 'Amortización acumulada de equipamiento (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.03.000', 'Rodados', 'asset', D),
  c('1.2.02.03.001', 'Rodados', 'asset', D, {
    cpra: true,
    desc: 'Vehículos de la SAS (motos de delivery, utilitarios)',
  }),
  c('1.2.02.03.003', 'Amortización acumulada de rodados (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.04.000', 'Muebles y útiles', 'asset', D),
  c('1.2.02.04.001', 'Muebles y útiles', 'asset', D, {
    cpra: true,
    desc: 'Mesas, sillas, barra y estanterías que duran años',
  }),
  c('1.2.02.04.002', 'Amortización acumulada de muebles y útiles (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.05.000', 'Instalaciones', 'asset', D),
  c('1.2.02.05.001', 'Instalaciones', 'asset', D, {
    cpra: true,
    desc: 'Obras e instalaciones del local: eléctrica, gas, aire acondicionado',
  }),
  c('1.2.02.05.002', 'Amortización acumulada de instalaciones (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.07.000', 'Vajilla', 'asset', D),
  c('1.2.02.07.001', 'Vajilla, cristalería y cubiertos', 'asset', D, {
    cpra: true,
    desc: 'Platos, copas y cubiertos de la compra inicial o de una renovación grande',
  }),
  c('1.2.02.07.002', 'Amortización acumulada de vajilla (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.09.000', 'Mejoras en inmuebles de terceros', 'asset', D),
  c('1.2.02.09.001', 'Mejoras en inmuebles de terceros', 'asset', D, {
    cpra: true,
    desc: 'Reformas en el local alquilado',
  }),
  c('1.2.02.09.002', 'Amortización acumulada de mejoras (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.10.000', 'Equipos de computación', 'asset', D),
  c('1.2.02.10.001', 'Equipos de computación', 'asset', D, {
    cpra: true,
    desc: 'Computadoras, tablets, impresoras y comanderas',
  }),
  c('1.2.02.10.002', 'Amortización acumulada de computación (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.02.99.000', 'Amortización acumulada general', 'asset', D),
  c('1.2.02.99.001', 'Amortización acumulada de bienes de uso (regularizadora)', 'asset', A, {
    key: 'accumulated_depreciation',
    desc: 'La regularizadora general del sistema; la contadora puede usar la de cada rubro',
  }),
  g('1.2.03.00.000', 'Activos intangibles', 'asset', D),
  g('1.2.03.01.000', 'Intangibles', 'asset', D),
  c('1.2.03.01.001', 'Software y licencias', 'asset', D, {
    cpra: true,
    desc: 'Licencias que duran más de un año',
  }),
  c('1.2.03.01.002', 'Gastos de organización', 'asset', D, {
    cpra: true,
    desc: 'Gastos de constitución de la SAS',
  }),
  c('1.2.03.01.009', 'Amortización acumulada de intangibles (regularizadora)', 'asset', A, {
    desc: 'La carga la contadora al cierre',
  }),
  g('1.2.04.00.000', 'Otros activos no corrientes', 'asset', D),
  g('1.2.04.01.000', 'Depósitos y garantías', 'asset', D),
  c('1.2.04.01.001', 'Depósitos en garantía', 'asset', D, {
    desc: 'Lo que dejaste de garantía al alquilar el local',
  }),
  g('2.0.00.00.000', 'PASIVO', 'liability', A),
  g('2.1.00.00.000', 'Pasivo corriente', 'liability', A),
  g('2.1.01.00.000', 'Deudas', 'liability', A),
  g(
    '2.1.01.01.000',
    'Deudas comerciales',
    'liability',
    A,
    'Proveedores y señas; acá se crean también las tarjetas de crédito de la empresa',
  ),
  c('2.1.01.01.001', 'Proveedores', 'liability', A, {
    key: 'payable_suppliers',
    ctrl: true,
    desc: 'Lo que les debés a los proveedores, factura por factura',
  }),
  c('2.1.01.01.003', 'Anticipos de clientes (señas)', 'liability', A, {
    key: 'customer_deposits',
    ctrl: true,
    desc: 'Señas y anticipos cobrados antes de la venta',
  }),
  g('2.1.01.03.000', 'Deudas fiscales', 'liability', A),
  c('2.1.01.03.001', 'IVA a pagar', 'liability', A, {
    key: 'vat_payable',
    ctrl: true,
    desc: 'Lo que da la liquidación mensual del IVA, hasta que se paga',
  }),
  c('2.1.01.03.002', 'Comercio e Industria a pagar', 'liability', A, {
    key: 'municipal_payable',
    ctrl: true,
    desc: 'La contribución municipal sobre comercio e industria, hasta que se paga',
  }),
  c('2.1.01.03.003', 'IIBB Córdoba a pagar', 'liability', A, {
    key: 'iibb_payable',
    ctrl: true,
    desc: 'La declaración de Ingresos Brutos del mes (Rentas Córdoba), hasta que se paga',
  }),
  c('2.1.01.03.011', 'Ganancias a pagar', 'liability', A, {
    key: 'income_tax_payable',
    ctrl: true,
    desc: 'Declaración y anticipos de Ganancias',
  }),
  c('2.1.01.03.015', 'IVA débito fiscal', 'liability', A, {
    key: 'vat_debit',
    desc: 'El IVA de lo que facturaste',
  }),
  c('2.1.01.03.018', 'Otros impuestos y planes de pago a pagar', 'liability', A, {
    key: 'other_taxes_payable',
    ctrl: true,
    desc: 'Planes de pago de ARCA y otros tributos',
  }),
  g('2.1.01.04.000', 'Deudas sociales', 'liability', A),
  c('2.1.01.04.001', 'Sueldos a pagar', 'liability', A, {
    key: 'payroll_payable',
    ctrl: true,
    desc: 'Sueldos netos liquidados que todavía no se pagaron',
  }),
  c('2.1.01.04.002', 'Honorarios a pagar', 'liability', A, {
    desc: 'Honorarios de profesionales ya devengados que todavía no se pagaron',
  }),
  c('2.1.01.04.003', 'Provisión SAC y vacaciones', 'liability', A, {
    key: 'payroll_provisions',
    desc: 'La carga la contadora',
  }),
  g('2.1.01.05.000', 'Aportes y contribuciones', 'liability', A),
  c('2.1.01.05.001', 'Cargas sociales a pagar (F.931)', 'liability', A, {
    key: 'social_security_payable',
    ctrl: true,
    desc: 'Aportes y contribuciones del F.931',
  }),
  c('2.1.01.05.002', 'ART a pagar', 'liability', A, {
    desc: 'La cuota de la aseguradora de riesgos del trabajo, hasta que se paga',
  }),
  c('2.1.01.05.003', 'Sindicato y obra social a pagar', 'liability', A, {
    key: 'union_payable',
    ctrl: true,
    desc: 'Cuotas sindicales y de obra social retenidas',
  }),
  c('2.1.01.05.005', 'Fondo convenio a pagar', 'liability', A, {
    desc: 'Aportes del convenio colectivo gastronómico retenidos o a cargo de la SAS',
  }),
  g('2.1.01.06.000', 'Otras deudas', 'liability', A),
  c('2.1.01.06.003', 'Acreedores varios', 'liability', A, {
    key: 'other_payables',
    ctrl: true,
    desc: 'Otras deudas con un acreedor identificado',
  }),
  c('2.1.01.06.007', 'Cuentas particulares de socios', 'liability', A, {
    key: 'partners_current',
    ctrl: true,
    desc: 'Retiros y aportes de cada socio',
  }),
  g('2.1.01.07.000', 'Deudas financieras', 'liability', A),
  c('2.1.01.07.001', 'Préstamos bancarios', 'liability', A, {
    key: 'bank_loans',
    desc: 'Préstamos del banco a menos de un año',
  }),
  c('2.1.01.07.002', 'Préstamos de socios', 'liability', A, {
    key: 'partner_loans',
    ctrl: true,
    desc: 'Plata que un socio le prestó a la SAS',
  }),
  g('2.1.02.00.000', 'Previsiones', 'liability', A),
  c('2.1.02.01.000', 'Previsión para despidos', 'liability', A, {
    desc: 'Indemnizaciones posibles por despidos (la carga la contadora)',
  }),
  g('2.2.00.00.000', 'Pasivo no corriente', 'liability', A),
  g('2.2.01.00.000', 'Préstamos', 'liability', A),
  g('2.2.01.01.000', 'Préstamos a largo plazo', 'liability', A),
  c('2.2.01.01.001', 'Préstamos bancarios a largo plazo', 'liability', A, {
    desc: 'Cuotas que vencen a más de un año',
  }),
  g('3.0.00.00.000', 'PATRIMONIO NETO', 'equity', A),
  g('3.1.00.00.000', 'Capital', 'equity', A),
  c('3.1.01.00.000', 'Capital social', 'equity', A, {
    key: 'share_capital',
    desc: 'El capital del estatuto',
  }),
  c('3.1.02.00.000', 'Ajuste de capital', 'equity', A, {
    desc: 'El ajuste por inflación del capital (lo carga la contadora)',
  }),
  c('3.1.07.00.000', 'Aportes irrevocables', 'equity', A, {
    key: 'irrevocable_contributions',
    desc: 'Aportes a cuenta de futuras suscripciones',
  }),
  c('3.1.08.00.000', 'Socios: capital a integrar (regularizadora)', 'equity', D, {
    key: 'capital_receivable',
    desc: 'Capital suscripto que los socios todavía no pusieron',
  }),
  g('3.3.00.00.000', 'Reservas y resultados', 'equity', A),
  g('3.3.01.00.000', 'Reserva legal', 'equity', A),
  c('3.3.01.01.000', 'Reserva legal', 'equity', A, {
    key: 'legal_reserve',
    desc: 'La define la asamblea',
  }),
  g('3.3.02.00.000', 'Otras reservas', 'equity', A),
  c('3.3.02.01.000', 'Reservas facultativas', 'equity', A, {
    desc: 'Reservas que decide la reunión de socios',
  }),
  g('3.3.03.00.000', 'Resultados no asignados', 'equity', A),
  c('3.3.03.01.000', 'Resultados no asignados', 'equity', A, {
    key: 'retained_earnings',
    desc: 'Ganancias o pérdidas de ejercicios anteriores',
  }),
  c('3.3.03.03.000', 'Ajustes de ejercicios anteriores', 'equity', A, {
    desc: 'Correcciones de ejercicios ya cerrados (las carga la contadora)',
  }),
  c('3.3.03.04.000', 'Resultado del ejercicio', 'equity', A, {
    key: 'current_year_result',
    desc: 'Lo deja la refundición al cerrar el ejercicio',
  }),
  c('3.3.03.05.000', 'Saldo de apertura a asignar', 'equity', A, {
    key: 'opening_equity',
    desc: 'La diferencia del asiento de apertura; la contadora la pasa a capital o resultados',
  }),
  g(
    '4.0.00.00.000',
    'RESULTADO DEL EJERCICIO',
    'income',
    A,
    'Ingresos menos egresos: su saldo es la ganancia (o la pérdida) del ejercicio',
  ),
  g('4.1.00.00.000', 'INGRESOS', 'income', A),
  g('4.1.01.00.000', 'Ventas', 'income', A),
  g('4.1.01.01.000', 'Ventas del salón', 'income', A),
  c('4.1.01.01.001', 'Ventas salón: facturadas', 'income', A, {
    key: 'sales_salon_invoiced',
    desc: 'Neto de lo facturado en el salón (concilia con el Libro IVA ventas)',
  }),
  c('4.1.01.01.002', 'Ventas salón: sin factura', 'income', A, {
    key: 'sales_salon_uninvoiced',
    desc: 'Lo vendido en el salón que no se facturó (sin IVA débito)',
  }),
  g('4.1.01.02.000', 'Ventas de delivery', 'income', A),
  c('4.1.01.02.001', 'Ventas delivery: facturadas', 'income', A, {
    key: 'sales_delivery_invoiced',
    desc: 'Neto de lo facturado por delivery',
  }),
  c('4.1.01.02.002', 'Ventas delivery: sin factura', 'income', A, {
    key: 'sales_delivery_uninvoiced',
    desc: 'Lo vendido por delivery que no se facturó',
  }),
  g('4.1.01.03.000', 'Ventas de eventos y empresas', 'income', A),
  c('4.1.01.03.001', 'Ventas eventos: facturadas', 'income', A, {
    key: 'sales_events_invoiced',
    desc: 'Eventos y empresas facturados',
  }),
  c('4.1.01.03.002', 'Ventas eventos: sin factura', 'income', A, {
    key: 'sales_events_uninvoiced',
    desc: 'Eventos que no se facturaron',
  }),
  g('4.1.02.00.000', 'Ingresos financieros', 'income', A),
  g('4.1.02.01.000', 'Intereses ganados', 'income', A),
  c('4.1.02.01.001', 'Intereses y rendimientos', 'income', A, {
    key: 'interest_income',
    desc: 'Rendimientos de Mercado Pago, plazos fijos',
  }),
  g('4.1.02.03.000', 'Otros ingresos financieros', 'income', A),
  c('4.1.02.03.001', 'Descuentos obtenidos', 'income', A, {
    key: 'discounts_obtained',
    desc: 'Bonificaciones y diferencias chicas a favor al pagar',
  }),
  c('4.1.02.03.003', 'Resultado por exposición a la inflación (RECPAM)', 'income', A, {
    desc: 'El ajuste por inflación de los estados contables (lo carga la contadora)',
  }),
  g('4.1.03.00.000', 'Otros ingresos', 'income', A),
  g('4.1.03.01.000', 'Otros ingresos', 'income', A),
  c('4.1.03.01.001', 'Sobrantes de caja', 'income', A, {
    key: 'cash_over',
    desc: 'Cuando al contar la caja hay más de lo que dice el sistema',
  }),
  c('4.1.03.01.002', 'Ingresos varios', 'income', A, {
    key: 'other_income',
    desc: 'Ingresos que no son ventas',
  }),
  c('4.1.03.01.003', 'Recupero de gastos', 'income', A, {
    desc: 'Gastos que te devuelven, por ejemplo un seguro que paga un arreglo',
  }),
  c('4.1.03.01.004', 'Resultado por venta de bienes de uso', 'income', A, {
    desc: 'Lo que se gana al vender un equipo o un mueble de la SAS (lo calcula la contadora)',
  }),
  g('4.2.00.00.000', 'EGRESOS', 'expense', D),
  g('4.2.01.00.000', 'Gastos de comercialización', 'expense', D),
  g('4.2.01.01.000', 'Personal', 'expense', D),
  c('4.2.01.01.003', 'Sueldos y jornales', 'expense', D, {
    key: 'salaries',
    desc: 'Sueldos brutos (asiento mensual de la contadora)',
  }),
  c('4.2.01.01.006', 'Contribuciones patronales', 'expense', D, {
    key: 'employer_contributions',
    desc: 'Las cargas a cargo de la SAS',
  }),
  c('4.2.01.01.008', 'Gratificaciones y premios', 'expense', D, {
    desc: 'Premios y gratificaciones al personal (los liquida la contadora)',
  }),
  c('4.2.01.01.010', 'ART y seguro de vida obligatorio', 'expense', D, {
    cpra: true,
    desc: 'Seguro de riesgos del trabajo',
  }),
  c('4.2.01.01.011', 'Personal eventual y extras', 'expense', D, {
    cpra: true,
    desc: 'Extras de eventos, changas',
  }),
  c('4.2.01.01.012', 'Uniformes y ropa de trabajo', 'expense', D, {
    cpra: true,
    desc: 'Delantales, chaquetas y calzado de trabajo',
  }),
  g('4.2.01.02.000', 'Impuestos, tasas y contribuciones', 'expense', D),
  c('4.2.01.02.003', 'Impuesto a las ganancias', 'expense', D, {
    key: 'income_tax_expense',
    desc: 'El impuesto del ejercicio (lo carga la contadora)',
  }),
  c('4.2.01.02.005', 'Comercio e Industria', 'expense', D, {
    key: 'municipal_tax_expense',
    cpra: true,
    desc: 'La contribución municipal sobre comercio e industria',
  }),
  c('4.2.01.02.008', 'Impuesto de sellos', 'expense', D, {
    cpra: true,
    desc: 'Sellos de Rentas por contratos, por ejemplo el alquiler',
  }),
  c('4.2.01.02.010', 'Ingresos Brutos', 'expense', D, {
    key: 'iibb_expense',
    cpra: true,
    desc: 'La declaración mensual de IIBB',
  }),
  c('4.2.01.02.015', 'Otros impuestos y tasas', 'expense', D, {
    key: 'other_taxes_expense',
    cpra: true,
    desc: 'Percepciones municipales y otros tributos',
  }),
  g('4.2.01.03.000', 'Gastos del local', 'expense', D),
  c('4.2.01.03.001', 'Mantenimiento y reparaciones', 'expense', D, {
    key: 'maintenance',
    cpra: true,
    desc: 'Plomero, electricista, arreglos',
  }),
  c('4.2.01.03.002', 'Amortizaciones', 'expense', D, {
    key: 'depreciation',
    desc: 'La carga la contadora al cierre',
  }),
  c('4.2.01.03.003', 'Telefonía', 'expense', D, { cpra: true, desc: 'Celulares y teléfono fijo' }),
  c('4.2.01.03.004', 'Energía eléctrica', 'expense', D, { cpra: true, desc: 'Luz (EPEC)' }),
  c('4.2.01.03.005', 'Gas', 'expense', D, { cpra: true, desc: 'Gas natural o envasado' }),
  c('4.2.01.03.006', 'Librería y papelería', 'expense', D, {
    cpra: true,
    desc: 'Papel, rollos de ticketera',
  }),
  c('4.2.01.03.008', 'Otra publicidad y promociones', 'expense', D, {
    key: 'advertising_other',
    cpra: true,
    desc: 'Volantes, cartelería, promociones',
  }),
  c('4.2.01.03.011', 'Software y suscripciones', 'expense', D, {
    cpra: true,
    desc: 'Thinkeon, HUB, apps',
  }),
  c('4.2.01.03.012', 'Alquiler', 'expense', D, { cpra: true, desc: 'El alquiler del local' }),
  c('4.2.01.03.014', 'Gastos varios', 'expense', D, {
    key: 'misc_expenses',
    cpra: true,
    desc: 'Lo que no entra en otra cuenta',
  }),
  c('4.2.01.03.016', 'Movilidad, fletes y envíos', 'expense', D, {
    cpra: true,
    desc: 'Taxis, fletes, cadetería',
  }),
  c('4.2.01.03.017', 'Atención a clientes y cortesías', 'expense', D, {
    cpra: true,
    desc: 'Invitaciones, regalos y atenciones a clientes',
  }),
  c('4.2.01.03.018', 'Deudores incobrables', 'expense', D, {
    desc: 'Lo que un cliente ya no va a pagar (lo carga la contadora)',
  }),
  c('4.2.01.03.022', 'Mantenimiento edilicio', 'expense', D, {
    cpra: true,
    desc: 'Arreglos del edificio: pintura, techos, plomería grande',
  }),
  c('4.2.01.03.024', 'Agua', 'expense', D, { cpra: true, desc: 'Agua' }),
  c('4.2.01.03.025', 'Internet', 'expense', D, { cpra: true, desc: 'Internet del local' }),
  c('4.2.01.03.027', 'Publicidad en redes (Meta, Google)', 'expense', D, {
    key: 'advertising_online',
    cpra: true,
    desc: 'Pauta en redes, en pesos',
  }),
  c('4.2.01.03.028', 'Faltantes de caja', 'expense', D, {
    key: 'cash_short',
    desc: 'Cuando al contar la caja hay menos de lo que dice el sistema',
  }),
  c('4.2.01.03.029', 'Limpieza e higiene', 'expense', D, {
    key: 'cleaning',
    cpra: true,
    desc: 'Artículos de limpieza, fumigación',
  }),
  c('4.2.01.03.030', 'Expensas', 'expense', D, { cpra: true, desc: 'Expensas del local' }),
  c('4.2.01.03.031', 'Seguridad y monitoreo', 'expense', D, {
    cpra: true,
    desc: 'Alarma, vigilancia',
  }),
  c('4.2.01.03.032', 'Música y derechos (SADAIC, AADI-CAPIF)', 'expense', D, {
    cpra: true,
    desc: 'Derechos de música',
  }),
  c('4.2.01.03.033', 'Vajilla y utensilios de reposición', 'expense', D, {
    cpra: true,
    desc: 'Vasos, platos y utensilios que se rompen y se reponen seguido',
  }),
  g('4.2.01.05.000', 'Comisiones y costos de cobro', 'expense', D),
  c('4.2.01.05.001', 'Comisiones de tarjetas', 'expense', D, {
    key: 'fees_cards',
    desc: 'Aranceles de débito y crédito',
  }),
  c('4.2.01.05.002', 'Comisiones de Mercado Pago', 'expense', D, {
    key: 'fees_wallets',
    desc: 'Comisión de QR y otras de Mercado Pago',
  }),
  c('4.2.01.05.003', 'Comisiones de plataformas de delivery', 'expense', D, {
    key: 'fees_platforms',
    desc: 'Comisión de PedidosYa, Rappi y las demás',
  }),
  c('4.2.01.05.004', 'Costo financiero y otros cargos de cobro', 'expense', D, {
    key: 'fees_other',
    cpra: true,
    desc: 'Cargos de cobro que no son comisión',
  }),
  g('4.2.02.00.000', 'Gastos de administración', 'expense', D),
  g('4.2.02.01.000', 'Honorarios', 'expense', D),
  c('4.2.02.01.003', 'Honorarios contables', 'expense', D, {
    cpra: true,
    desc: 'La contadora o el estudio contable',
  }),
  c('4.2.02.01.006', 'Honorarios profesionales', 'expense', D, {
    cpra: true,
    desc: 'Abogados, diseño, sistemas y otros profesionales',
  }),
  g('4.2.02.04.000', 'Gastos bancarios y financieros', 'expense', D),
  c('4.2.02.04.001', 'Intereses pagados', 'expense', D, {
    key: 'interest_expense',
    cpra: true,
    desc: 'Intereses de préstamos y tarjetas',
  }),
  c('4.2.02.04.003', 'Gastos bancarios', 'expense', D, {
    key: 'bank_fees',
    cpra: true,
    desc: 'Mantenimiento de cuenta y comisiones del banco',
  }),
  c('4.2.02.04.004', 'Intereses y multas fiscales', 'expense', D, {
    key: 'tax_penalties',
    cpra: true,
    desc: 'Recargos por pagar tarde',
  }),
  c('4.2.02.04.005', 'Diferencias de cambio', 'expense', D, {
    desc: 'Lo que se pierde por la variación del dólar (lo carga la contadora)',
  }),
  c('4.2.02.04.006', 'Impuesto sobre débitos y créditos bancarios', 'expense', D, {
    key: 'bank_tax_expense',
    desc: 'La parte del impuesto al cheque que no se computa en Ganancias',
  }),
  g('4.2.02.05.000', 'Seguros', 'expense', D),
  c('4.2.02.05.001', 'Seguros', 'expense', D, {
    cpra: true,
    desc: 'Seguro integral del local y otros seguros',
  }),
  g('4.2.03.00.000', 'Costo de mercadería vendida', 'expense', D),
  c('4.2.03.01.000', 'Costo de mercadería vendida', 'expense', D, {
    desc: 'Existencia inicial más compras menos existencia final (lo calcula la contadora al cierre)',
  }),
  c('4.2.03.02.000', 'Variación de existencias', 'expense', D, {
    key: 'inventory_variation',
    desc: 'La carga la contadora al cierre',
  }),
  g(
    '5.0.00.00.000',
    'COMPRAS',
    'expense',
    D,
    'Lo que comprás para vender o elaborar; al cierre la contadora lo lleva al costo de mercadería vendida',
  ),
  g('5.1.00.00.000', 'Compras de mercadería e insumos', 'expense', D),
  g('5.1.01.00.000', 'Compras de mercadería', 'expense', D),
  g('5.1.01.01.000', 'Alimentos y bebidas', 'expense', D),
  c('5.1.01.01.001', 'Compras: alimentos', 'expense', D, {
    key: 'purchases_food',
    cpra: true,
    desc: 'Carne, verdura, almacén',
  }),
  c('5.1.01.01.002', 'Compras: bebidas sin alcohol', 'expense', D, {
    key: 'purchases_soft_drinks',
    cpra: true,
    desc: 'Gaseosas, aguas, jugos',
  }),
  c('5.1.01.01.003', 'Compras: bebidas con alcohol', 'expense', D, {
    key: 'purchases_alcohol',
    cpra: true,
    desc: 'Cervezas, vinos, bebidas blancas',
  }),
  c('5.1.01.01.004', 'Compras: café e infusiones', 'expense', D, {
    key: 'purchases_coffee',
    cpra: true,
    desc: 'Café, té, yerba',
  }),
  c('5.1.01.01.005', 'Compras: panadería y pastelería', 'expense', D, {
    key: 'purchases_bakery',
    cpra: true,
    desc: 'Panes, facturas, tortas compradas',
  }),
  g('5.1.01.02.000', 'Insumos y descartables', 'expense', D),
  c('5.1.01.02.001', 'Compras: descartables y packaging', 'expense', D, {
    key: 'purchases_packaging',
    cpra: true,
    desc: 'Vasos, envases, bolsas de delivery',
  }),
  c('5.1.01.02.002', 'Compras: otros insumos', 'expense', D, {
    key: 'purchases_other',
    cpra: true,
    desc: 'Hielo y otros insumos de cocina y barra',
  }),
]

// ─── Ayudas sobre códigos ────────────────────────────────────────────────────

/** Formato de `acc_accounts.code` (aac_code_fmt): números separados por puntos. */
export const ACCOUNT_CODE_RE = /^[0-9]+(\.[0-9]+)*$/

/** Largo máximo de un código (aac_code_fmt). */
export const ACCOUNT_CODE_MAX_LENGTH = 24

/**
 * Código significativo: sin los segmentos finales en cero (`'1.1.01.01.000'` → `'1.1.01.01'`,
 * `'1.0.00.00.000'` → `'1'`). Espejo de `private.acc_code_sig`.
 */
export function significantCode(code: string): string {
  return code.replace(/(\.0+)+$/, '')
}

/**
 * Profundidad de un código = sus segmentos significativos (`'1.1.01.01.001'` → 5,
 * `'1.1.01.00.000'` → 3, `'1.1.03.01'` → 4). En el plan estándar coincide con el nivel.
 */
export function chartLevel(code: string): number {
  return significantCode(code).split('.').length
}

/**
 * Madre de un código del estilo con ceros: el último segmento significativo pasa a ceros del mismo
 * ancho (`'1.1.01.01.001'` → `'1.1.01.01.000'`, `'1.1.01.01.000'` → `'1.1.01.00.000'`); la raíz no
 * tiene (`null`). Espejo de `private.acc_code_parent` (la usa la siembra).
 */
export function chartParentCode(code: string): string | null {
  const segs = code.split('.')
  const at = chartLevel(code) - 1
  if (at === 0) return null
  segs[at] = '0'.repeat((segs[at] ?? '0').length)
  return segs.join('.')
}

/**
 * Siguiente código libre bajo una madre, con su estilo. Espejo de `private.acc_next_child_code`:
 * - estilo con ceros: numera el primer segmento de la cola de ceros con el mismo ancho
 *   (`'1.1.01.01.000'` con hijas `.001`…`.007` → `'1.1.01.01.008'`; `'1.1.01.00.000'` →
 *   `'1.1.01.03.000'`);
 * - estilo con puntos: agrega `.NN` (`'1.1.01'` → `'1.1.01.04'`).
 * `taken` son los códigos del plan (todos: el código es único por bar). Es solo la sugerencia que se
 * ve; si el campo queda vacío, el código lo elige la base.
 */
export function nextChildCode(parentCode: string, taken: Iterable<string>): string {
  const segs = parentCode.split('.')
  let zeroFrom = -1
  for (let i = segs.length - 1; i >= 1; i--) {
    if (!/^0+$/.test(segs[i] ?? '')) break
    zeroFrom = i
  }
  if (zeroFrom !== -1) {
    const prefix = `${segs.slice(0, zeroFrom).join('.')}.`
    const suffix = zeroFrom < segs.length - 1 ? `.${segs.slice(zeroFrom + 1).join('.')}` : ''
    const width = (segs[zeroFrom] ?? '').length
    let max = 0
    for (const code of taken) {
      if (code.length <= prefix.length + suffix.length) continue
      if (!code.startsWith(prefix) || !code.endsWith(suffix)) continue
      const middle = code.slice(prefix.length, code.length - suffix.length)
      if (/^[0-9]+$/.test(middle)) max = Math.max(max, Number(middle))
    }
    const next = String(max + 1)
    return `${prefix}${next.padStart(width, '0')}${suffix}`
  }
  const prefix = `${parentCode}.`
  let max = 0
  let width = 2
  for (const code of taken) {
    if (!code.startsWith(prefix)) continue
    const last = code.slice(prefix.length)
    if (!/^[0-9]{1,6}$/.test(last)) continue
    max = Math.max(max, Number(last))
    width = Math.max(width, last.length)
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}

/** Ingreso o egreso: las cuentas de resultado. */
export function isResultType(type: AccountType): boolean {
  return type === 'income' || type === 'expense'
}

/**
 * ¿Una cuenta de `childType` puede colgar de una madre de `parentType`? El mismo tipo, o las dos de
 * resultado: bajo «Resultado del ejercicio» (ingreso) hay egresos, y al revés (#16).
 */
export function childTypeAllowed(parentType: AccountType, childType: AccountType): boolean {
  return parentType === childType || (isResultType(parentType) && isResultType(childType))
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

// ─── Plan pegado (importar) ──────────────────────────────────────────────────

/** Una fila de `acc_import_accounts` (la madre y el tipo los resuelve la base si no vienen). */
export type ChartImportRow = {
  code: string
  name: string
  type?: AccountType
  postable?: boolean
  contra?: boolean
  parent_code?: string
  description?: string | null
}

export type PastedChartLineError = {
  /** Renglón de lo pegado, desde 1. */
  line: number
  raw: string
  message: string
}

const PASTED_LINE_RE = /^([0-9]+(?:\.[0-9]+)*)(?:\s*[-–—:|;]\s*|\s+)(.+)$/
const CODE_ONLY_RE = /^[0-9]+(?:\.[0-9]+)*$/

/**
 * Lo que se pega de un plan de cuentas (PDF, planilla o sistema anterior): una cuenta por renglón,
 * «1.1.01.01.001 CAJA», «1.1.01.01.001⇥CAJA» o «1.1.01.01.001 - CAJA» → filas `{code, name}` para
 * `acc_import_accounts`. Saltea renglones vacíos y los que no empiezan con un código (encabezados como
 * «PLAN DE CUENTAS», «EMPRESA: …» o la fecha). La madre se infiere en la base por el código.
 */
export function parsePastedChart(text: string): {
  rows: ChartImportRow[]
  errors: PastedChartLineError[]
} {
  const rows: ChartImportRow[] = []
  const errors: PastedChartLineError[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (line === '') return
    if (CODE_ONLY_RE.test(line)) {
      errors.push({ line: index + 1, raw, message: 'Falta el nombre de la cuenta.' })
      return
    }
    const match = PASTED_LINE_RE.exec(line)
    if (!match) return
    const code = match[1] ?? ''
    const name = (match[2] ?? '').replace(/\s+/g, ' ').trim()
    if (code.length > ACCOUNT_CODE_MAX_LENGTH) {
      errors.push({ line: index + 1, raw, message: 'El código puede tener hasta 24 caracteres.' })
    } else if (name.length < 2) {
      errors.push({ line: index + 1, raw, message: 'Falta el nombre de la cuenta.' })
    } else if (name.length > 80) {
      errors.push({ line: index + 1, raw, message: 'El nombre puede tener hasta 80 caracteres.' })
    } else {
      rows.push({ code, name })
    }
  })
  return { rows, errors }
}
