/**
 * Catálogo de errores y avisos de Administración (Sprint 1, G.4).
 *
 * - `ACC_ERRORS`: clave estable (la misma de `raise exception '<clave>'` en las
 *   RPC `acc_*` y de los `PostingError` del motor) → `code` de la acción → copy
 *   en rioplatense. Las claves marcadas `bug` no son errores de carga: se
 *   loguean con contexto (sin datos personales) y el usuario ve un mensaje
 *   genérico.
 * - `mapAccError`: un error de supabase-js/PostgREST → estado de la acción.
 *   Busca la clave dentro de `error.message` (como `mapPgError`); si no, decide
 *   por SQLSTATE y por el nombre del constraint.
 * - `warningCopy`: los avisos confirmables con sus botones.
 *
 * Los `{x}` de los mensajes se completan con el `detail` (de la RPC o del
 * motor) y con lo que pase el formulario. Si falta un dato, se usa el
 * `fallback` (sin huecos): nunca llega un `{nombre}` a la pantalla.
 *
 * Puro: sin `server-only`, sirve igual en el cliente.
 */

import { formatIsoDay, MONTH_NAMES } from '@/lib/dates'
import { formatVoucherNumber, formatVoucherRange } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import type { AccFailureCode, AccFailureState } from './action-state'
import { isVatRateBp, vatRateLabel } from './iva'
import type {
  CloseWarningKey,
  IvaCondition,
  MessageDetail,
  PostingError,
  PostingWarning,
  WarningKey,
} from './types'
import { voucherLabel } from './voucher-types'

/** El `code` del estado de la acción (G.3): decide cómo lo muestra el formulario. */
export type AccErrorCode = AccFailureCode

type AccErrorDef = {
  code: AccErrorCode
  message: string
  /** Mismo mensaje sin `{x}`, para cuando falta el dato. Obligatorio si `message` tiene huecos. */
  fallback?: string
  /** Error de programación, no de carga: se loguea y se muestra el genérico. */
  bug?: true
}

const BUG_MESSAGE =
  'No pudimos armar el asiento. Recargá la página y probá de nuevo; si sigue, avisanos.'

/** Genérico para lo que no se reconoce. */
export const ACC_GENERIC_ERROR = 'No pudimos guardar. Probá de nuevo; si sigue, avisanos.'

export const ACC_ERRORS = {
  // ─── Sesión, acceso y puesta en marcha ────────────────────────────────────
  unauthenticated: { code: 'forbidden', message: 'Tu sesión venció. Volvé a entrar.' },
  forbidden: {
    code: 'forbidden',
    message: 'No tenés permiso para hacer esto en Administración.',
  },
  accounting_not_enabled: {
    code: 'disabled',
    message: 'Administración no está habilitada para este bar.',
  },
  not_set_up: { code: 'conflict', message: 'Primero hay que configurar Administración.' },
  already_set_up: {
    code: 'conflict',
    message: 'Administración ya está configurada (la terminó {nombre}). Recargá la página.',
    fallback: 'Administración ya está configurada. Recargá la página.',
  },
  not_allowed_to_set_up: {
    code: 'forbidden',
    message: 'La configuración de Administración la hace otra persona del equipo.',
  },
  target_not_owner: { code: 'invalid', message: 'Solo se puede dar acceso a dueños del bar.' },
  last_admin: {
    code: 'conflict',
    message: 'Tiene que quedar al menos una persona que dé accesos.',
  },
  admins_exist: { code: 'conflict', message: 'Ya hay alguien que administra los accesos.' },
  access_not_found: { code: 'conflict', message: 'Esa persona ya no tiene acceso.' },
  display_name_invalid: {
    code: 'invalid',
    message: 'El nombre que se ve en Administración tiene que tener entre 1 y 80 caracteres.',
  },
  accountant_requires_acc_admin: {
    code: 'forbidden',
    message:
      'Solo quien administra los accesos de Administración puede sumar o cambiar a la contadora.',
  },
  protected_accounting_member: {
    code: 'forbidden',
    message:
      'Esta persona tiene acceso a Administración: solo quien administra los accesos puede cambiarle el rol, la contraseña o sacarla del equipo.',
  },
  invalid_cuit: { code: 'invalid', message: 'El CUIT no es válido: revisá el último número.' },
  invalid_start_date: {
    code: 'invalid',
    message: 'La fecha de arranque tiene que ser de los últimos 13 meses y no puede ser futura.',
  },
  cash_required: { code: 'invalid', message: 'Agregá al menos una caja de efectivo.' },
  sales_point_taken: { code: 'invalid', message: 'Ese punto de venta ya está cargado.' },

  // ─── Datos maestros ───────────────────────────────────────────────────────
  stale: {
    code: 'stale',
    message:
      'Otra persona cambió esto recién. Ya ves la versión nueva: revisala y guardá de nuevo.',
  },
  // Las RPC de la #8 validan forma y rangos de cada campo (detail = el campo).
  // Los schemas de zod copian esos rangos, así que si llega acá es que TS y
  // SQL se desfasaron: se loguea como bug, no es algo que la persona arregle.
  invalid_payload: {
    code: 'error',
    message:
      'Algún dato llegó con un formato inesperado. Recargá la página y probá de nuevo; si sigue, avisanos.',
    bug: true,
  },
  settings_locked_by_documents: {
    code: 'conflict',
    message:
      'Ya hay comprobantes cargados: este dato no se puede cambiar. Hablalo con la contadora.',
  },
  fiscal_year_locked: {
    code: 'conflict',
    message: 'Ya hay meses cerrados: el cierre de ejercicio no se puede cambiar desde acá.',
  },
  code_taken: { code: 'invalid', message: 'Ese código ya existe en el plan de cuentas.' },
  code_invalid: {
    code: 'invalid',
    message: 'El código tiene que empezar con el de la cuenta madre (por ejemplo, 5.3.02.12).',
  },
  code_parent_mismatch: {
    code: 'invalid',
    message: 'El código tiene que empezar con el de la cuenta madre (por ejemplo, 5.3.02.12).',
  },
  parent_is_postable: {
    code: 'invalid',
    message: 'Esa cuenta no puede tener subcuentas: elegí un grupo.',
  },
  system_account_locked: {
    code: 'conflict',
    message:
      'Esta cuenta la usa el sistema para armar asientos: podés renombrarla, pero no desactivarla.',
  },
  account_has_movements: {
    code: 'conflict',
    message:
      'La cuenta tiene movimientos: se puede renombrar o desactivar, no cambiar el código ni el tipo.',
  },
  account_has_balance: {
    code: 'conflict',
    message: 'La cuenta tiene saldo. Pasalo a otra cuenta con un asiento antes de desactivarla.',
  },
  account_in_use: {
    code: 'conflict',
    message:
      'La cuenta la usa una caja, un medio de cobro, un proveedor o un gasto fijo. Cambialos primero.',
  },
  account_move_with_children: {
    code: 'conflict',
    message: 'Una cuenta con subcuentas no se mueve.',
  },
  account_delete_forbidden: {
    code: 'conflict',
    message: 'Las cuentas no se borran: desactivala.',
  },
  invalid_control_account: {
    code: 'invalid',
    message: 'Elegí una cuenta de proveedores, clientes u organismos.',
  },
  duplicate_tax_id: {
    code: 'conflict',
    message: 'Ya hay un proveedor o cliente con ese CUIT: {nombre}.',
    fallback: 'Ya hay un proveedor o cliente con ese CUIT.',
  },
  system_party_locked: {
    code: 'conflict',
    message:
      'Este partícipe lo usa el sistema: podés completar sus datos, no cambiar su tipo ni sus cuentas.',
  },
  party_in_use: {
    code: 'conflict',
    message: 'Lo usa un medio de cobro o un gasto fijo: cambialo primero.',
  },
  treasury_has_balance: {
    code: 'conflict',
    message: 'La caja tiene saldo: movelo a otra antes de desactivarla.',
  },
  treasury_in_use: { code: 'conflict', message: 'La usa un medio de cobro.' },
  treasury_name_taken: { code: 'conflict', message: 'Ya hay una caja con ese nombre.' },
  treasury_account_invalid: {
    code: 'error',
    message: 'No pudimos armar la cuenta de la caja.',
    bug: true,
  },
  treasury_not_found: { code: 'conflict', message: 'Esa caja ya no está. Recargá la página.' },
  treasury_inactive: {
    code: 'invalid',
    message: 'Esa caja está desactivada. Reactivala o elegí otra.',
  },
  invalid_method_targets: {
    code: 'invalid',
    message: 'Revisá adónde va este medio de cobro.',
  },
  invalid_method_party: { code: 'invalid', message: 'Revisá adónde va este medio de cobro.' },
  sales_method_name_taken: {
    code: 'conflict',
    message: 'Ya hay un medio de cobro con ese nombre.',
  },
  sales_method_not_found: {
    code: 'conflict',
    message: 'Ese medio de cobro ya no está. Recargá la página.',
  },
  sales_point_not_found: {
    code: 'conflict',
    message: 'Ese punto de venta ya no está. Recargá la página.',
  },
  invalid_imputation_account: {
    code: 'invalid',
    message: 'Esa cuenta no sirve para imputar un gasto.',
  },
  recurring_name_taken: { code: 'invalid', message: 'Ya hay un gasto fijo con ese nombre.' },
  recurring_not_found: {
    code: 'conflict',
    message: 'Ese gasto fijo ya no está. Recargá la página.',
  },

  // ─── Apertura ─────────────────────────────────────────────────────────────
  opening_locked: {
    code: 'conflict',
    message:
      'El primer mes ya está cerrado: los saldos iniciales se corrigen con un asiento de ajuste.',
  },
  opening_exists: {
    code: 'conflict',
    message:
      'La apertura ya está cargada. Para cambiarla, anulala primero (con el primer mes abierto).',
  },
  opening_pending: {
    code: 'conflict',
    message:
      'Antes de cerrar el primer mes, cargá los saldos iniciales o elegí «Arrancar en cero».',
  },

  // ─── Estructura del bundle (errores de programación) ─────────────────────
  invalid_bundle: { code: 'error', message: BUG_MESSAGE, bug: true },
  kind_not_allowed: { code: 'error', message: BUG_MESSAGE, bug: true },
  invalid_line_role: { code: 'error', message: BUG_MESSAGE, bug: true },
  line_account_invalid: { code: 'error', message: BUG_MESSAGE, bug: true },
  fiscal_mismatch: { code: 'error', message: BUG_MESSAGE, bug: true },
  vat_computed_mismatch: { code: 'error', message: BUG_MESSAGE, bug: true },
  treasury_mismatch: { code: 'error', message: BUG_MESSAGE, bug: true },
  sales_method_mismatch: { code: 'error', message: BUG_MESSAGE, bug: true },
  control_party_mismatch: { code: 'error', message: BUG_MESSAGE, bug: true },
  document_without_entry: { code: 'error', message: BUG_MESSAGE, bug: true },
  document_entry_mismatch: { code: 'error', message: BUG_MESSAGE, bug: true },
  acc_immutable: { code: 'error', message: BUG_MESSAGE, bug: true },
  idempotency_conflict: {
    code: 'conflict',
    message: 'Ese pedido ya se usó para otra cosa. Recargá la página.',
  },
  /** 23505 sobre `abd_client_ref_uq`: dos envíos iguales a la vez; el segundo ve lo guardado. */
  request_replayed: {
    code: 'conflict',
    message: 'Esto ya se guardó (se mandó dos veces). Recargá la página para verlo.',
  },
  preview_stale: {
    code: 'preview_stale',
    message:
      'Algo cambió mientras cargabas (por ejemplo, otro dueño pagó esa factura). Revisá el asiento nuevo y guardá otra vez.',
  },
  /** La RPC rechazó por avisos sin aceptar (C.0): vienen todos juntos en `detail.warnings`. */
  warning_requires_ack: { code: 'needs_confirmation', message: 'Revisá antes de guardar.' },

  // ─── Comprobantes: partícipe, fechas, tipo, IVA, totales ─────────────────
  party_required: { code: 'invalid', message: 'Elegí el proveedor o cliente.' },
  party_not_found: {
    code: 'invalid',
    message: 'Ese proveedor o cliente no está disponible. Elegí otro.',
  },
  party_inactive: {
    code: 'invalid',
    message: 'Ese proveedor o cliente no está disponible. Elegí otro.',
  },
  party_kind_mismatch: {
    code: 'invalid',
    message: '{Nombre} no figura como {rol}.',
    fallback: 'Ese proveedor o cliente no corresponde a este tipo de comprobante.',
  },
  party_tax_id_required: {
    code: 'invalid',
    message: 'Para que entre al Libro IVA, completá el CUIT de {nombre}.',
    fallback: 'Para que entre al Libro IVA, completá el CUIT del proveedor o cliente.',
  },
  date_before_start: {
    code: 'invalid',
    message: 'Administración arranca el {fecha}: lo de antes va en los saldos iniciales.',
    fallback:
      'La fecha es anterior al arranque de Administración: lo de antes va en los saldos iniciales.',
  },
  date_in_future: { code: 'invalid', message: 'La fecha no puede ser futura.' },
  accounting_before_issue: {
    code: 'invalid',
    message: 'La fecha contable no puede ser anterior a la fecha del comprobante.',
  },
  due_before_issue: {
    code: 'invalid',
    message: 'El vencimiento no puede ser anterior a la fecha del comprobante.',
  },
  period_closed: {
    code: 'conflict',
    message:
      '{Mes} está cerrado. Cargalo con fecha de un mes abierto o corregilo con una nota de crédito o un ajuste.',
    fallback:
      'Ese mes está cerrado. Cargalo con fecha de un mes abierto o corregilo con una nota de crédito o un ajuste.',
  },
  period_not_found: { code: 'invalid', message: 'Esa fecha no está dentro de un ejercicio.' },
  period_kind_mismatch: {
    code: 'error',
    message: 'No pudimos ubicar el asiento en su período.',
    bug: true,
  },
  entry_date_outside_period: {
    code: 'error',
    message: 'No pudimos ubicar el asiento en su período.',
    bug: true,
  },
  fy_adjustment_date: {
    code: 'invalid',
    message: 'Los ajustes de cierre van con fecha del último día del ejercicio ({fecha}).',
    fallback: 'Los ajustes de cierre van con fecha del último día del ejercicio.',
  },
  invalid_voucher_for_kind: {
    code: 'invalid',
    message: 'Ese tipo de comprobante no corresponde acá.',
  },
  invalid_voucher_for_condition: {
    code: 'invalid',
    message: 'Un {condicion} no emite {tipo}. Revisá el tipo o la condición del proveedor.',
    fallback:
      'Ese tipo de comprobante no corresponde a la condición frente al IVA del proveedor. Revisá el tipo o la condición.',
  },
  vat_out_of_tolerance: {
    code: 'invalid',
    message: 'El IVA está muy lejos del {alicuota} del neto. Revisá los importes.',
    fallback: 'El IVA está muy lejos de la alícuota del neto. Revisá los importes.',
  },
  vat_not_allowed_for_voucher: {
    code: 'invalid',
    message: 'Las facturas B y C no discriminan IVA: cargá solo el total.',
  },
  ddjj_requires_tax_agency: {
    code: 'invalid',
    message: 'Una DDJJ se carga a nombre de un organismo (ARCA, Rentas, Municipalidad).',
  },
  total_mismatch: {
    code: 'invalid',
    message: 'Los importes suman {calculado} y el comprobante dice {control}.',
    fallback: 'Los importes no suman el total del comprobante.',
  },
  amount_required: { code: 'invalid', message: 'Cargá al menos un importe.' },
  amount_too_large: { code: 'invalid', message: 'Ese importe es demasiado grande. Revisalo.' },
  duplicate_document: {
    code: 'conflict',
    message: 'Esa factura ya está cargada ({tipo} {numero}, el {fecha}).',
    fallback: 'Esa factura ya está cargada.',
  },
  duplicate_sales_range: {
    code: 'conflict',
    message: 'Las facturas {rango} ya están en el cierre del {fecha}.',
    fallback: 'Esas facturas ya están en otro cierre del día.',
  },
  daily_close_exists: {
    code: 'conflict',
    message: 'Ya hay un cierre del {fecha}. Abrilo para corregirlo.',
    fallback: 'Ya hay un cierre de ese día. Abrilo para corregirlo.',
  },
  range_required: {
    code: 'invalid',
    message: 'Completá el punto de venta y los números desde y hasta.',
  },
  voucher_number_required: {
    code: 'invalid',
    message: 'Cargá el punto de venta y el número del comprobante.',
  },
  range_invalid: { code: 'invalid', message: 'El «hasta» no puede ser menor que el «desde».' },
  invoiced_exceeds_sold: {
    code: 'invalid',
    message:
      'En {canal} facturaste más de lo que vendiste. Si es una factura de otro día, confirmalo y contá por qué.',
    fallback:
      'En un canal facturaste más de lo que vendiste. Si es una factura de otro día, confirmalo y contá por qué.',
  },
  cash_count_invalid: { code: 'invalid', message: 'El efectivo contado no puede ser negativo.' },
  entry_not_balanced: {
    code: 'invalid',
    message: 'El asiento no cuadra: falta {diferencia} en el {lado}.',
    fallback: 'El asiento no cuadra: el Debe y el Haber tienen que sumar lo mismo.',
  },
  entry_too_few_lines: { code: 'invalid', message: 'Un asiento necesita al menos dos líneas.' },
  account_requires_party: {
    code: 'invalid',
    message: 'La cuenta {cuenta} necesita un proveedor, cliente u organismo.',
    fallback: 'Esa cuenta necesita un proveedor, cliente u organismo.',
  },
  party_not_allowed: { code: 'invalid', message: 'Esa cuenta no lleva proveedor ni cliente.' },
  account_not_found: { code: 'invalid', message: 'Esa cuenta no existe en este bar.' },
  account_not_postable: {
    code: 'invalid',
    message: '{Cuenta} es un grupo: elegí una cuenta de adentro.',
    fallback: 'Esa cuenta es un grupo: elegí una cuenta de adentro.',
  },
  account_inactive: {
    code: 'invalid',
    message: '{Cuenta} está desactivada.',
    fallback: 'Esa cuenta está desactivada.',
  },

  // ─── Partidas, pagos y cobros ─────────────────────────────────────────────
  item_not_found: {
    code: 'conflict',
    message: 'Ese comprobante ya no está pendiente. Recargá la página.',
  },
  item_voided: {
    code: 'conflict',
    message: 'Ese comprobante ya no está pendiente. Recargá la página.',
  },
  allocation_exceeds_open: {
    code: 'conflict',
    message: 'Estás aplicando más de lo que queda pendiente de {comprobante} ({monto}).',
    fallback: 'Estás aplicando más de lo que queda pendiente de ese comprobante.',
  },
  allocation_party_mismatch: {
    code: 'invalid',
    message: 'Ese pago y ese comprobante no son del mismo proveedor o cliente.',
  },
  allocation_side_mismatch: {
    code: 'invalid',
    message: 'Ese pago y ese comprobante no se pueden aplicar entre sí.',
  },
  allocation_date_invalid: {
    code: 'invalid',
    message: 'No se puede aplicar con una fecha anterior al comprobante.',
  },
  mixed_control_accounts: {
    code: 'invalid',
    message:
      'Aplicá comprobantes de una sola cuenta por vez (por ejemplo, no mezcles IVA con IIBB).',
  },
  credit_without_application: {
    code: 'invalid',
    message: 'Para usar un saldo a favor, elegí qué comprobante cancela.',
  },
  compensation_not_allowed: {
    code: 'invalid',
    message: 'Los saldos a favor de impuestos solo se usan para pagar impuestos.',
  },
  compensation_exceeds_balance: {
    code: 'invalid',
    message: 'Hay {saldo} disponibles en {cuenta}: no podés usar más.',
    fallback: 'No podés usar más saldo a favor del que hay disponible en esa cuenta.',
  },
  same_treasury: { code: 'invalid', message: 'Elegí dos cuentas distintas.' },
  stale_balance: {
    code: 'stale',
    message: 'El saldo cambió mientras ajustabas. Revisá el número de nuevo.',
  },
  balance_check_mismatch: {
    code: 'invalid',
    message: 'Lo que entró no coincide con el saldo que escribiste.',
  },
  difference_requires_adjustment: {
    code: 'invalid',
    message: 'Hay diferencia: registrala con «Ajustar saldo».',
  },
  adjustment_account_invalid: {
    code: 'invalid',
    message: 'Esa cuenta no sirve para explicar una diferencia de {caja}.',
    fallback: 'Esa cuenta no sirve para explicar una diferencia de esta caja.',
  },
  fiscal_voucher_missing: {
    code: 'error',
    message: 'No pudimos armar el comprobante fiscal.',
    bug: true,
  },
  fiscal_voucher_not_allowed: {
    code: 'error',
    message: 'No pudimos armar el comprobante fiscal.',
    bug: true,
  },

  // ─── Correcciones ─────────────────────────────────────────────────────────
  document_not_found: {
    code: 'conflict',
    message: 'Ese comprobante no existe o ya está anulado. Recargá la página.',
  },
  document_voided: {
    code: 'conflict',
    message: 'Ese comprobante no existe o ya está anulado. Recargá la página.',
  },
  kind_not_voidable: {
    code: 'conflict',
    message: 'Esto se deshace reabriendo el mes, no anulando.',
  },
  cannot_void_closed_period: {
    code: 'conflict',
    message:
      '{Mes} está cerrado. Usá «Anular con fecha de hoy», una nota de crédito o un asiento de ajuste.',
    fallback:
      'Ese mes está cerrado. Usá «Anular con fecha de hoy», una nota de crédito o un asiento de ajuste.',
  },
  use_void_in_open_period: {
    code: 'conflict',
    message: 'El mes está abierto: anulalo directamente.',
  },
  kind_not_reversible: {
    code: 'conflict',
    message: 'Esto no se anula así: corregilo con un asiento de ajuste.',
  },
  already_reversed: { code: 'conflict', message: 'Ya está anulado.' },
  reversal_date_invalid: {
    code: 'conflict',
    message: 'La fecha tiene que ser de un mes abierto y posterior al comprobante.',
  },
  document_has_allocations: {
    code: 'conflict',
    message:
      'Tiene pagos o cobros aplicados ({lista}). Si lo anulás, esos pagos quedan a cuenta. ¿Seguimos?',
    fallback:
      'Tiene pagos o cobros aplicados. Si lo anulás, esos pagos quedan a cuenta. ¿Seguimos?',
  },
  allocations_exceed_new_total: {
    code: 'conflict',
    message: 'Tiene {monto} pagados: el total nuevo no puede ser menor.',
    fallback: 'Tiene pagos aplicados: el total nuevo no puede ser menor que lo pagado.',
  },
  party_change_with_allocations: {
    code: 'conflict',
    message: 'No se puede cambiar el proveedor de un comprobante con pagos aplicados.',
  },
  allocation_not_found: { code: 'conflict', message: 'Esa imputación ya no está.' },
  allocation_voided: { code: 'conflict', message: 'Esa imputación ya no está.' },
  allocation_protected: {
    code: 'conflict',
    message: 'Esa imputación es de una anulación y no se puede deshacer.',
  },
  undo_expired: {
    code: 'conflict',
    message: 'Ya pasó el tiempo para deshacer. Si querés, anulalo desde el comprobante.',
  },
  reason_required: {
    code: 'invalid',
    message: 'Contá brevemente el motivo (al menos 5 letras).',
  },

  // ─── Períodos y ejercicio ─────────────────────────────────────────────────
  period_already_closed: {
    code: 'conflict',
    message: '{Mes} ya está cerrado.',
    fallback: 'Ese mes ya está cerrado.',
  },
  period_not_closed: {
    code: 'conflict',
    message: '{Mes} está abierto.',
    fallback: 'Ese mes está abierto.',
  },
  month_not_finished: {
    code: 'conflict',
    message: '{Mes} todavía no terminó.',
    fallback: 'El mes todavía no terminó.',
  },
  close_out_of_order: {
    code: 'conflict',
    message: 'Primero cerrá {mesAnterior}.',
    fallback: 'Primero cerrá el mes anterior.',
  },
  close_warnings: { code: 'needs_confirmation', message: 'Antes de cerrar, revisá estos avisos.' },
  reopen_not_last: {
    code: 'conflict',
    message: 'Solo se puede reabrir el último mes cerrado ({mes}).',
    fallback: 'Solo se puede reabrir el último mes cerrado.',
  },
  iva_settlement_paid: {
    code: 'conflict',
    message: 'El IVA de {mes} ya tiene un pago a ARCA. Anulá ese pago antes de reabrir.',
    fallback: 'El IVA de ese mes ya tiene un pago a ARCA. Anulá ese pago antes de reabrir.',
  },
  iva_settlement_exists: {
    code: 'conflict',
    message: 'La liquidación de IVA de {mes} ya está registrada.',
    fallback: 'La liquidación de IVA de ese mes ya está registrada.',
  },
  fiscal_year_closed: {
    code: 'conflict',
    message: 'El ejercicio de {mes} ya está cerrado.',
    fallback: 'Ese ejercicio ya está cerrado.',
  },
  periods_open: {
    code: 'conflict',
    message: 'Para cerrar el ejercicio, primero cerrá todos sus meses.',
  },
  next_fiscal_year_closed: {
    code: 'conflict',
    message: 'El ejercicio siguiente ya está cerrado: no se puede reabrir este.',
  },

  // ─── Reportes y exportes ──────────────────────────────────────────────────
  sas_cuit_required: {
    code: 'conflict',
    message: 'Para exportar los libros de IVA falta el CUIT de la SAS (Ajustes › Datos de la SAS).',
  },
  export_too_large: {
    code: 'invalid',
    message: 'Es demasiado para un solo archivo. Elegí un período más corto.',
  },
  range_crosses_fiscal_year: {
    code: 'invalid',
    message: 'El rango cruza dos ejercicios: elegí fechas de un solo ejercicio.',
  },
  export_failed: {
    code: 'error',
    message: 'No pudimos armar el archivo. Probá de nuevo en unos minutos.',
  },
  reset_after_close: {
    code: 'conflict',
    message:
      'No se puede reiniciar Administración: ya hay meses cerrados. Se corrige con comprobantes y ajustes.',
  },
  // Solo la levanta `private.acc_reset_tenant` (la corre soporte por el MCP,
  // nunca la app); igual lleva copy para que la paridad con la SQL cierre.
  reset_confirm_mismatch: {
    code: 'invalid',
    message: 'El texto de confirmación no coincide: no se borró nada.',
  },

  // ─── Por SQLSTATE (sin clave propia en la RPC) ────────────────────────────
  in_use: {
    code: 'conflict',
    message: 'Está en uso en comprobantes o datos de Administración: no se puede borrar.',
  },
  not_found: { code: 'conflict', message: 'Eso ya no existe. Recargá la página.' },
  duplicate: { code: 'conflict', message: 'Eso ya está cargado. Recargá la página.' },
  check_violation: {
    code: 'error',
    message: 'Algún dato no pasó los controles de la base. Revisá el formulario y probá de nuevo.',
    bug: true,
  },
  timeout: {
    code: 'error',
    message: 'Tardó demasiado. Probá de nuevo en un rato o con un período más corto.',
  },
  retry: {
    code: 'error',
    message: 'Hubo un cruce con otra carga al mismo tiempo. Probá de nuevo.',
  },
  function_unavailable: {
    code: 'error',
    message: 'Esta función todavía no está disponible. Actualizá la página en unos minutos.',
  },
  offline: {
    code: 'error',
    message: 'Sin conexión: no se guardó. Quedó cargado para reintentar.',
  },
} as const satisfies Record<string, AccErrorDef>

export type AccErrorKey = keyof typeof ACC_ERRORS

export const ACC_ERROR_KEYS = Object.keys(ACC_ERRORS) as AccErrorKey[]

export function isAccErrorKey(value: unknown): value is AccErrorKey {
  return typeof value === 'string' && Object.hasOwn(ACC_ERRORS, value)
}

// ─── Huecos `{x}` ────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g

/** Los huecos que tiene un texto (`'{Mes} está…'` → `['Mes']`). */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? '')
}

/**
 * Completa los `{x}` con `vars`. Si alguno queda sin dato devuelve `null`
 * (el que llama usa el fallback): nunca se muestra un hueco.
 */
export function fillTemplate(
  template: string,
  vars: Readonly<Record<string, string>>,
): string | null {
  let missing = false
  const text = template.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = vars[name]
    if (value === undefined || value.trim() === '') {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : text
}

/** El mensaje de una clave con sus datos, o el fallback si falta alguno. */
export function accErrorMessage(
  key: AccErrorKey,
  vars: Readonly<Record<string, string>> = {},
): string {
  const def: AccErrorDef = ACC_ERRORS[key]
  if (def.bug) return def.message
  return fillTemplate(def.message, vars) ?? def.fallback ?? def.message
}

// ─── Del `detail` crudo a los datos del mensaje ──────────────────────────────

const CONDITION_NOUN: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'responsable inscripto',
  monotributo: 'monotributista',
  exento: 'exento',
  consumidor_final: 'consumidor final',
  no_alcanzado: 'no alcanzado',
  sin_datos: 'proveedor sin condición cargada',
}

const CHANNEL_NOUN: Readonly<Record<string, string>> = {
  salon: 'salón',
  delivery: 'delivery',
  events: 'eventos',
}

function str(detail: MessageDetail, key: string): string | null {
  const v = detail[key]
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function num(detail: MessageDetail, key: string): number | null {
  const v = detail[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

function money(cents: number | null): string | null {
  return cents === null ? null : formatCents(cents)
}

/** `'2026-09-01'` o `'2026-09'` → número de mes (1–12), o `null`. */
function monthNumber(value: string | null): number | null {
  if (!value) return null
  const m = /^\d{4}-(\d{2})(?:-\d{2})?$/.exec(value)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 12 ? n : null
}

function monthNoun(value: string | null): string | null {
  const n = monthNumber(value)
  return n === null ? null : (MONTH_NAMES[n - 1] ?? null)
}

function capitalize(text: string | null): string | null {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null
}

function day(value: string | null): string | null {
  if (!value) return null
  const text = formatIsoDay(value.slice(0, 10))
  return text === '' ? null : text
}

/**
 * Traduce el `detail` de una RPC o del motor a los `{x}` de los mensajes.
 * Claves que se reconocen (las RPC `acc_*` las usan con estos nombres):
 * `month`, `previous_month`, `date`, `books_start_date`, `end_date`,
 * `accounting_date`, `channel`, `computed_cents`, `control_cents`,
 * `debit_cents` + `credit_cents` (o `diff_cents` + `missing_side`),
 * `open_cents`, `amount_cents`, `balance_cents`/`available_cents`,
 * `balance_after_cents`, `party_name`/`name`, `party_role`, `account_code` +
 * `account_name`, `document_label`/`label`, `rate_bp`, `condition`,
 * `voucher_type`, `point_of_sale` + `number`, `number_from` + `number_to`,
 * `treasury_name`, `allocations` (texto ya armado), `invoiced_cents`,
 * `sold_cents`, `median_cents`, `issue_date`.
 */
export function detailVars(detail: MessageDetail | null | undefined): Record<string, string> {
  if (!detail) return {}
  const vars: Record<string, string> = {}
  const put = (name: string, value: string | null) => {
    if (value !== null && value !== '') vars[name] = value
  }

  const month = monthNoun(str(detail, 'month'))
  put('mes', month)
  put('Mes', capitalize(month))
  put('mesAnterior', monthNoun(str(detail, 'previous_month')))
  put('mesContable', monthNoun(str(detail, 'accounting_month') ?? str(detail, 'accounting_date')))

  put(
    'fecha',
    day(
      str(detail, 'date') ??
        str(detail, 'books_start_date') ??
        str(detail, 'end_date') ??
        str(detail, 'issue_date') ??
        str(detail, 'accounting_date'),
    ),
  )

  const channel = str(detail, 'channel')
  put('canal', channel ? (CHANNEL_NOUN[channel] ?? null) : null)

  put('calculado', money(num(detail, 'computed_cents')))
  put('control', money(num(detail, 'control_cents')))
  put('facturado', money(num(detail, 'invoiced_cents')))
  put('vendido', money(num(detail, 'sold_cents')))
  put('mediana', money(num(detail, 'median_cents')))

  // Cuadre: «falta {diferencia} en el {lado}». Si sobra Debe, falta Haber.
  const debit = num(detail, 'debit_cents')
  const credit = num(detail, 'credit_cents')
  if (debit !== null && credit !== null && debit !== credit) {
    put('diferencia', money(Math.abs(debit - credit)))
    put('lado', debit > credit ? 'Haber' : 'Debe')
  } else {
    put('diferencia', money(num(detail, 'diff_cents')))
    const missing = str(detail, 'missing_side')
    put('lado', missing === 'debit' ? 'Debe' : missing === 'credit' ? 'Haber' : null)
  }
  put('dif', vars.diferencia ?? null)

  const amount = num(detail, 'open_cents') ?? num(detail, 'amount_cents')
  put('monto', money(amount))
  put('importe', money(num(detail, 'amount_cents') ?? num(detail, 'open_cents')))
  const balance = num(detail, 'available_cents') ?? num(detail, 'balance_cents')
  put('saldo', money(balance))
  const after = num(detail, 'balance_after_cents')
  if (after !== null) put('saldo', money(Math.abs(after)))

  const name = str(detail, 'party_name') ?? str(detail, 'name')
  put('nombre', name)
  put('Nombre', capitalize(name))
  put('proveedor', str(detail, 'party_name') ?? str(detail, 'account_name'))
  const role = str(detail, 'party_role')
  put('rol', role === 'customer' ? 'cliente' : role === 'supplier' ? 'proveedor' : role)

  const code = str(detail, 'account_code')
  const accountName = str(detail, 'account_name')
  const account = code && accountName ? `${code} ${accountName}` : (accountName ?? code)
  put('cuenta', account)
  put('Cuenta', capitalize(account))

  put('comprobante', str(detail, 'document_label') ?? str(detail, 'label'))
  put('caja', str(detail, 'treasury_name'))
  put('lista', str(detail, 'allocations'))

  const rate = num(detail, 'rate_bp')
  put('alicuota', rate !== null && isVatRateBp(rate) ? vatRateLabel(rate) : null)

  const condition = str(detail, 'condition')
  put(
    'condicion',
    condition && Object.hasOwn(CONDITION_NOUN, condition)
      ? CONDITION_NOUN[condition as IvaCondition]
      : null,
  )

  const voucherType = str(detail, 'voucher_type')
  put('tipo', voucherType ? voucherLabel(voucherType) : null)

  const pos = num(detail, 'point_of_sale')
  const number = num(detail, 'number')
  if (pos !== null && number !== null && number >= 1)
    put('numero', formatVoucherNumber(pos, number))
  const from = num(detail, 'number_from')
  const to = num(detail, 'number_to')
  if (pos !== null && from !== null && to !== null && from >= 1 && to >= from) {
    put('rango', formatVoucherRange(pos, from, to))
  }

  return vars
}

// ─── Errores de supabase-js / PostgREST ──────────────────────────────────────

/** La forma de `PostgrestError` (y de cualquier error con mensaje). */
export type PgLikeError = {
  message?: string | null
  code?: string | null
  details?: string | null
  hint?: string | null
}

export type MapAccErrorOptions = {
  /** Datos del formulario para los `{x}` (ganan sobre lo que traiga el `detail`). */
  vars?: Readonly<Record<string, string>>
  /** 23503 en un borrado/desactivación es «en uso»; en una alta, «no existe». Default `write`. */
  operation?: 'write' | 'delete'
}

/** Constraint único → clave (23505). */
const UNIQUE_CONSTRAINT_KEYS: ReadonlyArray<readonly [string, AccErrorKey]> = [
  ['adoc_purchase_dup_uq', 'duplicate_document'],
  ['adoc_sales_dup_uq', 'duplicate_document'],
  ['adoc_close_day_uq', 'daily_close_exists'],
  ['adoc_one_opening_uq', 'opening_exists'],
  ['adoc_one_reversal_uq', 'already_reversed'],
  ['adoc_one_replacement_uq', 'document_voided'],
  ['abd_client_ref_uq', 'request_replayed'],
  ['aac_code_uq', 'code_taken'],
  ['apt_tax_id_uq', 'duplicate_tax_id'],
  ['atr_name_uq', 'treasury_name_taken'],
  ['asm_name_uq', 'sales_method_name_taken'],
  ['asp_number_uq', 'sales_point_taken'],
  ['arx_name_uq', 'recurring_name_taken'],
]

const NETWORK_RE =
  /fetch failed|failed to fetch|networkerror|network request failed|load failed|econnreset|etimedout|enotfound/i

/** `detail` de PostgREST (`error.details`): JSON de la RPC (`raise … using detail = '<json>'`). */
function parseDetails(details: string | null | undefined): Record<string, unknown> | null {
  if (!details) return null
  try {
    const parsed: unknown = JSON.parse(details)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Solo los valores escalares del detail: el resto (listas, objetos) no va a un texto. */
function scalarDetail(raw: Record<string, unknown> | null): MessageDetail {
  const out: Record<string, string | number | boolean | null> = {}
  if (!raw) return out
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    }
  }
  return out
}

function warningsFromDetails(raw: Record<string, unknown> | null): PostingWarning[] {
  const list = raw?.warnings
  if (!Array.isArray(list)) return []
  const out: PostingWarning[] = []
  for (const item of list) {
    if (typeof item === 'string' && isWarningKey(item)) out.push({ key: item })
    else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      const key = record.key ?? record.warning
      if (isWarningKey(key)) out.push({ key, detail: scalarDetail(record) })
    }
  }
  return out
}

/**
 * Claves que arma `mapAccError` desde el SQLSTATE: no las levanta ninguna RPC,
 * así que no se buscan en el texto (el mensaje de un 23505 dice «duplicate key»
 * y no tiene que leerse como la clave `duplicate`).
 */
const DERIVED_KEYS: ReadonlySet<AccErrorKey> = new Set([
  'request_replayed',
  'in_use',
  'not_found',
  'duplicate',
  'check_violation',
  'timeout',
  'retry',
  'function_unavailable',
  'offline',
])

/** SQLSTATE con que las RPC levantan sus claves (C.0); sin código, también se busca. */
const KEYED_SQLSTATES: ReadonlySet<string> = new Set(['', 'P0001', '42501'])

/** La primera clave del catálogo que aparece como palabra entera en el mensaje. */
function keyInMessage(message: string): AccErrorKey | null {
  for (const token of message.match(/[a-z][a-z0-9_]*/g) ?? []) {
    if (isAccErrorKey(token) && !DERIVED_KEYS.has(token)) return token
  }
  return null
}

function failure(
  key: AccErrorKey,
  vars: Readonly<Record<string, string>>,
  extra: { detail?: MessageDetail; warnings?: PostingWarning[] } = {},
): AccFailureState {
  const def: AccErrorDef = ACC_ERRORS[key]
  const state: AccFailureState = {
    ok: false,
    code: def.code,
    message: accErrorMessage(key, vars),
    detail: { key, ...(def.bug ? { bug: true } : {}), ...(extra.detail ?? {}) },
  }
  if (extra.warnings && extra.warnings.length > 0) state.warnings = extra.warnings.map(warningCopy)
  return state
}

/**
 * Error de una RPC `acc_*` (o de un `select`) → estado de la acción, con el
 * mensaje listo para mostrar. Nunca muestra el `message` crudo de Postgres.
 */
export function mapAccError(
  error: PgLikeError | null | undefined,
  opts: MapAccErrorOptions = {},
): AccFailureState {
  const message = error?.message ?? ''
  const sqlState = error?.code ?? ''
  const rawDetail = parseDetails(error?.details)
  const detail = scalarDetail(rawDetail)
  const vars = { ...detailVars(detail), ...(opts.vars ?? {}) }

  if (!error) return { ok: false, code: 'error', message: ACC_GENERIC_ERROR }

  if (sqlState === 'PGRST202' || sqlState === '42883') return failure('function_unavailable', vars)
  if (!sqlState && NETWORK_RE.test(message)) return failure('offline', vars)

  const key = KEYED_SQLSTATES.has(sqlState) ? keyInMessage(message) : null
  if (key === 'warning_requires_ack') {
    return failure(key, vars, { detail, warnings: warningsFromDetails(rawDetail) })
  }
  if (key) return failure(key, vars, { detail })

  if (sqlState === '42501') return failure('forbidden', vars)
  if (sqlState === '23505') {
    const haystack = `${message} ${error.details ?? ''}`
    const match = UNIQUE_CONSTRAINT_KEYS.find(([constraint]) => haystack.includes(constraint))
    return failure(match ? match[1] : 'duplicate', vars, { detail })
  }
  if (sqlState === '23503')
    return failure(opts.operation === 'delete' ? 'in_use' : 'not_found', vars)
  if (sqlState === '23514') return failure('check_violation', vars)
  if (sqlState === '57014') return failure('timeout', vars)
  if (sqlState === '40001' || sqlState === '40P01') return failure('retry', vars)

  return { ok: false, code: 'error', message: ACC_GENERIC_ERROR }
}

/**
 * Errores del motor (`PostingResult` con `ok: false`) → estado de la acción:
 * el primer error por campo en `fieldErrors` y el primero de todos como
 * mensaje general.
 */
export function engineErrorsState(
  errors: readonly PostingError[],
  vars: Readonly<Record<string, string>> = {},
): AccFailureState {
  const first = errors[0]
  if (!first) return { ok: false, code: 'error', message: ACC_GENERIC_ERROR }
  const fieldErrors: Record<string, string> = {}
  for (const e of errors) {
    if (e.field && !(e.field in fieldErrors)) {
      fieldErrors[e.field] = accErrorMessage(e.key, { ...detailVars(e.detail), ...vars })
    }
  }
  const def: AccErrorDef = ACC_ERRORS[first.key]
  return {
    ok: false,
    code: def.code === 'needs_confirmation' ? 'invalid' : def.code,
    message: accErrorMessage(first.key, { ...detailVars(first.detail), ...vars }),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    detail: { key: first.key, ...(def.bug ? { bug: true } : {}) },
  }
}

// ─── Avisos confirmables ─────────────────────────────────────────────────────

export type WarningCopy = {
  key: WarningKey
  message: string
  /** Botón que acepta el aviso y guarda igual. */
  confirmLabel: string
  /** Botón que vuelve al formulario; `null` si el aviso es solo informativo («Entendido»). */
  cancelLabel: string | null
}

type WarningDef = {
  message: string
  fallback: string
  confirmLabel: string
  cancelLabel: string | null
}

export const WARNING_COPY: Readonly<Record<WarningKey, WarningDef>> = {
  vat_diff: {
    message:
      'El IVA no coincide con el {alicuota} del neto (diferencia: {dif}). ¿Está así en la factura?',
    fallback: 'El IVA no coincide con la alícuota del neto. ¿Está así en la factura?',
    confirmLabel: 'Sí, está así',
    cancelLabel: 'Revisar',
  },
  voucher_condition: {
    message: 'Con {tipo} no computás el IVA: va todo al costo. Pedí factura A si podés.',
    fallback: 'Con este comprobante no computás el IVA: va todo al costo. Pedí factura A si podés.',
    confirmLabel: 'Guardar igual',
    cancelLabel: 'Cambiar',
  },
  voucher_m: {
    message: 'Factura M: puede corresponder retener IVA y Ganancias. Consultalo con la contadora.',
    fallback: 'Factura M: puede corresponder retener IVA y Ganancias. Consultalo con la contadora.',
    confirmLabel: 'Entendido',
    cancelLabel: null,
  },
  treasury_negative: {
    message: '{caja} quedaría en −{saldo}. ¿Falta cargar algún ingreso o el cierre del día?',
    fallback: 'La caja quedaría en negativo. ¿Falta cargar algún ingreso o el cierre del día?',
    confirmLabel: 'Guardar igual',
    cancelLabel: 'Revisar',
  },
  possible_duplicate: {
    message: 'Ya cargaste algo igual ({importe} · {proveedor} · {fecha}). ¿Es otro?',
    fallback: 'Ya cargaste algo igual hace poco. ¿Es otro?',
    confirmLabel: 'Sí, es otro',
    cancelLabel: 'No, cancelar',
  },
  late_registration: {
    message: 'La factura es del {fecha}. Va al Libro IVA de {mesContable}.',
    fallback: 'La factura tiene más de 60 días: va al Libro IVA del mes en que la cargás.',
    confirmLabel: 'Entendido',
    cancelLabel: null,
  },
  write_off: {
    message: 'Vas a dar por cancelados {importe} de diferencia.',
    fallback: 'Vas a dar por cancelada la diferencia.',
    confirmLabel: 'Sí',
    cancelLabel: 'Revisar',
  },
  invoiced_exceeds_sold: {
    message:
      'En {canal} facturaste {facturado} y vendiste {vendido}. ¿Es una factura de otro día? (Contá por qué)',
    fallback:
      'En un canal facturaste más de lo que vendiste. ¿Es una factura de otro día? (Contá por qué)',
    confirmLabel: 'Confirmar',
    cancelLabel: 'Revisar',
  },
  amount_looks_off: {
    message: '¿Seguro? Con {proveedor} solés gastar alrededor de {mediana}.',
    fallback: '¿Seguro? Es muy distinto de lo que solés gastar.',
    confirmLabel: 'Sí, es así',
    cancelLabel: 'Revisar',
  },
}

export function isWarningKey(value: unknown): value is WarningKey {
  return typeof value === 'string' && Object.hasOwn(WARNING_COPY, value)
}

/**
 * Un aviso (del motor o de `warning_requires_ack`) con su texto y sus botones.
 * Un solo parámetro a propósito: la acción hace `pending.map(warningCopy)` (G.3).
 */
export function warningCopy(warning: PostingWarning): WarningCopy {
  return warningCopyWith(warning, {})
}

/** `warningCopy` con datos del formulario para los `{x}` (ganan sobre el `detail`). */
export function warningCopyWith(
  warning: PostingWarning,
  vars: Readonly<Record<string, string>>,
): WarningCopy {
  const def = WARNING_COPY[warning.key]
  const filled = fillTemplate(def.message, { ...detailVars(warning.detail), ...vars })
  return {
    key: warning.key,
    message: filled ?? def.fallback,
    confirmLabel: def.confirmLabel,
    cancelLabel: def.cancelLabel,
  }
}

/** Los avisos del cierre de mes (checklist, C.5.1 paso 4 y F.13). */
export const CLOSE_WARNING_COPY: Readonly<Record<CloseWarningKey, string>> = {
  missing_daily_closes: 'Faltan cierres del día en el mes.',
  receivables_overdue: 'Hay acreditaciones de tarjetas, billeteras o plataformas atrasadas.',
  treasury_negative: 'Hay cajas de efectivo en negativo al último día del mes.',
  treasuries_not_reconciled: 'Hay cajas o cuentas sin «Ajustar saldo» en el mes.',
  vat_pending_documentation:
    'Hay IVA de comisiones a documentar con más de 45 días: falta la factura.',
  recurring_not_loaded: 'Hay gastos fijos del mes sin cargar.',
  tickets_without_vendor: 'Hay tiques sin comercio: no entran al Libro IVA.',
  sas_cuit_missing: 'Falta el CUIT de la SAS (Ajustes › Datos de la SAS).',
}
