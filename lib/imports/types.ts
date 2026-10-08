/**
 * Tipos comunes de los importadores de Administración (diseño §4.0).
 *
 * Todo `lib/imports/*` (menos `server/**`) es puro: sin `server-only` ni módulos
 * de Node. Corre igual en el navegador (donde se parsean los archivos grandes),
 * en el servidor y en el cron.
 *
 * Las formas normalizadas (`McItem`, `MpItem`, `BankItem`) son lo que viaja a
 * `acc_import_items.data`. Por eso no llevan datos personales: ni nombres de
 * clientes, ni CUIT de quien paga, ni cuentas bancarias completas. El servidor
 * las vuelve a validar con los esquemas zod `.strict()` del final de este
 * archivo (`mcItemSchema`, `mpItemSchema`, `bankItemSchema`): una clave de más
 * se rechaza.
 *
 * Los avisos (`ImportIssue`) tampoco copian texto del archivo: llevan un código,
 * la fila y, como mucho, un campo canónico y un número. El texto en castellano
 * sale de `IMPORT_ISSUE_TEXT`.
 */

import { z } from 'zod'
import { formatCents } from '@/lib/money/format'
import { MONEY_MAX_CENTS } from '@/lib/money/parse'

// ─── Básicos ─────────────────────────────────────────────────────────────────

/** Día civil `yyyy-MM-dd` (sin hora ni zona). */
export type IsoDate = string

/** Centavos: entero seguro (`Number.isSafeInteger`). Con signo solo donde se aclara. */
export type Cents = number

/**
 * Una celda cruda. CSV y HTML dan siempre texto; un XLSX además da números,
 * booleanos y las fechas ya pasadas a `yyyy-MM-dd` (o `yyyy-MM-ddTHH:mm:ss` si
 * tienen hora). Vacía = `null` (en CSV, `''`).
 */
export type Cell = string | number | boolean | null

/** Separadores de CSV/TXT que reconocemos. */
export type Delimiter = ';' | ',' | '\t' | '|'

/** Codificaciones que reconoce `decodeText`. */
export type TextEncodingName = 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be'

/**
 * Descompresor «deflate crudo» inyectable (`DecompressionStream('deflate-raw')`, `zlib.inflateRawSync`…).
 * `maxSize` es el tope de la salida (contra bombas): `readZipEntry` pasa el tamaño que declara
 * el ZIP, y el descompresor tiene que cortar (tirar) apenas lo pase. Con `zlib`:
 * `(d, max) => zlib.inflateRawSync(d, { maxOutputLength: max })`.
 */
export type InflateRaw = (data: Uint8Array, maxSize?: number) => Promise<Uint8Array> | Uint8Array

/** Origen de un lote (`acc_import_batches.source`). */
export type ImportSource = 'arca_recibidos' | 'arca_emitidos' | 'mp_release' | 'bank_statement'

/** Familia de la clave natural (`acc_import_items.source_family`). El banco va por caja. */
export type SourceFamily = 'arca_recibidos' | 'arca_emitidos' | 'mp' | `bank:${string}`

/** Formulario que propone el importador (`acc_import_proposals.form`). */
export type ProposalForm =
  | 'purchase'
  | 'purchase_credit_note'
  | 'collection'
  | 'bank_expense'
  | 'transfer'
  | 'cash_movement'
  | 'payment'

/** Qué archivo parece ser (`detectSource`). */
export type DetectedSource =
  | 'arca_recibidos'
  | 'arca_emitidos'
  | 'portal_iva_compras'
  | 'mp_release'
  | 'mp_settlement'
  | 'bank'
  | 'unknown'

// ─── Avisos ──────────────────────────────────────────────────────────────────

/**
 * - `error`: la fila (o el archivo) no se puede usar así.
 * - `review`: se usa, pero alguien tiene que mirarla antes de cargar.
 * - `info`: solo para mostrar.
 */
export type IssueLevel = 'error' | 'review' | 'info'

export type ImportIssueCode =
  // Archivo
  | 'file_empty'
  | 'file_too_big'
  | 'file_xls_biff'
  | 'file_pdf'
  | 'file_zip_empty'
  | 'file_zip_many'
  | 'file_zip_encrypted'
  | 'file_zip_corrupt'
  | 'file_xlsx_corrupt'
  | 'file_not_table'
  | 'file_too_many_rows'
  | 'file_mojibake'
  | 'file_mojibake_repaired'
  // Mis Comprobantes / Portal IVA
  | 'mc_no_header'
  | 'mc_excel_resaved'
  | 'mc_other_cuit'
  | 'mc_column_count'
  | 'mc_bad_type'
  | 'mc_unknown_code'
  | 'mc_bad_date'
  | 'mc_bad_pos'
  | 'mc_bad_number'
  | 'mc_range'
  | 'mc_bad_amount'
  | 'mc_rounded_amount'
  | 'mc_negative_amount'
  | 'mc_bad_issuer'
  | 'mc_issuer_check_digit'
  | 'mc_receiver_mismatch'
  | 'mc_foreign_currency'
  | 'mc_unknown_currency'
  | 'mc_bad_fx'
  | 'mc_cae_damaged'
  | 'mc_total_gap'
  | 'mc_total_over'
  | 'mc_rounding'
  | 'mc_rate_unknown'
  | 'mc_net_sum'
  | 'mc_vat_sum'
  | 'mc_duplicate_key'
  // Mercado Pago
  | 'mp_no_header'
  | 'mp_settlement'
  | 'mp_bad_date'
  | 'mp_bad_amount'
  | 'mp_row_check'
  | 'mp_taxes_unreadable'
  | 'mp_taxes_mismatch'
  | 'mp_unknown_record_type'
  | 'mp_unknown_description'
  | 'mp_needs_review'
  | 'mp_channel_unknown'
  | 'mp_payout_unknown_account'
  | 'mp_currency'
  | 'mp_duplicate_row'
  | 'mp_balance_chain'
  | 'mp_total_mismatch'
  | 'mp_open_reserve'
  | 'mp_no_initial'
  | 'mp_no_total'
  // Banco
  | 'bank_needs_mapping'
  | 'bank_bad_date'
  | 'bank_bad_amount'
  | 'bank_both_sides'
  | 'bank_dc_unknown'
  | 'bank_direction_guess'
  | 'bank_balance_mismatch'
  | 'bank_pending_skipped'
  | 'bank_zero_amount'
  | 'bank_foreign_currency'

/**
 * Un aviso. `row` es la fila del archivo contando desde 1 (en un CSV, la línea;
 * en un Excel, el número de fila de la hoja); `null` si es de todo el archivo.
 * `field` es una clave canónica (`total`, `fecha`…), nunca un título del archivo.
 * `cents` lleva una diferencia o un importe cuando el mensaje lo necesita.
 */
export type ImportIssue = {
  readonly level: IssueLevel
  readonly code: ImportIssueCode
  readonly row: number | null
  readonly field?: string
  readonly cents?: Cents
}

/** Atajo para armar avisos sin claves `undefined` (así el objeto pasa por zod `.strict()`). */
export function issue(
  level: IssueLevel,
  code: ImportIssueCode,
  row: number | null,
  extra: { field?: string; cents?: Cents } = {},
): ImportIssue {
  const out: { -readonly [K in keyof ImportIssue]: ImportIssue[K] } = { level, code, row }
  if (extra.field !== undefined) out.field = extra.field
  if (extra.cents !== undefined) out.cents = extra.cents
  return out
}

export const IMPORT_ISSUE_TEXT: Readonly<Record<ImportIssueCode, string>> = {
  file_empty: 'El archivo está vacío.',
  file_too_big: 'El archivo pesa más de 20 MB. Bajá un período más corto.',
  file_xls_biff:
    'Es un Excel viejo (.xls). Abrilo y guardalo como CSV o como libro de Excel (.xlsx), y subilo de nuevo.',
  file_pdf: 'Es un PDF y todavía no leemos PDF. Subí la exportación en CSV, TXT o Excel.',
  file_zip_empty: 'El ZIP no tiene ningún archivo que podamos leer (CSV, TXT o Excel).',
  file_zip_many: 'El ZIP trae más de un archivo. Subí el ZIP tal cual lo bajaste o el CSV suelto.',
  file_zip_encrypted: 'El ZIP tiene contraseña. Subilo sin contraseña.',
  file_zip_corrupt: 'El ZIP está dañado o incompleto. Bajalo de nuevo.',
  file_xlsx_corrupt: 'El Excel está dañado o no tiene hojas. Bajalo de nuevo.',
  file_not_table: 'No pudimos leer el archivo como una tabla (CSV, TXT, Excel o HTML).',
  file_too_many_rows: 'El archivo tiene demasiadas filas. Bajá un período más corto.',
  file_mojibake:
    'Las tildes del archivo vienen rotas (por ejemplo «EmisiÃ³n»). Bajalo de nuevo y subilo sin abrirlo.',
  file_mojibake_repaired: 'Las tildes del archivo venían rotas y las arreglamos.',

  mc_no_header:
    'No encontramos la fila de títulos de ARCA (Fecha, Tipo, Punto de Venta… Imp. Total). ¿Es el archivo de Mis Comprobantes?',
  mc_excel_resaved:
    'Este CSV se abrió y se guardó con Excel (fechas con barras o el CAE en notación científica). Subí el ZIP tal cual lo bajaste de ARCA.',
  mc_other_cuit: 'Este archivo es de otra CUIT.',
  mc_column_count: 'La fila no tiene la misma cantidad de columnas que los títulos.',
  mc_bad_type: 'No se entiende el tipo de comprobante.',
  mc_unknown_code: 'El código de comprobante no está en la tabla de ARCA.',
  mc_bad_date: 'La fecha no se entiende.',
  mc_bad_pos: 'El punto de venta no se entiende.',
  mc_bad_number: 'El número de comprobante no se entiende.',
  mc_range: 'El comprobante abarca varios números (Desde y Hasta son distintos).',
  mc_bad_amount: 'Hay un importe que no se entiende.',
  mc_rounded_amount: 'Un importe venía con más de dos decimales y se redondeó al centavo.',
  mc_negative_amount:
    'Vino un importe negativo (ARCA los manda en positivo). Lo tomamos sin el signo.',
  mc_bad_issuer: 'Falta la CUIT del emisor o no se entiende.',
  mc_issuer_check_digit: 'La CUIT del emisor no pasa el dígito verificador.',
  mc_receiver_mismatch: 'El comprobante está a nombre de otra CUIT o de un DNI.',
  mc_foreign_currency:
    'Está en moneda extranjera: los importes se pasan a pesos con el tipo de cambio del comprobante.',
  mc_unknown_currency: 'No reconocemos la moneda del comprobante.',
  mc_bad_fx: 'El tipo de cambio no se entiende.',
  mc_cae_damaged: 'El código de autorización (CAE) vino dañado.',
  mc_total_gap:
    'El total supera la suma de sus partes: seguramente tiene percepciones que ARCA no detalla.',
  mc_total_over: 'La suma de las partes supera el total.',
  mc_rounding: 'ARCA redondeó: el total difiere de la suma de las partes en centavos.',
  mc_rate_unknown:
    'No se puede saber la alícuota de IVA (puede tener varias): hay que completarla.',
  mc_net_sum: 'El neto gravado total no coincide con la suma de los netos por alícuota.',
  mc_vat_sum: 'El IVA total no coincide con la suma del IVA por alícuota.',
  mc_duplicate_key: 'El comprobante aparece repetido en el archivo.',

  mp_no_header:
    'No encontramos los títulos del reporte de Liquidaciones (DATE, RECORD_TYPE, DESCRIPTION, NET_CREDIT_AMOUNT…). Configurá el reporte con encabezados en inglés.',
  mp_settlement: 'Es el reporte «Todas las transacciones». Acá va el de «Liquidaciones».',
  mp_bad_date: 'La fecha no se entiende.',
  mp_bad_amount: 'Hay un importe que no se entiende.',
  mp_row_check: 'El bruto menos la comisión y los impuestos no da el neto de la fila.',
  mp_taxes_unreadable: 'No se puede leer el detalle de impuestos de la fila.',
  mp_taxes_mismatch: 'El detalle de impuestos no suma el total de impuestos de la fila.',
  mp_unknown_record_type: 'Tipo de fila que no conocemos.',
  mp_unknown_description: 'Movimiento de Mercado Pago que todavía no conocemos.',
  mp_needs_review:
    'Movimiento para revisar (devolución, contracargo, propina, préstamo u otro que no es un cobro común).',
  mp_channel_unknown: 'Cobro sin canal claro (QR, Point, link o transferencia).',
  mp_payout_unknown_account:
    'Retiro sin la cuenta destino: no sabemos si fue a una cuenta propia o a un tercero.',
  mp_currency: 'El movimiento no está en pesos.',
  mp_duplicate_row: 'La fila aparece repetida en el reporte.',
  mp_balance_chain: 'El saldo de la fila no sigue al de la fila anterior.',
  mp_total_mismatch: 'El saldo inicial más los movimientos no da el saldo final del reporte.',
  mp_open_reserve: 'Hay dinero retenido que no se liberó dentro del período.',
  mp_no_initial: 'El reporte no trae el saldo inicial.',
  mp_no_total: 'El reporte no trae la fila del saldo final.',

  bank_needs_mapping: 'No reconocemos las columnas del extracto: contanos qué es cada una.',
  bank_bad_date: 'La fecha no se entiende.',
  bank_bad_amount: 'El importe no se entiende.',
  bank_both_sides: 'La fila tiene importe en Débito y en Crédito.',
  bank_dc_unknown: 'No se entiende si el movimiento es un débito o un crédito.',
  bank_direction_guess: 'El sentido (débito o crédito) se dedujo del texto: revisalo.',
  bank_balance_mismatch: 'El saldo no cierra con la fila anterior: revisá esta fecha.',
  bank_pending_skipped: 'Movimiento pendiente: se importa cuando esté conformado.',
  bank_zero_amount: 'Fila sin importe: no se importa.',
  bank_foreign_currency: 'El extracto parece ser en dólares: elegí una cuenta en dólares.',
}

/** Avisos cuyo `cents` es un importe y no una diferencia. */
const AMOUNT_CODES: ReadonlySet<ImportIssueCode> = new Set(['mp_open_reserve'])

/** El texto del aviso, con la fila adelante y la diferencia (o el importe) si la trae. */
export function issueText(i: ImportIssue): string {
  const base = IMPORT_ISSUE_TEXT[i.code]
  let amount = ''
  if (i.cents !== undefined) {
    const money = formatCents(Math.abs(i.cents), { decimals: 2 })
    amount = AMOUNT_CODES.has(i.code) ? ` (${money})` : ` (diferencia: ${money})`
  }
  return i.row === null ? `${base}${amount}` : `Fila ${i.row}: ${base}${amount}`
}

/** Fila parseada lista para `acc_import_add_items`: número de fila, clave natural, datos y avisos. */
export type ImportRow<T> = {
  /** Fila del archivo, desde 1. */
  readonly row: number
  /** Clave natural (`acc_import_items.natural_key`, 3 a 200 caracteres). */
  readonly key: string
  readonly item: T
  readonly issues: readonly ImportIssue[]
}

// ─── Mis Comprobantes (ARCA) ─────────────────────────────────────────────────

export type McGeneration = 'g1' | 'g2' | 'g3'
export type McKind = 'recibidos' | 'emitidos'

/** Alícuotas de IVA (0 %, 2,5 %, 5 %, 10,5 %, 21 %, 27 %). */
export type McRateKey = 'r0' | 'r25' | 'r5' | 'r105' | 'r21' | 'r27'
export type McVatRateKey = Exclude<McRateKey, 'r0'>

/**
 * Un comprobante de «Mis Comprobantes» (o del CSV de compras de Portal IVA).
 *
 * Los importes van en la **moneda del comprobante** (`currency`), siempre
 * positivos (las notas de crédito también: el sentido lo da `code`). La
 * conversión a pesos (`convertCents` con `fxRate`) la hace la propuesta.
 *
 * En G1 y G2 no hay neto ni IVA por alícuota: si la alícuota se deduce sola
 * (IVA ÷ neto ≈ 21 %, 10,5 %…) queda en su balde; si no, los baldes quedan en
 * cero, `netTotal`/`vatTotal` traen los totales y la fila va a revisión.
 */
export type McItem = {
  readonly kind: 'mc'
  readonly issueDate: IsoDate
  /** Código de ARCA (1 = Factura A, 3 = NC A, 11 = Factura C…), nunca la letra. */
  readonly code: number
  readonly pointOfSale: number
  readonly number: number
  /** «Número Hasta» (igual a `number` salvo en rangos). */
  readonly numberTo: number
  /** CAE o CAEA de 14 dígitos; `null` si no vino o vino dañado. */
  readonly authCode: string | null
  /** CUIT del emisor (11 dígitos). En Emitidos, la propia si se conoce; si no, `''`. */
  readonly issuerCuit: string
  /** Razón social según ARCA. En Emitidos va vacía (no guardamos datos de clientes). */
  readonly issuerName: string
  /** Tipo de documento del receptor (80 CUIT, 96 DNI, 99 consumidor final…). */
  readonly receiverDocType: number | null
  /**
   * Documento del receptor. En Recibidos es el propio; en Emitidos solo se guarda
   * si es una CUIT (tipo 80): un DNI de un cliente es un dato personal.
   */
  readonly receiverDoc: string | null
  /** `ARS`, `USD`, `EUR` o el texto crudo en mayúsculas si no lo reconocemos. */
  readonly currency: string
  /** Tipo de cambio exacto como texto decimal («1475,006» → `'1475.006'`; pesos → `'1'`). */
  readonly fxRate: string
  readonly net: Readonly<Record<McRateKey, Cents>>
  readonly vat: Readonly<Record<McVatRateKey, Cents>>
  /** Neto gravado total (columna de ARCA o, si falta, la suma de los baldes). */
  readonly netTotal: Cents
  readonly nonTaxed: Cents
  readonly exempt: Cents
  /** «Otros Tributos»: un solo número sin discriminar (percepciones, internos, municipales). */
  readonly otherTaxes: Cents
  readonly vatTotal: Cents
  readonly total: Cents
  readonly generation: McGeneration
}

/** Desglose que solo trae el CSV de compras de Portal IVA (para enriquecer «Otros Tributos»). */
export type PortalIvaTaxes = {
  readonly vatComputable: Cents
  readonly percVat: Cents
  readonly percIibb: Cents
  readonly percOtherNational: Cents
  readonly municipal: Cents
  readonly internal: Cents
}

// ─── Mercado Pago (reporte de Liquidaciones) ─────────────────────────────────

export type MpChannel =
  | 'qr'
  | 'point'
  | 'link'
  | 'transfer_in'
  | 'payout_own'
  | 'payout_third'
  | 'yield'
  | 'iibb_later'
  | 'perception'
  | 'bank_tax'
  | 'refund'
  | 'chargeback'
  | 'reserve'
  | 'tip'
  | 'loan'
  | 'fee_advance'
  | 'digital_change'
  | 'other'

export type MpSignalKey =
  | 'operationTags'
  | 'subUnit'
  | 'businessUnit'
  | 'poiId'
  | 'posId'
  | 'storeId'
  | 'paymentMethodType'
  | 'paymentMethod'

/** Un impuesto de `TAXES_DISAGGREGATED` (importe con el signo del reporte: negativo = descuento). */
export type MpTax = { readonly entity: string; readonly detail: string; readonly amount: Cents }

/**
 * Un movimiento del reporte de Liquidaciones (`RECORD_TYPE = release`).
 *
 * Los importes van con el signo del reporte: `netCredit` y `netDebit` en
 * positivo; `gross` con signo; comisiones e impuestos en negativo. Así se
 * cumple `netCredit − netDebit = gross + mpFee + financingFee + shippingFee + taxes`.
 */
export type MpItem = {
  readonly kind: 'mp'
  /** `mp:<sha256(SOURCE_ID|DESCRIPTION|RECORD_TYPE|DATE|NET_CREDIT|NET_DEBIT|GROSS)>`. */
  readonly rowKey: string
  readonly sourceId: string | null
  readonly recordType: string
  readonly description: string
  /** Instante de liberación (`DATE`) en UTC ISO. */
  readonly releasedAt: string
  /** Instante de aprobación del cobro (`TRANSACTION_APPROVAL_DATE`) en UTC ISO, si vino. */
  readonly approvedAt: string | null
  /** Día de Córdoba de la liberación (calendario, sin corte). */
  readonly releaseDate: IsoDate
  /** Día contable: el de la aprobación (o la liberación) con el corte de día del bar. */
  readonly businessDate: IsoDate
  readonly netCredit: Cents
  readonly netDebit: Cents
  readonly gross: Cents
  readonly mpFee: Cents
  readonly financingFee: Cents
  readonly shippingFee: Cents
  readonly couponCents: Cents
  readonly taxes: Cents
  readonly taxesDetail: readonly MpTax[]
  readonly balanceAfter: Cents | null
  readonly channel: MpChannel
  readonly signals: Readonly<Partial<Record<MpSignalKey, string>>>
  /** Últimos 4 dígitos de la cuenta destino de un retiro. */
  readonly payoutLast4: string | null
  /** ¿El retiro fue a un CBU/CVU propio? `null` si el reporte no trae la cuenta. */
  readonly payoutIsOwn: boolean | null
  /** ¿La transferencia vino de la propia CUIT? `null` si el reporte no trae quién pagó. */
  readonly fromOwnCuit: boolean | null
  /** `EXTERNAL_REFERENCE` (en retiros, el ID de Coelsa). */
  readonly externalReference: string | null
}

// ─── Banco ───────────────────────────────────────────────────────────────────

/** Cómo se supo si cada fila es débito o crédito (`banco.md` §3.4). */
export type BankDirection = 'columns' | 'sign' | 'dc' | 'balance_diff' | 'text'

export type BankItem = {
  readonly kind: 'bank'
  readonly date: IsoDate
  readonly valueDate: IsoDate | null
  /** Descripción como vino (espacios colapsados). Las reglas usan la normalizada. */
  readonly description: string
  readonly voucher: string | null
  /** Con signo: + crédito (entra), − débito (sale). */
  readonly amount: Cents
  /** Saldo después del movimiento, si el extracto lo trae. */
  readonly balance: Cents | null
  readonly counterpartyCuit: string | null
  /** Solo de una columna propia del extracto (nunca se adivina de la descripción). */
  readonly counterpartyName: string | null
  readonly reference: string | null
  /** Para filas idénticas del mismo día: 0, 1, 2… en el orden del extracto. */
  readonly ordinal: number
  /** `sha256(fecha|importe|descripción normalizada|comprobante|saldo)`. */
  readonly fingerprint: string
  readonly direction: BankDirection
  /** ¿Cierra el saldo con la fila anterior? `null` si no hay saldo para comparar. */
  readonly balanceOk: boolean | null
}

// ─── Esquemas (lo que vuelve a validar el servidor) ──────────────────────────

const centsSchema = z.number().int().min(-MONEY_MAX_CENTS).max(MONEY_MAX_CENTS)
const positiveCentsSchema = z.number().int().min(0).max(MONEY_MAX_CENTS)
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const utcInstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
const cuitSchema = z.string().regex(/^\d{11}$/)

const ISSUE_CODES = Object.keys(IMPORT_ISSUE_TEXT) as [ImportIssueCode, ...ImportIssueCode[]]

export const importIssueSchema = z
  .object({
    level: z.enum(['error', 'review', 'info']),
    code: z.enum(ISSUE_CODES),
    row: z.number().int().min(1).nullable(),
    field: z.string().min(1).max(60).optional(),
    cents: centsSchema.optional(),
  })
  .strict()

/** Los avisos de una fila (`acc_import_items.issues`). */
export const importIssuesSchema = z.array(importIssueSchema).max(50)

export const mcItemSchema = z
  .object({
    kind: z.literal('mc'),
    issueDate: isoDateSchema,
    code: z.number().int().min(1).max(999),
    pointOfSale: z.number().int().min(0).max(99_999),
    number: z.number().int().min(1).max(99_999_999),
    numberTo: z.number().int().min(1).max(99_999_999),
    authCode: z
      .string()
      .regex(/^\d{14}$/)
      .nullable(),
    issuerCuit: z.union([cuitSchema, z.literal('')]),
    issuerName: z.string().max(200),
    receiverDocType: z.number().int().min(0).max(99).nullable(),
    receiverDoc: z
      .string()
      .regex(/^\d{1,11}$/)
      .nullable(),
    currency: z.string().min(1).max(10),
    fxRate: z.string().regex(/^\d{1,12}(\.\d{1,10})?$/),
    net: z
      .object({
        r0: positiveCentsSchema,
        r25: positiveCentsSchema,
        r5: positiveCentsSchema,
        r105: positiveCentsSchema,
        r21: positiveCentsSchema,
        r27: positiveCentsSchema,
      })
      .strict(),
    vat: z
      .object({
        r25: positiveCentsSchema,
        r5: positiveCentsSchema,
        r105: positiveCentsSchema,
        r21: positiveCentsSchema,
        r27: positiveCentsSchema,
      })
      .strict(),
    netTotal: positiveCentsSchema,
    nonTaxed: positiveCentsSchema,
    exempt: positiveCentsSchema,
    otherTaxes: positiveCentsSchema,
    vatTotal: positiveCentsSchema,
    total: positiveCentsSchema,
    generation: z.enum(['g1', 'g2', 'g3']),
  })
  .strict()

const MP_CHANNELS = [
  'qr',
  'point',
  'link',
  'transfer_in',
  'payout_own',
  'payout_third',
  'yield',
  'iibb_later',
  'perception',
  'bank_tax',
  'refund',
  'chargeback',
  'reserve',
  'tip',
  'loan',
  'fee_advance',
  'digital_change',
  'other',
] as const satisfies readonly MpChannel[]

const signalSchema = z.string().min(1).max(80)

export const mpItemSchema = z
  .object({
    kind: z.literal('mp'),
    rowKey: z.string().regex(/^mp:[0-9a-f]{64}$/),
    sourceId: z.string().min(1).max(64).nullable(),
    recordType: z.string().max(40),
    description: z.string().max(80),
    releasedAt: utcInstantSchema,
    approvedAt: utcInstantSchema.nullable(),
    releaseDate: isoDateSchema,
    businessDate: isoDateSchema,
    netCredit: positiveCentsSchema,
    netDebit: positiveCentsSchema,
    gross: centsSchema,
    mpFee: centsSchema,
    financingFee: centsSchema,
    shippingFee: centsSchema,
    couponCents: centsSchema,
    taxes: centsSchema,
    taxesDetail: z
      .array(
        z
          .object({ entity: z.string().max(60), detail: z.string().max(80), amount: centsSchema })
          .strict(),
      )
      .max(20),
    balanceAfter: centsSchema.nullable(),
    channel: z.enum(MP_CHANNELS),
    signals: z
      .object({
        operationTags: signalSchema.optional(),
        subUnit: signalSchema.optional(),
        businessUnit: signalSchema.optional(),
        poiId: signalSchema.optional(),
        posId: signalSchema.optional(),
        storeId: signalSchema.optional(),
        paymentMethodType: signalSchema.optional(),
        paymentMethod: signalSchema.optional(),
      })
      .strict(),
    payoutLast4: z
      .string()
      .regex(/^\d{1,4}$/)
      .nullable(),
    payoutIsOwn: z.boolean().nullable(),
    fromOwnCuit: z.boolean().nullable(),
    externalReference: z.string().min(1).max(80).nullable(),
  })
  .strict()

export const bankItemSchema = z
  .object({
    kind: z.literal('bank'),
    date: isoDateSchema,
    valueDate: isoDateSchema.nullable(),
    description: z.string().max(240),
    voucher: z.string().min(1).max(40).nullable(),
    amount: centsSchema.refine((c) => c !== 0, 'Un movimiento sin importe no se importa'),
    balance: centsSchema.nullable(),
    counterpartyCuit: cuitSchema.nullable(),
    counterpartyName: z.string().min(1).max(120).nullable(),
    reference: z.string().min(1).max(80).nullable(),
    ordinal: z.number().int().min(0).max(9_999),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    direction: z.enum(['columns', 'sign', 'dc', 'balance_diff', 'text']),
    balanceOk: z.boolean().nullable(),
  })
  .strict()
