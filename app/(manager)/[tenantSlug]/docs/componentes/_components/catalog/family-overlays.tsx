'use client'

import {
  Archive,
  ArrowRightLeft,
  CalendarPlus,
  Copy,
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Users,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { ConfirmDialog, type ConfirmResult, useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toastUndo } from '@/components/ui/toast'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack } from './catalog-block'
import { wait } from './demo-utils'
import { tourId } from './registry'
import { SAMPLE_SUPPLIERS } from './sample-data'

// ─── Dialog ──────────────────────────────────────────────────────────────────

const DIALOG_SIZES = [
  { value: 'sm', label: 'sm · 400' },
  { value: 'md', label: 'md · 520' },
  { value: 'lg', label: 'lg · 720' },
  { value: 'xl', label: 'xl · 960' },
] as const

type DialogSizeValue = (typeof DIALOG_SIZES)[number]['value']

function DialogDemo() {
  const [size, setSize] = React.useState<DialogSizeValue>('md')
  const [open, setOpen] = React.useState(false)
  return (
    <DemoStack>
      <DemoRow label="Tamaño">
        <SegmentedControl
          aria-label="Tamaño del diálogo"
          size="sm"
          items={DIALOG_SIZES}
          value={size}
          onValueChange={setSize}
        />
      </DemoRow>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild data-tour={tourId('dialog-trigger')}>
          <Button type="button">Cambiar la mesa</Button>
        </DialogTrigger>
        <DialogContent size={size}>
          <DialogHeader>
            <DialogTitle>Cambiar la mesa de la reserva</DialogTitle>
            <DialogDescription>
              Cuatro personas a las 21:30. El cuerpo scrollea; el encabezado y el pie quedan fijos.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Mesa nueva">
              <Input defaultValue="14" inputMode="numeric" />
            </Field>
            <Field label="Motivo" optional>
              <Textarea placeholder="Pidieron ventana" />
            </Field>
            <ul className="grid gap-2 type-small text-muted-foreground">
              {SAMPLE_SUPPLIERS.concat(SAMPLE_SUPPLIERS).map((supplier, index) => (
                <li key={`${supplier.id}-${index.toString()}`}>
                  Línea de relleno para ver el scroll del cuerpo · {supplier.name}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              onClick={() => toast.info('Un aviso no cierra el diálogo')}
            >
              Mostrar un aviso
            </Button>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                setOpen(false)
                toast.success('Mesa cambiada')
              }}
            >
              Cambiar mesa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DemoStack>
  )
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

const SHEET_SIDES = [
  { value: 'right', label: 'Derecha' },
  { value: 'left', label: 'Izquierda' },
  { value: 'bottom', label: 'Abajo' },
] as const

type SheetSideValue = (typeof SHEET_SIDES)[number]['value']

function SheetDemo() {
  const [side, setSide] = React.useState<SheetSideValue>('right')
  const supplier = SAMPLE_SUPPLIERS[0]
  return (
    <DemoStack>
      <DemoRow label="Lado">
        <SegmentedControl
          aria-label="Lado de la hoja"
          size="sm"
          items={SHEET_SIDES}
          value={side}
          onValueChange={setSide}
        />
      </DemoRow>
      <Sheet>
        <SheetTrigger asChild data-tour={tourId('sheet-trigger')}>
          <Button type="button" variant="secondary">
            Ver el proveedor
          </Button>
        </SheetTrigger>
        <SheetContent side={side} size="md">
          {side === 'bottom' ? <SheetGrabber /> : null}
          <SheetHeader>
            <SheetTitle>{supplier?.name ?? 'Proveedor'}</SheetTitle>
            <SheetDescription>Bebidas · Responsable inscripto</SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-4">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 type-body">
              <dt className="text-muted-foreground">Saldo</dt>
              <dd className="text-end">
                <Amount cents={supplier?.balanceCents ?? null} />
              </dd>
              <dt className="text-muted-foreground">Plazo de pago</dt>
              <dd className="text-end">21 días</dd>
            </dl>
            <p className="type-small text-muted-foreground">
              Para ver o editar sin perder la lista de atrás.
            </p>
          </SheetBody>
          <SheetFooter>
            <Button type="button">Nuevo pago</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </DemoStack>
  )
}

// ─── ConfirmDialog, useConfirm y AlertDialog ─────────────────────────────────

function RowMenuWithConfirm({ fail }: { fail: boolean }) {
  const confirm = useConfirm()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Acciones de la regla «Happy hour»"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <Pencil aria-hidden="true" />
          Editar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            const ok = await confirm({
              title: '¿Borrar la regla «Happy hour»?',
              description: 'Deja de sumar puntos desde hoy. Los puntos ya dados no se tocan.',
              confirmLabel: 'Borrar regla',
              pendingLabel: 'Borrando…',
              tone: 'danger',
              icon: Trash2,
              onConfirm: async (): Promise<ConfirmResult> => {
                await wait(1000)
                return fail
                  ? { ok: false, error: 'No pudimos borrar la regla. Probá de nuevo.' }
                  : undefined
              },
            })
            if (ok) toast.success('Regla borrada')
          }}
        >
          <Trash2 aria-hidden="true" />
          Borrar…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConfirmDemo() {
  const [fail, setFail] = React.useState(false)
  const switchId = React.useId()

  async function deleteRule(): Promise<ConfirmResult> {
    await wait(1000)
    if (fail) return { ok: false, error: 'No pudimos borrar la regla. Probá de nuevo.' }
    toast.success('Regla borrada')
    return { ok: true }
  }

  return (
    <DemoStack>
      <span className="flex items-center gap-2">
        <Switch id={switchId} checked={fail} onCheckedChange={setFail} />
        <Label htmlFor={switchId}>Simular error (queda abierto con el mensaje)</Label>
      </span>
      <DemoRow label="ConfirmDialog: espera la acción con el diálogo abierto">
        <ConfirmDialog
          tone="danger"
          icon={Trash2}
          title="¿Borrar la regla «2x1 en tragos»?"
          description="Deja de sumar puntos desde hoy. Los puntos ya dados no se tocan."
          confirmLabel="Borrar regla"
          pendingLabel="Borrando…"
          onConfirm={deleteRule}
          trigger={
            <Button type="button" variant="danger-ghost" data-tour={tourId('confirm-trigger')}>
              <Trash2 aria-hidden="true" />
              Borrar regla
            </Button>
          }
        />
        <ConfirmDialog
          title="¿Archivar la etiqueta «Empresa»?"
          description="Deja de aparecer en los filtros. La podés volver a activar."
          confirmLabel="Archivar etiqueta"
          cancelLabel="Volver"
          icon={Archive}
          onConfirm={() => wait(600)}
          trigger={
            <Button type="button" variant="secondary">
              Archivar
            </Button>
          }
        />
      </DemoRow>
      <DemoRow label="useConfirm desde un menú (el diálogo no se desmonta con el menú)">
        <RowMenuWithConfirm fail={fail} />
      </DemoRow>
      <DemoRow label="AlertDialog (compatibilidad, reestilado; lo nuevo va con ConfirmDialog)">
        <AlertDialog>
          <AlertDialogTrigger asChild data-tour={tourId('alert-dialog-trigger')}>
            <Button type="button" variant="ghost">
              Descartar el borrador
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Descartar el borrador?</AlertDialogTitle>
              <AlertDialogDescription>Se pierde lo que escribiste.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <AlertDialogAction variant="danger">Descartar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DemoRow>
    </DemoStack>
  )
}

// ─── Popover ─────────────────────────────────────────────────────────────────

function PopoverDemo() {
  return (
    <DemoRow label="Tamaños: sm · md · lg">
      <Popover>
        <PopoverTrigger asChild data-tour={tourId('popover-trigger')}>
          <Button type="button" variant="secondary">
            Detalle del saldo
          </Button>
        </PopoverTrigger>
        <PopoverContent size="md" align="start">
          <PopoverHeader>
            <PopoverTitle>Saldo de Distribuidora del Centro SA</PopoverTitle>
            <PopoverDescription>Facturas menos pagos del período.</PopoverDescription>
          </PopoverHeader>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 type-small">
            <dt className="text-muted-foreground">Facturas</dt>
            <dd className="text-end">
              <Amount cents={142_000_000} />
            </dd>
            <dt className="text-muted-foreground">Pagos</dt>
            <dd className="text-end">
              <Amount cents={-30_000_000} />
            </dd>
          </dl>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost">
            Chico
          </Button>
        </PopoverTrigger>
        <PopoverContent size="sm">
          <p className="type-small text-muted-foreground">Un dato chico, a 6 px del disparador.</p>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost">
            Grande
          </Button>
        </PopoverTrigger>
        <PopoverContent size="lg">
          <p className="type-small text-muted-foreground">
            384 px de ancho: entra un formulario chico o una lista corta.
          </p>
        </PopoverContent>
      </Popover>
    </DemoRow>
  )
}

// ─── DropdownMenu ────────────────────────────────────────────────────────────

function DropdownDemo() {
  const [showInactive, setShowInactive] = React.useState(false)
  const [order, setOrder] = React.useState('nombre')
  const confirm = useConfirm()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild data-tour={tourId('dropdown-menu-trigger')}>
        <Button
          type="button"
          variant="secondary"
          aria-label="Acciones de Distribuidora del Centro SA"
        >
          Acciones
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Distribuidora del Centro SA</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <Pencil aria-hidden="true" />
            Editar
            <DropdownMenuShortcut>
              <KbdShortcut keys={['mod', 'e']} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy aria-hidden="true" />
            Duplicar
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowRightLeft aria-hidden="true" />
              Mover a…
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Bebidas</DropdownMenuItem>
                <DropdownMenuItem>Cafetería</DropdownMenuItem>
                <DropdownMenuItem>Limpieza</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={showInactive} onCheckedChange={setShowInactive}>
          Mostrar inactivos
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={order} onValueChange={setOrder}>
          <DropdownMenuRadioItem value="nombre">Nombre</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="saldo">Saldo</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            const ok = await confirm({
              title: '¿Borrar a «Distribuidora del Centro SA»?',
              description: 'Se borra el proveedor; sus comprobantes quedan en los libros.',
              confirmLabel: 'Borrar proveedor',
              pendingLabel: 'Borrando…',
              tone: 'danger',
              onConfirm: () => wait(800),
            })
            if (ok) {
              toastUndo('Proveedor borrado', {
                onUndo: () => {
                  toast('Volvió el proveedor')
                },
              })
            }
          }}
        >
          <Trash2 aria-hidden="true" />
          Borrar…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Command ─────────────────────────────────────────────────────────────────

/**
 * El `Command` suelto arranca sin nada elegido: con un `defaultValue` que no
 * es de ningún ítem, cmdk no elige el primero al montarse. Si lo eligiera, lo
 * traería a la vista con `scrollIntoView({ block: 'nearest' })`, que mueve la
 * página entera cuando el bloque se monta fuera de la pantalla (al scrollear
 * o al saltar desde el índice a «Contables»). Con ↑ ↓ o al escribir se elige
 * como siempre.
 */
const NOTHING_SELECTED = 'nada-elegido'

function PaletteItems({ onRun }: { onRun: (label: string) => void }) {
  return (
    <>
      <CommandInput placeholder="Buscar páginas y acciones…" />
      <CommandList>
        <CommandEmpty />
        <CommandGroup heading="Acciones rápidas">
          <CommandItem onSelect={() => onRun('Nueva reserva')}>
            <CalendarPlus aria-hidden="true" />
            Nueva reserva
          </CommandItem>
          <CommandItem onSelect={() => onRun('Nuevo comprobante de compra')}>
            <Receipt aria-hidden="true" />
            Nuevo comprobante de compra
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Ir a">
          <CommandItem onSelect={() => onRun('Resumen')}>
            <LayoutDashboard aria-hidden="true" />
            Resumen
          </CommandItem>
          <CommandItem onSelect={() => onRun('Clientes')}>
            <Users aria-hidden="true" />
            Clientes
            <CommandShortcut>Club › Clientes</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => onRun('Proveedores')}>
            <FileText aria-hidden="true" />
            Proveedores
            <CommandShortcut>Administración › Proveedores</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </>
  )
}

function CommandDemo() {
  const [open, setOpen] = React.useState(false)
  const run = (label: string) => {
    setOpen(false)
    toast(`Elegiste «${label}»`)
  }
  return (
    <DemoStack>
      <DemoRow label="Command suelto (la lista con su buscador)" stack>
        <Command
          className="rounded-xl border border-border"
          label="Buscar páginas y acciones"
          defaultValue={NOTHING_SELECTED}
          data-tour={tourId('command')}
        >
          <PaletteItems onRun={(label) => toast(`Elegiste «${label}»`)} />
          <CommandFooter />
        </Command>
      </DemoRow>
      <DemoRow label="CommandDialog: la paleta, sin animación (abre al instante)">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Abrir la paleta de ejemplo
        </Button>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <PaletteItems onRun={run} />
          <CommandFooter />
        </CommandDialog>
      </DemoRow>
    </DemoStack>
  )
}

export function OverlaysFamily() {
  return (
    <CatalogFamily id="superposiciones">
      <CatalogBlock
        id="dialog"
        purpose="Para decidir algo sin perder la pantalla: encabezado, cuerpo que scrollea y pie fijos."
        yes="Una decisión o un formulario corto que no merece pantalla propia (cambiar la mesa de una reserva)."
        no="Ver o editar sin perder la lista (`Sheet`), borrar (`ConfirmDialog`) o un dato chico (`Popover`)."
        usage={`<Dialog>
  <DialogTrigger asChild><Button>Cambiar la mesa</Button></DialogTrigger>
  <DialogContent size="md">
    <DialogHeader>
      <DialogTitle>Cambiar la mesa</DialogTitle>
      <DialogDescription>…</DialogDescription>
    </DialogHeader>
    <DialogBody>…</DialogBody>
    <DialogFooter>
      <DialogClose asChild><Button variant="secondary">Cancelar</Button></DialogClose>
      <Button>Cambiar mesa</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`}
        a11y={[
          'Radix: el foco queda atrapado adentro, Esc cierra y vuelve al disparador, `aria-modal` y título y descripción conectados.',
          'Al abrir, el foco va al primer campo; la X («Cerrar») va al final del orden de Tab.',
          'Alto máximo `min(85dvh, 760px)`: con `DialogBody`, scrollea solo el cuerpo y el título nunca se pierde.',
        ]}
      >
        <DialogDemo />
      </CatalogBlock>

      <CatalogBlock
        id="sheet"
        sample
        purpose="Para ver o editar sin perder la lista de atrás: lateral por defecto, abajo en el celular."
        yes="El detalle de una fila, un formulario mediano, el cajón del menú en el celular."
        no="Una decisión corta (`Dialog`)."
        usage={`<Sheet>
  <SheetTrigger asChild><Button variant="secondary">Ver el proveedor</Button></SheetTrigger>
  <SheetContent side="right" size="md">
    <SheetHeader><SheetTitle>…</SheetTitle></SheetHeader>
    <SheetBody>…</SheetBody>
    <SheetFooter><Button>Nuevo pago</Button></SheetFooter>
  </SheetContent>
</Sheet>`}
        a11y={[
          'Igual que el diálogo: foco atrapado, Esc y «Cerrar»; la manija de abajo es decorativa (nunca la única forma de cerrar, WCAG 2.5.7).',
          'Entra en 220 ms desde su borde; con «reducir movimiento», solo fundido.',
        ]}
      >
        <SheetDemo />
      </CatalogBlock>

      <CatalogBlock
        id="confirm-dialog"
        purpose="La confirmación estándar: espera la acción con el diálogo abierto y, si falla, queda abierto con el error adentro."
        yes="Todo lo destructivo o difícil de deshacer. Desde un menú, `useConfirm()` en el `onSelect`."
        no="Un cambio que se revierte desde la pantalla: ahí va `toastUndo`, no una pregunta."
        usage={`<ConfirmDialog
  tone="danger"
  title="¿Borrar la regla «2x1 en tragos»?"
  description="Deja de sumar puntos desde hoy."
  confirmLabel="Borrar regla"
  pendingLabel="Borrando…"
  onConfirm={() => deleteRule(id)}   // { ok: false, error } lo deja abierto
  trigger={<Button variant="danger-ghost">Borrar regla</Button>}
/>

const confirm = useConfirm()
<DropdownMenuItem variant="destructive" onSelect={async () => {
  if (await confirm({ title: '¿Borrar…?', confirmLabel: 'Borrar', onConfirm })) toast.success('Borrada')
}}>Borrar…</DropdownMenuItem>`}
        a11y={[
          'Al abrir, el foco va a «Cancelar» (lo menos destructivo).',
          'Mientras espera, los botones quedan `aria-disabled` (no `disabled`: perderían el foco) y ni Esc ni el velo cierran.',
          'Si la acción falla, el error aparece adentro (`role="alert"`) y el foco vuelve a «Confirmar».',
          'Al cerrar, el foco vuelve al disparador; si se borró su fila, a `returnFocus()` o al `h1`. Nunca al `<body>`.',
        ]}
      >
        <ConfirmDemo />
      </CatalogBlock>

      <CatalogBlock
        id="popover"
        sample
        purpose="Un dato chico sin salir de la pantalla, a 6 px de su disparador."
        yes="El detalle de un número, un filtro chico, una explicación con más de una línea."
        no="Un formulario largo (`Sheet`) o un nombre de ícono (`Tooltip`)."
        usage={`<Popover>
  <PopoverTrigger asChild><Button variant="secondary">Detalle del saldo</Button></PopoverTrigger>
  <PopoverContent size="md">
    <PopoverHeader><PopoverTitle>Saldo</PopoverTitle></PopoverHeader>
    …
  </PopoverContent>
</Popover>`}
        a11y={[
          'Esc cierra y devuelve el foco al disparador; Tab sigue adentro del contenido.',
          'Sale de su disparador en 180 ms y se va en 120 ms; con «reducir movimiento», solo fundido.',
        ]}
      >
        <PopoverDemo />
      </CatalogBlock>

      <CatalogBlock
        id="dropdown-menu"
        purpose="Las acciones de una fila o de una pantalla en un menú: ítems, casillas, radios, submenús y atajos."
        yes="Acciones secundarias que no entran a la vista (el «⋯» de una fila)."
        no="Elegir un valor de formulario (`Select`) o navegar entre secciones (`TabsNav`)."
        usage={`<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button size="icon" variant="ghost" aria-label="Acciones de la regla"><MoreHorizontal /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem>Editar</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" onSelect={borrarConConfirm}>Borrar…</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>`}
        a11y={[
          'Menú de Radix: ↑ ↓ recorren, → abre el submenú, ← lo cierra, Esc cierra y búsqueda por tipeo.',
          'El resaltado no se anima (se mueve con las flechas); el ítem destructivo resaltado va en `destructive-soft` (5,52:1).',
          'Adentro de un menú no va un `ConfirmDialog`: `useConfirm()` lo abre afuera y devuelve el foco al «⋯».',
        ]}
      >
        <DropdownDemo />
      </CatalogBlock>

      <CatalogBlock
        id="command"
        purpose="La paleta ⌘K: buscar páginas y acciones, sobre cmdk. Abre al instante, sin animación."
        yes="La paleta del shell (`CommandDialog`) y, suelto, una lista con buscador."
        no="Elegir un valor de formulario (`Combobox`)."
        usage={`<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Buscar páginas y acciones…" />
  <CommandList>
    <CommandEmpty />
    <CommandGroup heading="Ir a">
      <CommandItem onSelect={…}>Resumen</CommandItem>
    </CommandGroup>
  </CommandList>
  <CommandFooter />
</CommandDialog>`}
        a11y={[
          '↑ ↓ recorren, Enter abre, Esc cierra; el pie lo dice con teclas (se esconde con el dedo).',
          'El vacío dice qué se buscó: «No encontramos nada con «xyz».».',
          'El diálogo tiene título y descripción para el lector («Buscar y navegar»).',
          'Suelto en una página, sin nada elegido de entrada (un `defaultValue` que no es de ningún ítem): si no, cmdk elige el primero al montarse, lo trae a la vista y la página salta hasta la lista.',
        ]}
      >
        <CommandDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
