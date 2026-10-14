import type { SubledgerColumn } from '@/lib/accounting/queries/columns'
import {
  isCuitColumn,
  isRefColumn,
  isRunningBalanceColumn,
  subledgerCellCents,
  subledgerCellText,
} from '../../_lib/subledgers'

/**
 * Un renglón de subdiario para el celular: la fecha, «#125» (que lleva al
 * comprobante), el texto que lo nombra y UN importe. En compras lo que lo nombra
 * es el proveedor («Tostadero Serrano SA»), no el tipo («Compra», igual en los
 * veinte renglones); abajo va el comprobante. La tabla ancha (16
 * columnas en compras) no se puede leer en 390 px; esto sí, y la tabla completa
 * queda a un toque. Puro (lo prueban los tests).
 *
 * Qué importe: el «Total» del renglón; si el subdiario no tiene esa columna, el
 * que hace sus veces («Importe», «Neto recibido»); en cajas, lo que entró o lo
 * que salió con su signo; si no, la última columna de plata que no sea el saldo.
 */

type Cell =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<{ label: string; amountCents: number | null }>

export type SubledgerMobileRow = {
  /** `dd/MM/yyyy`; vacío si el renglón no trae fecha. */
  date: string
  /** «#125», o `null` si el subdiario no lleva referencia. */
  ref: string | null
  /** Lo que nombra el renglón: el proveedor si lo hay; si no, el primer texto con algo. */
  title: string
  /** El que sigue (en compras, el comprobante), si hay. */
  detail: string | null
  amountCents: number | null
  /** De qué columna salió el importe («Total», «Entró», «Salió»). */
  amountLabel: string | null
  /** `+1` entró, `−1` salió (cajas); `0` cuando el importe no lleva sentido. */
  direction: 1 | -1 | 0
}

/** Si el subdiario trae esta columna, es la que nombra el renglón. */
const NAMING_HEADER = 'Proveedor'
/** Y esta es la que va abajo cuando el nombre salió de la de arriba. */
const DETAIL_HEADER = 'Comprobante'

/** Las columnas que valen como «el importe del renglón», en orden de preferencia. */
const AMOUNT_HEADERS = ['Total', 'Importe', 'Neto recibido'] as const

function cellOf(values: Readonly<Record<string, Cell>>, column: SubledgerColumn): Cell {
  for (const key of column.keys) {
    if (key in values) return values[key] ?? null
  }
  return null
}

export function subledgerMobileRow(
  row: { values: Readonly<Record<string, Cell>> },
  columns: readonly SubledgerColumn[],
): SubledgerMobileRow {
  const textOf = (column: SubledgerColumn) =>
    subledgerCellText(cellOf(row.values, column), column).trim()
  const centsOf = (column: SubledgerColumn) => subledgerCellCents(cellOf(row.values, column))

  const dateColumn = columns.find((c) => c.type === 'date')
  const refColumn = columns.find(isRefColumn)
  const ref = refColumn ? textOf(refColumn) : ''

  // Los textos que nombran el renglón: ni la referencia, ni el CUIT, ni una lista de medios.
  const named = columns
    .filter((c) => c.type === 'text' && !isCuitColumn(c) && !isRefColumn(c))
    .map((c) => ({ header: c.header, text: textOf(c) }))
    .filter((t) => t.text !== '')
  const naming = named.find((t) => t.header === NAMING_HEADER)
  const rest = naming ? named.filter((t) => t !== naming) : named
  const texts = naming
    ? [naming.text, (rest.find((t) => t.header === DETAIL_HEADER) ?? rest[0])?.text ?? '']
    : rest.map((t) => t.text)

  const money = columns.filter((c) => c.type === 'money' && !isRunningBalanceColumn(c))
  let amountCents: number | null = null
  let amountLabel: string | null = null
  let direction: 1 | -1 | 0 = 0

  const inColumn = money.find((c) => c.header === 'Entró')
  const outColumn = money.find((c) => c.header === 'Salió')
  if (inColumn && outColumn) {
    const entered = centsOf(inColumn) ?? 0
    const left = centsOf(outColumn) ?? 0
    if (entered !== 0 || left !== 0) {
      const isIn = entered !== 0
      amountCents = isIn ? entered : left
      amountLabel = isIn ? inColumn.header : outColumn.header
      direction = isIn ? 1 : -1
    }
  } else {
    const preferred =
      AMOUNT_HEADERS.map((header) => money.find((c) => c.header === header)).find(Boolean) ??
      money.at(-1)
    if (preferred) {
      amountCents = centsOf(preferred)
      amountLabel = preferred.header
    }
  }

  return {
    date: dateColumn ? textOf(dateColumn) : '',
    ref: ref || null,
    title: texts[0] ?? '',
    detail: texts[1] || null,
    amountCents,
    amountLabel,
    direction,
  }
}
