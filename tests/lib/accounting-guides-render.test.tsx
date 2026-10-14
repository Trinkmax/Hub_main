// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * La guía «Cómo se usa Administración» en pantalla (rediseño de oct 2026): el mapa de cinco
 * paradas, las recetas con su ancla y su pantalla simulada, los cuatro papeles y los vínculos.
 * Acá: que todo esté en el primer paint (anclas, links, descripciones de los dibujos), que la
 * contadora no vea ningún botón de carga, y que los dibujos no inventen datos de un bar.
 */

const ctx = vi.hoisted(() => ({
  value: {
    tenantSlug: 'bar',
    today: '2026-10-13',
    access: { read: true, write: true, admin: false },
    readOnly: false,
    openAction: () => {},
    closeAction: () => {},
  } as {
    tenantSlug: string
    today: string
    access: { read: boolean; write: boolean; admin: boolean }
    readOnly: boolean
    openAction: () => void
    closeAction: () => void
  } | null,
}))
// El contexto lo monta el layout de la sección junto con las hojas (que acá no hacen falta).
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccountingOptional: () => ctx.value,
  useAccounting: () => ctx.value,
}))
// Las mini guías «¿Cómo lo bajo?» tienen sus propios tests (`arca-guide-render`).
vi.mock('@/components/administracion/guias/onboarding/how-to-slot', () => ({
  HowToFor: ({ source }: { source: string }) =>
    createElement('div', { 'data-como-lo-bajo': source }),
}))

import {
  BigLinks,
  GuideGlossary,
  RecipeTiles,
  RoutinePanel,
} from '@/components/administracion/guias/uso/cover'
import { LinksDetail, LinksMap } from '@/components/administracion/guias/uso/links'
import { GuideScenePreview } from '@/components/administracion/guias/uso/mock-scenes'
import {
  OneBook,
  PaperCases,
  PapersCompare,
  SalesInvoicing,
} from '@/components/administracion/guias/uso/papers'
import { Recipes } from '@/components/administracion/guias/uso/recipes'
import { StationMap } from '@/components/administracion/guias/uso/station-map'
import {
  GUIDE_GLOSSARY,
  GUIDE_LINKS,
  GUIDE_PAPER_CASES,
  GUIDE_RECIPES,
  GUIDE_STATIONS,
  type GuideOverview,
  guideRoutine,
  linkAnchor,
  PAPERS_ANCHOR,
  recipeAnchor,
  SCREEN_LABELS,
  stationStates,
} from '@/lib/accounting/guides'
import { onboardingState, parseOnboardingData } from '@/lib/accounting/onboarding'

const BASE = '/bar/administracion'
const OWNER = ctx.value

afterEach(() => {
  ctx.value = OWNER
})

function text(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

function overview(patch: Record<string, unknown> = {}): GuideOverview {
  const data = parseOnboardingData({
    today: '2026-10-13',
    sas_missing: [],
    bank_with_cbu: true,
    wallet_with_cvu: true,
    sales_methods: 9,
    sales_points: 1,
    opening_done: true,
    partner_granted: true,
    accountant_added: true,
    arca: null,
    mp: null,
    imports: {},
    recurring_active: 4,
    daily_close_missing: 2,
    treasuries_unchecked: 0,
    prev_month_closed: true,
    books_start_date: '2026-06-01',
    manual: [],
    ...patch,
  })
  if (!data) throw new Error('No se pudo leer el reporte de prueba')
  return { data, state: onboardingState(data) }
}

/** Nada de un bar real, y nada que saque algo de los libros. */
function expectNeutral(html: string) {
  const t = text(html)
  for (const re of [
    /thinkeon/i,
    /\bhub\b/i,
    /en negro/i,
    /en blanco/i,
    /\bganancia/i,
    /fuera de los libros/i,
    /\b\d{2}-\d{8}-\d\b/,
  ]) {
    expect(re.test(t), String(re)).toBe(false)
  }
}

describe('el mapa de paradas', () => {
  it('las cinco, en orden, con qué mueve cada una y «Ver cómo» a su receta', () => {
    const html = renderToString(<StationMap base={BASE} states={stationStates(overview())} />)
    const t = text(html)
    const order = GUIDE_STATIONS.map((s) => t.indexOf(`Parada ${s.n}: ${s.title}`))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    for (const s of GUIDE_STATIONS) {
      expect(html).toContain(`href="${BASE}/guias/dia-a-dia#${recipeAnchor(s.recipe)}"`)
      expect(t).toContain(s.movesText)
    }
    // La dirección va en palabras, no solo en la flecha.
    expect(t).toContain('Sube: Cajas')
    expect(t).toContain('Baja: Lo que debés')
    expect(t).toContain('No mueve plata')
    expectNeutral(html)
  })

  it('marca la parada que te toca y le pone el botón principal', () => {
    const html = renderToString(<StationMap base={BASE} states={stationStates(overview())} />)
    const t = text(html)
    expect(t).toContain('Te toca')
    expect(t).toContain('Faltan 2 cierres de la última semana.')
    expect(html).toContain(`href="${BASE}/ventas/cierre"`)
    // Una sola parada dorada: la primera que te toca.
    expect(html.match(/bg-adm-gold px-4/g)).toHaveLength(1)
  })

  it('al día lo dice; sin datos se ve igual, sin marcas', () => {
    const clear = text(
      renderToString(
        <StationMap base={BASE} states={stationStates(overview({ daily_close_missing: 0 }))} />,
      ),
    )
    expect(clear).toContain('Estás al día')
    const blank = text(renderToString(<StationMap base={BASE} states={stationStates(null)} />))
    expect(blank).not.toContain('Te toca')
    expect(blank).not.toContain('Al día')
    expect(blank).toContain('Vendés')
  })

  it('parado (el celular), «qué es y qué mueve» se abre desde el título; viene abierto el que te toca', () => {
    const html = renderToString(<StationMap base={BASE} states={stationStates(overview())} />)
    const folds = html.match(/<details[^>]*>/g) ?? []
    expect(folds).toHaveLength(GUIDE_STATIONS.length)
    // Faltan cierres: «Vendés» es la que te toca y es la única abierta.
    expect(folds.filter((tag) => /\sopen(=""|\s|>)/.test(tag))).toHaveLength(1)
    const opened = html.split('<details').find((chunk) => /^[^>]*\sopen=""/.test(chunk)) ?? ''
    expect(text(`<details${opened.split('</details>')[0]}`)).toContain('Vendés')
    // Acostado y parado comparten el corte: el mapa entra acostado en una notebook.
    expect(html).toContain('@[54rem]:grid-cols-5')
    expect(html).not.toContain('@[60rem]')
    // Los botones cortos entran en la columna angosta.
    for (const s of GUIDE_STATIONS) expect(s.action.label.length, s.id).toBeLessThanOrEqual(16)
  })

  it('la contadora ve el mapa y «Ver cómo», sin ningún botón de carga', () => {
    ctx.value = OWNER ? { ...OWNER, readOnly: true } : null
    const html = renderToString(<StationMap base={BASE} states={stationStates(overview())} />)
    const t = text(html)
    expect(t).toContain('Ver cómo')
    for (const s of GUIDE_STATIONS) expect(t).not.toContain(s.action.label)
    expect(html).not.toContain('<button')
  })
})

describe('la portada', () => {
  it('«¿Qué pasó?»: las doce recetas, cada una a su paso a paso', () => {
    const html = renderToString(<RecipeTiles base={BASE} />)
    for (const r of GUIDE_RECIPES) {
      expect(text(html)).toContain(r.title)
      expect(html).toContain(`href="${BASE}/guias/dia-a-dia#${recipeAnchor(r.id)}"`)
    }
  })

  it('los dos accesos grandes y la rutina con su estado en palabras', () => {
    const links = renderToString(<BigLinks base={BASE} />)
    expect(links).toContain(`href="${BASE}/guias/con-y-sin-factura"`)
    expect(links).toContain(`href="${BASE}/guias/como-se-vincula"`)
    // Cada acceso trae tres dudas, y cada una lleva a una parte que existe en su página.
    const anchors = [...links.matchAll(/href="[^"#]*#([^"]+)"/g)].map((match) => match[1])
    expect(anchors).toHaveLength(6)
    const pages = renderToString(
      <>
        <PapersCompare />
        <PaperCases base={BASE} />
        <SalesInvoicing base={BASE} />
        <LinksDetail base={BASE} />
      </>,
    )
    for (const anchor of anchors) expect(pages, anchor).toContain(`id="${anchor}"`)
    expect(anchors).toEqual(
      expect.arrayContaining([...Object.values(PAPERS_ANCHOR), linkAnchor('compra-pago')]),
    )
    expect(text(links)).toContain('¿Dónde cargo un remito?')

    const routine = renderToString(<RoutinePanel base={BASE} groups={guideRoutine(overview())} />)
    const t = text(routine)
    expect(t).toContain('Todos los días')
    expect(t).toContain('Cada semana')
    expect(t).toContain('Cada mes')
    expect(t).toContain('Faltan 2 cierres de la última semana')
    expect(t).toContain('Al día')
    expect(routine).toContain(`href="${BASE}/guias/dia-a-dia#receta-cierre"`)
    expect(routine).toContain(`href="${BASE}/importar/banco"`)
  })

  it('el glosario dice la idea y, en su propio renglón, el nombre de contadora', () => {
    const html = renderToString(<GuideGlossary />)
    const t = text(html)
    expect(t).toContain('Cómo queda en los libros Para los contadores: Asiento')
    expect(t).toContain('En camino Para los contadores: Por acreditar')
    // Sin el «·» que quedaba colgando al final del renglón.
    expect(t).not.toMatch(/ · (Asiento|Retención)/)
    // En el celular viene plegado: el botón dice cuántas son.
    expect(t).toContain(`Ver las ${GUIDE_GLOSSARY.length} palabras`)
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/)
  })
})

describe('las recetas', () => {
  it('doce acordeones con su ancla; se abre la rutina que te toca', () => {
    const html = renderToString(<Recipes base={BASE} overview={overview()} />)
    for (const r of GUIDE_RECIPES) {
      expect(html).toContain(`id="${recipeAnchor(r.id)}"`)
      expect(text(html)).toContain(r.title)
    }
    // Faltan cierres: «Cerré la caja de ayer» viene abierta; las demás, cerradas.
    const open = html.match(/aria-expanded="true"/g) ?? []
    expect(open).toHaveLength(1)
    expect(html).toMatch(/id="receta-cierre-titulo"[^>]*aria-expanded="true"/)
    // «Te toca» se dice como en el mapa: una píldora ámbar y el detalle al lado.
    expect(text(html)).toContain('Te toca Faltan 2 cierres de la última semana')
    expect(html).toMatch(/data-tone="warn"[^>]*>(?:<[^>]+>)*[^<]*Te toca/)
    // El índice también lo marca en ámbar (antes iba en verde, igual que «Al día»).
    expect(html).toMatch(/bg-warning\/15[^"]*text-warning-text[^>]*>Te toca/)
  })

  it('«Al día» va en verde y «Te toca» en ámbar: lo hecho y lo pendiente no se confunden', () => {
    const html = renderToString(
      <Recipes base={BASE} overview={overview({ treasuries_unchecked: 2 })} />,
    )
    const pill = (word: string) =>
      html.match(new RegExp(`data-tone="(\\w+)"[^>]*>(?:<[^>]+>)*${word}`))
    expect(pill('Te toca')?.[1]).toBe('warn')
    // Con el banco y Mercado Pago sin subir nunca, ninguna rutina está «al día» salvo el mes.
    expect(pill('Al día')?.[1]).toBe('ok')
  })

  it('cada receta trae sus pasos, la pantalla descripta, «Chequeá que…» y «Si algo sale mal»', () => {
    const html = renderToString(<Recipes base={BASE} overview={null} />)
    const t = text(html)
    for (const r of GUIDE_RECIPES) {
      for (const step of r.steps) expect(t).toContain(step.text)
      for (const check of r.checks) expect(t).toContain(check)
      for (const trouble of r.troubles) expect(t).toContain(trouble.problem)
      expect(t).toContain(r.result)
      // La primera pantalla, como imagen con su descripción.
      const first = r.screens[0]
      expect(first, r.id).toBeDefined()
      if (first) expect(html).toContain(`aria-label="${first.label.replace(/"/g, '&quot;')}"`)
    }
    // El marco dice «Ejemplo» y nada más: los rótulos son los de la pantalla de hoy.
    expect(t).toContain('Así se ve')
    expect(t).toContain('Ejemplo')
    expect(t).not.toContain('Puede verse distinto')
    expect(html).toContain('data-como-lo-bajo="mercado_pago"')
    expect(html).toContain('data-como-lo-bajo="mis_comprobantes"')
    expectNeutral(html)
  })

  it('la contadora las lee sin «Hacerlo ahora»', () => {
    const owner = text(renderToString(<Recipes base={BASE} overview={null} />))
    // El botón va pegado a «Qué queda», al pie de cada receta.
    for (const r of GUIDE_RECIPES) {
      expect(owner, r.id).toContain(`${r.result} ${r.action.label}`)
    }
    ctx.value = OWNER ? { ...OWNER, readOnly: true } : null
    const reader = text(renderToString(<Recipes base={BASE} overview={null} />))
    for (const r of GUIDE_RECIPES) {
      expect(reader, r.id).toContain(r.title)
      // El rótulo del botón puede coincidir con una palabra de un paso: se mira el botón entero.
      expect(reader, r.id).not.toContain(`${r.result} ${r.action.label}`)
    }
  })

  it('las pantallas simuladas se dibujan todas y no inventan datos de un bar', () => {
    const seen = new Set<string>()
    for (const r of GUIDE_RECIPES) {
      for (const screen of r.screens) {
        const key = JSON.stringify(screen.scene)
        if (seen.has(key)) continue
        seen.add(key)
        const html = renderToString(<GuideScenePreview scene={screen.scene} />)
        // Es un dibujo: nada de adentro se puede enfocar ni tocar.
        expect(html, key).toContain('inert=""')
        expect(text(html).trim().length, key).toBeGreaterThan(20)
        expectNeutral(html)
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(26)
  })

  it('las pantallas de las cargas que más confunden dicen lo que dice la pantalla de hoy', () => {
    const draw = (scene: Parameters<typeof GuideScenePreview>[0]['scene']) =>
      text(renderToString(<GuideScenePreview scene={scene} />))
    const count = draw({ kind: 'count' })
    for (const label of [
      SCREEN_LABELS.ajustar.title,
      SCREEN_LABELS.ajustar.treasury,
      SCREEN_LABELS.ajustar.book,
      SCREEN_LABELS.ajustar.save,
    ]) {
      expect(count, label).toContain(label)
    }
    // El conteo: los tres renglones y el resultado en palabras (falta, y qué pasa con eso).
    for (const label of [
      SCREEN_LABELS.ajustar.counted,
      SCREEN_LABELS.ajustar.missing,
      SCREEN_LABELS.ajustar.shortage,
    ]) {
      expect(count, label).toContain(label)
    }
    // La compra, en dos mitades: a quién y qué papel; cuánto, cuándo le pagás y el botón.
    const invoice = draw({ kind: 'purchase', paper: 'factura', part: 'paper' })
    for (const label of [
      SCREEN_LABELS.compra.title,
      SCREEN_LABELS.compra.who,
      SCREEN_LABELS.compra.paper,
      SCREEN_LABELS.compra.number,
      SCREEN_LABELS.compra.notPurchase,
      SCREEN_LABELS.compra.creditNote,
    ]) {
      expect(invoice, label).toContain(label)
    }
    const pay = draw({ kind: 'purchase', paper: 'factura', part: 'pay' })
    for (const label of [
      SCREEN_LABELS.compra.amount,
      SCREEN_LABELS.compra.total,
      SCREEN_LABELS.compra.payWhen,
      SCREEN_LABELS.compra.payLater,
      SCREEN_LABELS.compra.paidNow,
      SCREEN_LABELS.compra.due,
      `${SCREEN_LABELS.compra.save} · $ 84.000`,
    ]) {
      expect(pay, label).toContain(label)
    }
    const remito = draw({ kind: 'purchase', paper: 'remito', part: 'paper' })
    expect(remito).toContain(SCREEN_LABELS.compra.paperNone)
    expect(remito).toContain(SCREEN_LABELS.compra.remito)
    expect(remito).not.toContain(SCREEN_LABELS.compra.number)
    // Pagar: primero a quién (lo más urgente arriba) y después qué.
    const who = draw({ kind: 'pay', part: 'who' })
    for (const label of [
      SCREEN_LABELS.pagar.who,
      SCREEN_LABELS.pagar.urgent,
      SCREEN_LABELS.pagar.notSupplier,
      SCREEN_LABELS.pagar.fixed,
    ]) {
      expect(who, label).toContain(label)
    }
    const what = draw({ kind: 'pay', part: 'what' })
    expect(what).toContain(SCREEN_LABELS.pagar.invoices)
    expect(what).toContain(SCREEN_LABELS.pagar.treasury)
    // El cobro: cuánto entró y a dónde, y después de qué ventas es.
    const amount = draw({ kind: 'collect', part: 'amount' })
    for (const label of [
      SCREEN_LABELS.cobrar.who,
      SCREEN_LABELS.cobrar.step,
      SCREEN_LABELS.cobrar.amount,
      SCREEN_LABELS.cobrar.into,
      SCREEN_LABELS.cobrar.day,
      `${SCREEN_LABELS.cobrar.save} · entraron`,
    ]) {
      expect(amount, label).toContain(label)
    }
    const sales = draw({ kind: 'collect', part: 'sales' })
    for (const label of [
      SCREEN_LABELS.cobrar.sales,
      SCREEN_LABELS.cobrar.pending,
      SCREEN_LABELS.cobrar.discounted,
      SCREEN_LABELS.cobrar.estimated,
      SCREEN_LABELS.cobrar.deductions,
    ]) {
      expect(sales, label).toContain(label)
    }
    // Gastos fijos: «Pagar» en el renglón, y después el mismo renglón tildado.
    const due = draw({ kind: 'fixed', state: 'due' })
    expect(due).toContain(SCREEN_LABELS.gastosFijos.pending)
    expect(due).toContain(SCREEN_LABELS.gastosFijos.pay)
    expect(due).toContain('cuota 2 de 6')
    const paid = draw({ kind: 'fixed', state: 'paid' })
    expect(paid).toContain(`${SCREEN_LABELS.gastosFijos.paid} 07/10`)
    expect(paid).not.toContain('Venció hace')
    // Las subidas y la revisión, con los nombres de «Importar».
    const upload = draw({ kind: 'import', source: 'arca', phase: 'upload' })
    for (const label of [
      SCREEN_LABELS.importar.titleArca,
      SCREEN_LABELS.importar.stepGetArca,
      SCREEN_LABELS.importar.stepUpload,
      SCREEN_LABELS.importar.dropArca,
      SCREEN_LABELS.importar.choose,
      SCREEN_LABELS.importar.stepReview,
    ]) {
      expect(upload, label).toContain(label)
    }
    const review = draw({ kind: 'import', source: 'arca', phase: 'review' })
    for (const label of [
      'Revisá las compras de septiembre',
      'Te falta contestar',
      SCREEN_LABELS.importar.sameOrOther,
      SCREEN_LABELS.importar.same,
      SCREEN_LABELS.importar.different,
      SCREEN_LABELS.importar.loaded,
    ]) {
      expect(review, label).toContain(label)
    }
    const mp = draw({ kind: 'import', source: 'mercado_pago', phase: 'review' })
    expect(mp).toContain('Listos para cargar')
    expect(mp).toContain(SCREEN_LABELS.importar.ready)
    expect(mp).toContain('Cargar 3 movimientos')
    // El fin de mes: los tres pasos y los cuatro renglones del primero.
    const month = draw({ kind: 'month-close' })
    for (const label of [
      SCREEN_LABELS.cierreMes.title,
      SCREEN_LABELS.cierreMes.review,
      SCREEN_LABELS.cierreMes.closes,
      SCREEN_LABELS.cierreMes.purchases,
      SCREEN_LABELS.cierreMes.money,
      SCREEN_LABELS.cierreMes.papers,
      'Cerrar septiembre',
      SCREEN_LABELS.cierreMes.send,
    ]) {
      expect(month, label).toContain(label)
    }
    const expense = draw({ kind: 'expense', focus: 'paper', paper: 'sin' })
    expect(expense).toContain(SCREEN_LABELS.gasto.amount)
    expect(expense).toContain(SCREEN_LABELS.gasto.remito)
    const ticket = draw({ kind: 'expense-ticket', paper: 'sin' })
    expect(ticket).toContain(`${SCREEN_LABELS.gasto.save} · $ 12.500`)
    expect(ticket).toContain(SCREEN_LABELS.gasto.noteNone)
  })
})

describe('con factura y sin factura', () => {
  it('los cuatro papeles, las cuatro preguntas y el libro único', () => {
    const html = renderToString(
      <>
        <PapersCompare />
        <OneBook base={BASE} />
      </>,
    )
    const t = text(html)
    for (const title of ['Factura A', 'Factura B o C', 'Tique', 'Remito o nada']) {
      expect(t).toContain(title)
    }
    expect(t).toContain('¿Recuperás el IVA?')
    expect(t).toContain('¿Queda en tus números?')
    expect(t).toContain('Todo queda en el mismo libro')
    expect(t).toContain('Cómo se trata cada cosa lo define la contadora')
    expect(html).toContain(`href="${BASE}/compras?tab=comprobantes"`)
    // «Con factura / Sin factura» va con su rótulo, en la grilla y en cada tarjeta del celular:
    // una vez por la fila de la grilla y una por cada uno de los cuatro papeles.
    expect(t.split('En Comprobantes figura como').length - 1).toBe(5)
    expectNeutral(html)
  })

  it('los casos con «Dónde lo cargo» y el lado de las ventas, rotulado como ejemplo', () => {
    const html = renderToString(
      <>
        <PaperCases base={BASE} />
        <SalesInvoicing base={BASE} />
      </>,
    )
    const t = text(html)
    expect(t).toContain('Me dieron un remito y pagué en el momento')
    expect(t).toContain('Dónde lo cargo:')
    // Con factura hay dos puertas, y cada una dice cuándo vale.
    expect(t).toContain('Dónde lo cargo · Si ya la pagaste:')
    expect(t).toContain('Si la pagás después:')
    // Cada paso del camino es un renglón de una lista, con su número para el celular.
    const steps = GUIDE_PAPER_CASES.flatMap((c) => c.where).flatMap((route) => route.steps)
    expect(html.match(/<li class="flex items-baseline gap-2/g)).toHaveLength(steps.length)
    expect(t).toContain('Me dieron una nota de crédito')
    expect(html).toContain(`href="${BASE}/compras/nueva?tipo=nc"`)
    expect(t).toContain('Ejemplo')
    expect(t).toContain('Venta sin factura')
    expect(html).toContain(`href="${BASE}/ajustes?tab=puntos-de-venta"`)
    expectNeutral(html)
  })

  it('la contadora no ve los botones de carga de los casos', () => {
    ctx.value = OWNER ? { ...OWNER, readOnly: true } : null
    const html = renderToString(<PaperCases base={BASE} />)
    expect(html).not.toContain('<button')
    expect(html).not.toContain(`href="${BASE}/compras/nueva`)
    expect(text(html)).toContain('Ver el paso a paso')
  })
})

describe('cómo se vincula cada cosa', () => {
  it('el dibujo lleva a cada vínculo, y cada uno trae sus cuatro datos', () => {
    const html = renderToString(
      <>
        <LinksMap />
        <LinksDetail base={BASE} />
      </>,
    )
    const t = text(html)
    for (const link of GUIDE_LINKS) {
      expect(html).toContain(`href="#${linkAnchor(link.id)}"`)
      expect(html).toContain(`id="${linkAnchor(link.id)}"`)
      expect(t).toContain(link.what)
      expect(t).toContain(link.undo)
    }
    for (const label of ['Qué es', 'Dónde se hace', 'Qué pasa si no', 'Cómo se deshace']) {
      expect(t).toContain(label)
    }
    expect(t).toContain('Se une solo')
    expect(t).toContain('Lo unís vos')
    // Lo que hoy no se puede, dicho.
    expect(t).toContain('Hoy no se puede vincular después.')
    expectNeutral(html)
  })

  it('al tocar una unión, su bloque queda marcado; en el celular lo de consulta va plegado', () => {
    const html = renderToString(<LinksDetail base={BASE} />)
    const blocks = html.match(/<section id="vinculo-[^"]+"[^>]*>/g) ?? []
    expect(blocks).toHaveLength(GUIDE_LINKS.length)
    for (const block of blocks) {
      expect(block).toContain('target:ring-1')
      expect(block).toContain('scroll-mt-20')
    }
    // Un plegable por unión, con los tres datos de consulta.
    const folds = html.match(/<button[^>]*aria-expanded="false"[^>]*>/g) ?? []
    expect(folds).toHaveLength(GUIDE_LINKS.length)
    expect(text(html)).toContain('Dónde se hace, qué pasa si no y cómo se deshace')
  })
})
