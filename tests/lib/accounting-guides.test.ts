/**
 * «Cómo se usa Administración» (rediseño de oct 2026): el contenido de la guía y el estado que
 * saca de lo que ya hay cargado. Acá se fijan las reglas de los textos (un paso es una oración
 * corta, cada receta lleva a una pantalla que existe, nada propio de un bar, todo queda en el
 * mismo libro) y la lógica del avance, que no se guarda en ningún lado.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNTING_ACTIONS, ACTION_TITLES } from '@/components/administracion/acciones/types'
import { LAUNCHER_ITEMS, LAUNCHER_TITLE } from '@/components/administracion/nav/launcher-items'
import {
  GUIDE_GLOSSARY,
  GUIDE_LINKS,
  GUIDE_PAPER_CASES,
  GUIDE_PAPERS,
  GUIDE_PATHS,
  GUIDE_RECIPES,
  GUIDE_STATIONS,
  type GuideOverview,
  type GuideTarget,
  guideRecipe,
  guideRoutine,
  LINK_IDS,
  linkAnchor,
  MONEY_POCKET_HINT,
  PAPER_FACT_IDS,
  PAPER_FACTS,
  PAPER_IDS,
  PAPERS_ANCHOR,
  RECIPE_FREQUENCY_LABEL,
  RECIPE_IDS,
  RECIPE_STEP_MAX_WORDS,
  recipeAnchor,
  recipeStatus,
  routineStatus,
  SCREEN_LABELS,
  type ScreenKey,
  STATION_IDS,
  stationStates,
} from '@/lib/accounting/guides'
import { onboardingState, parseOnboardingData } from '@/lib/accounting/onboarding'

/** Las pantallas que existen bajo `/<bar>/administracion` y a las que la guía manda. */
const KNOWN_ROUTES = [
  /^\/ajustes\?tab=(sas|medios|puntos-de-venta)$/,
  /^\/compras\?tab=(proveedores|comprobantes)$/,
  /^\/compras\/nueva(\?tipo=nc)?$/,
  /^\/gastos-fijos$/,
  /^\/ventas\/cierre$/,
  /^\/ventas\?tab=caja$/,
  /^\/importar\/(arca|mercado-pago|banco)$/,
  /^\/libros\/cierres$/,
]

function expectTarget(target: GuideTarget, where: string) {
  if (target.kind === 'sheet') {
    expect(ACCOUNTING_ACTIONS as readonly string[], where).toContain(target.sheet)
    return
  }
  expect(
    KNOWN_ROUTES.some((re) => re.test(target.path)),
    `${where}: ${target.path}`,
  ).toBe(true)
}

function words(text: string): number {
  return text.trim().split(/\s+/).length
}

/** Todo texto de la guía que ve la persona. */
function allCopy(): string[] {
  const out: string[] = []
  for (const r of GUIDE_RECIPES) {
    out.push(r.title, r.hint, r.result, r.action.label, ...r.checks)
    for (const step of r.steps) out.push(step.text)
    for (const screen of r.screens) out.push(screen.title, screen.label)
    for (const t of r.troubles) out.push(t.problem, t.fix, t.link?.label ?? '')
  }
  for (const s of GUIDE_STATIONS) out.push(s.title, s.what, s.movesText, s.action.label)
  for (const p of GUIDE_PAPERS) {
    out.push(p.title, p.lead, p.filter)
    for (const id of PAPER_FACT_IDS) out.push(p.facts[id].text)
  }
  for (const f of PAPER_FACTS) out.push(f.question)
  for (const c of GUIDE_PAPER_CASES) {
    out.push(c.title, c.action.label, ...c.result)
    for (const route of c.where) out.push(route.when ?? '', ...route.steps)
  }
  for (const l of GUIDE_LINKS) {
    out.push(...l.ends, l.when, l.what, l.where, l.ifNot, l.undo, l.limit ?? '')
  }
  for (const g of GUIDE_GLOSSARY) out.push(g.idea, g.name ?? '', g.meaning)
  for (const group of guideRoutine(null)) {
    out.push(group.title, group.hint, ...group.rows.map((row) => row.title))
  }
  out.push(...Object.values(RECIPE_FREQUENCY_LABEL), ...Object.values(MONEY_POCKET_HINT))
  return out.filter((text) => text !== '')
}

describe('las recetas', () => {
  it('una por situación, en el orden de la guía, cada una con su ancla', () => {
    expect(GUIDE_RECIPES.map((r) => r.id)).toEqual([...RECIPE_IDS])
    expect(GUIDE_RECIPES).toHaveLength(12)
    expect(recipeAnchor('cierre')).toBe('receta-cierre')
    expect(new Set(GUIDE_RECIPES.map((r) => recipeAnchor(r.id))).size).toBe(12)
    for (const id of RECIPE_IDS) expect(guideRecipe(id).id).toBe(id)
  })

  it('de 3 a 5 pasos, cada uno corto', () => {
    for (const r of GUIDE_RECIPES) {
      expect(r.steps.length, r.id).toBeGreaterThanOrEqual(3)
      expect(r.steps.length, r.id).toBeLessThanOrEqual(5)
      for (const step of r.steps) {
        expect(words(step.text), `${r.id}: ${step.text}`).toBeLessThanOrEqual(RECIPE_STEP_MAX_WORDS)
      }
    }
  })

  it('cada pantalla simulada acompaña a un paso, y ningún paso apunta a una que no existe', () => {
    for (const r of GUIDE_RECIPES) {
      expect(r.screens.length, r.id).toBeGreaterThanOrEqual(1)
      const used = new Set<number>()
      for (const step of r.steps) {
        if (step.screen === undefined) continue
        expect(step.screen, r.id).toBeGreaterThanOrEqual(0)
        expect(step.screen, r.id).toBeLessThan(r.screens.length)
        used.add(step.screen)
      }
      expect(used.size, `${r.id}: hay pantallas sin paso`).toBe(r.screens.length)
      for (const screen of r.screens) {
        // La descripción es lo único que recibe quien no ve el dibujo.
        expect(screen.label.length, `${r.id}: ${screen.title}`).toBeGreaterThan(40)
      }
    }
  })

  it('con una pantalla a la vista no queda un paso del medio sin resaltar', () => {
    // Si el paso 2 y el 4 muestran la misma pantalla, el 3 también pasa en esa pantalla: sin su
    // referencia quedaba apagado entre dos resaltados y no ofrecía «Ver pantalla».
    for (const r of GUIDE_RECIPES) {
      const screens = r.steps.map((step) => step.screen)
      screens.forEach((screen, at) => {
        if (screen === undefined) return
        const next = screens.indexOf(screen, at + 1)
        if (next === -1) return
        for (let between = at + 1; between < next; between++) {
          expect(screens[between], `${r.id}: paso ${between + 1}`).toBeDefined()
        }
      })
    }
  })

  it('traen «Chequeá que…», «Si algo sale mal», qué queda y un botón que lleva a algo real', () => {
    for (const r of GUIDE_RECIPES) {
      expect(r.checks, r.id).toHaveLength(3)
      expect(r.troubles.length, r.id).toBeGreaterThanOrEqual(3)
      expect(r.result.trim(), r.id).not.toBe('')
      expect(r.action.label.trim(), r.id).not.toBe('')
      expectTarget(r.action.target, r.id)
      for (const t of r.troubles) {
        if (t.link) expectTarget({ kind: 'route', path: t.link.path }, `${r.id} · ${t.problem}`)
      }
    }
  })

  it('las que entran por «¿Qué querés cargar?» citan la tarjeta con su nombre real', () => {
    const titles = new Map(LAUNCHER_ITEMS.map((item) => [item.key, item.title]))
    for (const r of GUIDE_RECIPES) {
      for (const screen of r.screens) {
        if (screen.scene.kind === 'launcher') {
          expect(titles.has(screen.scene.pick), `${r.id}: ${screen.scene.pick}`).toBe(true)
          expect(screen.scene.pick, r.id).toBe(r.launcher)
        }
      }
      if (!r.launcher) continue
      const title = titles.get(r.launcher)
      expect(title, r.id).toBeDefined()
      expect(
        r.steps.some((step) => step.text.includes(`«${title}»`)),
        `${r.id}: ningún paso nombra «${title}»`,
      ).toBe(true)
    }
  })

  it('las dos que suben un archivo traen su «¿Cómo lo bajo?»', () => {
    expect(guideRecipe('mercado-pago').howTo).toBe('mercado_pago')
    expect(guideRecipe('arca').howTo).toBe('mis_comprobantes')
  })
})

describe('el mapa', () => {
  it('cinco paradas, siempre en el mismo orden, cada una con su receta y su botón', () => {
    expect(GUIDE_STATIONS.map((s) => s.id)).toEqual([...STATION_IDS])
    expect(GUIDE_STATIONS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5])
    expect(GUIDE_STATIONS.map((s) => s.title)).toEqual([
      'Vendés',
      'Comprás y gastás',
      'Pagás',
      'Controlás la plata',
      'Fin de mes',
    ])
    for (const s of GUIDE_STATIONS) {
      expect(guideRecipe(s.recipe).id, s.id).toBe(s.recipe)
      expectTarget(s.action.target, s.id)
    }
  })

  it('dice qué mueve cada una: vender sube, pagar baja y fin de mes no mueve plata', () => {
    const moves = Object.fromEntries(
      GUIDE_STATIONS.map((s) => [s.id, s.moves.map((m) => `${m.pocket}:${m.direction}`)]),
    )
    expect(moves.vender).toEqual(['cajas:up', 'en_camino:up'])
    expect(moves.comprar).toEqual(['cajas:down', 'deuda:up'])
    expect(moves.pagar).toEqual(['deuda:down', 'cajas:down'])
    expect(moves.controlar).toEqual(['en_camino:down', 'cajas:up'])
    expect(moves['fin-de-mes']).toEqual([])
    for (const s of GUIDE_STATIONS) expect(s.movesText.trim(), s.id).not.toBe('')
  })
})

describe('con factura y sin factura', () => {
  it('los cuatro papeles contestan las cuatro preguntas', () => {
    expect(GUIDE_PAPERS.map((p) => p.id)).toEqual([...PAPER_IDS])
    expect(PAPER_FACTS.map((f) => f.id)).toEqual([...PAPER_FACT_IDS])
    for (const p of GUIDE_PAPERS) {
      for (const id of PAPER_FACT_IDS) expect(p.facts[id].text.trim(), `${p.id}.${id}`).not.toBe('')
    }
  })

  it('todo queda en los números; lo único que cambia es el IVA y el Libro IVA', () => {
    const answers = (fact: (typeof PAPER_FACT_IDS)[number]) =>
      GUIDE_PAPERS.map((p) => p.facts[fact].answer)
    // Un solo libro: los cuatro quedan registrados.
    expect(answers('your_numbers')).toEqual(['yes', 'yes', 'yes', 'yes'])
    // Solo la Factura A recupera el IVA.
    expect(answers('recover_vat')).toEqual(['yes', 'no', 'no', 'no'])
    // El tique entra al Libro IVA solo con comercio y número; el remito, nunca.
    expect(answers('vat_book')).toEqual(['yes', 'yes', 'depends', 'no'])
    // «Sin factura» es solo remito o nada: un tique cuenta como «con factura».
    expect(GUIDE_PAPERS.map((p) => p.filter)).toEqual([
      'Con factura',
      'Con factura',
      'Con factura',
      'Sin factura',
    ])
  })

  it('cada caso dice dónde se carga y lleva a una pantalla o una hoja que existe', () => {
    expect(GUIDE_PAPER_CASES.map((c) => c.id)).toEqual([
      'remito-contado',
      'remito-cuenta',
      'tique',
      'factura-bc',
      'factura-a',
      'nota-credito',
    ])
    for (const c of GUIDE_PAPER_CASES) {
      expect(c.where.length, c.id).toBeGreaterThanOrEqual(1)
      expect(c.result.length, c.id).toBeGreaterThanOrEqual(2)
      expectTarget(c.action.target, c.id)
      if (c.recipe) expect(guideRecipe(c.recipe).id).toBe(c.recipe)
    }
  })

  it('el camino de «Dónde lo cargo» son toques de verdad: «+ Cargar» y una tarjeta del lanzador', () => {
    const cards = LAUNCHER_ITEMS.map((item) => item.title)
    for (const c of GUIDE_PAPER_CASES) {
      for (const route of c.where) {
        expect(route.steps.length, c.id).toBeGreaterThanOrEqual(3)
        expect(route.steps[0], c.id).toBe('+ Cargar')
        // Nada de «Pagué algo recién, o lo pago después»: eso son dos tarjetas distintas.
        expect(cards, `${c.id}: ${route.steps[1]}`).toContain(route.steps[1])
        // Con dos caminos, cada uno dice cuándo vale.
        if (c.where.length > 1) expect(route.when?.trim(), c.id).toBeTruthy()
      }
    }
    // Lo que se paga después se decide en «¿Qué papel te dieron?»: ahí están los cuatro papeles
    // y, al pie, la salida para una nota de crédito.
    const later = GUIDE_PAPER_CASES.flatMap((c) => c.where).filter((route) =>
      route.steps.includes('Me llegó una factura o un remito y lo pago después'),
    )
    expect(later.length).toBeGreaterThanOrEqual(4)
    const answers = new Set([...GUIDE_PAPERS.map((p) => p.title), SCREEN_LABELS.compra.creditNote])
    for (const route of later) {
      const question = route.steps[2] ?? ''
      const asked = [SCREEN_LABELS.compra.paper, SCREEN_LABELS.compra.notPurchase].find((label) =>
        question.startsWith(label),
      )
      expect(asked, question).toBeDefined()
      // Lo que sigue a la pregunta es una tarjeta que existe, con su nombre de verdad.
      expect(answers.has(question.slice((asked ?? '').length).trim()), question).toBe(true)
    }
  })

  it('las tres partes de la página tienen su ancla (la portada lleva directo a cada una)', () => {
    expect(PAPERS_ANCHOR).toEqual({ papers: 'papeles', cases: 'casos', sales: 'ventas' })
  })
})

describe('cómo se vincula cada cosa', () => {
  it('nueve vínculos, cada uno con sus cuatro datos', () => {
    expect(GUIDE_LINKS.map((l) => l.id)).toEqual([...LINK_IDS])
    expect(GUIDE_LINKS).toHaveLength(9)
    expect(linkAnchor('compra-pago')).toBe('vinculo-compra-pago')
    for (const l of GUIDE_LINKS) {
      for (const key of ['what', 'where', 'ifNot', 'undo', 'when'] as const) {
        expect(l[key].trim(), `${l.id}.${key}`).not.toBe('')
      }
      if (l.recipe) expect(guideRecipe(l.recipe).id).toBe(l.recipe)
    }
  })

  it('dice lo que hoy no se puede', () => {
    const limit = (id: (typeof LINK_IDS)[number]) =>
      GUIDE_LINKS.find((l) => l.id === id)?.limit ?? ''
    // Un gasto fijo no se puede colgar de algo ya cargado.
    expect(limit('gasto-fijo')).toMatch(/no se puede vincular después/i)
    // En una línea importada solo existe «no la cargues».
    expect(limit('importado')).toMatch(/no podés decir «es este comprobante»/i)
    // Un pago ya se puede sacar de la factura equivocada sin anularlo: no es más un límite, es
    // cómo se deshace. Del lado de lo que te deben todavía no existe, y se dice.
    const undo = (id: (typeof LINK_IDS)[number]) => GUIDE_LINKS.find((l) => l.id === id)?.undo ?? ''
    expect(GUIDE_LINKS.find((l) => l.id === 'compra-pago')?.limit).toBeNull()
    expect(undo('compra-pago')).toContain(`«${SCREEN_LABELS.comprobante.separate}»`)
    expect(undo('saldo-factura')).toContain(`«${SCREEN_LABELS.comprobante.separate}»`)
    expect(limit('saldo-factura')).toMatch(/plata por cobrar todavía no existe/i)
    // Lo que se arma solo siempre no tiene nada que avisar.
    expect(GUIDE_LINKS.find((l) => l.id === 'libros')?.limit).toBeNull()
  })
})

// ─── Lo que la guía dibuja y cita existe en la pantalla de hoy ───────────────

const ADM = 'app/(manager)/[tenantSlug]/administracion'
const ACCIONES = 'components/administracion/acciones'

/** Dónde está escrita cada pantalla (archivos o carpetas, desde la raíz del repo). */
const SCREEN_SOURCES: Readonly<Record<ScreenKey, readonly string[]>> = {
  cierre: [`${ADM}/ventas/cierre`],
  // Lo que cambió de lugar con la tanda 2 de oct 2026 está sumado en cada pantalla: las piezas
  // de cada hoja (`*-piezas.tsx`), sus palabras (`*-vista.ts`, `*-paper.ts`, `review-copy.ts`) y
  // la planilla de gastos fijos, que dejó de ser una pestaña de Compras.
  gasto: [
    `${ACCIONES}/gasto-sheet.tsx`,
    `${ACCIONES}/gasto-papel.ts`,
    `${ACCIONES}/gasto-piezas.tsx`,
    `${ADM}/compras/_components/supplier-account.tsx`,
    `${ADM}/compras/_components/supplier-invoicing-ask.tsx`,
    `${ADM}/compras/_components/expense-target-picker.tsx`,
    'lib/accounting/server/saved-message.ts',
  ],
  compra: [
    `${ADM}/compras/nueva`,
    `${ADM}/compras/_lib/purchase-paper.ts`,
    `${ADM}/compras/_components/supplier-invoicing-ask.tsx`,
    `${ACCIONES}/gasto-papel.ts`,
    `${ACCIONES}/gasto-piezas.tsx`,
    'lib/accounting/voucher-types.ts',
  ],
  // `pay-target.ts` solo por «Un gasto fijo» (la salida de «¿No es a un proveedor?»).
  pagar: [
    `${ACCIONES}/pagar-sheet.tsx`,
    `${ACCIONES}/pagar-piezas.tsx`,
    `${ADM}/compras/_lib/pay-summary.ts`,
    `${ADM}/compras/_lib/pay-target.ts`,
  ],
  cobrar: [
    `${ACCIONES}/cobrar-sheet.tsx`,
    `${ACCIONES}/cobrar-piezas.tsx`,
    `${ACCIONES}/cobrar-cuenta.ts`,
  ],
  ajustar: [
    `${ACCIONES}/ajustar-sheet.tsx`,
    `${ACCIONES}/ajustar-vista.ts`,
    `${ACCIONES}/ajustar-piezas.tsx`,
  ],
  importar: [
    `${ADM}/importar`,
    'components/administracion/importar',
    'lib/imports/ui/labels.ts',
    'lib/imports/ui/inbox.ts',
    'lib/imports/ui/review-copy.ts',
  ],
  comprobante: [`${ADM}/comprobantes/[id]/_components`],
  gastosFijos: [
    `${ADM}/gastos-fijos/page.tsx`,
    `${ADM}/gastos-fijos/_components`,
    `${ADM}/gastos-fijos/_lib/planilla-words.ts`,
    `${ADM}/compras/_lib/recurring.ts`,
  ],
  proveedor: [`${ADM}/compras/proveedores`],
  cierreMes: [`${ADM}/libros/cierres`],
  ventas: [`${ADM}/ventas/page.tsx`, `${ADM}/ventas/_components`],
  resumen: [`${ADM}/_resumen`],
  aviso: ['components/administracion/quick-actions.tsx'],
  lanzador: ['components/administracion/nav/launcher.tsx'],
}

function readSource(path: string): string {
  const full = join(process.cwd(), path)
  if (!statSync(full).isDirectory()) return readFileSync(full, 'utf8')
  return readdirSync(full)
    .map((name) => join(path, name))
    .filter((child) => statSync(join(process.cwd(), child)).isDirectory() || /\.tsx?$/.test(child))
    .map(readSource)
    .join('\n')
}

const sourceOf = (screen: ScreenKey) => SCREEN_SOURCES[screen].map(readSource).join('\n')

/**
 * Los rótulos que una pantalla arma con una plantilla (no están escritos enteros en el código):
 * cada uno con el pedazo de código que lo arma. Si ese pedazo cambia, hay que mirar la guía.
 */
const BUILT_LABELS: ReadonlyArray<{ label: string; screen: ScreenKey; built: readonly RegExp[] }> =
  [
    // El botón de la compra: «Cargar compra · $ 84.000» (`purchaseSubmitLabel`).
    {
      label: 'Cargar compra · $ 84.000',
      screen: 'compra',
      built: [/: 'Cargar compra'/, /`\$\{verb\} · \$\{exactAmountText\(/],
    },
    // Los chips de «¿Cuándo vence?»: «En 7 días», «En 15 días», «En 30 días».
    { label: 'En 15 días', screen: 'compra', built: [/`En \$\{days\} días`/] },
    // «Cerrá septiembre» (el paso 2 del fin de mes) y su botón, «Cerrar septiembre».
    { label: 'Cerrá septiembre', screen: 'cierreMes', built: [/`Cerrá \$\{noun\}`/] },
    { label: 'Cerrar septiembre', screen: 'cierreMes', built: [/`Cerrar \$\{monthNoun\}`/] },
    {
      label: 'Cargar 3 movimientos',
      screen: 'importar',
      built: [/return `Cargar \$\{/, /unit: \['movimiento', 'movimientos'\]/],
    },
    // El «＋» es el ícono; el texto del botón es «Cargar».
    { label: '+ Cargar', screen: 'lanzador', built: [/<Plus\b/] },
  ]

/** Lo que va entre « » y no es un rótulo de una pantalla propia. */
const NOT_A_LABEL = new Set([
  // Nombres de ARCA y de Mercado Pago.
  'Mis Comprobantes',
  'Recibidos',
  'Emitidos',
  'Liquidaciones',
  // Una idea de la guía (está en el glosario), no un botón.
  'en camino',
  // Lo que la guía avisa que NO existe.
  'editar',
  'es este comprobante',
])

function quotes(text: string): string[] {
  return [...text.matchAll(/«([^»]+)»/g)].map((match) => match[1] ?? '')
}

describe('lo que la guía dibuja y cita existe en la pantalla de hoy', () => {
  it('cada rótulo que dibujan las maquetas sigue escrito en el código de su pantalla', () => {
    // Se juntan todos los que faltan: si una pantalla cambió varios nombres, se ven de una vez.
    const missing: string[] = []
    for (const screen of Object.keys(SCREEN_LABELS) as ScreenKey[]) {
      const source = sourceOf(screen)
      for (const [key, label] of Object.entries(SCREEN_LABELS[screen])) {
        if (!source.includes(label)) missing.push(`${screen}.${key}: «${label}»`)
      }
    }
    expect(missing).toEqual([])
  })

  it('los que se arman con una plantilla siguen armándose igual', () => {
    const missing: string[] = []
    for (const { label, screen, built } of BUILT_LABELS) {
      const source = sourceOf(screen)
      for (const re of built) if (!re.test(source)) missing.push(`«${label}»: ${re}`)
    }
    expect(missing).toEqual([])
  })

  it('las maquetas no usan otro nombre para los cuatro papeles que la carga del gasto', () => {
    const source = sourceOf('gasto')
    for (const paper of GUIDE_PAPERS) {
      expect(source.includes(`title: '${paper.title}'`), paper.title).toBe(true)
      expect(source.includes(paper.lead), paper.lead).toBe(true)
    }
  })

  it('toda cita entre « » es un rótulo real: de una pantalla, del lanzador o de otra receta', () => {
    const known = [
      LAUNCHER_TITLE,
      ...LAUNCHER_ITEMS.map((item) => item.title),
      ...Object.values(ACTION_TITLES),
      ...GUIDE_RECIPES.map((r) => r.title),
      ...Object.values(SCREEN_LABELS).flatMap((labels) => Object.values(labels)),
      ...BUILT_LABELS.map((entry) => entry.label),
      // Las cuatro tarjetas de papel (el test de arriba comprueba que la carga las llame igual).
      ...GUIDE_PAPERS.map((paper) => paper.title),
      // «Cómo arrancar» es la otra guía.
      'Cómo arrancar',
    ]
    const isKnown = (quote: string) => {
      if (NOT_A_LABEL.has(quote)) return true
      // «…lo pago después»: el final de un rótulo largo.
      if (quote.startsWith('…')) return known.some((label) => label.endsWith(quote.slice(1)))
      // «Es el mismo», «Guardar cierre»: el principio de un rótulo que sigue con un dato.
      return known.some((label) => label === quote || label.startsWith(quote))
    }
    let cited = 0
    for (const text of allCopy()) {
      for (const quote of quotes(text)) {
        cited += 1
        expect(isKnown(quote), `«${quote}» en: ${text}`).toBe(true)
      }
    }
    // Si esto baja mucho, alguien dejó de citar: las recetas nombran lo que se toca.
    expect(cited).toBeGreaterThan(60)
  })

  it('las cargas que más confunden dicen lo que dice la pantalla', () => {
    const steps = (id: 'compra' | 'contar-caja' | 'sin-factura' | 'fin-de-mes') =>
      guideRecipe(id)
        .steps.map((step) => step.text)
        .join(' ')
    // La compra que queda a pagar: se nombra la pantalla que se abre, sus preguntas y el botón
    // (con los nombres de `SCREEN_LABELS`, que son los que el test de arriba compara con ella).
    expect(steps('compra')).toContain(`«${SCREEN_LABELS.compra.title}»`)
    for (const label of [
      SCREEN_LABELS.compra.paper,
      SCREEN_LABELS.compra.amount,
      SCREEN_LABELS.compra.payWhen,
      SCREEN_LABELS.compra.payLater,
      SCREEN_LABELS.compra.save,
    ]) {
      expect(steps('compra'), label).toContain(`«${label}»`)
    }
    // El botón de la guía dice lo mismo que el título de la pantalla que abre.
    expect(guideRecipe('compra').action.label).toBe(SCREEN_LABELS.compra.title)
    // Contar la caja: el título de la hoja y sus dos botones.
    expect(steps('contar-caja')).toContain(`«${SCREEN_LABELS.ajustar.title}»`)
    expect(steps('contar-caja')).toContain(`«${SCREEN_LABELS.ajustar.save}»`)
    expect(steps('contar-caja')).toContain(`«${SCREEN_LABELS.ajustar.matches}»`)
    // Sin factura: los dos caminos preguntan lo mismo y se contesta con la misma tarjeta.
    const [paidNow, payLater] = guideRecipe('sin-factura').steps
    expect(paidNow?.text).toContain(`«${SCREEN_LABELS.gasto.paper}»`)
    expect(paidNow?.text).toContain(`«${SCREEN_LABELS.gasto.paperNone}»`)
    expect(payLater?.text).toContain(`«${SCREEN_LABELS.compra.paper}»`)
    expect(payLater?.text).toContain(`«${SCREEN_LABELS.compra.paperNone}»`)
    expect(SCREEN_LABELS.compra.paper).toBe(SCREEN_LABELS.gasto.paper)
    expect(SCREEN_LABELS.compra.paperNone).toBe(SCREEN_LABELS.gasto.paperNone)
    // El gasto fijo se paga desde su renglón, y la guía lo dice con el rótulo del botón.
    const fixed = guideRecipe('gasto-fijo')
    expect(fixed.steps[0]?.text).toContain(`«${SCREEN_LABELS.gastosFijos.pay}»`)
    expect(fixed.action.target).toEqual({ kind: 'route', path: '/gastos-fijos' })
    // El fin de mes se llama igual en la receta, en el mapa y en la pantalla.
    expect(steps('fin-de-mes')).toContain(`Libros › ${SCREEN_LABELS.cierreMes.title}`)
    expect(steps('fin-de-mes')).toContain(`«${SCREEN_LABELS.cierreMes.review}»`)
  })
})

describe('textos para cualquier bar, con un solo libro', () => {
  it('no nombran al bar, su CUIT ni su sistema de caja', () => {
    const banned = [/thinkeon/i, /\bhub\b/i]
    for (const text of allCopy()) {
      for (const re of banned) expect(re.test(text), text).toBe(false)
      expect(/\b\d{2}-\d{8}-\d\b/.test(text), text).toBe(false)
    }
  })

  it('nada queda «afuera»: ni otra palabra para sin factura, ni «ganancia»', () => {
    const banned = [
      /en negro/i,
      /en blanco/i,
      /\bganancia/i,
      /\bganaste/i,
      /fuera de los libros/i,
      /no (queda|figura|aparece) en los libros/i,
      /la contadora no (lo )?ve/i,
    ]
    for (const text of allCopy()) {
      for (const re of banned) expect(re.test(text), text).toBe(false)
    }
  })

  it('el glosario dice la idea primero y explica cada palabra', () => {
    expect(new Set(GUIDE_GLOSSARY.map((g) => g.idea)).size).toBe(GUIDE_GLOSSARY.length)
    for (const g of GUIDE_GLOSSARY) expect(g.meaning.trim(), g.idea).not.toBe('')
    const names = GUIDE_GLOSSARY.map((g) => g.name)
    for (const name of ['Asiento', 'Plan de cuentas', 'Crédito fiscal', 'Punto de venta']) {
      expect(names, name).toContain(name)
    }
  })

  it('las páginas de la guía cuelgan de /guias', () => {
    expect(GUIDE_PATHS.home).toBe('/guias')
    for (const path of [GUIDE_PATHS.daily, GUIDE_PATHS.invoice, GUIDE_PATHS.links]) {
      expect(path.startsWith('/guias/')).toBe(true)
    }
  })
})

// ─── El estado, con lo que hay cargado ───────────────────────────────────────

/** Un bar que recién arranca: sin CUIT, sin banco, un cierre sin cargar, libros de este mes. */
const NEW_BAR = {
  today: '2026-10-13',
  sas_missing: ['cuit', 'activity_start_date'],
  bank_with_cbu: false,
  wallet_with_cvu: false,
  sales_methods: 9,
  sales_points: 0,
  opening_done: false,
  partner_granted: true,
  accountant_added: false,
  arca: null,
  mp: null,
  imports: {},
  mc_prev_month_covered: false,
  recurring_active: 31,
  daily_close_missing: 1,
  treasuries_unchecked: 2,
  prev_month_closed: false,
  books_start_date: '2026-10-12',
  manual: [],
}

/** Un bar andando y al día. */
const UP_TO_DATE = {
  ...NEW_BAR,
  sas_missing: [],
  bank_with_cbu: true,
  wallet_with_cvu: true,
  opening_done: true,
  accountant_added: true,
  imports: {
    mp_release: { last_batch_at: '2026-10-10T12:00:00Z', posted_batches: 3, pending_review: 0 },
    bank_statement: { last_batch_at: '2026-10-09T12:00:00Z', posted_batches: 2, pending_review: 0 },
  },
  mc_prev_month_covered: true,
  daily_close_missing: 0,
  treasuries_unchecked: 0,
  prev_month_closed: true,
  books_start_date: '2026-06-01',
}

function overviewOf(report: Record<string, unknown>): GuideOverview {
  const data = parseOnboardingData(report)
  if (!data) throw new Error('No se pudo leer el reporte de prueba')
  return { data, state: onboardingState(data) }
}

describe('el estado de la rutina', () => {
  it('sin datos de la base no marca nada (la guía se ve igual)', () => {
    expect(routineStatus('daily_close', null)).toBeNull()
    const states = stationStates(null)
    expect(Object.values(states.byId)).toEqual([null, null, null, null, null])
    expect(states.current).toBeNull()
    expect(states.allClear).toBe(false)
    for (const group of guideRoutine(null)) {
      for (const row of group.rows) expect(row.status, row.key).toBeNull()
    }
  })

  it('un bar que recién arranca: le toca el cierre, y no le pide lo que no puede hacer', () => {
    const o = overviewOf(NEW_BAR)
    expect(routineStatus('daily_close', o)).toEqual({
      state: 'todo',
      text: 'Falta 1 cierre de la última semana',
    })
    // Sin saldos iniciales, contar una caja no es lo que toca: primero se dice cuánto hay
    // (lo pide el Resumen). Contar contra un saldo en cero cargaría un sobrante que no existe.
    expect(routineStatus('treasury_check', o)).toEqual({
      state: 'idle',
      text: 'Primero cargá lo que hay en cada caja',
    })
    // Con los saldos iniciales cargados, las mismas dos cajas sí son un «te toca».
    expect(routineStatus('treasury_check', overviewOf({ ...NEW_BAR, opening_done: true }))).toEqual(
      { state: 'todo', text: 'Faltan contar 2 cajas este mes' },
    )
    // Sin CUIT no se puede bajar nada de ARCA: no es un «te toca».
    expect(routineStatus('arca_monthly', o)).toEqual({
      state: 'idle',
      text: 'Primero cargá la CUIT de la empresa',
    })
    // Sin banco cargado, subir el extracto tampoco.
    expect(routineStatus('bank_weekly', o)).toEqual({
      state: 'idle',
      text: 'Cuando tengas un banco cargado',
    })
    expect(routineStatus('mp_weekly', o)).toEqual({
      state: 'idle',
      text: 'Todavía no subiste ninguno',
    })
    // Los libros arrancaron este mes: todavía no hay un mes para cerrar.
    expect(routineStatus('month_close', o)).toEqual({
      state: 'idle',
      text: 'Todavía no hay un mes para cerrar',
    })

    const states = stationStates(o)
    expect(states.current).toBe('vender')
    expect(states.allClear).toBe(false)
    // De comprar y de pagar la base no dice nada: son «cuando pasa».
    expect(states.byId.comprar).toBeNull()
    expect(states.byId.pagar).toBeNull()
    // Una sola parada marcada: el mapa de un bar nuevo no reparte «te toca».
    expect(states.byId.controlar?.state).toBe('idle')
    expect(states.byId['fin-de-mes']?.state).toBe('idle')
    expect(Object.values(states.byId).filter((status) => status?.state === 'todo')).toHaveLength(1)
  })

  it('un bar al día: todo «Al día» y ninguna parada marcada', () => {
    const o = overviewOf(UP_TO_DATE)
    for (const id of [
      'daily_close',
      'mp_weekly',
      'bank_weekly',
      'arca_monthly',
      'treasury_check',
      'month_close',
    ] as const) {
      expect(routineStatus(id, o), id).toEqual({ state: 'done', text: 'Al día' })
    }
    const states = stationStates(o)
    expect(states.current).toBeNull()
    expect(states.allClear).toBe(true)
  })

  it('los plurales y lo que queda viejo', () => {
    const o = overviewOf({
      ...UP_TO_DATE,
      daily_close_missing: 3,
      treasuries_unchecked: 1,
      prev_month_closed: false,
      imports: {
        mp_release: { last_batch_at: '2026-09-20T12:00:00Z', posted_batches: 3, pending_review: 0 },
        bank_statement: {
          last_batch_at: '2026-10-12T12:00:00Z',
          posted_batches: 2,
          pending_review: 1,
        },
      },
    })
    expect(routineStatus('daily_close', o)?.text).toBe('Faltan 3 cierres de la última semana')
    expect(routineStatus('treasury_check', o)?.text).toBe('Falta contar 1 caja este mes')
    expect(routineStatus('mp_weekly', o)).toEqual({ state: 'todo', text: 'Pasó más de una semana' })
    expect(routineStatus('month_close', o)).toEqual({
      state: 'todo',
      text: 'El mes pasado sigue abierto',
    })
    // El cierre va primero aunque también falte contar una caja.
    expect(stationStates(o).current).toBe('vender')
  })

  it('las compras de ARCA: antes del 11 todavía no se pueden bajar', () => {
    const pending = { ...UP_TO_DATE, mc_prev_month_covered: false }
    expect(routineStatus('arca_monthly', overviewOf({ ...pending, today: '2026-10-05' }))).toEqual({
      state: 'idle',
      text: 'Se baja del día 11 en adelante',
    })
    expect(routineStatus('arca_monthly', overviewOf({ ...pending, today: '2026-10-13' }))).toEqual({
      state: 'todo',
      text: 'Falta bajar el mes pasado',
    })
  })

  it('las recetas que son rutina toman ese mismo estado; las demás no dicen nada', () => {
    const o = overviewOf(NEW_BAR)
    expect(recipeStatus(guideRecipe('cierre'), o)?.state).toBe('todo')
    expect(recipeStatus(guideRecipe('contar-caja'), o)?.state).toBe('idle')
    expect(
      recipeStatus(guideRecipe('contar-caja'), overviewOf({ ...NEW_BAR, opening_done: true }))
        ?.state,
    ).toBe('todo')
    expect(recipeStatus(guideRecipe('arca'), o)?.state).toBe('idle')
    expect(recipeStatus(guideRecipe('gasto'), o)).toBeNull()
    expect(recipeStatus(guideRecipe('corregir'), o)).toBeNull()
  })

  it('la rutina: tres grupos, y cada renglón lleva a su receta o a su pantalla', () => {
    const groups = guideRoutine(overviewOf(NEW_BAR))
    expect(groups.map((g) => g.frequency)).toEqual(['daily', 'weekly', 'monthly'])
    for (const group of groups) {
      expect(group.rows.length, group.frequency).toBe(3)
      for (const row of group.rows) {
        if (row.link.kind === 'recipe')
          expect(guideRecipe(row.link.recipe).id).toBe(row.link.recipe)
        else expectTarget({ kind: 'route', path: row.link.path }, row.key)
      }
    }
    expect(groups[0]?.rows[0]?.status?.state).toBe('todo')
  })
})
