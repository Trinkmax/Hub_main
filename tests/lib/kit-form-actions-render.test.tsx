// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'
import { FormActions as FieldFormActions } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { SubmitButton } from '@/components/ui/submit-button'

/**
 * Kit HUB §3.2, `FormActions`: una sola implementación (`form-actions.tsx`,
 * re-exportada por `field.tsx`) y, en el celular, una barra que cuenta solo las
 * acciones que se ven.
 *
 * El caso que estaba roto: [«Cancelar» con `max-sm:hidden`, «Guardar y pagar»,
 * «Guardar»]. La grilla vieja contaba al oculto (`:last-child:nth-child(3)`) y
 * la principal se llevaba la fila entera, con la otra a la mitad abajo. Ahora
 * la barra es un flex que envuelve: un hijo con `display: none` no es ítem del
 * flex, así que no ocupa lugar ni entra en ninguna cuenta. El HTML del server
 * no mide nada, así que se fija lo que decide el reparto:
 *
 * 1. Las clases de la barra no cuentan hijos por posición ni reordenan.
 * 2. Tailwind (el compilador instalado) genera lo que se espera de esas clases
 *    arbitrarias: una clase mal escrita no genera nada y no avisa.
 * 3. El marcado es el mismo con una, dos o tres acciones: la cuenta la hace el
 *    navegador con lo visible, no el componente.
 */

const html = (el: ReactElement) => renderToStaticMarkup(el)

/** React escapa `& < > " '` en los atributos: se vuelven a leer como en el DOM. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** La etiqueta de apertura del primer elemento con ese `data-slot`. */
function openTag(markup: string, slot: string): string {
  const match = new RegExp(`<[a-z][\\w-]*[^>]*\\sdata-slot="${slot}"[^>]*>`).exec(markup)
  if (!match) throw new Error(`no hay data-slot="${slot}" en:\n${markup}`)
  return match[0]
}

function attrOf(markup: string, slot: string, name: string): string | undefined {
  const raw = new RegExp(`\\s${name}="([^"]*)"`).exec(openTag(markup, slot))?.[1]
  return raw === undefined ? undefined : decode(raw)
}

function classesOf(markup: string, slot: string): string[] {
  return (attrOf(markup, slot, 'class') ?? '').split(/\s+/).filter(Boolean)
}

/** `max-sm:[&>*]:grow` → variantes `max-sm:[&>*]:` y utilidad `grow` (los `:` de adentro de [] no cortan). */
function splitClass(cls: string): { variants: string; utility: string } {
  let depth = 0
  let cut = -1
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i]
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (ch === ':' && depth === 0) cut = i
  }
  return { variants: cls.slice(0, cut + 1), utility: cls.slice(cut + 1) }
}

/** Los botones de la barra, en el orden del DOM: texto y clases. */
function actionsOf(markup: string): Array<{ text: string; classes: string[] }> {
  return [...markup.matchAll(/<button[^>]*\sclass="([^"]*)"[^>]*>(.*?)<\/button>/g)].map(
    ([, cls, inner]) => ({
      text: decode((inner ?? '').replace(/<[^>]+>/g, '')).trim(),
      classes: decode(cls ?? '').split(/\s+/),
    }),
  )
}

const ROW_CLASSES = ['max-sm:[&>*]:grow', 'max-sm:[&>*]:basis-[calc(50%-1rem)]']
const TALL_BUTTONS = 'max-sm:[&>[data-slot=button]]:h-11'
const FIXED = 'max-sm:[@media(min-height:30rem)]:fixed'
const WRAPPER_HEIGHT = 'max-sm:h-[calc(var(--sticky-actions-h)-var(--form-actions-offset,0px))]'
/** Arranca `--form-actions-offset` arriba del borde: lo define un layout con su propia barra abajo. */
const LIFTED = 'max-sm:[@media(min-height:30rem)]:bottom-(--form-actions-offset,0px)'

/** El caso de §5.4: el encabezado tiene `back`, así que «Cancelar» sale de la barra en el celular. */
const withHiddenCancel = (
  <form>
    <FormActions data-tour="acciones">
      <Button variant="secondary" className="max-sm:hidden">
        Cancelar
      </Button>
      <Button variant="secondary">Guardar y pagar</Button>
      <SubmitButton>Guardar</SubmitButton>
    </FormActions>
  </form>
)

describe('FormActions: una sola implementación', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url))
  const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

  it('field.tsx re-exporta la de form-actions.tsx: es el mismo componente', () => {
    expect(FieldFormActions).toBe(FormActions)
  })

  it('field.tsx no la define y form-actions.tsx no importa field.tsx (sin ciclo)', () => {
    const field = read('components/ui/field.tsx')
    expect(field).toMatch(
      /^export \{ FormActions, type FormActionsProps \} from '@\/components\/ui\/form-actions'$/m,
    )
    expect(field).not.toMatch(/\bfunction FormActions\b/)
    expect(field).not.toMatch(/\bconst MOBILE_/)
    const formActions = read('components/ui/form-actions.tsx')
    expect(formActions).not.toMatch(/from ['"](?:@\/components\/ui\/field|\.\/field)['"]/)
  })

  it('las dos rutas de import dibujan exactamente lo mismo', () => {
    const viaField = html(
      <form>
        <FieldFormActions>
          <SubmitButton>Guardar</SubmitButton>
        </FieldFormActions>
      </form>,
    )
    const viaFormActions = html(
      <form>
        <FormActions>
          <SubmitButton>Guardar</SubmitButton>
        </FormActions>
      </form>,
    )
    expect(viaField).toBe(viaFormActions)
  })
})

describe('FormActions en el celular: cuenta solo las acciones que se ven', () => {
  const out = html(withHiddenCancel)
  const bar = classesOf(out, 'form-actions-bar')

  it('el orden del DOM es el de quien llama (el del lector y el del Tab)', () => {
    expect(actionsOf(out).map((action) => action.text)).toEqual([
      'Cancelar',
      'Guardar y pagar',
      'Guardar',
    ])
    expect(actionsOf(out)[0]?.classes).toContain('max-sm:hidden')
  })

  it('la barra no cuenta hijos por posición, no es grilla y no reordena', () => {
    const offenders = bar.filter((cls) => {
      const { variants, utility } = splitClass(cls)
      return (
        /nth-child|nth-last-child|last-child|first-child|only-child/.test(variants) ||
        /^(?:order-|grid|col-|row-|flex-col-reverse|flex-row-reverse|flex-wrap-reverse)/.test(
          utility,
        )
      )
    })
    expect(offenders).toEqual([])
    // La guarda ve lo que tiene que ver: la regla vieja habría caído acá.
    expect(splitClass('max-sm:[&>:last-child:nth-child(3)]:order-first')).toEqual({
      variants: 'max-sm:[&>:last-child:nth-child(3)]:',
      utility: 'order-first',
    })
  })

  it('flex que envuelve: cada acción arranca en media fila y crece; botones de 44 px', () => {
    expect(bar).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'gap-2', ...ROW_CLASSES]))
    expect(bar).toContain(TALL_BUTTONS)
    // El alto de 44 px apunta a [data-slot=button]: lo llevan los dos botones.
    expect(out.match(/<button[^>]*\sdata-slot="button"/g)).toHaveLength(3)
  })

  it('el marcado de la barra es el mismo con una, dos o tres acciones', () => {
    const barWith = (children: ReactElement) =>
      classesOf(
        html(
          <form>
            <FormActions>{children}</FormActions>
          </form>,
        ),
        'form-actions-bar',
      )
    const one = barWith(<SubmitButton>Guardar</SubmitButton>)
    const two = barWith(
      <>
        <Button variant="secondary">Guardar y pagar</Button>
        <SubmitButton>Guardar</SubmitButton>
      </>,
    )
    expect(one).toEqual(bar)
    expect(two).toEqual(bar)
  })

  it('Tailwind genera el reparto: lo oculto sale del flex y el resto se parte la fila', async () => {
    const compiler = await compile(
      '@theme { --breakpoint-sm: 40rem; --spacing: 0.25rem; }\n@tailwind utilities;',
    )
    const css = (classes: string[]) => compiler.build(classes).replace(/\s+/g, '')
    const MOBILE = '@media(width<40rem)'
    // Sin un `display: none` en el celular, el «Cancelar» seguiría ocupando media fila.
    expect(css(['max-sm:hidden'])).toContain(`${MOBILE}{display:none;}`)
    expect(css(['flex-wrap'])).toContain('flex-wrap:wrap;')
    expect(css(['max-sm:[&>*]:grow'])).toContain(`${MOBILE}{&>*{flex-grow:1;}}`)
    // Media fila menos 1 rem: entra el gap (8 px, o el que se pase por className)
    // y `grow` reparte el resto en partes iguales; tres no entran en una fila.
    expect(css(['max-sm:[&>*]:basis-[calc(50%-1rem)]'])).toContain(
      `${MOBILE}{&>*{flex-basis:calc(50%-1rem);}}`,
    )
    expect(css([TALL_BUTTONS])).toContain(
      `${MOBILE}{&>[data-slot=button]{height:calc(var(--spacing)*11);}}`,
    )
    // Nada de lo que genera la barra reordena ni arma grilla.
    const barCss = css(bar)
    expect(barCss).not.toMatch(/order:|grid-template-columns|grid-column/)
  })
})

describe('FormActions: barra fija, props y clases', () => {
  it('por defecto es fija en el celular y el envoltorio reserva su alto', () => {
    const out = html(withHiddenCancel)
    expect(classesOf(out, 'form-actions-bar')).toContain(FIXED)
    expect(classesOf(out, 'form-actions')).toEqual([WRAPPER_HEIGHT])
    expect(classesOf(out, 'form-actions-bar')).toContain('justify-end')
  })

  it('fija arriba de la barra de abajo de un layout (Mensajería) con --form-actions-offset', () => {
    const bar = classesOf(html(withHiddenCancel), 'form-actions-bar')
    expect(bar).toContain(LIFTED)
    expect(bar).not.toContain('max-sm:[@media(min-height:30rem)]:bottom-0')
    // El área segura del iPhone ya la cubre la barra de abajo: se descuenta el offset.
    expect(bar).toContain(
      'max-sm:[@media(min-height:30rem)]:pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-var(--form-actions-offset,0px)))]',
    )
  })

  it('Tailwind genera el offset con 0 por defecto, y el alto reservado sin el offset', async () => {
    const compiler = await compile(
      '@theme { --breakpoint-sm: 40rem; --spacing: 0.25rem; }\n@tailwind utilities;',
    )
    const css = compiler.build([LIFTED, WRAPPER_HEIGHT]).replace(/\s+/g, '')
    expect(css).toContain('bottom:var(--form-actions-offset,0px);')
    // Sin --sticky-actions-h (la barra no está fija) el calc no vale y el alto queda en auto.
    expect(css).toContain('height:calc(var(--sticky-actions-h)-var(--form-actions-offset,0px));')
  })

  it('sticky={false}: ni fija ni alto reservado; el reparto en filas sigue', () => {
    const out = html(
      <form>
        <FormActions sticky={false}>
          <SubmitButton>Guardar</SubmitButton>
        </FormActions>
      </form>,
    )
    const bar = classesOf(out, 'form-actions-bar')
    expect(bar).not.toContain(FIXED)
    expect(classesOf(out, 'form-actions')).toEqual([])
    expect(bar).toEqual(expect.arrayContaining(ROW_CLASSES))
  })

  it('sticky="always" y align="between": pegada abajo también en escritorio', () => {
    const out = html(
      <form>
        <FormActions sticky="always" align="between">
          <SubmitButton>Guardar</SubmitButton>
        </FormActions>
      </form>,
    )
    expect(classesOf(out, 'form-actions-bar')).toEqual(
      expect.arrayContaining(['sm:sticky', 'sm:bottom-0', 'justify-between', FIXED]),
    )
  })

  it('las props van a la raíz, className a la barra (y gana), focusFirstInvalid no llega al DOM', () => {
    const out = html(
      <form>
        <FormActions
          id="acciones"
          data-tour="acciones"
          aria-label="Acciones del comprobante"
          focusFirstInvalid={false}
          className="gap-4"
        >
          <SubmitButton>Guardar</SubmitButton>
        </FormActions>
      </form>,
    )
    expect(attrOf(out, 'form-actions', 'id')).toBe('acciones')
    expect(attrOf(out, 'form-actions', 'data-tour')).toBe('acciones')
    expect(attrOf(out, 'form-actions', 'aria-label')).toBe('Acciones del comprobante')
    expect(out.toLowerCase()).not.toContain('focusfirstinvalid')
    const bar = classesOf(out, 'form-actions-bar')
    expect(bar).toContain('gap-4')
    expect(bar).not.toContain('gap-2')
    expect(classesOf(out, 'form-actions')).not.toContain('gap-4')
  })

  it('afuera de un <form> (botones con form="…") también se dibuja', () => {
    const out = html(
      <FormActions>
        <Button type="submit" form="comprobante">
          Guardar
        </Button>
      </FormActions>,
    )
    expect(openTag(out, 'form-actions')).toContain('data-slot="form-actions"')
    expect(out).toContain('form="comprobante"')
  })
})
