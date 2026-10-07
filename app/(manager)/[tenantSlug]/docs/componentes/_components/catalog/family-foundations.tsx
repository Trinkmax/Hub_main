'use client'

import { Search } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ControlSizeProvider } from '@/components/ui/control-size'
import { FilterChip } from '@/components/ui/filter-chip'
import { Input, SearchField } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack, Readout } from './catalog-block'
import { ColorSwatch, ContrastTable } from './contrast-table'

// ─── Color ───────────────────────────────────────────────────────────────────

const COLOR_GROUPS: ReadonlyArray<{
  title: string
  tokens: ReadonlyArray<readonly [token: string, note: string]>
}> = [
  {
    title: 'Superficies',
    tokens: [
      ['--background', 'papel'],
      ['--card', 'cartulina'],
      ['--popover', 'lo que flota'],
      ['--secondary', 'relleno visible'],
      ['--muted', 'relleno sobre cartulina'],
      ['--accent', 'opción resaltada'],
    ],
  },
  {
    title: 'Texto',
    tokens: [
      ['--foreground', 'tinta'],
      ['--muted-foreground', 'texto 2'],
      ['--subtle-foreground', 'apoyo y placeholder'],
    ],
  },
  {
    title: 'Acción y foco',
    tokens: [
      ['--primary', 'el «estás acá»'],
      ['--primary-hover', 'hover'],
      ['--ring', 'foco'],
    ],
  },
  {
    title: 'Líneas',
    tokens: [
      ['--border', 'pelo'],
      ['--border-strong', 'énfasis'],
      ['--input', 'borde de campo'],
      ['--rule', 'regla contable'],
    ],
  },
  {
    title: 'Estados por superposición',
    tokens: [
      ['--hover', 'hover'],
      ['--active', 'presionado'],
      ['--selected', 'elegido'],
      ['--overlay', 'velo'],
      ['--skeleton', 'esqueleto'],
    ],
  },
  {
    title: 'Tonos',
    tokens: [
      ['--success', 'sólido'],
      ['--success-soft', 'suave'],
      ['--success-text', 'texto'],
      ['--warning', 'sólido'],
      ['--warning-soft', 'suave'],
      ['--warning-text', 'texto'],
      ['--destructive', 'sólido'],
      ['--destructive-soft', 'suave'],
      ['--destructive-text', 'texto'],
      ['--info', 'sólido'],
      ['--info-soft', 'suave'],
      ['--info-text', 'texto'],
      ['--gold', 'sello'],
      ['--gold-soft', 'suave'],
      ['--gold-text', 'bronce'],
      ['--brand-soft', 'marca suave'],
      ['--brand-text', 'marca'],
    ],
  },
  {
    title: 'Gráficos (siempre sobre cartulina)',
    tokens: [
      ['--chart-1', 'verde'],
      ['--chart-2', 'ocre'],
      ['--chart-3', 'azul'],
      ['--chart-4', 'terracota'],
      ['--chart-5', 'ciruela'],
    ],
  },
  {
    title: 'Antigüedad de deuda',
    tokens: [
      ['--aging-current', 'al día'],
      ['--aging-soon', 'vence pronto'],
      ['--aging-1-30', '1 a 30 días'],
      ['--aging-31-60', '31 a 60'],
      ['--aging-60-plus', 'más de 60'],
    ],
  },
]

function ColorDemo() {
  return (
    <DemoStack>
      {COLOR_GROUPS.map((group) => (
        <DemoRow key={group.title} label={group.title} className="grid gap-3 sm:grid-cols-2">
          {group.tokens.map(([token, note]) => (
            <ColorSwatch key={token} token={token} note={note} />
          ))}
        </DemoRow>
      ))}
    </DemoStack>
  )
}

// ─── Tipografía ──────────────────────────────────────────────────────────────

const TYPE_SCALE: ReadonlyArray<{ utility: string; spec: string; sample: string }> = [
  {
    utility: 'type-title',
    spec: 'Fraunces · 28/34, 30/36 desde lg · 560',
    sample: 'Distribuidora del Centro SA',
  },
  { utility: 'type-kpi', spec: 'Fraunces · 28/32, 32/36 desde sm · 520', sample: '$ 1.240.000' },
  { utility: 'type-section', spec: 'Inter · 20/28 · 600', sample: 'Próximos vencimientos' },
  { utility: 'type-subtitle', spec: 'Inter · 16/24 · 600', sample: 'Datos fiscales' },
  {
    utility: 'type-body',
    spec: 'Inter · 14/20 · 400',
    sample: 'Cargá el primero para llevar su cuenta corriente.',
  },
  {
    utility: 'type-small',
    spec: 'Inter · 13/18 · 400',
    sample: 'Responsable inscripto · Paga a 21 días',
  },
  { utility: 'type-label', spec: 'Inter · 13/18 · 500', sample: 'Razón social' },
  { utility: 'type-caption', spec: 'Inter · 12/16 · 400 (el mínimo)', sample: 'Con o sin guiones' },
  { utility: 'type-group', spec: 'Inter · 12/16 · 600 · solo el menú', sample: 'Administración' },
  { utility: 'type-amount', spec: 'cifras tabulares, sin cortes', sample: '−$ 1.234,50' },
]

/** Clases enteras (Tailwind no ve las que se arman con plantillas). */
const TYPE_CLASS: Readonly<Record<string, string>> = {
  'type-title': 'type-title',
  'type-kpi': 'type-kpi',
  'type-section': 'type-section',
  'type-subtitle': 'type-subtitle',
  'type-body': 'type-body',
  'type-small': 'type-small',
  'type-label': 'type-label',
  'type-caption': 'type-caption',
  'type-group': 'type-group',
  'type-amount': 'type-amount type-body',
}

function TypographyDemo() {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {TYPE_SCALE.map((item) => (
        <li key={item.utility} className="grid gap-1 py-3 first:pt-0 last:pb-0">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 type-caption">
            <code className="font-mono text-foreground">{item.utility}</code>
            <span className="text-muted-foreground">{item.spec}</span>
          </span>
          <span className={cn('min-w-0 break-words text-foreground', TYPE_CLASS[item.utility])}>
            {item.sample}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ─── Radios y elevación ──────────────────────────────────────────────────────

const RADII: ReadonlyArray<{ className: string; label: string; use: string }> = [
  { className: 'rounded-sm', label: 'rounded-sm', use: 'etiquetas, kbd' },
  { className: 'rounded-md', label: 'rounded-md', use: 'botones, campos' },
  { className: 'rounded-lg', label: 'rounded-lg', use: 'bloques internos' },
  { className: 'rounded-xl', label: 'rounded-xl', use: 'tarjetas, tablas, menús' },
  { className: 'rounded-2xl', label: 'rounded-2xl', use: 'diálogos, hojas' },
  { className: 'rounded-full', label: 'rounded-full', use: 'chips, avatares' },
]

/** Una caja con el radio que mide el navegador (`getComputedStyle`), no el de una tabla. */
function RadiusBox({ className, label, use }: { className: string; label: string; use: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [radius, setRadius] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (ref.current) setRadius(getComputedStyle(ref.current).borderTopLeftRadius)
  }, [])
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        ref={ref}
        aria-hidden="true"
        className={cn('size-12 shrink-0 border border-border-strong bg-card', className)}
      />
      <span className="grid min-w-0 gap-0.5 type-caption">
        <code className="font-mono text-foreground">{label}</code>
        <span className="text-muted-foreground">
          {label === 'rounded-full' ? 'círculo' : (radius ?? '…')} · {use}
        </span>
      </span>
    </div>
  )
}

function RadiiDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {RADII.map((item) => (
        <RadiusBox key={item.label} {...item} />
      ))}
    </div>
  )
}

function ElevationDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="grid gap-1 rounded-xl border border-border bg-card p-4">
        <span className="type-label text-foreground">Quieto</span>
        <span className="type-caption text-muted-foreground">Sin sombra: alcanza con el pelo.</span>
      </div>
      <div className="grid gap-1 rounded-xl border border-border bg-popover p-4 shadow-float">
        <span className="type-label text-foreground">shadow-float</span>
        <span className="type-caption text-muted-foreground">Popover, menú, tooltip, toast.</span>
      </div>
      <div className="grid gap-1 rounded-2xl border border-border bg-popover p-4 shadow-modal">
        <span className="type-label text-foreground">shadow-modal</span>
        <span className="type-caption text-muted-foreground">Diálogo, hoja y paleta.</span>
      </div>
    </div>
  )
}

// ─── Movimiento ──────────────────────────────────────────────────────────────

const MOTION_VARS: ReadonlyArray<readonly [variable: string, use: string]> = [
  ['--duration-press', 'presionar algo chico'],
  ['--duration-quick', 'colores, tooltip, switch'],
  ['--duration-menu', 'menú y popover: entrada'],
  ['--duration-menu-exit', 'menú y popover: salida'],
  ['--duration-overlay', 'diálogo y hoja: entrada'],
  ['--duration-overlay-exit', 'diálogo y hoja: salida'],
]

function MotionDemo() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [on, setOn] = React.useState(true)
  const switchId = React.useId()

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const style = getComputedStyle(element)
    setValues(
      Object.fromEntries(
        MOTION_VARS.map(([variable]) => [variable, style.getPropertyValue(variable).trim()]),
      ),
    )
  }, [])

  return (
    <DemoStack>
      <div ref={ref}>
        <Readout
          items={MOTION_VARS.map(([variable, use]) => ({
            label: use,
            value: `${variable}: ${values[variable] || '…'}`,
          }))}
        />
      </div>
      <DemoRow label="Presionar (utilidad press: escala 0,97 en 140 ms)">
        <Button type="button" variant="secondary">
          Presioná y soltá
        </Button>
        <Button type="button">Guardar</Button>
      </DemoRow>
      <DemoRow label="Switch: la perilla se desplaza en 150 ms">
        <Switch id={switchId} checked={on} onCheckedChange={setOn} />
        <Label htmlFor={switchId}>Avisar por WhatsApp</Label>
      </DemoRow>
    </DemoStack>
  )
}

// ─── Densidad ────────────────────────────────────────────────────────────────

const SIZES = ['sm', 'md', 'lg'] as const

function DensityDemo() {
  return (
    <DemoStack>
      {SIZES.map((size) => (
        <DemoRow key={size} label={`size="${size}": botón y campo miden lo mismo`}>
          <Input
            size={size}
            aria-label={`Buscar, tamaño ${size}`}
            placeholder="Buscar proveedor"
            className="max-w-56"
          />
          <Button type="button" size={size} variant="secondary">
            Exportar
          </Button>
          <Button type="button" size={size}>
            Nuevo proveedor
          </Button>
        </DemoRow>
      ))}
      <DemoRow label='Una fila, un tamaño: ControlSizeProvider size="sm" (la barra de una tabla)'>
        <ControlSizeProvider size="sm">
          <SearchField
            aria-label="Buscar en la tabla"
            placeholder="Buscar por nombre o CUIT"
            className="max-w-60"
          />
          <SegmentedControl
            aria-label="Estado"
            defaultValue="todos"
            items={[
              { value: 'todos', label: 'Todos' },
              { value: 'deuda', label: 'Con deuda' },
              { value: 'vencidos', label: 'Vencidos' },
            ]}
          />
          <Button type="button" variant="secondary">
            <Search aria-hidden="true" />
            Filtrar
          </Button>
        </ControlSizeProvider>
      </DemoRow>
      <DemoRow label="Filas: cómoda (44 px, listas) y compacta (36 px, libros)" stack>
        <div className="grid gap-px overflow-clip rounded-lg border border-border bg-border">
          <div className="flex h-(--row-comfortable) items-center bg-card px-4 type-body">
            Fila cómoda · 44 px
          </div>
          <div className="flex h-(--row-compact) items-center bg-card px-3 type-body">
            Fila compacta · 36 px
          </div>
        </div>
      </DemoRow>
    </DemoStack>
  )
}

// ─── Foco y selección ────────────────────────────────────────────────────────

function FocusDemo() {
  const checkboxId = React.useId()
  return (
    <DemoStack>
      <DemoRow label="Afuera (outline-offset-2): botones, chips, casillas, links">
        <Button type="button" variant="secondary">
          Cancelar
        </Button>
        <FilterChip>Cena</FilterChip>
        <span className="flex items-center gap-2">
          <Checkbox id={checkboxId} />
          <Label htmlFor={checkboxId}>Recordarme</Label>
        </span>
      </DemoRow>
      <DemoRow label="Sobre el borde (-outline-offset-1): campos y disparadores" stack>
        <Input aria-label="Razón social" placeholder="Razón social" className="max-w-72" />
      </DemoRow>
      <DemoRow label="Adentro (-outline-offset-2): pestañas, ítems pegados, celdas" stack>
        <Tabs defaultValue="movimientos">
          <TabsList aria-label="Ficha del proveedor">
            <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
            <TabsTrigger value="comprobantes">Comprobantes</TabsTrigger>
            <TabsTrigger value="pagos">Pagos</TabsTrigger>
          </TabsList>
          <TabsContent value="movimientos" className="type-small text-muted-foreground">
            Con Tab se entra a la pestaña elegida; las flechas mueven.
          </TabsContent>
          <TabsContent value="comprobantes" className="type-small text-muted-foreground">
            Comprobantes del proveedor.
          </TabsContent>
          <TabsContent value="pagos" className="type-small text-muted-foreground">
            Pagos del proveedor.
          </TabsContent>
        </Tabs>
      </DemoRow>
      <DemoRow label="Lo elegido: contorno sobre cartulina en filtros, relleno en lo chico y único">
        <SegmentedControl
          aria-label="Vista"
          defaultValue="mes"
          items={[
            { value: 'dia', label: 'Día' },
            { value: 'mes', label: 'Mes' },
            { value: 'ejercicio', label: 'Ejercicio' },
          ]}
        />
        <FilterChip defaultPressed>Con deuda</FilterChip>
        <span className="inline-flex size-8 items-center justify-center rounded-md bg-primary type-label text-primary-foreground">
          15
        </span>
      </DemoRow>
    </DemoStack>
  )
}

// ─── La familia ──────────────────────────────────────────────────────────────

export function FoundationsFamily() {
  return (
    <CatalogFamily id="fundamentos">
      <CatalogBlock
        id="color"
        purpose="Papel, cartulina y tinta; un solo «estás acá» y los tonos. Cada muestra dice el valor que mide el navegador ahora."
        yes="Siempre por token: `bg-card`, `text-muted-foreground`, `bg-success-soft text-success-text`."
        no="Colores crudos de la paleta de Tailwind (`emerald-*`, `amber-*`), `dark:` en código nuevo u opacidad sobre tokens de texto (`text-muted-foreground/70`)."
        usage={`<div className="rounded-xl border border-border bg-card p-4">
  <p className="type-body text-foreground">Tinta sobre cartulina</p>
  <p className="type-small text-muted-foreground">Texto 2</p>
  <Badge tone="success">Pagada</Badge>
</div>`}
        a11y={[
          'El dorado no es texto en claro (2:1 sobre la cartulina): es un sello, siempre con tinta encima.',
          'De cada tono, el sólido es relleno o punto y el texto va en `-text`: `text-warning-text`, nunca `text-warning`.',
          'El apoyo (`subtle-foreground`) no va sobre `secondary` ni sobre el `selected` del papel: ahí va texto 2.',
        ]}
      >
        <ColorDemo />
      </CatalogBlock>

      <CatalogBlock
        id="contraste"
        wide
        purpose="Cada par de §2.7 medido en este navegador con `getComputedStyle` y la misma cuenta del test: si alguien toca un token, acá se ve."
        yes="Antes de mergear un cambio de tokens, y para revisar «más contraste» del sistema operativo."
        no="No reemplaza al test `tests/lib/tokens-contrast.test.ts`, que mide lo mismo desde `globals.css` en cada PR."
        usage={`import { contrastRatio, parseColor } from '@/lib/color/contrast'

const fg = parseColor(getComputedStyle(muestra).color)        // oklch(…) del token
const bg = parseColor(getComputedStyle(fondo).backgroundColor)
contrastRatio(fg, bg) // 17,48 (tinta sobre cartulina)`}
        a11y={[
          'Mínimos de WCAG 2.x AA: 4,5:1 para texto; 3:1 para bordes de campo, foco e indicadores (1.4.3 y 1.4.11).',
          'Los tokens con alfa (`--hover`, `--selected`) se miden compuestos sobre la superficie donde van.',
          'La barra de antigüedad tiene un tramo debajo de 3:1 en cada modo (medido): por eso su leyenda con montos es obligatoria.',
        ]}
      >
        <ContrastTable />
      </CatalogBlock>

      <CatalogBlock
        id="tipografia"
        purpose="Diez utilidades `type-*`: Fraunces solo para nombres y números; todo lo demás, Inter."
        yes="El título de la página (`type-title`), los números del Resumen (`type-kpi`) y toda plata alineada (`type-amount`)."
        no="Nada por debajo de 12 px. Fraunces nunca en botones, etiquetas o tablas, ni en un número que cambia en vivo: no tiene cifras tabulares."
        usage={`<h1 className="type-title">Proveedores</h1>
<p className="type-small text-muted-foreground">Responsable inscripto</p>
<span className="type-amount">$ 1.234,50</span>`}
        a11y={[
          'Un solo `h1` por página: el de `PageHeader`.',
          'Filas, ítems y opciones con `min-h-*`, no `h-*`: con el espaciado de texto del usuario (WCAG 1.4.12) el texto puede crecer.',
          '`cn()` conoce `type-*`: `cn("type-body", "text-lg")` deja `text-lg`, como cualquier otra clase.',
        ]}
      >
        <TypographyDemo />
      </CatalogBlock>

      <CatalogBlock
        id="radios"
        purpose="Escala 6 · 8 · 8 · 12 · 16 por variables con scope: `rounded-xl` vale 12 px acá y sigue en 14 en el salón, con la misma clase."
        yes="`rounded-md` en botones y campos, `rounded-xl` en tarjetas, tablas y menús, `rounded-2xl` en diálogos y hojas, `rounded-full` en chips y avatares."
        no="Radios arbitrarios (`rounded-[2rem]`). La única excepción documentada es la casilla (`rounded-[4px]`: con 6 px, una caja de 16 se ve redonda)."
        usage={`<Card className="rounded-xl" />   // 12 px
<Button className="rounded-md" /> // 8 px`}
        a11y={[
          'Radios concéntricos: el interno es el externo menos el relleno (un menú `xl` con `p-1` lleva ítems de 8).',
          'El radio no ocupa lugar: cambiarlo nunca mueve el layout ni tapa el foco.',
        ]}
      >
        <RadiiDemo />
      </CatalogBlock>

      <CatalogBlock
        id="elevacion"
        purpose="Lo quieto no tiene sombra: alcanza con el pelo. Solo lo que flota lleva elevación."
        yes="`shadow-float` en popover, menú, select, tooltip y toast; `shadow-modal` en diálogo, hoja y paleta."
        no="Sombra en una tarjeta, una tabla o un botón. `shadow-sm`, `-md` y `-lg` quedan para lo viejo que se migra por lotes."
        usage={`<div className="rounded-xl border border-border bg-popover shadow-float">…</div>`}
        a11y={[
          'En oscuro la sombra casi no se ve: separan el borde de 1 px y el `--popover` más claro.',
          'En alto contraste lo que se ve es el borde, por eso todo lo que flota lo lleva.',
        ]}
      >
        <ElevationDemo />
      </CatalogBlock>

      <CatalogBlock
        id="movimiento"
        purpose="Quieto por defecto y con respuesta: lo que se usa decenas de veces por día no se anima."
        yes="`press` en lo chico (escala 0,97 en 140 ms), 180/120 ms en menús, 220/160 ms en diálogos y hojas, y el sello «Cuadra» en 160 ms."
        no="`transition: all`, ni animar números, pestañas, la paleta ⌘K o el resaltado de una opción (deja estela al moverse con las flechas)."
        usage={`<button className="press …">Guardar</button>
// overlays: duration-(--duration-menu) data-[state=closed]:duration-(--duration-menu-exit) ease-(--ease-ui)`}
        a11y={[
          'Con «reducir movimiento» del sistema, todo pasa a fundido: sin escalas ni desplazamientos.',
          'El hover va detrás de `@media (hover: hover)`: con el dedo no queda pegado.',
        ]}
      >
        <MotionDemo />
      </CatalogBlock>

      <CatalogBlock
        id="densidad"
        purpose="Tres altos de control (32 · 36 · 44 px con mouse; 36 · 44 · 48 con el dedo) y dos de fila (44 y 36)."
        yes="`ControlSizeProvider` para «una fila, un tamaño» (la barra de una tabla va en `sm`) y filas compactas en los libros contables."
        no="Forzar altos con `h-11` o `h-12`: congelan tamaños viejos y no crecen con el dedo."
        usage={`<ControlSizeProvider size="sm">
  <SearchField aria-label="Buscar" />
  <SegmentedControl aria-label="Estado" items={…} />
  <Button variant="secondary">Exportar</Button>
</ControlSizeProvider>`}
        a11y={[
          'Con el dedo, lo que dibuja menos de 44 px agranda su área (utilidad `hit-area`), no su dibujo (WCAG 2.5.8).',
          'El interruptor «Densidad compacta» del encabezado cambia todo el catálogo: controles en `sm` y filas de 36 px.',
        ]}
      >
        <DensityDemo />
      </CatalogBlock>

      <CatalogBlock
        id="foco"
        purpose="Un color, un grosor y tres posiciones para el foco, siempre `outline`; lo elegido, siempre a 3:1 o más."
        yes="Recorré los ejemplos con Tab: afuera en lo suelto, sobre el borde en los campos, adentro en lo que va pegado o recortado."
        no="`focus-visible:ring-*` o `box-shadow` para el foco: desaparecen en el alto contraste de Windows."
        usage={`// afuera
'outline-offset-2 outline-(--ring) focus-visible:outline-2'
// sobre el borde (campos)
'outline-(--ring) -outline-offset-1 focus-visible:outline-2'
// adentro (pestañas, celdas)
'outline-(--ring) -outline-offset-2 focus-visible:outline-2'`}
        a11y={[
          'Nada fijo tapa el foco: el documento tiene `scroll-padding` del alto del topbar y de la barra de acciones (WCAG 2.4.11).',
          'Lo elegido nunca es solo color: contorno, relleno o check (WCAG 1.4.1 y 1.4.11).',
        ]}
      >
        <FocusDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
