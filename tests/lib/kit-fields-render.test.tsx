// @vitest-environment node
import { Plus } from 'lucide-react'
import type * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CodeField } from '@/components/ui/code-field'
import { ControlSizeProvider } from '@/components/ui/control-size'
import { CopyButton } from '@/components/ui/copy-button'
import { Field, FieldRow, FormActions, FormError, FormSection } from '@/components/ui/field'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input, InputAddon, InputGroup, SearchField } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioCards } from '@/components/ui/radio-cards'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

/**
 * Kit HUB, acciones y campos (§3.1 y §3.2): lo que se ve en el primer HTML.
 *
 * - Compatibilidad: los ~150 archivos del panel siguen pasando las variantes y
 *   los tamaños viejos; tienen que caer en las clases nuevas equivalentes.
 * - `data-tour` llega al DOM en cada componente (los anclajes de los tours).
 * - Field cablea id, name, aria-describedby (ayuda y error, en ese orden) y
 *   aria-invalid al control, y los compuestos mandan el valor canónico en un
 *   hidden sin duplicar el name.
 * - Button cargando: enfocable, sin enviar, spinner en el lugar del ícono o
 *   superpuesto sin que el ancho salte.
 */

const html = (node: React.ReactElement) => renderToString(node)

/** React escapa `& < > " '` en los atributos: se vuelven a leer como en el DOM. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Los atributos del primer elemento que matchea `selector`. */
function attrsOf(markup: string, selector: RegExp): Record<string, string> {
  const m = selector.exec(markup)
  if (!m) throw new Error(`no encontré ${selector} en ${markup}`)
  return Object.fromEntries(
    [...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', decode(v ?? '')]),
  )
}

function classesOf(markup: string, selector: RegExp): string[] {
  return (attrsOf(markup, selector).class ?? '').split(/\s+/)
}

describe('Button: variantes y tamaños', () => {
  it('por defecto es primary, sin tamaño fijo (toma el de la fila o md)', () => {
    const out = html(<Button>Guardar</Button>)
    const cls = classesOf(out, /<button[^>]*>/)
    expect(cls).toContain('bg-primary')
    expect(cls).toContain('press')
    expect(cls).toContain('h-[var(--control-h,var(--control-md))]')
    expect(out).toContain('>Guardar</button>')
  })

  it('las variantes viejas caen en las nuevas', () => {
    expect(buttonVariants({ variant: 'default' })).toBe(buttonVariants({ variant: 'primary' }))
    expect(buttonVariants({ variant: 'outline' })).toBe(buttonVariants({ variant: 'secondary' }))
    expect(buttonVariants({ variant: 'destructive' })).toBe(buttonVariants({ variant: 'danger' }))
    expect(buttonVariants({ variant: 'success' })).toBe(buttonVariants({ variant: 'primary' }))
    expect(buttonVariants({ size: 'default' })).toBe(buttonVariants({ size: 'md' }))
    expect(buttonVariants({ size: 'xl' })).toBe(buttonVariants({ size: 'lg' }))
    // alert-dialog llama buttonVariants() sin nada: primary md.
    expect(buttonVariants()).toBe(buttonVariants({ variant: 'primary', size: 'md' }))
  })

  it('secondary es cartulina con borde; ghost es texto 2; danger-ghost, texto de peligro', () => {
    expect(buttonVariants({ variant: 'secondary' })).toContain('border-border-strong')
    expect(buttonVariants({ variant: 'ghost' })).toContain('text-muted-foreground')
    expect(buttonVariants({ variant: 'danger-ghost' })).toContain('text-destructive-text')
  })

  it('el link va subrayado siempre, sin alto fijo y sin press', () => {
    const cls = classesOf(html(<Button variant="link">Ver más</Button>), /<button[^>]*>/)
    expect(cls).toContain('underline')
    expect(cls).not.toContain('press')
    expect(cls.some((c) => c.startsWith('h-[var(--control-h'))).toBe(false)
  })

  it('tamaños: alto por token; sm e icon-sm agrandan el área táctil', () => {
    expect(buttonVariants({ size: 'md' })).toContain('h-(--control-md)')
    expect(buttonVariants({ size: 'lg' })).toContain('h-(--control-lg)')
    expect(buttonVariants({ size: 'icon' })).toContain('size-(--control-md)')
    expect(buttonVariants({ size: 'sm' })).toContain('hit-area')
    expect(buttonVariants({ size: 'icon-sm' })).toContain('hit-area')
  })

  it('un alto forzado del que llama sigue ganando', () => {
    const cls = classesOf(
      html(
        <Button size="lg" className="h-11 w-full">
          Ok
        </Button>,
      ),
      /<button[^>]*>/,
    )
    expect(cls).toContain('h-11')
    expect(cls).not.toContain('h-(--control-lg)')
  })

  it('no cambia el type por defecto (los formularios dependen del submit implícito)', () => {
    expect(attrsOf(html(<Button>Enviar</Button>), /<button[^>]*>/).type).toBeUndefined()
  })

  it('data-tour llega al botón y, con asChild, al hijo', () => {
    expect(html(<Button data-tour="nuevo">Nuevo</Button>)).toContain('data-tour="nuevo"')
    const link = html(
      <Button asChild variant="outline" data-tour="ver">
        <a href="/x">Ver</a>
      </Button>,
    )
    const a = attrsOf(link, /<a[^>]*>/)
    expect(a['data-tour']).toBe('ver')
    expect(a['data-slot']).toBe('button')
    expect(a.class).toContain('border-border-strong')
  })
})

describe('Button: cargando', () => {
  it('enfocable, ocupado, sin enviar el formulario', () => {
    const out = html(
      <Button loading type="submit" name="intent" value="save">
        Guardar
      </Button>,
    )
    const a = attrsOf(out, /<button[^>]*>/)
    expect(a['aria-busy']).toBe('true')
    expect(a['aria-disabled']).toBe('true')
    expect(a.type).toBe('button')
    expect(a.disabled).toBeUndefined()
    // name/value siguen: el FormData del envío en curso ya se armó con ellos.
    expect(a.name).toBe('intent')
  })

  it('sin ícono: la etiqueta queda (transparente) y el spinner va encima', () => {
    const out = html(<Button loading>Guardar</Button>)
    expect(out).toMatch(/data-slot="button-label"[^>]*class="[^"]*opacity-0[^"]*"[^>]*>Guardar</)
    expect(out).toMatch(/data-slot="button-spinner"[^>]*>\s*<svg[^>]*data-slot="spinner"/)
    expect(classesOf(out, /<button[^>]*>/)).toContain('relative')
  })

  it('con ícono inicial: el spinner ocupa su lugar y el texto se ve', () => {
    const out = html(
      <Button loading>
        <Plus aria-hidden />
        Nuevo
      </Button>,
    )
    expect(out).not.toContain('lucide-plus')
    expect(out).toMatch(/<button[^>]*><svg[^>]*data-slot="spinner"[^>]*>.*<\/svg>Nuevo<\/button>/)
  })

  it('con loadingText: spinner + texto', () => {
    const out = html(
      <Button loading loadingText="Guardando…">
        Guardar
      </Button>,
    )
    expect(out).toContain('Guardando…')
    expect(out).not.toContain('>Guardar<')
  })

  it('un botón absoluto sigue absoluto mientras carga', () => {
    const cls = classesOf(
      html(
        <Button loading className="absolute right-2">
          Ok
        </Button>,
      ),
      /<button[^>]*>/,
    )
    expect(cls).toContain('absolute')
    expect(cls).not.toContain('relative')
  })
})

describe('Spinner', () => {
  it('suelto: role=status y el texto para el lector', () => {
    const out = html(<Spinner />)
    expect(out).toContain('role="status"')
    expect(out).toContain('<span class="sr-only">Cargando…</span>')
  })

  it('adentro de un botón: el svg pelado, oculto', () => {
    const out = html(<Spinner aria-hidden size={20} />)
    expect(out.startsWith('<svg')).toBe(true)
    expect(out).toContain('aria-hidden="true"')
    expect(out).not.toContain('role="status"')
    expect(out).toContain('size-5')
  })
})

describe('SubmitButton', () => {
  it('fuera de un envío es un submit común', () => {
    const a = attrsOf(html(<SubmitButton>Guardar</SubmitButton>), /<button[^>]*>/)
    expect(a.type).toBe('submit')
    expect(a['aria-busy']).toBeUndefined()
  })
})

describe('CopyButton', () => {
  it('iconOnly: nombre en aria-label, cuadrado de 36 aunque pida sm, y región aria-live', () => {
    const out = html(
      <CopyButton
        value="https://hub.ar"
        iconOnly
        variant="ghost"
        size="sm"
        label="Copiar link"
        data-tour="copiar"
      />,
    )
    const a = attrsOf(out, /<button[^>]*>/)
    expect(a['aria-label']).toBe('Copiar link')
    expect(a['data-tour']).toBe('copiar')
    expect(a.class).toContain('size-(--control-md)')
    expect(out).toContain('aria-live="polite"')
  })

  it('con texto: secondary sm por defecto', () => {
    const out = html(<CopyButton value="x" />)
    const cls = classesOf(out, /<button[^>]*>/)
    expect(cls).toContain('border-border-strong')
    expect(cls).toContain('h-(--control-sm)')
    expect(out).toContain('Copiar')
  })
})

describe('Field + Input', () => {
  it('cablea id, name, ayuda y error (en ese orden) y marca inválido', () => {
    const out = html(
      <Field
        label="Razón social"
        name="legal_name"
        hint="Como figura en ARCA"
        error={['Falta la razón social', 'otro']}
        data-tour="razon"
      >
        <Input defaultValue="" />
      </Field>,
    )
    const input = attrsOf(out, /<input[^>]*>/)
    const label = attrsOf(out, /<label[^>]*>/)
    expect(label.for).toBe(input.id)
    expect(input.name).toBe('legal_name')
    expect(input['aria-invalid']).toBe('true')
    expect(input['aria-describedby']).toBe(`${input.id}-hint ${input.id}-error`)
    expect(out).toContain(`id="${input.id}-hint"`)
    expect(out).toContain(`id="${input.id}-error"`)
    // Se muestra el primero de los fieldErrors de zod.
    expect(out).toContain('Falta la razón social')
    expect(out).not.toContain('otro')
    expect(attrsOf(out, /<div[^>]*data-slot="field"[^>]*>/)['data-tour']).toBe('razon')
  })

  it('lo propio gana y required no se marca con asterisco', () => {
    const out = html(
      <Field label="Email" name="email" required optional={false}>
        <Input id="mi-email" name="contacto" type="email" />
      </Field>,
    )
    const input = attrsOf(out, /<input[^>]*>/)
    expect(input.id).toBe('mi-email')
    expect(input.name).toBe('contacto')
    expect(input.required).toBe('')
    expect(out).not.toContain('*')
  })

  it('optional suma « (opcional)» y labelHidden deja la etiqueta solo para el lector', () => {
    expect(
      html(
        <Field label="Teléfono" optional>
          <Input />
        </Field>,
      ),
    ).toContain(' (opcional)')
    const hidden = html(
      <Field label="Buscar" labelHidden>
        <Input />
      </Field>,
    )
    expect(classesOf(hidden, /<label[^>]*>/)).toContain('sr-only')
  })

  it('render-prop para controles que no son del kit', () => {
    const out = html(
      <Field label="Color" name="color" error="Elegí un color">
        {(control) => <input type="color" {...control} />}
      </Field>,
    )
    const input = attrsOf(out, /<input[^>]*>/)
    expect(input.name).toBe('color')
    expect(input['aria-invalid']).toBe('true')
  })

  it('el Input mide por token, sin sombra, con foco «sobre el borde»', () => {
    const cls = classesOf(html(<Input data-tour="buscar" />), /<input[^>]*>/)
    expect(cls).toContain('h-(--control-md)')
    expect(cls).toContain('-outline-offset-1')
    expect(cls).toContain('text-(length:--control-font)')
    expect(cls.some((c) => c.startsWith('shadow'))).toBe(false)
    expect(html(<Input data-tour="buscar" />)).toContain('data-tour="buscar"')
  })

  it('invalid es un atajo de aria-invalid', () => {
    expect(attrsOf(html(<Input invalid />), /<input[^>]*>/)['aria-invalid']).toBe('true')
  })
})

describe('ControlSizeProvider', () => {
  it('una fila en sm: el Input lo toma por contexto y el Button por CSS', () => {
    const out = html(
      <ControlSizeProvider size="sm">
        <Input />
        <Button>Exportar</Button>
        <Button size="md">Explícito</Button>
      </ControlSizeProvider>,
    )
    expect(out).toMatch(/data-slot="control-size"[^>]*style="[^"]*--control-h:var\(--control-sm\)/)
    expect(attrsOf(out, /<input[^>]*>/)['data-size']).toBe('sm')
    expect(classesOf(out, /<input[^>]*>/)).toContain('h-(--control-sm)')
    const [auto, explicit] = [...out.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    expect(auto).toContain('h-[var(--control-h,var(--control-md))]')
    // La prop explícita gana: md con su clase fija.
    expect(explicit).toContain('h-(--control-md)')
  })
})

describe('InputGroup y SearchField', () => {
  it('el grupo es la caja y el Input de adentro pierde la suya', () => {
    const out = html(
      <InputGroup data-tour="plata">
        <InputAddon>$</InputAddon>
        <Input name="monto" />
        <InputAddon side="end">ARS</InputAddon>
      </InputGroup>,
    )
    expect(attrsOf(out, /<div[^>]*>/)['data-tour']).toBe('plata')
    expect(classesOf(out, /<div[^>]*>/)).toContain('[&>[data-slot=input]]:border-0')
    expect(out).toContain('data-side="end"')
  })

  it('SearchField: name="q" por defecto, lupa y sin «Limpiar» si está vacío', () => {
    const empty = html(<SearchField aria-label="Buscar proveedor" />)
    const input = attrsOf(empty, /<input[^>]*>/)
    expect(input.name).toBe('q')
    expect(input.type).toBe('search')
    expect(empty).not.toContain('Limpiar búsqueda')
    expect(html(<SearchField defaultValue="coca" />)).toContain('aria-label="Limpiar búsqueda"')
  })
})

describe('Textarea', () => {
  it('showCount con maxLength muestra «n / máx» y no anuncia lejos del límite', () => {
    const out = html(
      <Textarea showCount maxLength={500} defaultValue="Hola mundo" data-tour="nota" />,
    )
    expect(out).toMatch(
      /data-slot="textarea-count"[^>]*aria-live="off"[^>]*>10<!-- --> \/ <!-- -->500</,
    )
    expect(attrsOf(out, /<textarea[^>]*>/)['data-tour']).toBe('nota')
  })

  it('cerca del límite se anuncia', () => {
    const out = html(<Textarea showCount maxLength={10} value="123456789" readOnly />)
    expect(out).toContain('aria-live="polite"')
  })

  it('sin showCount es el textarea pelado', () => {
    expect(html(<Textarea />).startsWith('<textarea')).toBe(true)
  })
})

describe('CodeField', () => {
  it('adentro de un Field: el visible sin name, el hidden con el canónico', () => {
    const out = html(
      <Field label="CUIT" name="cuit" hint="Con o sin guiones">
        <CodeField kind="cuit" defaultValue="20123456786" />
      </Field>,
    )
    const inputs = [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0])
    expect(inputs).toHaveLength(2)
    const [visible, hidden] = inputs
    expect(visible).not.toContain('name=')
    expect(visible).toContain('value="20-12345678-6"')
    expect(visible).toContain('inputMode="numeric"')
    expect(visible).toContain('type="text"')
    expect(hidden).toContain('type="hidden"')
    expect(hidden).toContain('name="cuit"')
    expect(hidden).toContain('value="20123456786"')
  })

  it('punto de venta y número con ceros', () => {
    const pv = html(<CodeField kind="pv" name="pv" defaultValue="3" />)
    expect(pv).toContain('value="00003"')
    const doc = html(<CodeField kind="doc-number" name="number" defaultValue="1290" />)
    expect(doc).toContain('value="00001290"')
  })
})

describe('Select', () => {
  it('adentro de un Field el disparador toma el id y ocupa el ancho', () => {
    const out = html(
      <Field label="Tipo" name="kind">
        <Select defaultValue="a">
          <SelectTrigger data-tour="tipo">
            <SelectValue placeholder="Elegí" />
          </SelectTrigger>
        </Select>
      </Field>,
    )
    const trigger = attrsOf(out, /<button[^>]*data-slot="select-trigger"[^>]*>/)
    const label = attrsOf(out, /<label[^>]*>/)
    expect(trigger.id).toBe(label.for)
    expect(trigger['data-tour']).toBe('tipo')
    expect(trigger.class).toContain('w-full')
    expect(trigger.class).toContain('h-(--control-md)')
  })

  it('suelto queda w-fit (compatibilidad) y size="default" es md', () => {
    const out = html(
      <Select>
        <SelectTrigger size="default">
          <SelectValue />
        </SelectTrigger>
      </Select>,
    )
    const trigger = attrsOf(out, /<button[^>]*>/)
    expect(trigger.class).toContain('w-fit')
    expect(trigger['data-size']).toBe('md')
  })
})

describe('Checkbox y Switch', () => {
  it('Checkbox: caja de 4 px de radio, área táctil y aria-invalid del Field', () => {
    const out = html(
      <Field label="Acepto" error="Tenés que aceptar" layout="toggle">
        <Checkbox data-tour="acepto" />
      </Field>,
    )
    const box = attrsOf(out, /<button[^>]*data-slot="checkbox"[^>]*>/)
    expect(box['aria-invalid']).toBe('true')
    expect(box['data-tour']).toBe('acepto')
    expect(box.class).toContain('rounded-[4px]')
    expect(box.class).toContain('hit-area')
  })

  it('Switch: md por defecto, `default` es md, pending marca ocupado', () => {
    const out = html(<Switch size="default" pending data-tour="activo" aria-label="Activo" />)
    const root = attrsOf(out, /<button[^>]*>/)
    expect(root['data-size']).toBe('md')
    expect(root['aria-busy']).toBe('true')
    expect(root['data-tour']).toBe('activo')
    expect(root.class).toContain('w-9')
    expect(out).toContain('data-slot="spinner"')
  })

  it('toggle: la etiqueta cubre la fila (::after) para que todo sea clickeable', () => {
    const out = html(
      <Field label="Avisar por WhatsApp" hint="Un mensaje por reserva" layout="toggle">
        <Switch />
      </Field>,
    )
    expect(classesOf(out, /<label[^>]*>/)).toContain('after:inset-0')
    expect(attrsOf(out, /<button[^>]*role="switch"[^>]*>/)['aria-describedby']).toMatch(/-hint$/)
  })
})

describe('RadioCards', () => {
  const items = [
    { value: 'factura', label: 'Con factura', description: 'Cargás el comprobante' },
    { value: 'ticket', label: 'Sin factura' },
  ]

  it('adentro de un Field el grupo se nombra con la etiqueta del Field', () => {
    const out = html(
      <Field label="Nuevo gasto" name="kind">
        <RadioCards items={items} defaultValue="factura" columns={2} data-tour="gasto" />
      </Field>,
    )
    const group = attrsOf(out, /<div[^>]*role="radiogroup"[^>]*>/)
    const label = attrsOf(out, /<label[^>]*>/)
    expect(group['aria-labelledby']).toBe(label.id)
    expect(group['data-tour']).toBe('gasto')
    const first = attrsOf(out, /<button[^>]*role="radio"[^>]*>/)
    expect(first['aria-checked']).toBe('true')
    expect(first['aria-describedby']).toMatch(/-description$/)
    expect(out).toContain('Cargás el comprobante')
  })
})

describe('IconPicker', () => {
  it('suelto dibuja su etiqueta; las opciones son radios de Radix', () => {
    const out = html(
      <IconPicker
        value={null}
        onChange={() => {}}
        label="Ícono del nivel"
        hint="Va en el carnet"
        data-tour="nivel-icono"
      />,
    )
    expect(out).toContain('Ícono del nivel')
    expect(out).toContain('Va en el carnet')
    const none = attrsOf(out, /<button[^>]*aria-label="Sin ícono"[^>]*>/)
    expect(none['aria-checked']).toBe('true')
    expect(none.role).toBe('radio')
    // El grupo lleva el anclaje del tour, su etiqueta y su ayuda.
    const group = attrsOf(out, /<div[^>]*role="radiogroup"[^>]*>/)
    expect(group['data-tour']).toBe('nivel-icono')
    expect(group['aria-labelledby']).toBe(attrsOf(out, /<label[^>]*>/).id)
    expect(group['aria-describedby']).toMatch(/-hint$/)
  })

  it('adentro de un Field la etiqueta la pone el Field y el valor viaja en un hidden', () => {
    const out = html(
      <Field label="Ícono" name="icon">
        <IconPicker value={null} onChange={() => {}} />
      </Field>,
    )
    expect(out.match(/<label/g)).toHaveLength(1)
    const group = attrsOf(out, /<div[^>]*role="radiogroup"[^>]*>/)
    expect(group['aria-labelledby']).toBe(attrsOf(out, /<label[^>]*>/).id)
    expect(out).toMatch(/<input type="hidden" name="icon" value=""/)
  })
})

describe('Estructura del formulario', () => {
  it('FormError: alerta enfocable; sin mensaje no dibuja nada', () => {
    const out = html(<FormError message="No pudimos guardar. Probá de nuevo." />)
    const box = attrsOf(out, /<div[^>]*>/)
    expect(box.role).toBe('alert')
    expect(box.tabindex).toBe('-1')
    expect(box['data-slot']).toBe('form-error')
    expect(html(<FormError message={null} />)).toBe('')
  })

  it('FormSection con título y FieldRow de 2 columnas', () => {
    const out = html(
      <FormSection title="Datos fiscales" description="Los de la factura" data-tour="fiscal">
        <FieldRow columns={2}>
          <Field label="PV">
            <Input />
          </Field>
        </FieldRow>
      </FormSection>,
    )
    const section = attrsOf(out, /<section[^>]*>/)
    expect(section['data-tour']).toBe('fiscal')
    expect(out).toContain(`id="${section['aria-labelledby']}"`)
    expect(out).toContain('sm:grid-cols-2')
  })

  it('FormActions: barra fija en el celular y data-tour en la raíz', () => {
    const out = html(
      <FormActions data-tour="acciones">
        <Button variant="secondary">Cancelar</Button>
        <SubmitButton>Guardar</SubmitButton>
      </FormActions>,
    )
    expect(attrsOf(out, /<div[^>]*>/)['data-tour']).toBe('acciones')
    expect(out).toContain('max-sm:[@media(min-height:30rem)]:fixed')
  })

  it('Label suelto: type-label en tinta', () => {
    const cls = classesOf(html(<Label htmlFor="x">Nombre</Label>), /<label[^>]*>/)
    expect(cls).toContain('type-label')
    expect(cls).toContain('text-foreground')
  })
})
