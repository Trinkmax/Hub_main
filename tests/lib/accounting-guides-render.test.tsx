// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * La guía «Cómo se usa Administración» en pantalla: la portada en planillas, las recetas con su
 * ancla y su pantalla simulada, los cuatro papeles y los vínculos.
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
  GuideGlossary,
  RecipeTable,
  RoutineTable,
  SectionsTable,
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
import {
  GUIDE_GLOSSARY,
  GUIDE_LINKS,
  GUIDE_PAPER_CASES,
  GUIDE_RECIPES,
  GUIDE_SECTIONS,
  type GuideOverview,
  guideRoutine,
  linkAnchor,
  recipeAnchor,
  SCREEN_LABELS,
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

describe('la portada', () => {
  it('«¿Qué pasó?»: una planilla con cada situación, dónde se carga y su paso a paso', () => {
    const html = renderToString(<RecipeTable base={BASE} />)
    const t = text(html)
    for (const head of ['Situación', 'Dónde', 'Cuándo']) expect(html).toContain(`>${head}</th>`)
    for (const r of GUIDE_RECIPES) {
      expect(t).toContain(r.title)
      expect(t).toContain(r.where)
      expect(html).toContain(`href="${BASE}/guias/dia-a-dia#${recipeAnchor(r.id)}"`)
    }
    // Sin tarjetas: es una tabla.
    expect(html).toContain('<table')
    expectNeutral(html)
  })

  it('la rutina con su estado en palabras', () => {
    const routine = renderToString(<RoutineTable base={BASE} groups={guideRoutine(overview())} />)
    const t = text(routine)
    expect(t).toContain('Todos los días')
    expect(t).toContain('Cada semana')
    expect(t).toContain('Cada mes')
    expect(t).toContain('Faltan 2 cierres de la última semana')
    expect(t).toContain('Al día')
    expect(routine).toContain(`href="${BASE}/guias/dia-a-dia#receta-cierre"`)
    expect(routine).toContain(`href="${BASE}/guias/dia-a-dia#receta-banco"`)
    expect(routine).toContain(`href="${BASE}/guias/dia-a-dia#receta-plan-semana"`)
    expect(routine).toContain('id="rutina"')
  })

  it('sin datos de la base, la rutina se ve igual, sin marcas', () => {
    const t = text(renderToString(<RoutineTable base={BASE} groups={guideRoutine(null)} />))
    expect(t).not.toContain('Al día')
    expect(t).toContain('Subir el reporte de Mercado Pago')
  })

  it('dónde está cada cosa: las secciones del menú, con sus solapas', () => {
    const html = renderToString(<SectionsTable base={BASE} />)
    const t = text(html)
    for (const section of GUIDE_SECTIONS) {
      expect(t).toContain(section.title)
      for (const tab of section.tabs) expect(t).toContain(tab)
      expect(html).toContain(`href="${BASE}${section.path}"`)
    }
    expect(t).toContain('Arrastrar un archivo')
    expect(t).toContain('La foto por QR')
    expect(t).toContain('Ajustes')
  })

  it('el glosario dice la idea y, en su propio renglón, el nombre de contadora', () => {
    const html = renderToString(<GuideGlossary />)
    const t = text(html)
    expect(t).toContain('Cómo queda en los libros Para los contadores: Asiento')
    expect(t).toContain('Por cobrar Para los contadores: Cuentas a cobrar')
    expect(t).toContain('Cambiarle la cuenta a un renglón Para los contadores: Reimputar')
    expect(t).toContain('Impuesto al cheque Para los contadores: Ley 25.413')
    // Sin el «·» que quedaba colgando al final del renglón.
    expect(t).not.toMatch(/ · (Asiento|Retención)/)
    // Plegado, para que la portada sea corta, y con su ancla (la Puesta en marcha manda acá).
    expect(html).toMatch(/<details id="glosario"/)
    expect(html).not.toMatch(/<details id="glosario"[^>]*\sopen/)
    expect(GUIDE_GLOSSARY.every((entry) => t.includes(entry.meaning))).toBe(true)
  })
})

describe('las recetas', () => {
  it('un acordeón por receta, con su ancla; se abre la rutina que te toca', () => {
    const html = renderToString(<Recipes base={BASE} overview={overview()} />)
    for (const r of GUIDE_RECIPES) {
      expect(html).toContain(`id="${recipeAnchor(r.id)}"`)
      expect(text(html)).toContain(r.title)
    }
    // Faltan cierres: «Cerré la caja de ayer» viene abierta; las demás, cerradas.
    const open = html.match(/aria-expanded="true"/g) ?? []
    expect(open).toHaveLength(1)
    expect(html).toMatch(/id="receta-cierre-titulo"[^>]*aria-expanded="true"/)
    // «Te toca» es una píldora ámbar y el detalle al lado.
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
      // La primera pantalla, si tiene, como imagen con su descripción.
      const first = r.screens[0]
      if (first) expect(html).toContain(`aria-label="${first.label.replace(/"/g, '&quot;')}"`)
    }
    // El marco dice «Ejemplo» y nada más: los rótulos son los de la pantalla de hoy.
    expect(t).toContain('Así se ve')
    expect(t).toContain('Ejemplo')
    expect(t).not.toContain('Puede verse distinto')
    expect(html).toContain('data-como-lo-bajo="mercado_pago"')
    expect(html).toContain('data-como-lo-bajo="banco"')
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

  it('la píldora elegida de contar la caja es verde', () => {
    const count = renderToString(<GuideScenePreview scene={{ kind: 'count' }} />)
    expect(count).toContain('border-primary bg-primary text-primary-foreground')
    expect(count).not.toContain('bg-foreground text-background')
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
    expect(seen.size).toBeGreaterThanOrEqual(10)
  })

  it('el menú de «+ Cargar» dibuja las opciones de verdad y marca la que toca', () => {
    const draw = (pick: 'compra' | 'sueldo') =>
      renderToString(<GuideScenePreview scene={{ kind: 'launcher', pick }} />)
    const t = text(draw('compra'))
    expect(t).toContain('¿Qué cargás?')
    for (const title of [
      'Compra',
      'Compra y pago',
      'Pago',
      'Cierre del día',
      'Adelanto o sueldo',
    ]) {
      expect(t).toContain(title)
    }
    expect(t).toContain('Tocá acá')
    // Vale igual para una de la fila chica.
    expect(text(draw('sueldo'))).toContain('Tocá acá')
  })

  it('contar la caja, importar, deshacer y anular dicen lo que dice la pantalla de hoy', () => {
    const draw = (scene: Parameters<typeof GuideScenePreview>[0]['scene']) =>
      text(renderToString(<GuideScenePreview scene={scene} />))
    const count = draw({ kind: 'count' })
    for (const label of [
      SCREEN_LABELS.ajustar.title,
      SCREEN_LABELS.ajustar.treasury,
      SCREEN_LABELS.ajustar.book,
      SCREEN_LABELS.ajustar.save,
    ]) {
      expect(count).toContain(label)
    }
    expect(count).toContain(SCREEN_LABELS.ajustar.counted)
    const upload = draw({ kind: 'import', source: 'mercado_pago', phase: 'upload' })
    expect(upload).toContain(SCREEN_LABELS.importar.titleMercadoPago)
    expect(upload).toContain(SCREEN_LABELS.importar.dropMercadoPago)
    expect(upload).toContain(SCREEN_LABELS.importar.choose)
    const review = draw({ kind: 'import', source: 'arca', phase: 'review' })
    expect(review).toContain(SCREEN_LABELS.importar.sameOrOther)
    expect(review).toContain(SCREEN_LABELS.importar.same)
    expect(review).toContain(SCREEN_LABELS.importar.loaded)
    expect(draw({ kind: 'undo' })).toContain(SCREEN_LABELS.aviso.undo)
    expect(draw({ kind: 'void' })).toContain(SCREEN_LABELS.comprobante.void)
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
    for (const title of ['Factura A', 'Factura B o C', 'Tique', 'Remito']) {
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
    // En el celular no hay columnas: la bajada lo dice distinto en cada tamaño.
    expect(html).toContain('bajá por su columna')
    expect(html).toContain('Buscá el papel que te dieron: abajo están sus respuestas.')
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
