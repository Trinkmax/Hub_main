/**
 * Un tique para la comandera, como una lista de renglones — PURO.
 *
 * Se imprime por dos caminos: por el navegador, con el driver de una impresora enchufada a la compu
 * (`html.ts`), o directo en el idioma de la impresora térmica por la red del bar (`escpos.ts`, lo usa
 * el programa «HUB Impresoras» para las comanderas por WiFi).
 *
 * Acá se arma QUÉ dice el tique (comanda, cuenta, cierre de caja); cómo se dibuja está en cada camino.
 * Reglas del papel térmico: todo en negro pleno (los grises salen punteados y no se leen), letra
 * grande, y lo importante en negativo o entre rayas.
 */

/** Ancho del rollo, en milímetros. El de 80 es el de casi todas las comanderas; el de 58, las chicas. */
export const PAPER_WIDTHS = [80, 58] as const
export type PaperWidth = (typeof PAPER_WIDTHS)[number]

/** Lo que de verdad se imprime de cada rollo (el cabezal deja un margen a cada lado). */
export const PRINTABLE_MM: Readonly<Record<PaperWidth, number>> = { 80: 72, 58: 48 }

export function isPaperWidth(value: unknown): value is PaperWidth {
  return value === 80 || value === 58
}

export type TextSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl'

export type PrintLine =
  /** Texto suelto. */
  | {
      kind: 'text'
      text: string
      align?: 'left' | 'center' | 'right'
      bold?: boolean
      size?: TextSize
      upper?: boolean
      /** Corrido a la derecha: el detalle de lo de arriba. */
      indent?: boolean
    }
  /** Dos puntas: a la izquierda qué es, a la derecha cuánto. */
  | { kind: 'row'; left: string; right: string; bold?: boolean; size?: TextSize; dots?: boolean }
  /** Un producto de la comanda: la cantidad grande, el nombre, y debajo cómo va. */
  | {
      kind: 'item'
      qty: string
      name: string
      /** Aclaraciones que valen para todas las unidades. */
      marks: string[]
      /** El mismo producto pedido de formas distintas: cada forma con su cantidad. */
      variants: { qty: string; marks: string[] }[]
      /** Tachado: ya salió. */
      done?: boolean
    }
  /** Una franja en negativo: lo que no se puede pasar por alto (celíaco, PRÁCTICA). */
  | { kind: 'banner'; text: string }
  /** El logo del bar. Sin logo cargado (o si la impresora no lo puede dibujar), no ocupa lugar. */
  | { kind: 'logo' }
  /**
   * Lo que se busca con la vista desde lejos, gigante: el número de mesa. `caption` va arriba en
   * chico («MESA»); sin número (un nombre, «Delivery») va sin rótulo.
   */
  | { kind: 'hero'; caption: string | null; text: string }
  | { kind: 'rule'; style?: 'solid' | 'dashed' | 'double' }
  | { kind: 'space'; lines?: number }
  /** Un casillero para escribir a mano (firma, contado). */
  | { kind: 'blank'; label: string }

export type PrintDoc = {
  /** Para el título de la ventana y el nombre del trabajo en la cola de impresión. */
  title: string
  lines: PrintLine[]
}

/** Varios tiques en un mismo trabajo: la impresora corta entre uno y otro. */
export type PrintJob = {
  paper: PaperWidth
  docs: PrintDoc[]
  /** El logo del bar (dirección de la imagen), para el renglón `logo`. */
  logo?: string | null
}

/** Atajos para armar renglones sin repetir `kind`. */
export const p = {
  text: (text: string, opts: Omit<Extract<PrintLine, { kind: 'text' }>, 'kind' | 'text'> = {}) =>
    ({ kind: 'text', text, ...opts }) satisfies PrintLine,
  center: (text: string, opts: Omit<Extract<PrintLine, { kind: 'text' }>, 'kind' | 'text'> = {}) =>
    ({ kind: 'text', text, align: 'center', ...opts }) satisfies PrintLine,
  row: (
    left: string,
    right: string,
    opts: Omit<Extract<PrintLine, { kind: 'row' }>, 'kind' | 'left' | 'right'> = {},
  ) => ({ kind: 'row', left, right, ...opts }) satisfies PrintLine,
  rule: (style: 'solid' | 'dashed' | 'double' = 'solid') =>
    ({ kind: 'rule', style }) satisfies PrintLine,
  space: (lines = 1) => ({ kind: 'space', lines }) satisfies PrintLine,
  banner: (text: string) => ({ kind: 'banner', text }) satisfies PrintLine,
  blank: (label: string) => ({ kind: 'blank', label }) satisfies PrintLine,
}

/** Plata para un tique: «$ 12.500». Sin centavos salvo que los haya. */
export function ticketMoney(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(Math.round(cents))
  const whole = Math.floor(abs / 100)
  const rest = abs % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const text = rest === 0 ? grouped : `${grouped},${String(rest).padStart(2, '0')}`
  return `${negative ? '−' : ''}$ ${text}`
}

/** «21:34» en la hora del bar. */
export function ticketTime(iso: string | number | Date, timeZone: string): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/** «16/11/2026 21:34» en la hora del bar. */
export function ticketDateTime(iso: string | number | Date, timeZone: string): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
}
