/**
 * Cómo entra el riel en cada pantalla — PURO y testeado.
 *
 * Todo está dibujado para una tele de 1920×1080 vista a tres metros, en una
 * unidad (`u`) que vale 1 px ahí. En otra pantalla la unidad se estira o se
 * achica, así una tele de 720 o una 4K muestran exactamente lo mismo. En una
 * tablet o un celular la unidad tiene un piso (nadie los mira de lejos) y lo
 * que cambia es cuántas comandas entran una al lado de la otra.
 */

export const DESIGN = {
  width: 1920,
  height: 1080,
  /** Piso y techo de la unidad, en px. */
  minUnit: 0.6,
  maxUnit: 2.4,
  /** Separación entre comandas, en unidades. */
  gap: 20,
  /**
   * Ancho mínimo de una comanda, en unidades: lo que necesita un nombre de plato a 40. Con este número
   * la tele cuelga cuatro (tres con el evento al lado) y una tablet de 1024 cuelga tres.
   */
  minColumn: 404,
  maxColumns: 6,
  /** Por debajo de esto no hay riel: una sola columna que se recorre con el dedo. */
  listBelowWidth: 720,
  listBelowHeight: 480,
} as const

export type KitchenMode = 'rail' | 'list'

export function unitFor(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1
  const fit = Math.min(width / DESIGN.width, height / DESIGN.height)
  return Math.min(DESIGN.maxUnit, Math.max(DESIGN.minUnit, fit))
}

export function modeFor(width: number, height: number): KitchenMode {
  if (!(width > 0) || !(height > 0)) return 'rail'
  return width < DESIGN.listBelowWidth || height < DESIGN.listBelowHeight ? 'list' : 'rail'
}

/** Cuántas comandas entran una al lado de la otra en un riel de ese ancho (en px). Siempre al menos una. */
export function columnsFor(railWidthPx: number, unit: number): number {
  if (!(railWidthPx > 0) || !(unit > 0)) return 1
  const width = railWidthPx / unit
  const count = Math.floor((width + DESIGN.gap) / (DESIGN.minColumn + DESIGN.gap))
  return Math.min(DESIGN.maxColumns, Math.max(1, count))
}

/** Lo que hace falta saber de una comanda para estimar cuánto mide. */
export type TicketShape = {
  /** Franjas de aviso arriba (salud, dieta, prueba). */
  strips: number
  /** Lleva la línea de sector, personas, tanda. */
  meta: boolean
  /** Rótulos de estación (cuando la comanda mezcla estaciones). */
  labels: number
  /** Lleva la línea del pie con lo de otras estaciones. */
  footer: boolean
  lines: readonly { name: string; modifiers: readonly string[]; notes: string | null }[]
}

/** Las medidas de `kitchen.css`, en unidades. Si cambia la hoja de estilos, cambian acá. */
const TICKET = {
  /** Lo que queda adentro del riel + la franja del estado + el encabezado sin la línea de sector. */
  head: 181,
  meta: 37,
  strip: 50,
  label: 33,
  footer: 55,
  bodyPadding: 14,
  /** Un renglón nunca mide menos que su cantidad. */
  lineMin: 72,
  linePadding: 19,
  nameRow: 45,
  /** Ancho medio de una letra del nombre: «Clasica SIMPLE» da 18, «Lomo Completo» 21. */
  nameChar: 19.5,
  modRow: 43,
  modChar: 16,
  modPadding: 26,
  /** Padding lateral del papel + la columna de la cantidad. */
  sideChrome: 130,
} as const

function rowsOf(widths: readonly number[], available: number, gap: number): number {
  let rows = 0
  let x = 0
  for (const width of widths) {
    if (width >= available) {
      // Más ancho que el renglón: se parte adentro.
      rows += Math.ceil(width / available)
      x = 0
      continue
    }
    if (x === 0 || x + gap + width > available) {
      rows += 1
      x = width
    } else {
      x += gap + width
    }
  }
  return rows
}

/**
 * Cuánto mide una comanda a letra entera, en unidades: lo fijo (encabezado, avisos, pie) y los
 * renglones. Es una cuenta, no una medición: sirve para decidir ANTES de dibujar si una comanda
 * larga necesita dos lugares. Si le erra por poco, la comanda igual se acomoda sola al dibujarse.
 */
export function estimateTicket(
  shape: TicketShape,
  columnUnits: number,
): { fixed: number; body: number } {
  const nameWidth = Math.max(120, columnUnits - TICKET.sideChrome)
  let body = TICKET.bodyPadding + shape.labels * TICKET.label
  for (const line of shape.lines) {
    const nameRows = Math.max(1, Math.ceil((line.name.length * TICKET.nameChar) / nameWidth))
    const marks = [...line.modifiers, ...(line.notes ? [`«${line.notes}»`] : [])].map(
      (text) => text.length * TICKET.modChar + TICKET.modPadding,
    )
    const modRows = rowsOf(marks, nameWidth, 8)
    const height =
      TICKET.linePadding +
      nameRows * TICKET.nameRow +
      (modRows > 0 ? 7 + modRows * TICKET.modRow : 0)
    body += Math.max(TICKET.lineMin, height)
  }
  const fixed =
    TICKET.head +
    (shape.meta ? TICKET.meta : 0) +
    shape.strips * TICKET.strip +
    (shape.footer ? TICKET.footer : 0)
  return { fixed, body }
}

/** Hasta cuánto de más se tolera antes de darle dos lugares: un poco se resuelve achicando apenas. */
const WIDE_TOLERANCE = 1.12

/**
 * Cuántos lugares del riel ocupa una comanda. Casi todas, uno. La que a letra entera no entra en el
 * alto del riel ocupa dos y reparte sus renglones en dos columnas: es preferible mostrar una comanda
 * menos que una mesa de doce en letra que no se lee a tres metros.
 */
export function ticketSpan(
  shape: TicketShape,
  columnUnits: number,
  roomUnits: number,
  slots: number,
): 1 | 2 {
  if (slots < 2 || !(roomUnits > 0) || !(columnUnits > 0)) return 1
  const { fixed, body } = estimateTicket(shape, columnUnits)
  return fixed + body > roomUnits * WIDE_TOLERANCE ? 2 : 1
}

/**
 * Cuántos totales entran en la tira de arriba, que tiene un alto fijo de `lines` renglones.
 * Se acomodan como un texto: uno al lado del otro y, cuando no entra más, abajo. Si no entran todos,
 * en el último renglón se guarda lugar para el «+N» que dice cuántos quedaron afuera.
 */
export function fitCount(
  widths: readonly number[],
  available: number,
  gap: number,
  lines: number,
  moreWidth: number,
): number {
  if (!(available > 0) || lines < 1) return 0
  const ends: { line: number; end: number }[] = []
  let line = 1
  let x = 0
  for (const width of widths) {
    let end = x === 0 ? width : x + gap + width
    if (end > available && x > 0) {
      line += 1
      end = width
    }
    if (line > lines) break
    ends.push({ line, end })
    x = end
  }
  if (ends.length === widths.length) return widths.length
  // No entraron todos: sacar del último renglón hasta que entre el «+N».
  let count = ends.length
  while (count > 0) {
    const last = ends[count - 1]
    if (!last || last.line < lines || last.end + gap + moreWidth <= available) break
    count -= 1
  }
  return count
}

/** Hasta cuánto se achica la letra de una comanda muy larga antes de dejar de achicarla. */
export const MIN_TICKET_SCALE = 0.5

/**
 * Una comanda más alta que el riel no se corta: se achica la letra de sus
 * renglones hasta que entre. `fixed` es lo que no se achica (el encabezado).
 * Devuelve la escala siguiente a probar; se llama de nuevo si todavía no entra
 * (los nombres que dejan de partirse en dos líneas cambian la cuenta).
 */
export function nextTicketScale(
  current: number,
  measured: number,
  available: number,
  fixed: number,
): number {
  if (!(measured > available) || !(available > 0)) return current
  const body = measured - fixed
  const room = available - fixed
  if (!(body > 0) || !(room > 0)) return MIN_TICKET_SCALE
  // Un poco de más: redondeos y renglones que se reacomodan.
  const next = Math.min(current * (room / body) * 0.985, current - 0.02)
  return Math.max(MIN_TICKET_SCALE, Math.round(next * 1000) / 1000)
}
