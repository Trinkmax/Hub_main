'use client'

import {
  Building2,
  CalendarDays,
  Coins,
  FileText,
  Receipt,
  Star,
  Users,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'
import { SectionNav } from '@/components/ui/section-nav'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Steps } from '@/components/ui/steps'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabsNav } from '@/components/ui/tabs-nav'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { tourId } from './registry'

// ─── Tabs y TabsNav ──────────────────────────────────────────────────────────

function TabsDemo() {
  const { basePath } = useCatalog()
  // La primera es esta página (queda activa); las demás son anclas de esta
  // misma página: tocarlas no navega a otra ruta.
  const navItems = [
    { href: basePath, label: 'Movimientos', exact: true },
    { href: `${basePath}#tabs`, label: 'Comprobantes', count: 12 },
    { href: `${basePath}#tabs-pagos`, label: 'Pagos' },
    { href: `${basePath}#tabs-datos`, label: 'Datos' },
  ]
  return (
    <DemoStack>
      <DemoRow label="Tabs: secciones de una página (Radix)" stack>
        <Tabs defaultValue="movimientos">
          <TabsList aria-label="Ficha del proveedor" data-tour={tourId('tabs-list')}>
            <TabsTrigger value="movimientos" icon={Wallet}>
              Movimientos
            </TabsTrigger>
            <TabsTrigger value="comprobantes" icon={Receipt} count={12}>
              Comprobantes
            </TabsTrigger>
            <TabsTrigger value="pagos" icon={Coins}>
              Pagos
            </TabsTrigger>
            <TabsTrigger value="notas" disabled>
              Notas
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="movimientos"
            className="type-small text-muted-foreground"
            data-tour={tourId('tabs-content')}
          >
            Los movimientos de la cuenta corriente.
          </TabsContent>
          <TabsContent value="comprobantes" className="type-small text-muted-foreground">
            Doce comprobantes cargados.
          </TabsContent>
          <TabsContent value="pagos" className="type-small text-muted-foreground">
            Los pagos del período.
          </TabsContent>
        </Tabs>
      </DemoRow>
      <DemoRow label="TabsNav: subpáginas por ruta (links con aria-current)" stack>
        <TabsNav
          aria-label="Secciones del proveedor"
          items={navItems}
          data-tour={tourId('tabs-nav')}
        />
      </DemoRow>
    </DemoStack>
  )
}

// ─── SectionNav ──────────────────────────────────────────────────────────────

function SectionNavDemo() {
  const { basePath } = useCatalog()
  return (
    <SectionNav
      aria-label="Secciones de Configuración"
      data-tour={tourId('section-nav')}
      items={[
        { href: basePath, label: 'Equipo', icon: Users, group: 'Cuenta', exact: true },
        { href: `${basePath}#section-nav`, label: 'Local', icon: Building2, group: 'Cuenta' },
        {
          href: `${basePath}#section-nav-reservas`,
          label: 'Reservas',
          icon: CalendarDays,
          group: 'Salón',
        },
        { href: `${basePath}#section-nav-resenas`, label: 'Reseñas', icon: Star, group: 'Salón' },
        {
          href: `${basePath}#section-nav-comprobantes`,
          label: 'Comprobantes',
          icon: FileText,
          group: 'Administración',
        },
      ]}
    />
  )
}

// ─── SegmentedControl ────────────────────────────────────────────────────────

const SEGMENTS = [
  { value: 'todos', label: 'Todos', count: 140 },
  { value: 'deuda', label: 'Con deuda', count: 38 },
  { value: 'vencidos', label: 'Vencidos', count: 6 },
] as const

type Segment = (typeof SEGMENTS)[number]['value']

function SegmentedDemo() {
  const { basePath } = useCatalog()
  const [segment, setSegment] = React.useState<Segment>('todos')
  return (
    <DemoStack>
      <DemoRow label="Modo radio: las flechas mueven y eligen">
        <SegmentedControl
          aria-label="Proveedores a la vista"
          items={SEGMENTS}
          value={segment}
          onValueChange={setSegment}
          data-tour={tourId('segmented-control')}
        />
      </DemoRow>
      <DemoRow label="Chico, con una opción deshabilitada">
        <SegmentedControl
          aria-label="Servicio"
          size="sm"
          defaultValue="cena"
          items={[
            { value: 'almuerzo', label: 'Almuerzo' },
            { value: 'merienda', label: 'Merienda', disabled: true },
            { value: 'cena', label: 'Cena' },
          ]}
        />
      </DemoRow>
      <DemoRow label="A todo el ancho" stack>
        <SegmentedControl
          aria-label="Vista del mes"
          fullWidth
          defaultValue="lista"
          items={[
            { value: 'lista', label: 'Lista' },
            { value: 'calendario', label: 'Calendario' },
          ]}
        />
      </DemoRow>
      <DemoRow label="Modo link: cada opción es un <a> (filtros por URL)">
        <SegmentedControl
          aria-label="Reseñas"
          value="todas"
          items={[
            { value: 'todas', label: 'Todas', href: `${basePath}#segmented-control` },
            { value: 'malas', label: 'Con queja', href: `${basePath}#segmented-control-malas` },
            {
              value: 'buenas',
              label: '4 y 5 estrellas',
              href: `${basePath}#segmented-control-buenas`,
            },
          ]}
        />
      </DemoRow>
    </DemoStack>
  )
}

// ─── FilterChip y ChipGroup ──────────────────────────────────────────────────

function FilterChipDemo() {
  const { basePath } = useCatalog()
  return (
    <DemoStack>
      <DemoRow label="Filtros que se suman (aria-pressed)" stack>
        <ChipGroup aria-label="Servicios" data-tour={tourId('chip-group')}>
          <FilterChip count={12} data-tour={tourId('filter-chip')}>
            Almuerzo
          </FilterChip>
          <FilterChip count={4}>Merienda</FilterChip>
          <FilterChip defaultPressed count={31}>
            Cena
          </FilterChip>
          <FilterChip icon={Star}>Eventos</FilterChip>
          <FilterChip disabled>Delivery</FilterChip>
        </ChipGroup>
      </DemoRow>
      <DemoRow label="Mediano y como link (asChild: aria-current en vez de aria-pressed)">
        <FilterChip size="md" defaultPressed>
          Con deuda
        </FilterChip>
        <FilterChip asChild pressed>
          <Link href={`${basePath}#filter-chip`}>Vencidos</Link>
        </FilterChip>
      </DemoRow>
    </DemoStack>
  )
}

// ─── Steps ───────────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { label: 'Proveedor', description: 'A quién le compraste' },
  { label: 'Ítems', description: 'Qué compraste' },
  { label: 'Importes', description: 'Netos e IVA' },
  { label: 'Confirmar' },
] as const

function StepsDemo() {
  const [current, setCurrent] = React.useState(1)
  return (
    <DemoStack>
      <Steps steps={WIZARD_STEPS} current={current} data-tour={tourId('steps')} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setCurrent((n) => Math.max(0, n - 1))}
          aria-disabled={current === 0 || undefined}
        >
          Anterior
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => setCurrent((n) => Math.min(WIZARD_STEPS.length - 1, n + 1))}
          aria-disabled={current === WIZARD_STEPS.length - 1 || undefined}
        >
          Siguiente
        </Button>
      </div>
    </DemoStack>
  )
}

export function NavigationFamily() {
  return (
    <CatalogFamily id="navegacion">
      <CatalogBlock
        id="tabs"
        purpose="Pestañas subrayadas: las secciones de una página (`Tabs`) o sus subpáginas por ruta (`TabsNav`)."
        yes="`Tabs` cuando todo vive en la misma página (con `syncParam` para que la URL las recuerde); `TabsNav` cuando cada una tiene su ruta."
        no="Para filtrar una lista (`SegmentedControl`) o para pasos de un asistente (`Steps`)."
        usage={`<Tabs defaultValue="movimientos" syncParam="tab">
  <TabsList aria-label="Ficha del proveedor">
    <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
    <TabsTrigger value="comprobantes" count={12}>Comprobantes</TabsTrigger>
  </TabsList>
  <TabsContent value="movimientos">…</TabsContent>
</Tabs>

<TabsNav aria-label="Secciones del proveedor" items={[
  { href: \`/\${slug}/proveedores/\${id}\`, label: 'Movimientos', exact: true },
  { href: \`/\${slug}/proveedores/\${id}/pagos\`, label: 'Pagos' },
]} />`}
        a11y={[
          '`Tabs`: tablist de Radix; Tab entra en la activa y ← → Inicio Fin mueven. Para paneles pesados, `activationMode="manual"`.',
          '`TabsNav`: un link por parada de Tab y `aria-current="page"` en el activo; sin flechas (son links).',
          'El activo es un borde de 2 px (no un pseudo-elemento): sobrevive al alto contraste. Sin animación.',
        ]}
      >
        <TabsDemo />
      </CatalogBlock>

      <CatalogBlock
        id="section-nav"
        purpose="La subbarra de un área con muchas subpáginas, como Configuración."
        yes="Más de cinco subpáginas agrupadas: columna de 224 px desde `lg`, fila con scroll debajo."
        no="Pocas subpáginas: `TabsNav`."
        usage={`<div className="lg:flex lg:gap-8">
  <SectionNav aria-label="Secciones de Configuración" items={[
    { href: \`/\${slug}/configuracion/equipo\`, label: 'Equipo', icon: Users, group: 'Cuenta' },
    …
  ]} />
  <div className="min-w-0 flex-1">{children}</div>
</div>`}
        a11y={[
          'Un solo `<nav>` con nombre; el activo lleva `aria-current="page"`, fondo y barra de 2 px.',
          'La columna y la fila están las dos en el DOM y una se esconde con `display: none` (sale del Tab y del lector).',
        ]}
      >
        <SectionNavDemo />
      </CatalogBlock>

      <CatalogBlock
        id="segmented-control"
        compat="`SlidingTabs` sigue andando como envoltorio de `SegmentedControl`, con `aria-label` «Vista» por defecto (`@deprecated`)."
        purpose="Un filtro de una sola opción a la vista: «Todos · Con deuda · Vencidos»."
        yes="Filtros chicos de una lista, en modo radio o, con `href` en cada ítem, en modo link (filtros por URL)."
        no="Secciones de una página: `Tabs`. Filtros que se suman: `FilterChip`."
        usage={`<SegmentedControl
  aria-label="Proveedores a la vista"
  items={[{ value: 'todos', label: 'Todos', count: 140 }, { value: 'deuda', label: 'Con deuda' }]}
  value={segmento}
  onValueChange={(v) => router.replace(conParam('segmento', v))}
/>`}
        a11y={[
          '`role="radiogroup"`: Tab entra en la elegida y las flechas mueven y eligen.',
          'La elegida: cartulina con contorno de 1 px `--primary` (8,54:1 contra la pista).',
          'Si elegir cambia la URL, va `router.replace` (no `push`): cada flecha dejaría una entrada en el historial.',
        ]}
      >
        <SegmentedDemo />
      </CatalogBlock>

      <CatalogBlock
        id="filter-chip"
        purpose="Filtros que se suman: servicios, tamaño de mesa, segmentos."
        yes="Varios filtros independientes que se prenden y apagan, en un `ChipGroup` con nombre."
        no="Una sola opción entre varias (`SegmentedControl`) o una acción (`Button`)."
        usage={`<ChipGroup aria-label="Servicios">
  <FilterChip pressed={cena} onPressedChange={setCena} count={31}>Cena</FilterChip>
</ChipGroup>`}
        a11y={[
          'Cada chip es un botón con `aria-pressed`; como link (`asChild`) lleva `aria-current`.',
          'Activo: contorno verde sobre cartulina y un check adelante (forma, no solo color).',
          'Con el dedo el área llega a 44 px; entre chips van 8 px para que las áreas no se pisen.',
        ]}
      >
        <FilterChipDemo />
      </CatalogBlock>

      <CatalogBlock
        id="steps"
        compat="`Stepper` es `Steps` con otro nombre: mismas props (`@deprecated`)."
        purpose="Los pasos de un asistente: dónde estoy y cuánto falta."
        yes="Asistentes de 3 a 6 pasos (difusiones, alta de comprobante en pasos)."
        no="Navegar entre secciones: `Tabs`."
        usage={`<Steps current={1} steps={[
  { label: 'Proveedor' }, { label: 'Ítems' }, { label: 'Importes' }, { label: 'Confirmar' },
]} />`}
        a11y={[
          'Un `<ol>` con `aria-current="step"` en el actual; los hechos suman «(listo)» para el lector.',
          'En el celular se ve solo el actual: «Paso 2 de 4 · Ítems».',
        ]}
      >
        <StepsDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
