/**
 * Lector de XML mínimo y sin dependencias: anda igual en el navegador y en Node.
 *
 * Alcanza para lo que leemos nosotros: las respuestas SOAP de ARCA (WSAA, WSFE
 * y padrón, `lib/arca/*`) y las partes de un XLSX (`sharedStrings.xml`,
 * `sheetN.xml`, `workbook.xml` y sus `.rels`, `lib/imports/xlsx.ts`). No es un
 * parser de XML completo, a propósito:
 *
 * - **Ignora los prefijos de namespace.** `soap:Body`, `soapenv:Body` y `Body`
 *   se leen igual (`name === 'Body'`), y lo mismo con los nombres que se les
 *   piden a los helpers: `child(n, 'soap:Body')` busca `Body`. No resuelve URIs.
 * - **Nunca expande un DTD.** Un `<!DOCTYPE …>` se saltea entero y las
 *   entidades que declara quedan como texto literal: ni «billion laughs» ni XXE.
 * - Decodifica las cinco entidades de XML y las referencias numéricas
 *   (`&#225;`, `&#xE1;`). Cualquier otra (`&nbsp;`, `AT&T`) queda tal cual.
 * - Recibe texto ya decodificado: no mira el `encoding` de la declaración.
 *   Saca el BOM y pasa los finales de línea CRLF y CR a LF, como manda XML.
 * - Es estricto con la estructura (una etiqueta que no cierra, dos raíces,
 *   texto fuera de la raíz): la página HTML de error de un proxy tira
 *   `XmlParseError` en vez de devolver un árbol a medias.
 * - No usa recursión (ni al leer ni en los helpers) y corta a los
 *   `MAX_DEPTH` niveles de anidamiento.
 *
 * El espacio entre etiquetas (la sangría) no cuenta como texto: en
 * `<a>\n  <b>x</b>\n</a>`, `a.text` es `''` y `textOf(a)` es `'x'`. En un
 * elemento sin hijos el texto va entero, espacios incluidos
 * (`<t xml:space="preserve"> hola </t>` → `' hola '`).
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type XmlNode = {
  /** Nombre local, sin prefijo de namespace: `soap:Body` → `Body`. */
  readonly name: string
  /** El nombre tal cual vino en el XML (`soap:Body`). */
  readonly qname: string
  /**
   * Atributos con el nombre tal cual vino (`r:id`, `xml:space`, `xmlns:soap`)
   * y el valor ya decodificado. No hereda nada de `Object.prototype`: un
   * atributo que se llama `__proto__` o `constructor` es uno más. Para buscar
   * sin importar el prefijo: `attr`.
   */
  readonly attrs: Readonly<Record<string, string>>
  /** Los hijos que son elementos, en orden de documento. Los repetidos están todos. */
  readonly children: readonly XmlNode[]
  /**
   * El texto propio del elemento (no el de sus hijos): entidades decodificadas
   * y los CDATA tal cual, en orden. Si tiene hijos, los pedazos que son solo
   * espacio no cuentan. El texto de todo el subárbol lo da `textOf`.
   */
  readonly text: string
  /**
   * Solo en contenido mixto (texto que no es espacio entre elementos, como
   * `<p>Hola <b>che</b></p>`): texto y elementos en el orden real, para que
   * `textOf` lo respete. En SOAP y XLSX no aparece.
   */
  readonly mixed?: readonly (string | XmlNode)[]
}

/**
 * El XML no se pudo leer. El mensaje nombra etiquetas pero nunca copia el
 * texto del documento, que puede traer datos personales (un padrón, un Excel).
 */
export class XmlParseError extends Error {
  readonly code = 'xml_parse'
  /** Dónde se dio cuenta, contado sobre el texto sin BOM y con los CRLF ya pasados a LF. */
  readonly position: number
  constructor(reason: string, position: number) {
    super(`XML mal formado (posición ${position}): ${reason}`)
    this.name = 'XmlParseError'
    this.position = position
  }
}

/** Niveles de anidamiento que se aceptan. SOAP y XLSX no pasan de 15. */
export const MAX_DEPTH = 512

// ─── Lectura ─────────────────────────────────────────────────────────────────

/**
 * Prototipo vacío y sin nada detrás, del que heredan los atributos. Con
 * `Object.create(null)` pasaría lo mismo con `__proto__`, pero V8 guarda esos
 * objetos como diccionario: en una hoja de 150.000 celdas el árbol ocupa un
 * 30 % más (66 MB contra 46 MB).
 */
const ATTRS_PROTO: object = Object.freeze(Object.create(null))
const EMPTY_CHILDREN: readonly XmlNode[] = Object.freeze([])
const EMPTY_ATTRS: Readonly<Record<string, string>> = Object.freeze(Object.create(ATTRS_PROTO))

/** Lo que es «espacio» para XML: solo estos cuatro (un NBSP es texto). */
const NON_WS = /[^ \t\n\r]/
/** Normalización de atributos de XML: tab y salto de línea literales valen un espacio. */
const ATTR_WS = /[\t\n\r]/g

/** Un elemento abierto mientras se lee. */
type Frame = {
  readonly name: string
  readonly qname: string
  readonly attrs: Readonly<Record<string, string>>
  kids: XmlNode[] | null
  text: string
  nonWs: boolean
  /** Texto y elementos en orden; se arma recién cuando aparecen los dos. */
  seq: (string | XmlNode)[] | null
}

/**
 * Lee un documento y devuelve su elemento raíz. Tira `XmlParseError` si el
 * texto no es XML bien formado (o pasa los `MAX_DEPTH` niveles).
 */
export function parseXml(input: string): XmlNode {
  let src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  if (src.includes('\r')) src = src.replace(/\r\n?/g, '\n')
  const len = src.length
  const stack: Frame[] = []
  let root: XmlNode | null = null
  let pos = 0

  while (pos < len) {
    const lt = src.indexOf('<', pos)
    const textEnd = lt === -1 ? len : lt
    if (textEnd > pos) {
      const raw = src.slice(pos, textEnd)
      const top = stack[stack.length - 1]
      if (top) pushText(top, decodeEntities(raw))
      else if (NON_WS.test(raw)) throw new XmlParseError('hay texto fuera del elemento raíz', pos)
    }
    if (lt === -1) break

    const next = src.charCodeAt(lt + 1)
    if (next === 0x3f /* <? */) {
      // Declaración `<?xml …?>` o instrucción de procesamiento: se saltean.
      const close = src.indexOf('?>', lt + 2)
      if (close === -1) throw new XmlParseError('una instrucción <? … ?> no cierra', lt)
      pos = close + 2
    } else if (next === 0x21 /* <! */) {
      pos = readBang(src, lt, stack, root !== null)
    } else if (next === 0x2f /* </ */) {
      const nameEnd = readName(src, lt + 2)
      const qname = src.slice(lt + 2, nameEnd)
      const gt = skipWs(src, nameEnd)
      if (src.charCodeAt(gt) !== 0x3e) {
        throw new XmlParseError(`la etiqueta </${clip(qname)}> no cierra`, lt)
      }
      const frame = stack.pop()
      if (!frame) throw new XmlParseError(`sobra </${clip(qname)}>: no hay nada abierto`, lt)
      if (frame.qname !== qname) {
        throw new XmlParseError(`se esperaba </${clip(frame.qname)}> y vino </${clip(qname)}>`, lt)
      }
      const node = finish(frame)
      const parent = stack[stack.length - 1]
      if (parent) pushKid(parent, node)
      else root = node
      pos = gt + 1
    } else {
      if (root !== null && stack.length === 0) {
        throw new XmlParseError('hay más de un elemento raíz', lt)
      }
      if (stack.length >= MAX_DEPTH) {
        throw new XmlParseError(`hay más de ${MAX_DEPTH} niveles de anidamiento`, lt)
      }
      const tag = readStartTag(src, lt)
      const frame: Frame = {
        name: localName(tag.qname),
        qname: tag.qname,
        attrs: tag.attrs,
        kids: null,
        text: '',
        nonWs: false,
        seq: null,
      }
      if (tag.selfClosing) {
        const node = finish(frame)
        const parent = stack[stack.length - 1]
        if (parent) pushKid(parent, node)
        else root = node
      } else {
        stack.push(frame)
      }
      pos = tag.end
    }
  }

  const open = stack[stack.length - 1]
  if (open) throw new XmlParseError(`falta cerrar <${clip(open.qname)}>`, len)
  if (root === null) throw new XmlParseError('no hay ningún elemento', len)
  return root
}

/** `<!-- … -->`, `<![CDATA[ … ]]>` o `<!DOCTYPE …>`. Devuelve dónde sigue. */
function readBang(src: string, lt: number, stack: Frame[], afterRoot: boolean): number {
  if (src.startsWith('<!--', lt)) {
    const close = src.indexOf('-->', lt + 4)
    if (close === -1) throw new XmlParseError('un comentario <!-- no cierra', lt)
    return close + 3
  }
  if (src.startsWith('<![CDATA[', lt)) {
    const close = src.indexOf(']]>', lt + 9)
    if (close === -1) throw new XmlParseError('un <![CDATA[ no cierra', lt)
    const top = stack[stack.length - 1]
    if (!top) throw new XmlParseError('hay un CDATA fuera del elemento raíz', lt)
    pushText(top, src.slice(lt + 9, close))
    return close + 3
  }
  if (src.startsWith('<!DOCTYPE', lt)) {
    if (afterRoot || stack.length > 0) {
      throw new XmlParseError('el <!DOCTYPE va antes del elemento raíz', lt)
    }
    return skipDoctype(src, lt)
  }
  throw new XmlParseError('declaración <! … > no soportada', lt)
}

/**
 * Saltea un `<!DOCTYPE …>` con su subconjunto interno `[ … ]` sin interpretar
 * nada: las `<!ENTITY>` no se registran, así que nunca se expanden.
 */
function skipDoctype(src: string, start: number): number {
  let depth = 0
  let i = start + 9 // largo de '<!DOCTYPE'
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (c === 0x22 || c === 0x27) {
      // Un literal entre comillas puede traer `>` o `]`.
      const close = src.indexOf(c === 0x22 ? '"' : "'", i + 1)
      if (close === -1) break
      i = close + 1
      continue
    }
    if (c === 0x3c && src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4)
      if (close === -1) break
      i = close + 3
      continue
    }
    if (c === 0x5b) depth++
    else if (c === 0x5d) depth = Math.max(0, depth - 1)
    else if (c === 0x3e && depth === 0) return i + 1
    i++
  }
  throw new XmlParseError('el <!DOCTYPE no cierra', start)
}

type StartTag = {
  qname: string
  attrs: Readonly<Record<string, string>>
  selfClosing: boolean
  end: number
}

/** `<nombre atributo="valor" …>` o `<nombre … />`, desde el `<`. */
function readStartTag(src: string, lt: number): StartTag {
  const nameEnd = readName(src, lt + 1)
  const qname = src.slice(lt + 1, nameEnd)
  if (qname === '') throw new XmlParseError('hay un «<» suelto (en el texto va como &lt;)', lt)
  let attrs: Record<string, string> | null = null
  let i = nameEnd
  for (;;) {
    i = skipWs(src, i)
    const c = src.charCodeAt(i)
    if (c === 0x3e /* > */) {
      return { qname, attrs: attrs ?? EMPTY_ATTRS, selfClosing: false, end: i + 1 }
    }
    if (c === 0x2f /* / */) {
      if (src.charCodeAt(i + 1) !== 0x3e) {
        throw new XmlParseError(`en <${clip(qname)}> se esperaba «/>»`, i)
      }
      return { qname, attrs: attrs ?? EMPTY_ATTRS, selfClosing: true, end: i + 2 }
    }
    if (i >= src.length) throw new XmlParseError(`la etiqueta <${clip(qname)}> no cierra`, lt)

    const attrEnd = readName(src, i)
    const name = src.slice(i, attrEnd)
    if (name === '') throw new XmlParseError(`hay un carácter de más dentro de <${clip(qname)}>`, i)
    i = skipWs(src, attrEnd)
    if (src.charCodeAt(i) !== 0x3d /* = */) {
      throw new XmlParseError(`al atributo ${clip(name)} de <${clip(qname)}> le falta el valor`, i)
    }
    i = skipWs(src, i + 1)
    const quote = src[i]
    if (quote !== '"' && quote !== "'") {
      throw new XmlParseError(`el valor del atributo ${clip(name)} va entre comillas`, i)
    }
    const close = src.indexOf(quote, i + 1)
    if (close === -1) throw new XmlParseError(`el valor del atributo ${clip(name)} no cierra`, i)
    const raw = src.slice(i + 1, close)
    if (raw.includes('<')) {
      throw new XmlParseError(`el valor del atributo ${clip(name)} tiene un «<»`, i)
    }
    if (attrs === null) attrs = Object.create(ATTRS_PROTO) as Record<string, string>
    if (Object.hasOwn(attrs, name)) {
      throw new XmlParseError(`el atributo ${clip(name)} está repetido en <${clip(qname)}>`, i)
    }
    attrs[name] = decodeEntities(raw.replace(ATTR_WS, ' '))
    i = close + 1
  }
}

function pushText(frame: Frame, segment: string): void {
  if (segment === '') return
  if (!frame.nonWs && NON_WS.test(segment)) frame.nonWs = true
  if (frame.seq) frame.seq.push(segment)
  else if (frame.kids) frame.seq = [...frame.kids, segment]
  frame.text += segment
}

function pushKid(frame: Frame, node: XmlNode): void {
  if (frame.seq) frame.seq.push(node)
  else if (frame.text !== '') frame.seq = [frame.text, node]
  if (frame.kids) frame.kids.push(node)
  else frame.kids = [node]
}

function finish(f: Frame): XmlNode {
  const { name, qname, attrs } = f
  if (f.kids === null) return { name, qname, attrs, children: EMPTY_CHILDREN, text: f.text }
  // Con hijos y solo espacio entre ellos: es sangría, no texto.
  if (!f.nonWs) return { name, qname, attrs, children: f.kids, text: '' }
  return { name, qname, attrs, children: f.kids, text: f.text, mixed: f.seq ?? f.kids }
}

/** Hasta dónde llega un nombre (de etiqueta o de atributo) que empieza en `from`. */
function readName(src: string, from: number): number {
  let i = from
  while (i < src.length) {
    const c = src.charCodeAt(i)
    // espacio, tab, LF, CR, `/`, `>`, `=`, `<`, `"` y `'` cortan el nombre
    if (
      c === 0x20 ||
      c === 0x09 ||
      c === 0x0a ||
      c === 0x0d ||
      c === 0x2f ||
      c === 0x3e ||
      c === 0x3d ||
      c === 0x3c ||
      c === 0x22 ||
      c === 0x27
    ) {
      break
    }
    i++
  }
  return i
}

function skipWs(src: string, from: number): number {
  let i = from
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break
    i++
  }
  return i
}

/** `soap:Body` → `Body`. */
function localName(qname: string): string {
  const colon = qname.lastIndexOf(':')
  return colon === -1 || colon === qname.length - 1 ? qname : qname.slice(colon + 1)
}

/** Para los mensajes de error: un nombre absurdamente largo no infla el log. */
function clip(name: string): string {
  return name.length > 40 ? `${name.slice(0, 40)}…` : name
}

// ─── Navegación ──────────────────────────────────────────────────────────────
// Todos aceptan `null`/`undefined` para encadenar sin chequeos intermedios:
// `childrenNamed(child(det, 'Observaciones'), 'Obs')` da `[]` si no hay.

/** El primer hijo directo con ese nombre local, o `null`. */
export function child(n: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!n) return null
  const want = localName(name)
  for (const c of n.children) if (c.name === want) return c
  return null
}

/** Todos los hijos directos con ese nombre local (siempre un array, aunque haya uno solo). */
export function childrenNamed(n: XmlNode | null | undefined, name: string): XmlNode[] {
  if (!n) return []
  const want = localName(name)
  return n.children.filter((c) => c.name === want)
}

/**
 * Baja por hijos directos: `nodeAt(env, 'Body/FEDummyResponse/FEDummyResult')`.
 * El camino es relativo a `n` (no nombra a `n`) y toma el primero de cada nombre.
 */
export function nodeAt(n: XmlNode | null | undefined, path: string): XmlNode | null {
  let cur: XmlNode | null = n ?? null
  for (const step of path.split('/')) {
    if (step === '') continue
    cur = child(cur, step)
    if (!cur) return null
  }
  return cur
}

/**
 * El texto (`textOf`, sin recortar) del elemento en ese camino, o `null` si no
 * está. Un elemento vacío (`<CAE/>`) da `''`: distinto de que no venga.
 */
export function textAt(n: XmlNode | null | undefined, path: string): string | null {
  const node = nodeAt(n, path)
  return node ? textOf(node) : null
}

/** El primero con ese nombre local en `n` o sus descendientes, en orden de documento. */
export function findFirst(n: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!n) return null
  const want = localName(name)
  const stack: XmlNode[] = [n]
  let cur = stack.pop()
  while (cur) {
    if (cur.name === want) return cur
    pushChildrenReversed(stack, cur.children)
    cur = stack.pop()
  }
  return null
}

/** Todos los que tienen ese nombre local en `n` (incluido) y sus descendientes, en orden de documento. */
export function findAll(n: XmlNode | null | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = []
  if (!n) return out
  const want = localName(name)
  const stack: XmlNode[] = [n]
  let cur = stack.pop()
  while (cur) {
    if (cur.name === want) out.push(cur)
    pushChildrenReversed(stack, cur.children)
    cur = stack.pop()
  }
  return out
}

/**
 * Todo el texto del subárbol en orden de documento, con entidades decodificadas
 * y los CDATA tal cual. La sangría entre etiquetas no cuenta.
 */
export function textOf(n: XmlNode): string {
  if (n.children.length === 0) return n.text
  let out = ''
  const stack: (string | XmlNode)[] = [n]
  let cur = stack.pop()
  while (cur !== undefined) {
    if (typeof cur === 'string') out += cur
    else if (cur.children.length === 0) out += cur.text
    else pushChildrenReversed(stack, cur.mixed ?? cur.children)
    cur = stack.pop()
  }
  return out
}

function pushChildrenReversed<T>(stack: T[], items: readonly T[]): void {
  for (let k = items.length - 1; k >= 0; k--) {
    const item = items[k]
    if (item !== undefined) stack.push(item)
  }
}

/**
 * Un atributo, o `null`. Primero por el nombre exacto (`r:id`); si no está, por
 * el nombre local, porque el prefijo lo elige quien escribe el XML: `r:id`
 * encuentra `ns1:id` y `space` encuentra `xml:space`. Si se pide con prefijo,
 * solo mira atributos con prefijo. Las declaraciones `xmlns` solo salen con el
 * nombre exacto (`xmlns:r`).
 */
export function attr(n: XmlNode | null | undefined, name: string): string | null {
  if (!n) return null
  if (Object.hasOwn(n.attrs, name)) return n.attrs[name] ?? null
  const colon = name.lastIndexOf(':')
  const want = colon === -1 ? name : name.slice(colon + 1)
  for (const key of Object.keys(n.attrs)) {
    if (key === 'xmlns' || key.startsWith('xmlns:')) continue
    const k = key.lastIndexOf(':')
    if (colon !== -1 && k === -1) continue
    if ((k === -1 ? key : key.slice(k + 1)) === want) return n.attrs[key] ?? null
  }
  return null
}

// ─── Entidades ───────────────────────────────────────────────────────────────

const ENTITY = /&(?:#(\d+)|#x([\da-fA-F]+)|(amp|lt|gt|quot|apos));/g
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * Decodifica las cinco entidades de XML y las referencias numéricas, en una sola
 * pasada (`&amp;lt;` → `&lt;`, no `<`). Lo que no reconoce queda igual: una
 * entidad de HTML (`&nbsp;`), un `&` suelto o una referencia a un carácter que
 * XML no admite (`&#0;`). Sirve para un texto que vino escapado dos veces.
 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(
    ENTITY,
    (whole, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named !== undefined) return NAMED[named] ?? whole
      const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16)
      return isXmlChar(cp) ? String.fromCodePoint(cp) : whole
    },
  )
}

/** Los caracteres que XML 1.0 admite (`Char` de la especificación). */
function isXmlChar(cp: number): boolean {
  return (
    cp === 0x9 ||
    cp === 0xa ||
    cp === 0xd ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  )
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: son justamente los caracteres que XML 1.0 no admite, ni escapados
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/gu
const SPECIAL = /[&<>"'\t\n\r]/g
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;',
}

/**
 * Escapa un valor para meterlo en un XML, como texto o como valor de atributo
 * (sirve para los dos). Tab, LF y CR van como referencia numérica para volver
 * idénticos (en un atributo se leerían como espacio y un CR suelto se pierde).
 * Los caracteres que XML 1.0 no admite de ninguna forma (controles, surrogates
 * sueltos, U+FFFE/U+FFFF) se sacan: con ellos el documento no se puede leer.
 */
export function escapeXml(s: string): string {
  return s.replace(INVALID_XML_CHARS, '').replace(SPECIAL, (c) => ESCAPES[c] ?? c)
}
