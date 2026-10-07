/**
 * «Importar plan», puro: de lo que contesta `acc_import_accounts` (ensayo) a la tabla de la vista
 * previa: qué cuentas son nuevas, cuáles cambian (y qué), cuáles quedan igual y qué líneas tienen un
 * error, con el grupo inferido y el tipo de cada una, en criollo.
 */

import { significantAccountCode } from '@/components/administracion/account-paths'
import { ACC_ERRORS, accErrorMessage, isAccErrorKey } from '@/lib/accounting/errors'
import type {
  ChartImportChange,
  ChartImportResult,
  ChartImportResultRow,
} from '@/lib/accounting/queries/accounts'
import type { AccountType } from '@/lib/accounting/types'
import { systemUse } from './system-uses'
import { ACCOUNT_TYPE_NAMES } from './tree'

export type ImportPreviewKind = 'new' | 'changed' | 'same' | 'error'

export type ImportPreviewRow = {
  /** Línea de lo que se mandó, desde 1. */
  row: number
  code: string
  name: string
  kind: ImportPreviewKind
  /** «Nueva», «Cambia», «Sin cambios», «Error». */
  status: string
  /** Lo que cambia de una que ya existe, en criollo. */
  details: string[]
  parentCode: string | null
  /** El nombre del grupo (el que queda después de importar). */
  parentName: string | null
  level: number | null
  type: AccountType | null
  postable: boolean | null
  /** Es una cuenta principal nueva: hay que elegir su tipo. */
  rootNeedsType: boolean
  /** Si es una cuenta del sistema, su uso (se resalta: el sistema la sigue usando). */
  systemLabel: string | null
  isTreasury: boolean
  error: string | null
}

export type ImportPreviewCounts = {
  total: number
  creates: number
  updates: number
  unchanged: number
  errors: number
}

export type ImportPreview = {
  rows: ImportPreviewRow[]
  counts: ImportPreviewCounts
  /** Principales nuevas que todavía no tienen tipo. */
  missingTypes: number
  /** Sin errores y con algo para cambiar. */
  canImport: boolean
}

const STATUS: Readonly<Record<ImportPreviewKind, string>> = {
  new: 'Nueva',
  changed: 'Cambia',
  same: 'Sin cambios',
  error: 'Error',
}

function detailText(detail: ChartImportResultRow['errorDetail'], key: string): string | null {
  const value = detail[key]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** El error de una línea, con su dato (el grupo, la otra línea, la caja). */
export function importRowError(row: Pick<ChartImportResultRow, 'error' | 'errorDetail'>): string {
  const d = row.errorDetail
  const parent = detailText(d, 'parent_code')
  switch (row.error) {
    case null:
      return ''
    case 'code_invalid':
      return 'El código va con números separados por puntos, hasta 24 caracteres.'
    case 'account_name_invalid':
      return 'El nombre tiene que tener entre 2 y 80 caracteres.'
    case 'account_description_invalid':
      return '«Para qué se usa» puede tener hasta 280 caracteres.'
    case 'import_duplicate_code': {
      const first = detailText(d, 'row')
      return first
        ? `Ese código ya está en la línea ${first}.`
        : 'Ese código está repetido en lo que pegaste.'
    }
    case 'import_parent_not_found':
      return parent
        ? `No encontramos el grupo ${parent} ni en el plan ni en lo que pegaste.`
        : ACC_ERRORS.import_parent_not_found.message
    case 'import_parent_has_errors':
      return parent
        ? `Su grupo (${parent}) tiene un problema: corregilo primero.`
        : ACC_ERRORS.import_parent_has_errors.message
    case 'import_type_required':
      return 'Es una cuenta principal nueva: elegí su tipo.'
    case 'import_treasury_conflict': {
      const name = detailText(d, 'account_name')
      return name
        ? `Es la cuenta de la caja «${name}»: su nombre se cambia desde Ajustes › Cajas y cuentas.`
        : 'Es la cuenta de una caja: su nombre se cambia desde Ajustes › Cajas y cuentas.'
    }
    case 'account_type_mismatch':
      return parent
        ? `No puede ser de ese tipo adentro de ${parent}.`
        : 'No puede cambiar de tipo: la usa el sistema o una caja, o tiene cuentas adentro de otro tipo.'
    case 'parent_is_postable':
      return parent
        ? `${parent} es una cuenta imputable: no puede tener cuentas adentro.`
        : ACC_ERRORS.parent_is_postable.message
    case 'account_has_movements':
      return 'Tiene movimientos: no puede cambiar de tipo, de lado ni pasar a grupo.'
    case 'system_account_locked':
      return 'La usa el sistema: tiene que seguir siendo imputable.'
    case 'account_in_use':
      return 'La usa una caja, un proveedor o un gasto fijo: tiene que seguir siendo imputable.'
    case 'account_has_children':
      return 'Tiene cuentas adentro: no puede pasar a imputable.'
    case 'account_move_cycle':
      return 'Quedaría adentro de sí misma.'
    case 'account_level_too_deep':
      return 'Quedaría a más de 8 niveles: revisá el código.'
    case 'account_root_must_be_group':
      return 'Una cuenta principal tiene que ser un grupo.'
    case 'check_violation':
    case 'duplicate':
    case 'import_failed':
      return 'No pudimos probar esta línea: revisala.'
    default:
      return isAccErrorKey(row.error) ? accErrorMessage(row.error) : 'Revisá esta línea.'
  }
}

function changeText(
  change: ChartImportChange,
  row: ChartImportResultRow,
  parentName: string | null,
): string {
  const prev = row.previous
  switch (change) {
    case 'name':
      return prev?.name ? `Nombre: «${prev.name}» → «${row.name}»` : 'Cambia el nombre'
    case 'description':
      return 'Cambia «Para qué se usa»'
    case 'parent':
      return row.parentCode
        ? `Pasa adentro de ${row.parentCode}${parentName ? ` ${parentName}` : ''}`
        : 'Pasa a ser cuenta principal'
    case 'type':
      return prev?.type && row.type
        ? `Tipo: ${ACCOUNT_TYPE_NAMES[prev.type]} → ${ACCOUNT_TYPE_NAMES[row.type]}`
        : 'Cambia el tipo'
    case 'normal_side':
      return 'Cambia el lado de su saldo'
    case 'postable':
      return row.postable ? 'Pasa a ser imputable' : 'Pasa a ser grupo'
  }
}

/**
 * La vista previa. `planNames` = código → nombre del plan de hoy (para nombrar el grupo inferido;
 * si el grupo también viene en lo pegado, gana ese nombre).
 */
export function buildImportPreview(
  result: ChartImportResult,
  planNames: ReadonlyMap<string, string>,
): ImportPreview {
  const pastedNames = new Map<string, string>()
  for (const r of result.rows) {
    if (r.action !== 'error' && !pastedNames.has(r.code)) pastedNames.set(r.code, r.name)
  }
  const rows = result.rows.map((r): ImportPreviewRow => {
    const kind: ImportPreviewKind =
      r.action === 'create'
        ? 'new'
        : r.action === 'update'
          ? 'changed'
          : r.action === 'none'
            ? 'same'
            : 'error'
    const parentName = r.parentCode
      ? (pastedNames.get(r.parentCode) ?? planNames.get(r.parentCode) ?? null)
      : null
    return {
      row: r.row,
      code: r.code,
      name: r.name,
      kind,
      status: STATUS[kind],
      details: kind === 'changed' ? r.changes.map((c) => changeText(c, r, parentName)) : [],
      parentCode: r.parentCode,
      parentName,
      level: r.level,
      type: r.type,
      postable: r.postable,
      rootNeedsType:
        r.error === 'import_type_required' || (r.action === 'create' && r.parentCode === null),
      systemLabel: systemUse(r.systemKey)?.label ?? null,
      isTreasury: r.isTreasury,
      error: kind === 'error' ? importRowError(r) : null,
    }
  })
  const counts: ImportPreviewCounts = {
    total: rows.length,
    creates: rows.filter((r) => r.kind === 'new').length,
    updates: rows.filter((r) => r.kind === 'changed').length,
    unchanged: rows.filter((r) => r.kind === 'same').length,
    errors: rows.filter((r) => r.kind === 'error').length,
  }
  return {
    rows,
    counts,
    missingTypes: result.rows.filter((r) => r.error === 'import_type_required').length,
    canImport: counts.errors === 0 && counts.creates + counts.updates > 0,
  }
}

/**
 * Las líneas pegadas que van a quedar como cuentas principales (sin grupo): ningún código del plan
 * ni de lo pegado es un prefijo de su código significativo. Es la misma inferencia de
 * `acc_import_accounts`; sirve para mandar el tipo elegido solo a las que de verdad son principales.
 */
export function pastedRootCodes(
  rows: ReadonlyArray<{ code: string }>,
  planCodes: Iterable<string>,
): Set<string> {
  const known = new Set<string>()
  for (const code of planCodes) known.add(significantAccountCode(code))
  for (const r of rows) known.add(significantAccountCode(r.code))
  const roots = new Set<string>()
  for (const r of rows) {
    const segs = significantAccountCode(r.code).split('.')
    let hasParent = false
    for (let k = segs.length - 1; k >= 1 && !hasParent; k -= 1) {
      hasParent = known.has(segs.slice(0, k).join('.'))
    }
    if (!hasParent) roots.add(r.code)
  }
  return roots
}
