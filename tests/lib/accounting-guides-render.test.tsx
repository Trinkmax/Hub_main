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
  GUIDE_LINKS,
  GUIDE_RECIPES,
  GUIDE_STATIONS,
  type GuideOverview,
  guideRoutine,
  linkAnchor,
  recipeAnchor,
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

  it('el glosario dice la idea y, al lado, el nombre de contadora', () => {
    const t = text(renderToString(<GuideGlossary />))
    expect(t).toContain('Cómo queda en los libros · Asiento')
    expect(t).toContain('En camino · Por acreditar')
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
    expect(text(html)).toContain('Te toca · Faltan 2 cierres de la última semana')
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
    expect(t).toContain('Así se ve en Administración')
    expect(t).toContain('Puede verse distinto')
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
    expect(seen.size).toBeGreaterThanOrEqual(20)
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
})
