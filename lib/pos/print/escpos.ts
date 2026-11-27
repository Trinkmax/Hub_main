/**
 * El tique en el idioma de la impresora térmica (ESC/POS) — PURO y testeado
 * (`tests/lib/pos-print-escpos.test.ts`).
 *
 * Lo usa el programa «HUB Impresoras» para las comanderas que están en la red del bar (WiFi o cable):
 * a esas no se les puede imprimir desde el navegador, así que el programa les manda los bytes directo
 * al puerto 9100. ESC/POS lo entienden casi todas las térmicas (Epson, Xprinter, 3nStar, Gadnic, Hasar…).
 *
 * Decisiones para que salga igual en cualquier marca:
 *   · Letra A (12×24 puntos): 48 columnas en el rollo de 80 y 32 en el de 58.
 *   · Los tamaños son multiplicadores de esa letra (`GS !`): la mesa sale de hasta 8 veces.
 *   · Las rayas y el logo van como imagen (`GS v 0`): salen parejas en todas las marcas.
 *   · Antes de imprimir se apaga el modo chino (`FS .`): en las comanderas chinas, sin eso, las letras
 *     con tilde salen como ideogramas.
 *   · Las tildes van en la página de códigos 850 (`ESC t 2`, la misma en Epson y en las chinas). Si
 *     alguna impresora no la tiene, `codepage: 'ascii'` las saca («Clásica» → «Clasica»).
 */
import type { PaperWidth, PrintDoc, PrintJob, PrintLine, TextSize } from './doc'

/** Un dibujo de un bit por punto, como lo imprime la cabeza térmica: filas de bytes, el bit alto a la izquierda. */
export type Raster = {
  /** Ancho en puntos (múltiplo de 8). */
  width: number
  height: number
  /** `width / 8` bytes por fila. 1 = punto negro. */
  data: Uint8Array
}

export type Codepage = 'cp850' | 'ascii'

export type EscPosOptions = {
  codepage?: Codepage
  /** El logo ya pasado a puntos (`raster.ts`). Sin logo, el renglón `logo` no imprime nada. */
  logo?: Raster | null
  /** Cortar el papel al final de cada tique (las que no tienen cortador lo ignoran). */
  cut?: boolean
}

/** Columnas de la letra A y puntos que imprime la cabeza, según el rollo. */
export const COLUMNS: Readonly<Record<PaperWidth, number>> = { 80: 48, 58: 32 }
export const DOTS: Readonly<Record<PaperWidth, number>> = { 80: 576, 58: 384 }

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c
const LF = 0x0a

/** Ancho × alto de cada tamaño de letra, en veces la letra normal. */
const SIZE: Readonly<Record<TextSize, readonly [number, number]>> = {
  sm: [1, 1],
  md: [1, 1],
  lg: [1, 2],
  xl: [2, 2],
  xxl: [3, 3],
}

// ─── Texto ───────────────────────────────────────────────────────────────────

/** Las letras de la página 850 que se usan en castellano (y algunas más). */
const CP850: Readonly<Record<string, number>> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  ø: 0x9b,
  '£': 0x9c,
  Ø: 0x9d,
  '×': 0x9e,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  '¿': 0xa8,
  '®': 0xa9,
  '¬': 0xaa,
  '½': 0xab,
  '¼': 0xac,
  '¡': 0xad,
  '«': 0xae,
  '»': 0xaf,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  '©': 0xb8,
  '¢': 0xbd,
  ã: 0xc6,
  Ã: 0xc7,
  Ê: 0xd2,
  Ë: 0xd3,
  È: 0xd4,
  Í: 0xd6,
  Î: 0xd7,
  Ï: 0xd8,
  Ì: 0xde,
  Ó: 0xe0,
  ß: 0xe1,
  Ô: 0xe2,
  Ò: 0xe3,
  õ: 0xe4,
  Õ: 0xe5,
  Ú: 0xe9,
  Û: 0xea,
  Ù: 0xeb,
  '°': 0xf8,
  '·': 0xfa,
  '²': 0xfd,
}

/** Lo tipográfico que la impresora no tiene, por su equivalente común. */
const PLAIN: Readonly<Record<string, string>> = {
  '–': '-',
  '—': '-',
  '−': '-',
  '‐': '-',
  '…': '...',
  '“': '"',
  '”': '"',
  '„': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '•': '·',
  '\u00a0': ' ',
  '\u2009': ' ',
  '\u202f': ' ',
  '€': 'EUR',
}

/** Sin la página 850: «Ñandú» → «Nandu», «¿» se va, «·» → «-». */
const ASCII_ONLY: Readonly<Record<string, string>> = {
  '¿': '',
  '¡': '',
  '«': '"',
  '»': '"',
  '·': '-',
  '×': 'x',
  '°': 'o',
  ª: 'a',
  º: 'o',
}

/** Una letra a uno o más bytes de la impresora. Lo que no se puede imprimir (un emoji) se saltea. */
export function encodeText(text: string, codepage: Codepage = 'cp850'): number[] {
  const out: number[] = []
  for (const original of text) {
    const replaced = PLAIN[original]
    if (replaced !== undefined) {
      // Lo tipográfico pasa a lo común («…» → «...»), que ya se puede imprimir.
      out.push(...encodeText(replaced, codepage))
      continue
    }
    const char = original
    const code = char.codePointAt(0) ?? 0
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) {
      out.push(code)
      continue
    }
    if (codepage === 'cp850' && CP850[char] !== undefined) {
      out.push(CP850[char] as number)
      continue
    }
    const fallback = ASCII_ONLY[char]
    if (fallback !== undefined) {
      out.push(...encodeText(fallback, 'ascii'))
      continue
    }
    // Sin tilde: «á» → «a». Si igual no es ASCII (un emoji, un ideograma), no se imprime.
    const bare = char.normalize('NFD').replace(/\p{M}/gu, '')
    for (const rest of bare) {
      const restCode = rest.codePointAt(0) ?? 0
      if (restCode >= 0x20 && restCode < 0x7f) out.push(restCode)
    }
  }
  return out
}

/** Corta un texto en renglones de `width` letras, sin partir palabras salvo que no entren solas. */
export function wrap(text: string, width: number): string[] {
  const max = Math.max(1, Math.floor(width))
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word
      while (Array.from(rest).length > max) {
        // Una palabra que no entra sola se parte.
        if (current) {
          lines.push(current)
          current = ''
        }
        const chars = Array.from(rest)
        lines.push(chars.slice(0, max).join(''))
        rest = chars.slice(max).join('')
      }
      if (!rest) continue
      const candidate = current ? `${current} ${rest}` : rest
      if (Array.from(candidate).length <= max) current = candidate
      else {
        lines.push(current)
        current = rest
      }
    }
    lines.push(current)
  }
  return lines
}

// ─── Comandos ────────────────────────────────────────────────────────────────

class Bytes {
  private readonly chunks: number[] = []
  push(...bytes: number[]): this {
    for (const byte of bytes) this.chunks.push(byte & 0xff)
    return this
  }
  get length(): number {
    return this.chunks.length
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks)
  }
}

const align = (out: Bytes, where: 'left' | 'center' | 'right') =>
  out.push(ESC, 0x61, where === 'center' ? 1 : where === 'right' ? 2 : 0)
const bold = (out: Bytes, on: boolean) => out.push(ESC, 0x45, on ? 1 : 0)
const reverse = (out: Bytes, on: boolean) => out.push(GS, 0x42, on ? 1 : 0)
/** Ancho y alto de 1 a 8 veces la letra normal. */
const magnify = (out: Bytes, width: number, height: number) => {
  const w = Math.min(8, Math.max(1, Math.round(width))) - 1
  const h = Math.min(8, Math.max(1, Math.round(height))) - 1
  out.push(GS, 0x21, (w << 4) | h)
}
const feed = (out: Bytes, lines: number) => out.push(ESC, 0x64, Math.min(255, Math.max(0, lines)))

/** Un dibujo (`GS v 0`), centrado. */
function image(out: Bytes, raster: Raster) {
  const bytesPerRow = Math.ceil(raster.width / 8)
  align(out, 'center')
  // En tramos: algunas impresoras no aceptan dibujos muy altos de una sola vez.
  const STRIP = 256
  for (let top = 0; top < raster.height; top += STRIP) {
    const rows = Math.min(STRIP, raster.height - top)
    out.push(GS, 0x76, 0x30, 0, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8)
    const start = top * bytesPerRow
    for (let index = 0; index < rows * bytesPerRow; index++) {
      out.push(raster.data[start + index] ?? 0)
    }
  }
  align(out, 'left')
}

/** Una raya del ancho del papel, como dibujo (sale pareja en cualquier marca). */
export function ruleRaster(paper: PaperWidth, style: 'solid' | 'dashed' | 'double'): Raster {
  const width = DOTS[paper]
  const bytesPerRow = width / 8
  const pattern = style === 'double' ? [1, 1, 0, 0, 1, 1] : style === 'dashed' ? [1, 1] : [1, 1, 1]
  const data = new Uint8Array(bytesPerRow * pattern.length)
  pattern.forEach((on, row) => {
    for (let column = 0; column < bytesPerRow; column++) {
      // La rayada: 8 puntos sí, 8 no.
      const ink = on === 1 && (style !== 'dashed' || column % 2 === 0)
      data[row * bytesPerRow + column] = ink ? 0xff : 0
    }
  })
  return { width, height: pattern.length, data }
}

// ─── Cada renglón ────────────────────────────────────────────────────────────

type Ctx = { out: Bytes; paper: PaperWidth; codepage: Codepage; logo: Raster | null }

function text(ctx: Ctx, value: string) {
  ctx.out.push(...encodeText(value, ctx.codepage), LF)
}

/** Texto a un tamaño, cortado al ancho que entra a ese tamaño. */
function block(
  ctx: Ctx,
  value: string,
  opts: { size?: TextSize; bold?: boolean; align?: 'left' | 'center' | 'right'; indent?: number },
) {
  const [w, h] = SIZE[opts.size ?? 'md']
  const columns = Math.floor(COLUMNS[ctx.paper] / w)
  const indent = opts.indent ?? 0
  align(ctx.out, opts.align ?? 'left')
  bold(ctx.out, opts.bold === true)
  magnify(ctx.out, w, h)
  for (const line of wrap(value, columns - indent)) text(ctx, `${' '.repeat(indent)}${line}`)
  magnify(ctx.out, 1, 1)
  bold(ctx.out, false)
  align(ctx.out, 'left')
}

/** Una franja en negativo, de lado a lado del papel. */
function banner(ctx: Ctx, value: string) {
  const columns = Math.floor(COLUMNS[ctx.paper] / 2)
  bold(ctx.out, true)
  reverse(ctx.out, true)
  magnify(ctx.out, 2, 2)
  for (const line of wrap(value.toLocaleUpperCase('es-AR'), columns - 2)) {
    const free = columns - Array.from(line).length
    const left = Math.floor(free / 2)
    text(ctx, `${' '.repeat(left)}${line}${' '.repeat(free - left)}`)
  }
  magnify(ctx.out, 1, 1)
  reverse(ctx.out, false)
  bold(ctx.out, false)
}

/** El número de mesa: el más grande que entre en el papel, hasta 8 veces la letra. */
export function heroScale(textValue: string, paper: PaperWidth): number {
  const length = Math.max(1, Array.from(textValue).length)
  return Math.max(2, Math.min(8, Math.floor(COLUMNS[paper] / length)))
}

function hero(ctx: Ctx, caption: string | null, value: string) {
  if (caption)
    block(ctx, caption.toLocaleUpperCase('es-AR'), { size: 'xl', bold: true, align: 'center' })
  const scale = heroScale(value, ctx.paper)
  const columns = Math.floor(COLUMNS[ctx.paper] / scale)
  align(ctx.out, 'center')
  bold(ctx.out, true)
  magnify(ctx.out, scale, scale)
  for (const line of wrap(value.toLocaleUpperCase('es-AR'), columns)) text(ctx, line)
  magnify(ctx.out, 1, 1)
  bold(ctx.out, false)
  align(ctx.out, 'left')
}

function row(ctx: Ctx, left: string, right: string, size: TextSize | undefined, isBold: boolean) {
  const [w, h] = SIZE[size ?? 'md']
  const columns = Math.floor(COLUMNS[ctx.paper] / w)
  bold(ctx.out, isBold)
  magnify(ctx.out, w, h)
  const rightLength = Array.from(right).length
  const lefts = wrap(left, Math.max(1, columns - rightLength - 1))
  for (const [index, line] of lefts.entries()) {
    if (index < lefts.length - 1) {
      text(ctx, line)
      continue
    }
    const gap = Math.max(1, columns - Array.from(line).length - rightLength)
    text(ctx, `${line}${' '.repeat(gap)}${right}`)
  }
  magnify(ctx.out, 1, 1)
  bold(ctx.out, false)
}

function item(ctx: Ctx, line: Extract<PrintLine, { kind: 'item' }>) {
  const qty = line.qty
  const indent = Array.from(qty).length + 1
  const name = line.done ? `${line.name} (ya salió)` : line.name
  // La cantidad y el producto, en letra alta: se lee de lejos sin comer el ancho del papel.
  const [w, h] = SIZE.lg
  const columns = Math.floor(COLUMNS[ctx.paper] / w)
  bold(ctx.out, true)
  magnify(ctx.out, w, h)
  wrap(name.toLocaleUpperCase('es-AR'), columns - indent).forEach((part, index) => {
    text(ctx, `${index === 0 ? `${qty} ` : ' '.repeat(indent)}${part}`)
  })
  magnify(ctx.out, 1, 1)
  for (const mark of line.marks) block(ctx, `· ${mark}`, { bold: true, indent })
  for (const variant of line.variants) {
    block(ctx, `${variant.qty} ${variant.marks.join(', ')}`, { bold: true, indent })
  }
  bold(ctx.out, false)
}

function lineBytes(ctx: Ctx, line: PrintLine) {
  switch (line.kind) {
    case 'logo':
      if (ctx.logo) {
        image(ctx.out, ctx.logo)
        feed(ctx.out, 1)
      }
      return
    case 'hero':
      return hero(ctx, line.caption, line.text)
    case 'text':
      return block(ctx, line.upper ? line.text.toLocaleUpperCase('es-AR') : line.text, {
        size: line.size,
        bold: line.bold,
        align: line.align,
        indent: line.indent ? 3 : 0,
      })
    case 'row':
      return row(ctx, line.left, line.right, line.size, line.bold === true)
    case 'item':
      return item(ctx, line)
    case 'banner':
      return banner(ctx, line.text)
    case 'rule':
      image(ctx.out, ruleRaster(ctx.paper, line.style ?? 'solid'))
      ctx.out.push(LF)
      return
    case 'space':
      return feed(ctx.out, Math.max(1, Math.min(8, line.lines ?? 1)))
    case 'blank': {
      const columns = COLUMNS[ctx.paper]
      const label = `${line.label}: `
      feed(ctx.out, 2)
      return text(ctx, `${label}${'_'.repeat(Math.max(4, columns - Array.from(label).length))}`)
    }
  }
}

/** Prepara la impresora: lo de fábrica, sin modo chino, la página de las tildes y la letra A. */
function reset(ctx: Ctx) {
  ctx.out.push(ESC, 0x40)
  ctx.out.push(FS, 0x2e)
  if (ctx.codepage === 'cp850') ctx.out.push(ESC, 0x74, 2)
  ctx.out.push(ESC, 0x4d, 0)
  ctx.out.push(ESC, 0x32)
}

function docBytes(ctx: Ctx, doc: PrintDoc, cut: boolean) {
  for (const line of doc.lines) lineBytes(ctx, line)
  if (cut) {
    // Sube el papel hasta el cortador y corta (casi entero: el tique no se cae al piso).
    feed(ctx.out, 1)
    ctx.out.push(GS, 0x56, 0x42, 0)
  } else {
    feed(ctx.out, 5)
  }
}

/** Todo un trabajo (uno o más tiques, cada uno con su corte) en los bytes que entiende la impresora. */
export function escposJob(job: PrintJob, options: EscPosOptions = {}): Uint8Array {
  const ctx: Ctx = {
    out: new Bytes(),
    paper: job.paper,
    codepage: options.codepage ?? 'cp850',
    logo: options.logo ?? null,
  }
  reset(ctx)
  for (const doc of job.docs) docBytes(ctx, doc, options.cut !== false)
  return ctx.out.toUint8Array()
}
