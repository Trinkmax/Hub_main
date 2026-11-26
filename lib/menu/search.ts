/**
 * El buscador de la carta pública — PURO y testeado (`tests/lib/menu-search.test.ts`).
 *
 * Quien busca en la carta de un bar escribe apurado, con una mano y como habla: «hamburgesa», «birra»,
 * «fernet», «muzza». El buscador de antes comparaba el texto tal cual contra el nombre y la descripción,
 * y por eso «hamburguesa» no traía ninguna hamburguesa (se llaman «Clásica simple», «Bacon burger»…
 * y la palabra solo está en el nombre de la sección) ni «fernet» traía el «Branca y Cola».
 *
 * Este entiende:
 * - **dónde está cada cosa**: el nombre de la sección y del rubro también cuentan («pizza» trae todas
 *   las pizzas aunque se llamen «Especial»);
 * - **tildes, mayúsculas, plurales y signos** («Por*Hub», «ñoquis», «tés»);
 * - **lo que se va escribiendo** («mila» ya encuentra las milanesas);
 * - **errores de dedo** en el nombre, la sección y las etiquetas (una letra de más, de menos o cambiada);
 * - **cómo se dice en la barra** (`EXPANSIONS`): birra = cerveza, fernet = Branca, celíaco = sin TACC.
 *
 * Y ordena: primero lo que coincide en el nombre, después por etiqueta y sección, al final lo que solo
 * lo menciona en la descripción. Todas las palabras escritas tienen que aparecer en algún lado.
 */
import { type CartaRoot, foldText } from './carta'
import type { MenuItem } from './queries'

/** Con menos letras que esto no se busca (una sola letra trae media carta). */
export const MIN_QUERY_LENGTH = 2

type Token = {
  /** La palabra sin tildes ni mayúsculas, en singular (`stemToken`). */
  stem: string
  /** Dónde está en el texto original, para resaltarla. */
  start: number
  end: number
}

export type SearchEntry = {
  item: MenuItem
  rootId: string
  rootSlug: string
  sectionId: string
  sectionSlug: string
  /** «Comida › Hamburguesas», o solo «Postres» si la sección es el rubro. */
  where: string
  /** El orden de la carta, para desempatar. */
  order: number
  name: Token[]
  section: string[]
  tags: string[]
  body: string[]
}

/** Un lugar de la carta al que se puede ir desde el buscador: un rubro entero o una de sus secciones. */
export type SearchSection = {
  rootId: string
  rootSlug: string
  rootName: string
  /** `null`: el rubro entero. */
  sectionSlug: string | null
  title: string
  count: number
  tokens: string[]
}

export type SearchIndex = {
  entries: SearchEntry[]
  sections: SearchSection[]
}

export type ItemHit = {
  entry: SearchEntry
  score: number
  /** Tramos del nombre que coinciden con lo escrito: `[desde, hasta)`. */
  ranges: Array<[number, number]>
}

export type SearchResults = {
  /** Secciones cuyo nombre coincide: un atajo para ir a verlas enteras. */
  sections: SearchSection[]
  items: ItemHit[]
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

/**
 * La palabra en singular, a lo bruto: sin la «s» final y sin la «e» que deja un plural en «-es»
 * («especiales» → «especial»). Se aplica igual a la carta y a lo que se escribe, así que no importa si
 * de más acorta alguna («postre» → «postr»): de los dos lados queda igual.
 */
export function stemToken(token: string): string {
  let stem = token
  if (stem.length > 3 && stem.endsWith('s')) stem = stem.slice(0, -1)
  const previous = stem[stem.length - 2]
  if (stem.length > 5 && stem.endsWith('e') && previous !== undefined && !VOWELS.has(previous)) {
    stem = stem.slice(0, -1)
  }
  return stem
}

const COMBINING = /[̀-ͯ]/
const ALNUM = /[a-z0-9]/

/** Las palabras de un texto con su lugar en el original. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let current = ''
  let start = 0
  const flush = (end: number) => {
    if (current) tokens.push({ stem: stemToken(current), start, end })
    current = ''
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ''
    // Una tilde suelta (texto en NFD) es parte de la letra anterior, no corta la palabra.
    if (COMBINING.test(char)) continue
    const folded = char.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (folded.length === 1 && ALNUM.test(folded)) {
      if (!current) start = i
      current += folded
    } else {
      flush(i)
    }
  }
  flush(text.length)
  return tokens
}

const stems = (text: string): string[] => tokenize(text).map((token) => token.stem)

/** Palabras que no dicen nada en una búsqueda («tabla **de** quesos»). «sin» sí dice: «sin alcohol». */
const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'con',
  'y',
  'o',
  'a',
  'al',
  'en',
  'un',
  'una',
  'para',
  'por',
  'que',
])

/**
 * Cómo se dice en la barra. Va en un solo sentido: quien escribe «cerveza» quiere ver la Stella, pero
 * quien escribe «stella» no quiere ver todas las cervezas. Se escriben como se dicen; al cargar se
 * pasan a la forma en que se compara (sin tildes, en singular).
 */
const BEERS = [
  'chopp',
  'porrón',
  'lager',
  'ipa',
  'stout',
  'stella',
  'corona',
  'quilmes',
  'heineken',
  'andes',
  'patagonia',
  'imperial',
  'budweiser',
  'brahma',
  'schneider',
  'amstel',
]
const VERMOUTHS = ['carpano', 'gancia', 'cinzano', 'martini']
const WHISKIES = ['label', 'jack', 'johnnie', 'chivas']

const SPOKEN: Readonly<Record<string, ReadonlyArray<string>>> = {
  cerveza: ['birra', ...BEERS],
  birra: ['cerveza', ...BEERS],
  chopp: ['cerveza', 'birra'],
  porrón: ['cerveza', 'birra'],
  fernet: ['branca', 'fernandito'],
  fernandito: ['fernet', 'branca'],
  ferne: ['fernet', 'branca'],
  gaseosa: ['coca', 'cola', 'sprite', 'fanta', 'pepsi', 'schweppes', 'tónica', 'zero'],
  refresco: ['gaseosa', 'coca', 'cola', 'sprite', 'fanta', 'pepsi', 'schweppes'],
  coca: ['cola'],
  vino: [
    'malbec',
    'cabernet',
    'torrontés',
    'chardonnay',
    'syrah',
    'bonarda',
    'pinot',
    'merlot',
    'sauvignon',
    'espumante',
  ],
  espumante: ['champán', 'champagne', 'brut', 'chandon', 'baron', 'burbujas'],
  champán: ['espumante', 'champagne', 'brut'],
  champagne: ['espumante', 'champán', 'brut'],
  champaña: ['espumante', 'champán', 'champagne', 'brut'],
  café: [
    'espresso',
    'expreso',
    'cortado',
    'lágrima',
    'latte',
    'capuccino',
    'cappuccino',
    'capuchino',
    'americano',
    'lungo',
    'flat',
    'macchiato',
    'machiatto',
    'moca',
    'mocha',
    'ristretto',
    'jarrito',
    'submarino',
  ],
  cortado: ['macchiato', 'machiatto', 'lágrima', 'jarrito'],
  hamburguesa: ['burger', 'burguer', 'cheeseburger'],
  burger: ['hamburguesa'],
  burguer: ['hamburguesa', 'burger'],
  lomo: ['lomito'],
  lomito: ['lomo'],
  fritas: ['papas'],
  trago: ['cóctel', 'cocktail', 'aperitivo'],
  cóctel: ['trago', 'cocktail'],
  cocktail: ['trago', 'cóctel'],
  vegano: ['vegetariano', 'vegetariana', 'veggie'],
  vegana: ['vegetariano', 'vegetariana', 'veggie'],
  veggie: ['vegetariano', 'vegetariana', 'vegano'],
  vegetariano: ['veggie', 'vegano'],
  vegetariana: ['vegetariano', 'veggie'],
  celíaco: ['tacc', 'gluten'],
  celíaca: ['tacc', 'gluten'],
  gluten: ['tacc'],
  tacc: ['gluten'],
  postre: ['dulce', 'torta', 'flan', 'helado', 'chocotorta', 'panqueque', 'cheesecake', 'brownie'],
  dulce: ['postre', 'torta'],
  whisky: ['whiskey', ...WHISKIES],
  whiskey: ['whisky', ...WHISKIES],
  wisky: ['whisky', 'whiskey', ...WHISKIES],
  vermut: ['vermú', 'vermouth', ...VERMOUTHS],
  vermú: ['vermut', 'vermouth', ...VERMOUTHS],
  vermouth: ['vermut', 'vermú', ...VERMOUTHS],
  energizante: ['speed', 'monster'],
  jugo: ['licuado', 'exprimido', 'limonada', 'pomelada'],
  licuado: ['batido', 'smoothie', 'frappé'],
  batido: ['licuado', 'smoothie', 'frappé'],
  smoothie: ['licuado', 'batido', 'frappé'],
  sándwich: ['sánguche', 'tostado', 'lomito'],
  sánguche: ['sándwich', 'tostado', 'lomito'],
  desayuno: ['brunch', 'merienda', 'medialuna', 'tostadas'],
  merienda: ['desayuno', 'brunch', 'medialuna'],
  picada: ['tabla'],
  picar: ['tabla', 'picada', 'nachos', 'rabas', 'nuggets'],
  compartir: ['tabla', 'picada', 'combo'],
  pasta: ['tallarines', 'sorrentinos', 'ñoquis', 'ravioles', 'canelones', 'fideos', 'lasagna'],
  fideos: ['tallarines', 'pasta'],
}

const EXPANSIONS: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const map = new Map<string, string[]>()
  for (const [word, aliases] of Object.entries(SPOKEN)) {
    const key = stemToken(foldText(word))
    const list = map.get(key) ?? []
    for (const alias of aliases) {
      const stem = stemToken(foldText(alias))
      if (stem !== key && !list.includes(stem)) list.push(stem)
    }
    map.set(key, list)
  }
  return map
})()

/** Cuántas letras de diferencia se perdonan según el largo de lo escrito. */
function allowedEdits(length: number): number {
  if (length < 4) return 0
  return length < 8 ? 1 : 2
}

/**
 * Distancia de edición con trasposición (dos letras vecinas cambiadas de lugar cuentan como una), con
 * corte: devuelve `max + 1` apenas se sabe que la pasa.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous2: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (previous2[j - 2] ?? 0) + 1)
      }
      current[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    previous2 = previous
    previous = current
  }
  return previous[b.length] ?? max + 1
}

/** Qué tan bien coincide lo escrito con una palabra de la carta: de 0 (nada) a 1 (igual). */
function directQuality(query: string, word: string, fuzzy: boolean): number {
  if (query === word) return 1
  if (word.startsWith(query)) return 0.62 + 0.3 * (query.length / word.length)
  if (!fuzzy || query[0] !== word[0]) return 0
  const edits = allowedEdits(query.length)
  if (edits === 0) return 0
  if (editDistance(query, word, edits) <= edits) return 0.5
  // El error está en lo que ya se escribió de una palabra más larga («hamburges» → «hamburguesa»).
  if (query.length >= 5 && word.length > query.length) {
    if (editDistance(query, word.slice(0, query.length), 1) <= 1) return 0.42
    if (editDistance(query, word.slice(0, query.length + 1), 1) <= 1) return 0.42
  }
  return 0
}

/** Lo mismo, sumando cómo se dice en la barra (vale menos que la palabra tal cual). */
function fieldQuality(query: string, words: ReadonlyArray<string>, fuzzy: boolean): number {
  let best = 0
  for (const word of words) {
    const quality = directQuality(query, word, fuzzy)
    if (quality > best) best = quality
    if (best === 1) return 1
  }
  const expansions = EXPANSIONS.get(query)
  if (expansions && best < 0.6) {
    for (const alias of expansions) {
      for (const word of words) {
        if (word === alias) best = Math.max(best, 0.6)
        else if (alias.length >= 4 && word.startsWith(alias)) best = Math.max(best, 0.45)
      }
    }
  }
  return best
}

const WEIGHT = { name: 100, tags: 70, section: 60, body: 25 } as const

/** Las palabras de lo escrito que sirven para buscar. */
export function queryTokens(query: string): string[] {
  const all = stems(query)
  const meaningful = all.filter((token) => !STOPWORDS.has(token))
  return meaningful.length > 0 ? meaningful : all
}

/** Arma el índice una vez por carta (es barato: unas cuantas palabras por producto). */
export function buildSearchIndex(roots: ReadonlyArray<CartaRoot>): SearchIndex {
  const entries: SearchEntry[] = []
  const sections: SearchSection[] = []
  let order = 0
  for (const root of roots) {
    const rootStems = stems(root.name)
    sections.push({
      rootId: root.id,
      rootSlug: root.slug,
      rootName: root.name,
      sectionSlug: null,
      title: root.name,
      count: root.itemCount,
      tokens: rootStems,
    })
    for (const section of root.sections) {
      const whole = root.sections.length === 1
      const sameName = foldText(section.title) === foldText(root.name)
      const sectionStems = [...new Set([...stems(section.title), ...rootStems])]
      // Un rubro de una sola sección se ofrece una vez, entero.
      if (!whole) {
        sections.push({
          rootId: root.id,
          rootSlug: root.slug,
          rootName: root.name,
          sectionSlug: section.slug,
          title: section.title,
          count: section.items.length,
          tokens: stems(section.title),
        })
      }
      for (const item of section.items) {
        entries.push({
          item,
          rootId: root.id,
          rootSlug: root.slug,
          sectionId: section.id,
          sectionSlug: section.slug,
          where: sameName ? root.name : `${root.name} › ${section.title}`,
          order: order++,
          name: tokenize(item.name),
          section: sectionStems,
          tags: item.tags.flatMap((tag) => stems(tag.name)),
          body: item.description ? stems(item.description) : [],
        })
      }
    }
  }
  return { entries, sections }
}

function scoreEntry(entry: SearchEntry, tokens: ReadonlyArray<string>): ItemHit | null {
  const nameStems = entry.name.map((token) => token.stem)
  let score = 0
  let allInName = true
  const ranges: Array<[number, number]> = []

  for (const token of tokens) {
    const inName = fieldQuality(token, nameStems, true)
    const best = Math.max(
      WEIGHT.name * inName,
      WEIGHT.tags * fieldQuality(token, entry.tags, true),
      WEIGHT.section * fieldQuality(token, entry.section, true),
      // En la descripción no se perdonan errores: es mucho texto y aparecen parecidos por casualidad.
      WEIGHT.body * fieldQuality(token, entry.body, false),
    )
    if (best === 0) return null
    score += best
    if (inName === 0) allInName = false

    // Qué resaltar del nombre: las palabras que coinciden con lo escrito, tal cual.
    for (const word of entry.name) {
      const quality = directQuality(token, word.stem, true)
      if (quality === 0) continue
      const prefixOnly = word.stem !== token && word.stem.startsWith(token)
      ranges.push([
        word.start,
        prefixOnly ? Math.min(word.start + token.length, word.end) : word.end,
      ])
    }
  }

  if (allInName) score += 15
  const first = entry.name[0]?.stem
  const lead = tokens[0]
  if (first !== undefined && lead !== undefined && first.startsWith(lead)) score += 20
  return { entry, score, ranges: mergeRanges(ranges) }
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/**
 * Busca en la carta. Con una etiqueta elegida (`tagId`) se queda solo con lo que la lleva; con la
 * etiqueta y sin texto devuelve todo lo de esa etiqueta, en el orden de la carta.
 */
export function searchMenu(
  index: SearchIndex,
  query: string,
  options: { tagId?: string | null; limit?: number } = {},
): SearchResults {
  const { tagId = null, limit = 60 } = options
  const pool = tagId
    ? index.entries.filter((entry) => entry.item.tags.some((tag) => tag.id === tagId))
    : index.entries

  const tokens = queryTokens(query)
  const typed = foldText(query).replace(/ /g, '').length
  if (tokens.length === 0 || typed < MIN_QUERY_LENGTH) {
    return {
      sections: [],
      items: tagId ? pool.slice(0, limit).map((entry) => ({ entry, score: 0, ranges: [] })) : [],
    }
  }

  const items: ItemHit[] = []
  for (const entry of pool) {
    const hit = scoreEntry(entry, tokens)
    if (hit) items.push(hit)
  }
  items.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)

  // Secciones que se llaman como lo escrito: «piz» ofrece ir a «Pizza» entera.
  const sections = tagId
    ? []
    : index.sections.filter((section) =>
        tokens.every((token) => fieldQuality(token, section.tokens, true) >= 0.5),
      )

  return { sections: sections.slice(0, 4), items: items.slice(0, limit) }
}
