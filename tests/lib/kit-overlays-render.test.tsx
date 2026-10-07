// @vitest-environment node
import { Trash2 } from 'lucide-react'
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@/components/theme/theme-provider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  type ConfirmActionState,
  ConfirmDialog,
  type ConfirmResult,
  confirmFailureMessage,
  useConfirm,
} from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InfoTip } from '@/components/ui/info-tip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Kit HUB §3.7 (superposiciones) en el HTML del server. Los `Portal` de Radix
 * no dibujan nada en el server (montan después de hidratar), así que acá se
 * reemplazan por un pase directo: lo que se prueba es el contenido del
 * overlay abierto (copy, roles, nombres, clases del kit y compatibilidad),
 * no el portal.
 */

// vi.mock se iza arriba de todo: el pase directo tiene que izarse con él.
const { Passthrough } = vi.hoisted(() => ({
  Passthrough: ({ children }: { children?: ReactNode }) => children,
}))

// El ThemeProvider importa la Server Action del tema: acá no hace falta.
vi.mock('@/lib/theme/actions', () => ({ setThemePreferenceAction: vi.fn() }))
vi.mock('@radix-ui/react-alert-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-alert-dialog')>()
  return { ...actual, Portal: Passthrough }
})
vi.mock('@radix-ui/react-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dialog')>()
  return { ...actual, Portal: Passthrough }
})
vi.mock('@radix-ui/react-dropdown-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dropdown-menu')>()
  return { ...actual, Portal: Passthrough }
})
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>()
  return {
    ...actual,
    Popover: { ...actual.Popover, Portal: Passthrough },
    Tooltip: { ...actual.Tooltip, Portal: Passthrough },
  }
})

const render = (el: ReactElement) => renderToStaticMarkup(el)

/**
 * `data-tour` por spread: TypeScript acepta `data-*` en JSX pero no en un
 * objeto literal de `createElement`. Los 46 anclajes de los tours dependen de
 * que llegue al DOM (kit §3.0).
 */
const tour = (value: string) => ({ 'data-tour': value }) as const

/** Atributos del primer elemento que tenga `data-slot="<slot>"`. */
function slotAttrs(html: string, slot: string): Record<string, string> {
  const tag = html.match(new RegExp(`<[a-z0-9]+[^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? ''
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', v ?? '']),
  )
}

const classesOf = (html: string, slot: string) =>
  new Set((slotAttrs(html, slot).class ?? '').split(/\s+/).filter(Boolean))

/** El texto de los botones, en orden. */
const buttonTexts = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) =>
    (inner ?? '').replace(/<[^>]+>/g, '').trim(),
  )

// ─── ConfirmDialog ───────────────────────────────────────────────────────────

describe('ConfirmDialog', () => {
  const base = {
    open: true,
    title: '¿Borrar la regla «2x1 en tragos»?',
    description: 'Deja de sumar puntos desde hoy. Los puntos ya dados no se tocan.',
    confirmLabel: 'Borrar regla',
  } as const

  it('es un alertdialog con la pregunta, la consecuencia y los dos verbos', () => {
    const html = render(h(ConfirmDialog, { ...base, onConfirm: vi.fn() }))
    const content = slotAttrs(html, 'confirm-dialog')
    expect(content.role).toBe('alertdialog')
    expect(html).toContain('¿Borrar la regla «2x1 en tragos»?')
    expect(html).toContain('Deja de sumar puntos desde hoy.')
    // «Cancelar» por defecto y antes del principal en el DOM (en el celular
    // quedan apilados con el principal arriba: flex-col-reverse).
    expect(buttonTexts(html)).toEqual(['Cancelar', 'Borrar regla'])
    // Título y descripción conectados al diálogo.
    const title = slotAttrs(html, 'confirm-dialog-title')
    const description = slotAttrs(html, 'confirm-dialog-description')
    expect(content['aria-labelledby']).toBe(title.id)
    expect(content['aria-describedby']).toBe(description.id)
  })

  it('la descripción acepta nodos: va en un div, nunca un div adentro de un p', () => {
    const html = render(
      h(ConfirmDialog, {
        ...base,
        description: h('div', null, h('strong', null, '3'), ' reservas'),
      }),
    )
    expect(html).not.toMatch(/<p[^>]*>\s*<div/)
    expect(slotAttrs(html, 'confirm-dialog-description')).toBeTruthy()
    expect(html).toContain('<strong>3</strong> reservas')
  })

  it('sin descripción no queda un aria-describedby colgado', () => {
    const html = render(h(ConfirmDialog, { ...base, description: undefined }))
    expect(slotAttrs(html, 'confirm-dialog')['aria-describedby']).toBeUndefined()
  })

  it('tone danger: botón danger e ícono en disco destructive-soft', () => {
    const html = render(h(ConfirmDialog, { ...base, tone: 'danger', icon: Trash2 }))
    expect(slotAttrs(html, 'confirm-dialog')['data-tone']).toBe('danger')
    const icon = classesOf(html, 'confirm-dialog-icon')
    expect(icon).toContain('bg-destructive-soft')
    expect(icon).toContain('text-destructive-text')
    expect(slotAttrs(html, 'confirm-dialog-icon')['aria-hidden']).toBe('true')
    const confirm = html.match(/<button[^>]*>Borrar regla<\/button>/)?.[0] ?? ''
    expect(confirm).toContain('bg-destructive')
  })

  it('tono default: botón primario y sin ícono si no se pide', () => {
    const html = render(h(ConfirmDialog, { ...base }))
    expect(slotAttrs(html, 'confirm-dialog')['data-tone']).toBe('default')
    expect(html).not.toContain('data-slot="confirm-dialog-icon"')
    const confirm = html.match(/<button[^>]*>Borrar regla<\/button>/)?.[0] ?? ''
    expect(confirm).toContain('bg-primary')
  })

  it('«Volver» cuando cancelar no pierde nada, y confirmar enfocable aunque esté bloqueado', () => {
    const html = render(h(ConfirmDialog, { ...base, cancelLabel: 'Volver', confirmDisabled: true }))
    expect(buttonTexts(html)).toEqual(['Volver', 'Borrar regla'])
    const confirm = html.match(/<button[^>]*>Borrar regla<\/button>/)?.[0] ?? ''
    expect(confirm).toContain('aria-disabled="true"')
    expect(confirm).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('mide 400 px (sm) con el alto máximo del kit', () => {
    const html = render(h(ConfirmDialog, { ...base }))
    const classes = classesOf(html, 'confirm-dialog')
    expect(classes).toContain('sm:max-w-[min(25rem,calc(100%-2rem))]')
    expect(classes).toContain('max-h-[min(85dvh,760px)]')
    expect(classes).toContain('rounded-2xl')
  })

  it('modo Server Action: un <form> con los campos ocultos, los extra y el submit', () => {
    const formAction = async (): Promise<ConfirmActionState> => ({ ok: true })
    const html = render(
      h(
        ConfirmDialog,
        {
          ...base,
          title: '¿Cancelar la reserva de Ana?',
          confirmLabel: 'Cancelar reserva',
          cancelLabel: 'Volver',
          formAction,
          hiddenFields: { reservationId: 'r-1', tenantSlug: 'hub' },
        },
        h('textarea', { name: 'reason', 'aria-label': 'Motivo' }),
      ),
    )
    const form = html.match(/<form[^>]*data-slot="confirm-dialog-form"[\s\S]*<\/form>/)?.[0] ?? ''
    expect(form).toContain('<input type="hidden" name="reservationId" value="r-1"/>')
    expect(form).toContain('<input type="hidden" name="tenantSlug" value="hub"/>')
    expect(form).toContain('name="reason"')
    expect(form).toMatch(/<button[^>]*type="submit"[^>]*>Cancelar reserva<\/button>/)
    // «Volver» no envía el formulario.
    expect(form).toMatch(/<button[^>]*type="button"[^>]*>Volver<\/button>/)
  })

  it('el resultado de la casa entra sin adaptar: { ok: false, message } es el error del diálogo', () => {
    // El mismo mensaje sale de `message` (Server Actions de la casa) y de
    // `error` (formularios del kit); sin ninguno, el genérico.
    expect(confirmFailureMessage({ ok: false, message: 'Sin permisos.' })).toBe('Sin permisos.')
    expect(confirmFailureMessage({ ok: false, error: 'Tiene mesas activas.' })).toBe(
      'Tiene mesas activas.',
    )
    expect(confirmFailureMessage({ ok: false, error: '', message: 'Del server.' })).toBe(
      'Del server.',
    )
    expect(confirmFailureMessage({ ok: false })).toBe('No se pudo completar. Probá de nuevo.')
    expect(confirmFailureMessage({ ok: false, message: '   ' })).toBe(
      'No se pudo completar. Probá de nuevo.',
    )
    // Lo que no es un fallo no tiene mensaje: el diálogo se cierra.
    expect(confirmFailureMessage({ ok: true })).toBeNull()
    expect(confirmFailureMessage(undefined)).toBeNull()
    expect(confirmFailureMessage(null)).toBeNull()
  })

  it('formAction y onConfirm aceptan el ActionState de la casa tal cual', () => {
    // El tipo de lib/<dominio>/actions.ts: { ok: true, … } | { ok: false, message }.
    type HouseState = { ok: true; message?: string; id?: string } | { ok: false; message: string }
    const houseAction = async (_prev: HouseState | null, formData: FormData) =>
      formData.get('id')
        ? ({ ok: true, id: 'a-1' } satisfies HouseState)
        : ({ ok: false, message: 'Falta la audiencia.' } satisfies HouseState)
    const remove = async (): Promise<HouseState> => ({ ok: false, message: 'Sin permisos.' })
    const html = render(
      h(ConfirmDialog<HouseState>, {
        ...base,
        formAction: houseAction,
        hiddenFields: { id: 'a-1' },
      }),
    )
    expect(html).toContain('data-slot="confirm-dialog-form"')
    expect(html).toContain('<input type="hidden" name="id" value="a-1"/>')
    // Modo cliente: el resultado de la acción se devuelve sin mapear.
    const onConfirm = async (): Promise<ConfirmResult> => {
      const r = await remove()
      if (!r.ok) return r
    }
    expect(render(h(ConfirmDialog, { ...base, onConfirm }))).toContain('Borrar regla')
  })

  it('cerrado no dibuja nada; con trigger, dibuja solo el disparador', () => {
    expect(render(h(ConfirmDialog, { ...base, open: false }))).toBe('')
    const html = render(
      h(ConfirmDialog, {
        ...base,
        open: undefined,
        trigger: h('button', { type: 'button', 'data-tour': 'borrar' }, 'Borrar'),
      }),
    )
    expect(html).toContain('data-tour="borrar"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('role="alertdialog"')
  })

  it('useConfirm sin ConfirmProvider avisa qué falta', () => {
    const Probe = () => {
      useConfirm()
      return null
    }
    expect(() => render(h(Probe))).toThrow(/ConfirmProvider/)
  })
})

// ─── AlertDialog (compatibilidad) ────────────────────────────────────────────

describe('AlertDialog', () => {
  it('mismas piezas, reestiladas: Action suma variant y las clases a mano siguen ganando', () => {
    const html = render(
      h(
        AlertDialog,
        { open: true },
        h(
          AlertDialogContent,
          { 'aria-describedby': undefined },
          h(AlertDialogTitle, null, '¿Borrar?'),
          h(AlertDialogAction, { variant: 'danger' }, 'Borrar'),
          h(
            AlertDialogAction,
            { className: 'bg-destructive text-destructive-foreground hover:bg-destructive/90' },
            'Borrar igual',
          ),
        ),
      ),
    )
    expect(slotAttrs(html, 'alert-dialog-content').role).toBe('alertdialog')
    expect(classesOf(html, 'alert-dialog-content')).toContain('rounded-2xl')
    expect(classesOf(html, 'alert-dialog-title')).toContain('type-section')
    const [danger, legacy] = [
      ...html.matchAll(/<button[^>]*data-slot="alert-dialog-action"[^>]*>/g),
    ]
    expect(danger?.[0]).toContain('bg-destructive')
    expect(legacy?.[0]).toContain('bg-destructive')
    expect(legacy?.[0]).not.toContain('bg-primary ')
  })
})

// ─── Dialog ──────────────────────────────────────────────────────────────────

describe('Dialog', () => {
  it('la X dice «Cerrar», va al final y el contenido pasa data-tour', () => {
    const html = render(
      h(
        Dialog,
        { open: true },
        h(
          DialogContent,
          { ...tour('x'), 'aria-describedby': undefined },
          h(DialogHeader, null, h(DialogTitle, null, 'Editar etiqueta')),
          h(DialogBody, null, 'cuerpo'),
          h(DialogFooter, null, h('button', { type: 'button' }, 'Guardar')),
        ),
      ),
    )
    expect(slotAttrs(html, 'dialog-content')['data-tour']).toBe('x')
    expect(slotAttrs(html, 'dialog-content')['data-size']).toBe('md')
    expect(slotAttrs(html, 'dialog-close-button')['aria-label']).toBe('Cerrar')
    expect(buttonTexts(html).at(-1)).toBe('')
    expect(classesOf(html, 'dialog-body')).toContain('overflow-y-auto')
    expect(classesOf(html, 'dialog-title')).toContain('type-section')
  })

  it('size y showCloseButton', () => {
    const html = render(
      h(
        Dialog,
        { open: true },
        h(
          DialogContent,
          { size: 'xl', showCloseButton: false, 'aria-describedby': undefined },
          h(DialogTitle, null, 'Vista previa'),
        ),
      ),
    )
    expect(classesOf(html, 'dialog-content')).toContain('sm:max-w-[min(60rem,calc(100%-2rem))]')
    expect(html).not.toContain('data-slot="dialog-close-button"')
  })

  it('un h-* del que llama manda sobre el alto máximo (vista previa de páginas)', () => {
    const html = render(
      h(
        Dialog,
        { open: true },
        h(
          DialogContent,
          { className: 'h-[92dvh] w-[96vw] max-w-none p-0', 'aria-describedby': undefined },
          h(DialogTitle, null, 'Vista previa'),
        ),
      ),
    )
    const classes = classesOf(html, 'dialog-content')
    expect(classes).toContain('h-[92dvh]')
    expect(classes).not.toContain('max-h-[min(85dvh,760px)]')
    expect(classes).not.toContain('w-full')
  })
})

// ─── Sheet ───────────────────────────────────────────────────────────────────

describe('Sheet', () => {
  it('showCloseButton={false} apaga la X; la manija es decorativa', () => {
    const html = render(
      h(
        Sheet,
        { open: true },
        h(
          SheetContent,
          { side: 'bottom', showCloseButton: false, 'aria-describedby': undefined },
          h(SheetGrabber),
          h(SheetTitle, { className: 'sr-only' }, 'Reserva'),
        ),
      ),
    )
    expect(slotAttrs(html, 'sheet-content')['data-side']).toBe('bottom')
    expect(classesOf(html, 'sheet-content')).toContain('rounded-t-2xl')
    expect(html).not.toContain('data-slot="sheet-close-button"')
    expect(slotAttrs(html, 'sheet-grabber')['aria-hidden']).toBe('true')
  })

  it('SheetFooter: apilado por defecto; inline en una fila a la derecha, parejo en el celular', () => {
    const footer = (layout?: 'stack' | 'inline') =>
      render(
        h(
          Sheet,
          { open: true },
          h(
            SheetContent,
            { 'aria-describedby': undefined },
            h(SheetTitle, null, 'Gestor'),
            h(
              SheetFooter,
              { layout, ...tour('pie') },
              h('button', { type: 'button' }, 'Cancelar'),
              h('button', { type: 'submit' }, 'Guardar'),
            ),
          ),
        ),
      )
    const stack = footer()
    expect(slotAttrs(stack, 'sheet-footer')['data-layout']).toBe('stack')
    expect(slotAttrs(stack, 'sheet-footer')['data-tour']).toBe('pie')
    expect(classesOf(stack, 'sheet-footer')).toContain('flex-col')
    // React escapa `&` y `>` en los atributos: se leen como en el DOM.
    const inline = new Set(
      [...classesOf(footer('inline'), 'sheet-footer')].map((c) =>
        c.replace(/&amp;/g, '&').replace(/&gt;/g, '>'),
      ),
    )
    expect(inline).not.toContain('flex-col')
    for (const c of ['flex-row', 'flex-wrap', 'justify-end', 'max-sm:[&>*]:flex-1']) {
      expect(inline).toContain(c)
    }
    // El pelo y el área segura del iPhone, en los dos.
    expect(inline).toContain('border-t')
    expect(inline).toContain('pb-[max(1rem,env(safe-area-inset-bottom))]')
    expect(buttonTexts(footer('inline')).slice(0, 2)).toEqual(['Cancelar', 'Guardar'])
  })

  it('lateral: ancho por size, X con «Cerrar», encabezado y cuerpo del kit', () => {
    const html = render(
      h(
        Sheet,
        { open: true },
        h(
          SheetContent,
          { size: 'lg', 'aria-describedby': undefined },
          h(SheetHeader, null, h(SheetTitle, null, 'Filtros')),
          h(SheetBody, null, 'cuerpo'),
        ),
      ),
    )
    const classes = classesOf(html, 'sheet-content')
    expect(classes).toContain('[--sheet-w:40rem]')
    expect(classes).toContain('w-[min(100vw,var(--sheet-w))]')
    expect(slotAttrs(html, 'sheet-close-button')['aria-label']).toBe('Cerrar')
    expect(classesOf(html, 'sheet-header')).toContain('border-b')
    expect(classesOf(html, 'sheet-body')).toContain('overflow-y-auto')
  })

  it('un ancho del que llama sigue ganando (w-full sm:max-w-md)', () => {
    const html = render(
      h(
        Sheet,
        { open: true },
        h(
          SheetContent,
          { className: 'w-full sm:max-w-md', 'aria-describedby': undefined },
          h(SheetTitle, null, 'Detalle'),
        ),
      ),
    )
    const classes = classesOf(html, 'sheet-content')
    expect(classes).toContain('w-full')
    expect(classes).not.toContain('w-[min(100vw,var(--sheet-w))]')
  })
})

// ─── Command ─────────────────────────────────────────────────────────────────

describe('CommandDialog', () => {
  it('en español por defecto, sin animación y sin X', () => {
    const html = render(
      h(
        CommandDialog,
        { open: true },
        h(CommandInput, { placeholder: 'Buscar páginas y acciones…' }),
        h(CommandList, null, h(CommandItem, { value: 'reservas' }, 'Reservas')),
        h(CommandFooter),
      ),
    )
    expect(html).toContain('Buscar y navegar')
    expect(html).toContain('Escribí el nombre de una página o una acción.')
    const content = classesOf(html, 'command-dialog-content')
    expect([...content].some((c) => c.includes('animate'))).toBe(false)
    expect(content).toContain('top-[12vh]')
    expect(html).not.toContain('data-slot="command-dialog-close"')
    expect(html).toContain('para moverte')
    expect(html).toContain('para abrir')
    expect(html).toContain('para cerrar')
  })
})

describe('CommandEmpty', () => {
  it('sin children dice que no hay nada (con lo buscado, cuando hay búsqueda)', () => {
    const html = render(h(CommandDialog, { open: true }, h(CommandList, null, h(CommandEmpty))))
    expect(html).toContain('No encontramos nada.')
  })

  it('los children del que llama siguen ganando', () => {
    const html = render(
      h(CommandDialog, { open: true }, h(CommandList, null, h(CommandEmpty, null, 'Nada por acá'))),
    )
    expect(html).toContain('Nada por acá')
    expect(html).not.toContain('No encontramos nada')
  })
})

// ─── DropdownMenu ────────────────────────────────────────────────────────────

describe('DropdownMenu', () => {
  it('destructivo en texto de peligro y etiqueta de grupo en minúscula normal', () => {
    const html = render(
      h(
        DropdownMenu,
        { open: true },
        h(DropdownMenuTrigger, null, 'Más'),
        h(
          DropdownMenuContent,
          null,
          h(DropdownMenuLabel, null, 'Página'),
          h(DropdownMenuItem, { variant: 'destructive' }, 'Borrar'),
        ),
      ),
    )
    expect(classesOf(html, 'dropdown-menu-content')).toContain('rounded-xl')
    expect(classesOf(html, 'dropdown-menu-content')).toContain('min-w-48')
    expect(classesOf(html, 'dropdown-menu-label')).toContain('type-caption')
    expect(classesOf(html, 'dropdown-menu-label')).not.toContain('uppercase')
    expect(slotAttrs(html, 'dropdown-menu-item')['data-variant']).toBe('destructive')
    expect(classesOf(html, 'dropdown-menu-item')).toContain(
      'data-[variant=destructive]:text-destructive-text',
    )
  })
})

// ─── Popover, Tooltip e InfoTip ──────────────────────────────────────────────

describe('Popover y Tooltip', () => {
  it('Popover: cartulina flotante con el tamaño pedido', () => {
    const html = render(
      h(
        Popover,
        { open: true },
        h(PopoverTrigger, null, 'Abrir'),
        h(PopoverContent, { size: 'lg' }, 'Cupo del día'),
      ),
    )
    const classes = classesOf(html, 'popover-content')
    expect(classes).toContain('w-96')
    expect(classes).toContain('shadow-float')
    expect(classes).toContain('rounded-xl')
  })

  it('un Tooltip sin TooltipProvider arriba no explota (se arma uno propio)', () => {
    const html = render(
      h(
        Tooltip,
        { open: true },
        h(TooltipTrigger, null, 'i'),
        h(TooltipContent, null, 'Ocultar menú'),
      ),
    )
    expect(html).toContain('Ocultar menú')
    const classes = classesOf(html, 'tooltip-content')
    expect(classes).toContain('bg-foreground')
    expect(classes).toContain('data-[state=delayed-open]:animate-in')
  })

  it('InfoTip: botón con nombre, ícono decorativo y área táctil', () => {
    const html = render(
      <InfoTip label="Qué son los cubiertos" data-tour="cubiertos">
        Personas sentadas.
      </InfoTip>,
    )
    const button = slotAttrs(html, 'info-tip')
    expect(button['aria-label']).toBe('Qué son los cubiertos')
    expect(button.type).toBe('button')
    expect(button['data-tour']).toBe('cubiertos')
    expect(classesOf(html, 'info-tip')).toContain('hit-area')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    // Cerrado: la explicación todavía no está en el HTML.
    expect(html).not.toContain('Personas sentadas.')
  })
})

// ─── Toaster ─────────────────────────────────────────────────────────────────

describe('Toaster', () => {
  it('anuncia los avisos en español (no «Notifications alt+T»)', () => {
    const html = render(
      <ThemeProvider initialPreference="dark">
        <Toaster />
      </ThemeProvider>,
    )
    expect(html).toContain('aria-label="Avisos alt+T"')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('Notifications')
  })
})
