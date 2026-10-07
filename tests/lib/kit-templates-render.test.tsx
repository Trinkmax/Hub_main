// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Users } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { Field, FormSection } from '@/components/ui/field'
import { FormActions, firstInvalidTarget } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import {
  ClosedPeriodCallout,
  DetailTemplate,
  FormTemplate,
  ListEmptyState,
  ListTemplate,
  READ_ONLY_MESSAGE,
  ReadOnlyCallout,
  ReportTemplate,
  StatementTemplate,
  SummaryTemplate,
} from '@/components/ui/page-templates'
import { Section } from '@/components/ui/section'
import { SubmitButton } from '@/components/ui/submit-button'

/**
 * Kit HUB §5: las seis plantillas de pantalla y los patrones de §5.7, en el
 * HTML del server (son Server Components; la barra de acciones es cliente y
 * también se dibuja en el server).
 *
 * Lo que se fija:
 * 1. Cada plantilla dibuja sus slots en el orden de la spec, que es también
 *    el orden del DOM (lector de pantalla y Tab recorren lo que se ve), y un
 *    slot vacío no deja envoltorio (no suma los 32 px del gap).
 * 2. `data-tour` y el resto de las props llegan a la raíz (los tours).
 * 3. Lo que cambia por ancho: 2/3 + 1/3 del Resumen, el `aside` del
 *    formulario fijo al costado solo en `comfortable`, la barra fija de
 *    acciones con su lugar reservado al final de la plantilla y la principal
 *    a todo el ancho en la ficha del celular.
 * 4. Solo lectura y período cerrado: el aviso correcto, sin anuncio.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const html = (el: ReactElement) => renderToStaticMarkup(el)

/** La etiqueta de apertura del primer elemento con ese `data-slot`. */
function openTag(markup: string, slot: string): string {
  const match = new RegExp(`<[a-z][\\w-]*[^>]*\\sdata-slot="${slot}"[^>]*>`).exec(markup)
  if (!match) throw new Error(`no hay data-slot="${slot}" en:\n${markup}`)
  return match[0]
}

/** React escapa `& < > " '` en los atributos: se vuelven a leer como en el DOM. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Un atributo de la etiqueta de apertura del primer elemento con ese `data-slot`. */
function attrOf(markup: string, slot: string, name: string): string | undefined {
  const raw = new RegExp(`\\s${name}="([^"]*)"`).exec(openTag(markup, slot))?.[1]
  return raw === undefined ? undefined : decode(raw)
}

/** Las clases de la etiqueta de apertura del primer elemento con ese `data-slot`. */
function classesOf(markup: string, slot: string): string[] {
  return (attrOf(markup, slot, 'class') ?? '').split(/\s+/)
}

/** El código sin comentarios: los JSDoc nombran hooks de otros archivos. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Dónde aparece cada marca en el HTML: para verificar el orden del DOM. */
function positions(markup: string, marks: string[]): number[] {
  return marks.map((mark) => {
    const at = markup.indexOf(mark)
    if (at === -1) throw new Error(`no aparece «${mark}» en:\n${markup}`)
    return at
  })
}

function expectInOrder(markup: string, marks: string[]) {
  const at = positions(markup, marks)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
}

const header = (title = 'Proveedores') => (
  <PageHeader
    title={title}
    back={{ href: '/hub/compras', label: 'Compras' }}
    actions={
      <>
        <Button variant="secondary">Nuevo pago</Button>
        <Button>Nuevo comprobante</Button>
      </>
    }
  />
)

const kpis = (
  <KPIGroup>
    <KPI label="Saldo" value="$ 1.240.000" />
    <KPI label="Vencido" value="$ 380.000" />
    <KPI label="Vence en 7 días" value="$ 860.000" />
  </KPIGroup>
)

/** Un componente que no dibuja nada (como un `FormError` sin mensaje). */
function Nothing(): ReactNode {
  return null
}

describe('SummaryTemplate (§5.1)', () => {
  const full = html(
    <SummaryTemplate
      header={header('Resumen')}
      kpis={kpis}
      attention={<Section title="Pide atención">3 facturas vencen esta semana</Section>}
      shortcuts={<Section title="Accesos">Nuevo gasto</Section>}
      data-tour="resumen"
    >
      <Section title="Visitas">gráfico</Section>
    </SummaryTemplate>,
  )

  it('encabezado → KPIs → «Pide atención» → «Accesos» → el resto, en el DOM', () => {
    expectInOrder(full, [
      'data-slot="page-header"',
      'data-slot="summary-template-kpis"',
      'data-slot="summary-template-attention"',
      'data-slot="summary-template-shortcuts"',
      '>Visitas<',
    ])
  })

  it('raíz: PageShell `default`, data-tour y sin data-readonly', () => {
    const root = openTag(full, 'summary-template')
    expect(root).toContain('data-tour="resumen"')
    expect(root).not.toContain('data-readonly')
    expect(classesOf(full, 'summary-template')).toEqual(
      expect.arrayContaining(['mx-auto', 'flex-col', 'gap-8', 'max-w-7xl']),
    )
  })

  it('con los dos: 2/3 + 1/3 desde lg; con uno solo, todo el ancho', () => {
    expect(classesOf(full, 'summary-template-work')).toContain('lg:grid-cols-3')
    expect(classesOf(full, 'summary-template-attention')).toContain('lg:col-span-2')

    const alone = html(
      <SummaryTemplate header={header('Resumen')} kpis={kpis} attention="3 facturas vencen" />,
    )
    expect(classesOf(alone, 'summary-template-work')).not.toContain('lg:grid-cols-3')
    expect(classesOf(alone, 'summary-template-attention')).not.toContain('lg:col-span-2')
    expect(alone).not.toContain('summary-template-shortcuts')
  })

  it('sin «Pide atención» ni accesos no deja la grilla vacía', () => {
    const bare = html(<SummaryTemplate header={header('Resumen')} kpis={kpis} />)
    expect(bare).not.toContain('summary-template-work')
    expect(bare).not.toContain('template-notices')
  })
})

describe('ListTemplate (§5.2)', () => {
  it('encabezado → barra → tabla → paginación, a 12 px como la DataTable', () => {
    const out = html(
      <ListTemplate
        header={header()}
        toolbar={<div>barra</div>}
        pagination={<nav>1–25 de 140</nav>}
        width="wide"
        data-tour="proveedores"
      >
        <table>
          <caption>Proveedores</caption>
        </table>
      </ListTemplate>,
    )
    expectInOrder(out, [
      'data-slot="page-header"',
      'data-slot="list-template-toolbar"',
      '<table>',
      'data-slot="list-template-pagination"',
    ])
    expect(classesOf(out, 'list-template-body')).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'gap-3']),
    )
    expect(classesOf(out, 'list-template')).toContain('max-w-screen-2xl')
    expect(attrOf(out, 'list-template', 'data-tour')).toBe('proveedores')
  })

  it('sin barra ni paginación (las trae la DataTable) no deja envoltorios', () => {
    const out = html(
      <ListTemplate header={header()} toolbar={null} pagination={false}>
        <table />
      </ListTemplate>,
    )
    expect(out).not.toContain('list-template-toolbar')
    expect(out).not.toContain('list-template-pagination')
    expect(classesOf(out, 'list-template')).toContain('max-w-7xl')
  })
})

describe('ListEmptyState (§5.2)', () => {
  it('sin datos todavía: el vacío de verdad con su CTA', () => {
    const out = html(
      <ListEmptyState
        filtered={false}
        clearHref="/hub/compras"
        icon={Users}
        title="Todavía no cargaste proveedores"
        description="Cargá el primero para llevar su cuenta corriente."
        action={<Button>Nuevo proveedor</Button>}
      />,
    )
    expect(out).toContain('Todavía no cargaste proveedores')
    expect(out).toContain('Nuevo proveedor')
    expect(out).not.toContain('Limpiar filtros')
    expect(openTag(out, 'list-empty-state')).not.toContain('data-filtered')
    // Adentro de la tabla: el chico (py-8).
    expect(classesOf(out, 'list-empty-state')).toContain('py-8')
  })

  it('sin resultados para el filtro: «Limpiar filtros» a la ruta sin filtros', () => {
    const out = html(
      <ListEmptyState
        filtered
        clearHref="/hub/compras?tab=proveedores"
        title="Todavía no cargaste proveedores"
        action={<Button>Nuevo proveedor</Button>}
        secondaryAction={<Button variant="secondary">Importar</Button>}
      />,
    )
    expect(openTag(out, 'list-empty-state')).toContain('data-filtered=""')
    expect(out).toContain('No hay resultados con estos filtros')
    expect(out).toMatch(/<a[^>]*href="\/hub\/compras\?tab=proveedores"[^>]*>Limpiar filtros<\/a>/)
    expect(out).toContain('lucide-search-x')
    expect(out).not.toContain('Todavía no cargaste proveedores')
    expect(out).not.toContain('Nuevo proveedor')
    expect(out).not.toContain('Importar')
  })
})

describe('DetailTemplate (§5.3)', () => {
  const out = html(
    <DetailTemplate
      header={header('Distribuidora del Centro SA')}
      summary={kpis}
      tabs={<nav aria-label="Secciones del proveedor">Movimientos</nav>}
      data-tour="ficha"
    >
      <p>contenido de la pestaña</p>
    </DetailTemplate>,
  )

  it('encabezado → KPIs → pestañas → contenido, pestañas pegadas al contenido', () => {
    expectInOrder(out, [
      'data-slot="page-header"',
      'data-slot="detail-template-summary"',
      'data-slot="detail-template-tabs"',
      'contenido de la pestaña',
    ])
    expect(classesOf(out, 'detail-template-main')).toContain('gap-6')
    expect(attrOf(out, 'detail-template', 'data-tour')).toBe('ficha')
  })

  it('en el celular la acción principal (la última) ocupa todo el ancho', () => {
    expect(classesOf(out, 'detail-template')).toContain(
      'max-sm:[&>[data-slot=page-header]_[data-slot=page-actions]>:last-child]:w-full',
    )
  })

  it('sin aside, una sola columna; con aside, al costado solo si entran las dos', () => {
    expect(out).not.toContain('detail-template-aside')
    expect(classesOf(out, 'detail-template-body')).not.toContain('lg:flex-row')

    const withAside = html(
      <DetailTemplate header={header()} aside={<Section title="Datos">CUIT</Section>}>
        <p>movimientos</p>
      </DetailTemplate>,
    )
    expect(classesOf(withAside, 'detail-template-body')).toEqual(
      expect.arrayContaining(['flex-col', 'lg:flex-row', 'lg:flex-wrap', 'lg:items-start']),
    )
    expect(classesOf(withAside, 'detail-template-main')).toEqual(
      expect.arrayContaining(['lg:min-w-[40rem]', 'lg:flex-[999_1_0%]']),
    )
    expect(classesOf(withAside, 'detail-template-aside')).toContain('lg:flex-[1_1_20rem]')
    expectInOrder(withAside, ['movimientos', 'data-slot="detail-template-aside"'])
  })
})

describe('FormTemplate (§5.4)', () => {
  const form = (
    <form>
      <FormSection title="Proveedor y comprobante">
        <Field label="Proveedor" name="supplier">
          <Input />
        </Field>
      </FormSection>
      <FormActions data-tour="acciones">
        <Button variant="secondary">Guardar y pagar</Button>
        <SubmitButton>Guardar</SubmitButton>
      </FormActions>
    </form>
  )

  it('sin aside: una columna compacta (3xl) con la barra adentro del formulario', () => {
    const out = html(<FormTemplate header={header('Nuevo comprobante')}>{form}</FormTemplate>)
    expectInOrder(out, [
      'data-slot="page-header"',
      'data-slot="form-template-main"',
      'Proveedor y comprobante',
      'data-slot="form-actions"',
    ])
    expect(classesOf(out, 'form-template')).toContain('max-w-3xl')
    expect(out).not.toContain('form-template-aside')
    // La barra de acciones es la del kit: fija en el celular, con data-tour.
    expect(attrOf(out, 'form-actions', 'data-tour')).toBe('acciones')
    expect(classesOf(out, 'form-actions-bar')).toContain('max-sm:[@media(min-height:30rem)]:fixed')
  })

  it('la barra fija reserva su lugar al final de la plantilla, no del formulario', () => {
    const out = html(<FormTemplate header={header('Nuevo comprobante')}>{form}</FormTemplate>)
    expect(classesOf(out, 'form-template')).toEqual(
      expect.arrayContaining([
        'max-sm:[&_[data-slot=form-actions]]:h-auto',
        'max-sm:pb-[calc(var(--sticky-actions-h,0px)+1.5rem)]',
      ]),
    )
  })

  it('con aside: comfortable, formulario de 3xl y el aside fijo al costado, después en el DOM', () => {
    const out = html(
      <FormTemplate
        header={header('Nuevo comprobante')}
        aside={<div>Asiento que se va a generar</div>}
      >
        {form}
      </FormTemplate>,
    )
    expect(classesOf(out, 'form-template')).toContain('max-w-6xl')
    expect(classesOf(out, 'form-template-body')).toEqual(
      expect.arrayContaining(['lg:flex-row', 'lg:flex-wrap', 'lg:items-start']),
    )
    expect(classesOf(out, 'form-template-main')).toEqual(
      expect.arrayContaining(['max-w-3xl', 'lg:min-w-[34rem]', 'lg:flex-[999_1_0%]']),
    )
    expect(classesOf(out, 'form-template-aside')).toEqual(
      expect.arrayContaining([
        'lg:sticky',
        'lg:top-[calc(var(--topbar-h)+1rem)]',
        'lg:flex-[1_1_20rem]',
      ]),
    )
    // En el celular el aside va antes de la barra fija: después del formulario en el DOM.
    expectInOrder(out, ['data-slot="form-actions"', 'Asiento que se va a generar'])
  })

  it('compact con aside: el aside va abajo en todos los anchos', () => {
    const out = html(
      <FormTemplate header={header()} aside={<div>ayuda</div>} width="compact">
        {form}
      </FormTemplate>,
    )
    expect(classesOf(out, 'form-template')).toContain('max-w-3xl')
    expect(classesOf(out, 'form-template-body')).not.toContain('lg:flex-row')
    expect(classesOf(out, 'form-template-aside')).not.toContain('lg:sticky')
  })

  it('comfortable sin aside: el formulario usa todo el ancho (grillas)', () => {
    const out = html(
      <FormTemplate header={header('Asiento manual')} width="comfortable">
        {form}
      </FormTemplate>,
    )
    expect(classesOf(out, 'form-template')).toContain('max-w-6xl')
    expect(classesOf(out, 'form-template-main')).not.toContain('max-w-3xl')
  })

  it('solo lectura: el aviso arriba del formulario y la raíz marcada', () => {
    const out = html(
      <FormTemplate header={header()} readOnly>
        <form>campos de solo lectura</form>
      </FormTemplate>,
    )
    expect(openTag(out, 'form-template')).toContain('data-readonly=""')
    expectInOrder(out, ['data-slot="read-only-callout"', 'campos de solo lectura'])
  })
})

describe('ReportTemplate (§5.5)', () => {
  it('encabezado → totales → libro → notas, en una sola pieza (16 px)', () => {
    const out = html(
      <ReportTemplate
        header={<PageHeader title="Sumas y saldos" />}
        totals={<p>Debe = Haber</p>}
        notes="D = saldo deudor · A = saldo acreedor"
        data-tour="sumas"
      >
        <table>
          <caption>Sumas y saldos</caption>
        </table>
      </ReportTemplate>,
    )
    expectInOrder(out, [
      'data-slot="page-header"',
      'data-slot="report-template-totals"',
      '<table>',
      'data-slot="report-template-notes"',
    ])
    expect(classesOf(out, 'report-template-body')).toContain('gap-4')
    expect(classesOf(out, 'report-template-notes')).toEqual(
      expect.arrayContaining(['type-small', 'text-muted-foreground']),
    )
    expect(classesOf(out, 'report-template')).toContain('max-w-7xl')
    expect(attrOf(out, 'report-template', 'data-tour')).toBe('sumas')
  })

  it('wide para libros anchos; sin totales ni notas no deja envoltorios', () => {
    const out = html(
      <ReportTemplate header={<PageHeader title="IVA compras" />} width="wide">
        <table />
      </ReportTemplate>,
    )
    expect(classesOf(out, 'report-template')).toContain('max-w-screen-2xl')
    expect(out).not.toContain('report-template-totals')
    expect(out).not.toContain('report-template-notes')
  })
})

describe('StatementTemplate (§5.6)', () => {
  it('encabezado → saldo y antigüedad → pestañas → libro → próximos vencimientos', () => {
    const out = html(
      <StatementTemplate
        header={header('Distribuidora del Centro SA')}
        balance={
          <>
            {kpis}
            <div>antigüedad</div>
          </>
        }
        tabs={<nav aria-label="Secciones">Movimientos</nav>}
        upcoming={<Section title="Próximos vencimientos">Factura A 0003-00001234</Section>}
        data-tour="estado"
      >
        <table>
          <caption>Movimientos</caption>
        </table>
      </StatementTemplate>,
    )
    expectInOrder(out, [
      'data-slot="page-header"',
      'data-slot="statement-template-balance"',
      'data-slot="kpi-group"',
      'antigüedad',
      'data-slot="statement-template-tabs"',
      '<table>',
      'data-slot="statement-template-upcoming"',
    ])
    expect(classesOf(out, 'statement-template-balance')).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'gap-4']),
    )
    expect(classesOf(out, 'statement-template')).toContain(
      'max-sm:[&>[data-slot=page-header]_[data-slot=page-actions]>:last-child]:w-full',
    )
    expect(attrOf(out, 'statement-template', 'data-tour')).toBe('estado')
  })

  it('una caja no tiene pestañas: sin envoltorio', () => {
    const out = html(
      <StatementTemplate header={header('Caja')} balance={kpis}>
        <table />
      </StatementTemplate>,
    )
    expect(out).not.toContain('statement-template-tabs')
    expect(out).not.toContain('statement-template-upcoming')
  })
})

describe('Solo lectura y período cerrado (§5.7)', () => {
  it('ReadOnlyCallout: info, sin anuncio, con el texto de la spec', () => {
    const out = html(<ReadOnlyCallout data-tour="lectura" />)
    const tag = openTag(out, 'read-only-callout')
    expect(tag).toContain('data-tone="info"')
    expect(tag).toContain('data-tour="lectura"')
    expect(tag).not.toContain('role=')
    expect(out).toContain(READ_ONLY_MESSAGE)
    expect(READ_ONLY_MESSAGE).toBe('Tenés acceso de lectura: podés ver y exportar todo.')
  })

  it('readOnly en cualquier plantilla: un solo aviso, arriba del contenido y debajo del encabezado', () => {
    const out = html(
      <ListTemplate header={header()} readOnly notice={<ClosedPeriodCallout period="Septiembre" />}>
        <table />
      </ListTemplate>,
    )
    expect(out.match(/data-slot="read-only-callout"/g)).toHaveLength(1)
    expectInOrder(out, [
      'data-slot="page-header"',
      'data-slot="read-only-callout"',
      'data-slot="closed-period-callout"',
      '<table',
    ])
    expect(openTag(out, 'list-template')).toContain('data-readonly=""')
  })

  it('un aviso que no dibuja nada no suma aire: el envoltorio se esconde vacío', () => {
    const out = html(
      <ReportTemplate header={<PageHeader title="Mayor" />} notice={<Nothing />}>
        <table />
      </ReportTemplate>,
    )
    expect(classesOf(out, 'template-notices')).toContain('empty:hidden')
    expect(out).toMatch(/<div data-slot="template-notices"[^>]*><\/div>/)
  })

  it('ClosedPeriodCallout: neutro con candado, título y la acción al asiento de ajuste', () => {
    const out = html(
      <ClosedPeriodCallout period="Septiembre" adjustmentHref="/hub/libros/asiento-manual" />,
    )
    const tag = openTag(out, 'closed-period-callout')
    expect(tag).toContain('data-tone="neutral"')
    expect(tag).not.toContain('role=')
    expect(out).toContain('lucide-lock')
    expect(out).toContain('Septiembre está cerrado')
    expect(out).toContain('Para corregir, cargá un asiento de ajuste.')
    expect(out).toMatch(
      /<a[^>]*href="\/hub\/libros\/asiento-manual"[^>]*>Nuevo asiento de ajuste<\/a>/,
    )
  })

  it('ClosedPeriodCallout sin link (la contadora): sin acción; una acción propia gana', () => {
    const reader = html(<ClosedPeriodCallout period="Septiembre" />)
    expect(reader).not.toContain('callout-action')
    expect(reader).not.toContain('Nuevo asiento de ajuste')

    const owner = html(
      <ClosedPeriodCallout
        period="Octubre"
        adjustmentHref="/hub/libros/asiento-manual"
        action={<Button size="sm">Cargar una nota de crédito</Button>}
      >
        Para corregirlo, elegí cómo.
      </ClosedPeriodCallout>,
    )
    expect(owner).toContain('Cargar una nota de crédito')
    expect(owner).not.toContain('Nuevo asiento de ajuste')
    expect(owner).toContain('Para corregirlo, elegí cómo.')
  })
})

describe('FormActions (form-actions.tsx)', () => {
  it('es la barra del kit: no deja pasar la prop propia al DOM', () => {
    const out = html(
      <form>
        <FormActions focusFirstInvalid={false} sticky="always" align="between" id="acciones">
          <SubmitButton>Guardar</SubmitButton>
        </FormActions>
      </form>,
    )
    expect(attrOf(out, 'form-actions', 'id')).toBe('acciones')
    expect(out.toLowerCase()).not.toContain('focusfirstinvalid')
    expect(classesOf(out, 'form-actions-bar')).toEqual(
      expect.arrayContaining(['justify-between', 'sm:sticky']),
    )
  })

  it('firstInvalidTarget: el primer campo inválido; si no hay, el FormError; si no, nada', () => {
    const field = { id: 'campo' }
    const formError = { id: 'error' }
    const root = (found: Record<string, object | null>) => ({
      querySelector: (selector: string) => found[selector] ?? null,
    })
    const invalid = '[aria-invalid="true"]'
    const error = '[data-slot="form-error"]'
    expect(
      firstInvalidTarget(root({ [invalid]: field, [error]: formError }) as unknown as ParentNode),
    ).toBe(field)
    expect(firstInvalidTarget(root({ [error]: formError }) as unknown as ParentNode)).toBe(
      formError,
    )
    expect(firstInvalidTarget(root({}) as unknown as ParentNode)).toBeNull()
  })
})

describe('reglas del kit en estos archivos', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url))
  const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

  it('las plantillas son server-safe: sin «use client» ni hooks', () => {
    const source = read('components/ui/page-templates.tsx')
    expect(source).not.toMatch(/^['"]use client['"]/m)
    expect(withoutComments(source)).not.toMatch(/\buse[A-Z]\w*\(/)
  })

  it('la barra con foco es cliente', () => {
    expect(read('components/ui/form-actions.tsx')).toMatch(/^'use client'/)
  })

  it.each([
    'components/ui/page-templates.tsx',
    'components/ui/form-actions.tsx',
  ])('%s: sin -[--x], dark:, sombras en lo quieto ni texto de menos de 12 px', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/-\[--[a-z]/)
    expect(source).not.toMatch(/\bdark:/)
    expect(source).not.toMatch(/\bshadow-(?:xs|sm|md|lg|2xs)\b/)
    expect(source).not.toMatch(/text-\[(?:9|10|11)px\]/)
    // El orden del DOM es el visual: nada de `order-*`.
    expect(source).not.toMatch(/\border-(?:first|last|\d)/)
  })
})
