/**
 * Tablas de una página HTML → filas de texto (diseño §4.0). Varios home
 * bankings exportan un «.xls» que en realidad es HTML (Excel lo abre igual).
 * El formato exacto de Nación Empresa 24 está A CONFIRMAR con una muestra real.
 *
 * No usa `DOMParser` (no existe en el servidor): recorre las etiquetas con un
 * tokenizador tolerante. Toma las filas (`<tr>`) de todas las tablas en orden de
 * documento; un `colspan` deja celdas vacías para no correr las columnas y las
 * tablas anidadas no mezclan su texto con el de la celda que las contiene. Lo de
 * `<script>`, `<style>` y `<head>` se ignora.
 */

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  Ccedil: 'Ç',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
  iexcl: '¡',
  iquest: '¿',
  laquo: '«',
  raquo: '»',
  euro: '€',
  middot: '·',
  ndash: '–',
  mdash: '—',
  copy: '©',
  reg: '®',
}

/** Entidades de HTML (las comunes en castellano y las numéricas). Las desconocidas quedan tal cual. */
export function decodeHtmlEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const cp = Number.parseInt(ref.slice(2), 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole
    }
    if (ref.startsWith('#')) {
      const cp = Number.parseInt(ref.slice(1), 10)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole
    }
    return NAMED[ref] ?? whole
  })
}

function cleanCell(s: string): string {
  return decodeHtmlEntities(s).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()
}

type Context = { row: string[] | null; cell: string | null; colspan: number }

const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>]*)>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g

/** Las filas de todas las tablas del HTML, celda por celda (texto limpio). */
export function readHtmlTable(html: string): string[][] {
  const rows: string[][] = []
  const stack: Context[] = []
  let ctx: Context = { row: null, cell: null, colspan: 1 }
  /** Etiqueta cuyo contenido se ignora (`script`, `style`, `head`, `title`). */
  let skipUntil: string | null = null

  const closeCell = () => {
    if (ctx.cell === null) return
    if (!ctx.row) ctx.row = []
    ctx.row.push(cleanCell(ctx.cell))
    for (let i = 1; i < ctx.colspan; i++) ctx.row.push('')
    ctx.cell = null
    ctx.colspan = 1
  }
  const closeRow = () => {
    closeCell()
    if (ctx.row) rows.push(ctx.row)
    ctx.row = null
  }

  let last = 0
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(html); m !== null; m = TOKEN_RE.exec(html)) {
    const text = html.slice(last, m.index)
    last = TOKEN_RE.lastIndex
    if (skipUntil === null && ctx.cell !== null && text !== '') ctx.cell += text
    if (m[1] !== undefined) {
      if (skipUntil === null && ctx.cell !== null) ctx.cell += m[1]
      continue
    }
    const name = (m[3] ?? '').toLowerCase()
    if (name === '') continue
    const closing = m[2] === '/'
    if (skipUntil !== null) {
      if (closing && name === skipUntil) skipUntil = null
      continue
    }
    if (
      !closing &&
      (name === 'script' || name === 'style' || name === 'head' || name === 'title')
    ) {
      skipUntil = name
      continue
    }
    switch (name) {
      case 'table':
        if (!closing) {
          stack.push(ctx)
          ctx = { row: null, cell: null, colspan: 1 }
        } else {
          closeRow()
          ctx = stack.pop() ?? { row: null, cell: null, colspan: 1 }
        }
        break
      case 'tr':
        // Un `<tr>` sin cerrar el anterior también termina la fila (HTML lo permite).
        closeRow()
        if (!closing) ctx.row = []
        break
      case 'td':
      case 'th':
        if (!closing) {
          closeCell()
          if (!ctx.row) ctx.row = []
          ctx.cell = ''
          const span = /\bcolspan\s*=\s*["']?(\d+)/i.exec(m[4] ?? '')
          ctx.colspan = Math.min(Math.max(Number(span?.[1] ?? '1') || 1, 1), 100)
        } else {
          closeCell()
        }
        break
      case 'br':
      case 'p':
      case 'div':
      case 'li':
        if (ctx.cell !== null) ctx.cell += ' '
        break
      default:
        break
    }
  }
  if (skipUntil === null && ctx.cell !== null) ctx.cell += html.slice(last)
  closeRow()
  while (stack.length > 0) {
    ctx = stack.pop() ?? ctx
    closeRow()
  }
  return rows
}

/** ¿El texto es una página HTML con tablas? */
export function looksLikeHtmlTable(text: string): boolean {
  const head = text.trimStart().slice(0, 4096).toLowerCase()
  return head.startsWith('<') && /<table[\s>]/.test(text.slice(0, 1_000_000).toLowerCase())
}
