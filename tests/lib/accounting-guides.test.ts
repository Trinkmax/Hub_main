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
import { ADM_SECTIONS, ADM_SETTINGS } from '@/components/administracion/nav/adm-nav-model'
import { LAUNCHER_ITEMS, LAUNCHER_TITLE } from '@/components/administracion/nav/launcher-items'
import {
  GUIDE_EVERYWHERE,
  GUIDE_GLOSSARY,
  GUIDE_LINKS,
  GUIDE_PAPER_CASES,
  GUIDE_PAPERS,
  GUIDE_PATHS,
  GUIDE_RECIPES,
  GUIDE_SECTIONS,
  type GuideOverview,
  type GuideTarget,
  guideRecipe,
  guideRoutine,
  LINK_IDS,
  linkAnchor,
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
} from '@/lib/accounting/guides'
import { onboardingState, parseOnboardingData } from '@/lib/accounting/onboarding'

/** Las pantallas que existen bajo `/<bar>/administracion` y a las que la guía manda. */
const KNOWN_ROUTES = [
  /^\/ajustes\?tab=(sas|medios|puntos-de-venta|impuestos)$/,
  /^\/compras(\?tab=comprobantes)?$/,
  /^\/compras\/nueva(\?tipo=nc|\?modo=pago)?$/,
  /^\/compras\/semana$/,
  /^\/gastos-fijos$/,
  /^\/cajas$/,
  /^\/sueldos$/,
  /^\/ventas\/cierre$/,
  /^\/importar\/(arca|mercado-pago|banco)$/,
  /^\/libros\/(cierres|mayor|asiento-manual)$/,
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
    out.push(r.title, r.hint, r.where, r.result, r.action.label, ...r.checks)
    for (const step of r.steps) out.push(step.text)
    for (const screen of r.screens) out.push(screen.title, screen.label)
    for (const t of r.troubles) out.push(t.problem, t.fix, t.link?.label ?? '')
  }
  for (const s of GUIDE_SECTIONS) out.push(s.title, s.what, ...s.tabs)
  for (const e of GUIDE_EVERYWHERE) out.push(e.title, e.what)
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
  out.push(...Object.values(RECIPE_FREQUENCY_LABEL))
  return out.filter((text) => text !== '')
}

describe('las recetas', () => {
  it('una por situación, en el orden de la guía, cada una con su ancla', () => {
    expect(GUIDE_RECIPES.map((r) => r.id)).toEqual([...RECIPE_IDS])
    expect(GUIDE_RECIPES).toHaveLength(RECIPE_IDS.length)
    expect(recipeAnchor('cierre')).toBe('receta-cierre')
    expect(new Set(GUIDE_RECIPES.map((r) => recipeAnchor(r.id))).size).toBe(RECIPE_IDS.length)
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

  it('dicen dónde se hace, con las palabras del menú', () => {
    const places = [
      '+ Cargar › ',
      'Arrastrá el archivo',
      ...ADM_SECTIONS.flatMap((section) =>
        (section.sub ?? []).map((tab) => `${section.label} › ${tab.label}`),
      ),
      'Contabilidad › Asiento manual',
      'Ajustes › Impuestos',
    ]
    for (const r of GUIDE_RECIPES) {
      expect(
        places.some((place) => r.where.startsWith(place)),
        `${r.id}: ${r.where}`,
      ).toBe(true)
    }
  })

  it('cada pantalla simulada acompaña a un paso, y ningún paso apunta a una que no existe', () => {
    for (const r of GUIDE_RECIPES) {
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
        expect(screen.label.length, `${r.id}: ${screen.title}`).toBeGreaterThan(30)
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
      expect(r.checks.length, r.id).toBeGreaterThanOrEqual(2)
      expect(r.troubles.length, r.id).toBeGreaterThanOrEqual(1)
      expect(r.result.trim(), r.id).not.toBe('')
      expect(r.action.label.trim(), r.id).not.toBe('')
      expectTarget(r.action.target, r.id)
      for (const t of r.troubles) {
        if (t.link) expectTarget({ kind: 'route', path: t.link.path }, `${r.id} · ${t.problem}`)
      }
    }
  })

  it('las que entran por «¿Qué cargás?» citan la opción con su nombre real', () => {
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

  it('las que suben un archivo traen su «¿Cómo lo bajo?» y dicen que se arrastra', () => {
    expect(guideRecipe('mercado-pago').howTo).toBe('mercado_pago')
    expect(guideRecipe('banco').howTo).toBe('banco')
    expect(guideRecipe('arca').howTo).toBe('mis_comprobantes')
    for (const id of ['mercado-pago', 'banco', 'arca'] as const) {
      expect(guideRecipe(id).where).toContain('Arrastrá el archivo')
    }
  })

  it('el reporte de Cobros y el impuesto al cheque se explican donde se tropieza con ellos', () => {
    const text = (id: (typeof RECIPE_IDS)[number]) =>
      guideRecipe(id)
        .steps.map((step) => step.text)
        .join(' ')
    expect(text('mercado-pago')).toContain('El de Cobros no sirve')
    expect(text('banco')).toContain('impuesto al cheque')
    expect(text('banco')).toContain('no se cuenta dos veces')
    expect(text('gasto')).toContain('impuesto al cheque se anota solo')
    expect(text('pagar-deuda')).toContain('impuesto al cheque se anota solo')
  })
})

describe('dónde está cada cosa', () => {
  it('las secciones se llaman y se abren como en el menú, con sus solapas', () => {
    const sections = GUIDE_SECTIONS.filter((section) => section.key !== 'ajustes')
    expect(sections.map((section) => section.title)).toEqual(ADM_SECTIONS.map((a) => a.label))
    expect(sections.map((section) => section.path)).toEqual(ADM_SECTIONS.map((a) => a.path))
    for (const section of sections) {
      const nav = ADM_SECTIONS.find((a) => a.label === section.title)
      expect(section.tabs, section.title).toEqual((nav?.sub ?? []).map((tab) => tab.label))
    }
    const settings = GUIDE_SECTIONS.find((section) => section.key === 'ajustes')
    expect(settings?.title).toBe(ADM_SETTINGS.label)
    expect(settings?.path).toBe(ADM_SETTINGS.path)
    expect(settings?.tabs).toEqual(ADM_SETTINGS.sub.map((tab) => tab.label))
  })

  it('lo que se hace desde cualquier pantalla: cargar, arrastrar y la foto por QR', () => {
    expect(GUIDE_EVERYWHERE.map((item) => item.title)).toEqual([
      '+ Cargar',
      'Arrastrar un archivo',
      'La foto por QR',
    ])
    // «+ Cargar» nombra las cuatro principales, con sus palabras.
    const daily = LAUNCHER_ITEMS.filter((item) => item.featured).map((item) => item.title)
    for (const title of daily) expect(GUIDE_EVERYWHERE[0]?.what, title).toContain(title)
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

  it('el camino de «Dónde lo cargo» son toques de verdad: «+ Cargar» y una opción del menú', () => {
    const cards = LAUNCHER_ITEMS.map((item) => item.title)
    for (const c of GUIDE_PAPER_CASES) {
      for (const route of c.where) {
        expect(route.steps.length, c.id).toBeGreaterThanOrEqual(3)
        expect(route.steps[0], c.id).toBe('+ Cargar')
        // Compra y Compra y pago son dos opciones distintas: un camino va por una sola.
        expect(cards, `${c.id}: ${route.steps[1]}`).toContain(route.steps[1])
        // Con dos caminos, cada uno dice cuándo vale.
        if (c.where.length > 1) expect(route.when?.trim(), c.id).toBeTruthy()
      }
    }
    // Lo que se toca al final es uno de los cuatro papeles; la nota de crédito, su salida.
    const papers = new Set([...GUIDE_PAPERS.map((p) => p.title), 'Es una nota de crédito'])
    for (const route of GUIDE_PAPER_CASES.flatMap((c) => c.where)) {
      expect(papers.has(route.steps[2] ?? ''), route.steps.join(' › ')).toBe(true)
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
    expect(limit('saldo-factura')).toMatch(/plata por cobrar todavía no se puede/i)
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
  compra: [
    `${ADM}/compras/nueva`,
    `${ADM}/compras/_lib/purchase-paper.ts`,
    `${ACCIONES}/gasto-papel.ts`,
    'lib/accounting/voucher-types.ts',
  ],
  foto: ['components/administracion/foto-qr'],
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
  comprobante: [
    `${ADM}/comprobantes/[id]/_components`,
    `${ADM}/comprobantes/_lib/document-story.ts`,
  ],
  gastosFijos: [`${ADM}/gastos-fijos/_components`, `${ADM}/gastos-fijos/_lib/planilla-words.ts`],
  sueldos: [`${ADM}/sueldos`],
  semana: [`${ADM}/compras/semana`],
  caja: [`${ADM}/cajas`],
  cierreMes: [`${ADM}/libros/cierres`],
  contabilidad: [`${ADM}/libros/_components/reimpute-form.tsx`, `${ADM}/libros/asiento-manual`],
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
  // El botón de más opciones de cada cuenta, en Caja.
  '⋯',
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

  it('los cuatro papeles se llaman como en la carga', () => {
    const source = sourceOf('compra')
    for (const paper of GUIDE_PAPERS) {
      expect(source.includes(paper.title), paper.title).toBe(true)
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
    expect(cited).toBeGreaterThan(50)
  })

  it('las cargas que más confunden dicen lo que dice la pantalla', () => {
    const steps = (id: (typeof RECIPE_IDS)[number]) =>
      guideRecipe(id)
        .steps.map((step) => step.text)
        .join(' ')
    // La Compra: sus campos, «La debo» y el botón.
    for (const label of [
      SCREEN_LABELS.compra.who,
      SCREEN_LABELS.compra.number,
      SCREEN_LABELS.compra.due,
      SCREEN_LABELS.compra.owe,
      SCREEN_LABELS.compra.save,
    ]) {
      expect(steps('compra'), label).toContain(`«${label}»`)
    }
    expect(steps('compra')).toContain(`«${SCREEN_LABELS.foto.scan}»`)
    expect(steps('gasto')).toContain(`«${SCREEN_LABELS.compra.savePaid}»`)
    expect(steps('gasto')).toContain(`«${SCREEN_LABELS.compra.from}»`)
    // Contar la caja: el título de la hoja y sus dos botones.
    expect(steps('contar-caja')).toContain(`«${SCREEN_LABELS.ajustar.title}»`)
    expect(steps('contar-caja')).toContain(`«${SCREEN_LABELS.ajustar.save}»`)
    expect(steps('contar-caja')).toContain(`«${SCREEN_LABELS.ajustar.matches}»`)
    // Sin factura: los dos caminos preguntan lo mismo y se contesta con la misma tarjeta.
    expect(steps('sin-factura')).toContain('«Compra y pago»')
    expect(steps('sin-factura')).toContain('«Compra»')
    expect(steps('sin-factura')).toContain(`«${SCREEN_LABELS.compra.paperNone}»`)
    // El gasto fijo se paga tildando su renglón.
    expect(steps('gasto-fijo')).toContain(`«${SCREEN_LABELS.gastosFijos.save}»`)
    expect(guideRecipe('gasto-fijo').action.target).toEqual({
      kind: 'route',
      path: '/gastos-fijos',
    })
    // Sueldos: lo que se toca en su renglón.
    expect(steps('sueldos')).toContain(`«${SCREEN_LABELS.sueldos.advance}»`)
    expect(steps('sueldos')).toContain(`«${SCREEN_LABELS.sueldos.accrue}»`)
    // El cierre de mes se llama igual en la receta y en la pantalla.
    expect(steps('fin-de-mes')).toContain(`Contabilidad › ${SCREEN_LABELS.cierreMes.title}`)
    expect(guideRecipe('fin-de-mes').where).toBe(`Contabilidad › ${SCREEN_LABELS.cierreMes.title}`)
  })

  it('no quedan los nombres de antes', () => {
    const stale = [
      /Pagué algo/,
      /Nuevo gasto/,
      /Me entró plata/,
      /Pago algo que debía/,
      /Cerrar el día/,
      /Conté la caja»/,
      /Libros › /,
      /Fin de mes\b(?! para)/,
      /Mover plata/,
      /Importar › /,
      /\bContadora\b/,
      /en camino/i,
    ]
    for (const text of allCopy()) {
      for (const re of stale) expect(re.test(text), `${re}: ${text}`).toBe(false)
    }
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
    const names = GUIDE_GLOSSARY.map((g) => g.name ?? g.idea)
    // Es el único glosario: «Cómo arrancar» manda acá, así que trae también sus palabras.
    for (const name of [
      'Asiento',
      'Plan de cuentas',
      'Crédito fiscal',
      'Punto de venta',
      'Constancia de inscripción',
      'Ingresos Brutos',
      'Mis Comprobantes',
      'CBU y CVU',
      'Retención',
      'Saldos iniciales',
      'ARCA',
      'CUIT',
    ]) {
      expect(names, name).toContain(name)
    }
  })

  it('los botones dicen adónde llevan: «Cierre de mes» no «cierra» nada con un toque', () => {
    expect(guideRecipe('fin-de-mes').action.label).toBe(`Ir a ${SCREEN_LABELS.cierreMes.title}`)
    for (const r of GUIDE_RECIPES) expect(r.action.label, r.id).not.toMatch(/^Cerrar /)
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
      text: 'Primero cargá lo que había en cada cuenta al arrancar',
    })
    // Con los saldos iniciales cargados, las mismas dos cajas sí son un «te toca».
    expect(routineStatus('treasury_check', overviewOf({ ...NEW_BAR, opening_done: true }))).toEqual(
      { state: 'todo', text: 'Faltan contar 2 cuentas este mes' },
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
  })

  it('un bar al día: todo «Al día»', () => {
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
    expect(routineStatus('treasury_check', o)?.text).toBe('Falta contar 1 cuenta este mes')
    expect(routineStatus('mp_weekly', o)).toEqual({ state: 'todo', text: 'Pasó más de una semana' })
    expect(routineStatus('month_close', o)).toEqual({
      state: 'todo',
      text: 'El mes pasado sigue abierto',
    })
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
      expect(group.rows.length, group.frequency).toBeGreaterThanOrEqual(3)
      for (const row of group.rows) {
        if (row.link.kind === 'recipe')
          expect(guideRecipe(row.link.recipe).id).toBe(row.link.recipe)
        else expectTarget({ kind: 'route', path: row.link.path }, row.key)
      }
    }
    expect(groups[0]?.rows[0]?.status?.state).toBe('todo')
    const rows = groups.flatMap((group) => group.rows.map((row) => row.key))
    expect(rows).toContain('plan')
    expect(rows).toContain('sueldos')
  })
})
