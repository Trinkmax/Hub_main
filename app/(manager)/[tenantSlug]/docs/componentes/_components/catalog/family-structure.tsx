'use client'

import { CalendarDays, ChevronRight, Info, Pencil, Plus, Users, Wallet } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/ui/amount'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DueStatus } from '@/components/ui/due-status'
import { InfoTip } from '@/components/ui/info-tip'
import { Kbd } from '@/components/ui/kbd'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Section } from '@/components/ui/section'
import { Separator } from '@/components/ui/separator'
import { TabsNav } from '@/components/ui/tabs-nav'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { addDays } from '@/lib/dates/civil'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack, InlineText } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { tourId } from './registry'
import { SAMPLE_SUPPLIERS } from './sample-data'

function PageShellDemo() {
  return (
    <div className="rounded-lg border border-dashed border-border-strong">
      <PageShell width="compact" data-tour={tourId('page-shell')}>
        <div className="rounded-md bg-muted px-3 py-2 type-small text-muted-foreground">
          Encabezado
        </div>
        <div className="rounded-md bg-muted px-3 py-2 type-small text-muted-foreground">
          32 px de aire entre bloques
        </div>
        <div className="rounded-md bg-muted px-3 py-2 type-small text-muted-foreground">
          Contenido
        </div>
      </PageShell>
    </div>
  )
}

function PageHeaderDemo() {
  const { basePath } = useCatalog()
  return (
    <DemoStack>
      <PageHeader
        data-tour={tourId('page-header')}
        title="Distribuidora del Centro SA"
        back={{ href: `${basePath}#page-header`, label: 'Proveedores' }}
        breadcrumbs={[
          { label: 'Administración', href: `${basePath}#page-header` },
          { label: 'Proveedores', href: `${basePath}#page-header` },
          { label: 'Distribuidora del Centro SA' },
        ]}
        description="Bebidas y cervezas para el salón. Entrega martes y jueves."
        meta={['CUIT 20-12345678-6', 'Responsable inscripto', 'Paga a 21 días']}
        actions={
          <>
            <Button type="button" variant="secondary">
              Nuevo pago
            </Button>
            <Button type="button">
              <Plus aria-hidden="true" />
              Nuevo comprobante
            </Button>
          </>
        }
        tabs={
          <TabsNav
            aria-label="Secciones del proveedor"
            items={[
              { href: basePath, label: 'Movimientos', exact: true },
              { href: `${basePath}#page-header-comprobantes`, label: 'Comprobantes' },
              { href: `${basePath}#page-header-pagos`, label: 'Pagos' },
            ]}
          />
        }
      />
      <DemoRow label="Breadcrumb suelto (dos niveles o más)">
        <Breadcrumb
          data-tour={tourId('breadcrumb')}
          items={[
            { label: 'Configuración', href: `${basePath}#page-header` },
            { label: 'Equipo', href: `${basePath}#page-header` },
            { label: 'Invitar' },
          ]}
        />
      </DemoRow>
    </DemoStack>
  )
}

function SectionDemo() {
  return (
    <DemoStack>
      <Section
        data-tour={tourId('section')}
        title="Próximos vencimientos"
        description="Lo que vence en los próximos siete días."
        actions={
          <Button type="button" size="sm" variant="secondary">
            Ver todos
          </Button>
        }
      >
        <p className="type-body text-muted-foreground">
          El contenido va a 16 px del encabezado. Una sección es título, aire y contenido: sin
          tarjeta.
        </p>
      </Section>
      <Section title="Datos del local" headingLevel={3} divider>
        <p className="type-body text-muted-foreground">
          <InlineText text="`headingLevel={3}` para una sección adentro de otra; `divider` suma un pelo arriba." />
        </p>
      </Section>
    </DemoStack>
  )
}

function CardDemo() {
  const { basePath } = useCatalog()
  return (
    <DemoStack>
      <Card data-tour={tourId('card')}>
        <CardHeader>
          <CardTitle>Cuenta corriente</CardTitle>
          <CardDescription>Lo que le debés a este proveedor.</CardDescription>
          <CardAction>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Editar la cuenta">
              <Pencil aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Amount cents={124_000_000} className="type-kpi" />
        </CardContent>
        <CardFooter className="border-t border-border">
          <span className="type-small text-muted-foreground">Actualizado hoy</span>
        </CardFooter>
      </Card>
      <DemoRow label="Rellenos: sm · md (default) · lg" className="grid gap-2 sm:grid-cols-3">
        <Card padding="sm">
          <span className="type-small">p-3</span>
        </Card>
        <Card>
          <span className="type-small">p-4 → p-6</span>
        </Card>
        <Card padding="lg">
          <span className="type-small">p-6 → p-8</span>
        </Card>
      </DemoRow>
      <DemoRow
        label="Interactiva (asChild con un link): borde al pasar, foco afuera, sin escala"
        stack
      >
        <Card asChild interactive>
          <Link href={`${basePath}#card`} className="flex-row items-center justify-between">
            <span className="grid gap-0.5">
              <span className="type-subtitle">Cierre del día</span>
              <span className="type-small text-muted-foreground">Ventas por medio de pago</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
          </Link>
        </Card>
      </DemoRow>
    </DemoStack>
  )
}

function KpiDemo() {
  const { basePath, today } = useCatalog()
  return (
    <DemoStack>
      <KPIGroup data-tour={tourId('kpi-group')}>
        <KPI
          label="Reservas 30 d"
          value="412"
          icon={CalendarDays}
          delta={{ value: '+12 %', direction: 'up', tone: 'positive', label: 'vs. mes anterior' }}
          data-tour={tourId('kpi')}
        />
        <KPI label="Personas" value="1.386" unit="por mes" icon={Users} />
        <KPI
          label="Saldo"
          value={<Amount cents={124_000_000} decimals={0} />}
          icon={Wallet}
          href={`${basePath}#kpi`}
        />
        <KPI
          label="Vencido"
          value={<Amount cents={38_000_000} decimals={0} />}
          status={<DueStatus dueDate={addDays(today, -3)} today={today} />}
          delta={{ value: '−$ 3.200', direction: 'down', tone: 'neutral' }}
        />
      </KPIGroup>
      <DemoRow label="Cargando y suelto (su propio <dl>)">
        <KPI label="Facturación" value="—" loading className="min-w-48" />
        <KPI label="Ticket promedio" value={<Amount cents={2_350_000} decimals={0} />} size="lg" />
      </DemoRow>
    </DemoStack>
  )
}

function MiscDemo() {
  return (
    <DemoStack>
      <DemoRow label="Separator: horizontal y vertical" stack>
        <Separator data-tour={tourId('separator')} />
        <div className="flex h-6 items-center gap-3 type-small text-muted-foreground">
          <span>Septiembre</span>
          <Separator orientation="vertical" />
          <span>412 reservas</span>
        </div>
      </DemoRow>
      <DemoRow label="ScrollArea: una lista larga adentro de un popover o una hoja" stack>
        <ScrollArea
          data-tour={tourId('scroll-area')}
          className="max-h-40 rounded-lg border border-border bg-card"
        >
          <ul className="divide-y divide-border">
            {SAMPLE_SUPPLIERS.map((supplier) => (
              <li key={supplier.id} className="px-3 py-2 type-small">
                {supplier.name}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DemoRow>
      <DemoRow label="Kbd y KbdShortcut (⌘ en Mac, Ctrl en el resto)">
        <Kbd data-tour={tourId('kbd')}>Esc</Kbd>
        <KbdShortcut keys={['mod', 'k']} data-tour={tourId('kbd-shortcut')} />
        <KbdShortcut keys={['shift', 'enter']} />
        <KbdShortcut keys={['up', 'down']} />
      </DemoRow>
      <DemoRow label="Avatar: 24 · 32 · 40 · 56 px">
        <Avatar size="xs" data-tour={tourId('avatar')}>
          <AvatarFallback>LG</AvatarFallback>
        </Avatar>
        <Avatar size="sm">
          <AvatarFallback>MR</AvatarFallback>
        </Avatar>
        <Avatar size="md">
          <AvatarFallback>DC</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>HB</AvatarFallback>
        </Avatar>
      </DemoRow>
    </DemoStack>
  )
}

function TooltipDemo() {
  return (
    <DemoStack>
      <DemoRow label="Tooltip: nombra un ícono o completa un texto cortado">
        <Tooltip>
          <TooltipTrigger asChild data-tour={tourId('tooltip-trigger')}>
            <Button type="button" size="icon" variant="ghost" aria-label="Editar proveedor">
              <Pencil aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Editar proveedor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: el texto cortado tiene que poder enfocarse para mostrar el tooltip con el teclado */}
            <span tabIndex={0} className="max-w-40 truncate rounded-sm type-body">
              Distribuidora del Centro SA · Bebidas
            </span>
          </TooltipTrigger>
          <TooltipContent>Distribuidora del Centro SA · Bebidas</TooltipContent>
        </Tooltip>
      </DemoRow>
      <DemoRow label="InfoTip: explica un término (tooltip con mouse, popover con el dedo)">
        <span className="inline-flex items-center gap-1.5 type-label">
          Cubiertos
          <InfoTip label="Qué son los cubiertos" data-tour={tourId('info-tip')}>
            La cantidad de personas atendidas: cada comensal es un cubierto, aunque no pida plato.
          </InfoTip>
        </span>
        <span className="inline-flex items-center gap-1.5 type-label">
          <Info aria-hidden="true" className="size-4 text-muted-foreground" />
          Siempre con texto al lado
        </span>
      </DemoRow>
    </DemoStack>
  )
}

export function StructureFamily() {
  return (
    <CatalogFamily id="estructura">
      <CatalogBlock
        id="page-shell"
        purpose="El contenedor de toda página: ancho, relleno y 32 px de aire entre bloques."
        yes="Toda página del panel, con el ancho que le toque (`compact` 3xl · `comfortable` 6xl · `default` 7xl · `wide` · `full`)."
        no="Como `<main>`: el `<main id=&quot;contenido&quot;>` lo pone el shell."
        usage={`export default function Page() {
  return (
    <PageShell width="comfortable">
      <PageHeader title="Proveedores" />
      …
    </PageShell>
  )
}`}
        a11y={[
          'No es un punto de referencia: el `<main>` del shell es el destino de «Saltar al contenido».',
          'Columna flex con `gap`: el aire no depende de los márgenes de cada bloque.',
        ]}
      >
        <PageShellDemo />
      </CatalogBlock>

      <CatalogBlock
        id="page-header"
        compat="`eyebrow` se dibuja como línea de contexto de 13 px, sin mayúsculas; si era un «volver», va `back` (`@deprecated`)."
        purpose="El encabezado de página: contexto (volver o migas), el único `h1`, acciones, descripción, datos clave y pestañas."
        yes="Toda página. `back` con el nombre de adonde se vuelve («← Proveedores»); `breadcrumbs` con dos niveles o más."
        no="Eyebrows en mayúsculas o el nombre de la sección arriba del título: el menú ya ubica."
        usage={`<PageHeader
  title="Distribuidora del Centro SA"
  back={{ href: \`/\${slug}/proveedores\`, label: 'Proveedores' }}
  meta={['CUIT 20-12345678-6', 'Responsable inscripto']}
  actions={<Button>Nuevo comprobante</Button>}
  tabs={<TabsNav aria-label="Secciones del proveedor" items={…} />}
/>`}
        a11y={[
          'El título es el único `h1` de la página (acá hay más de uno porque cada panel dibuja el componente real).',
          'Las migas son un `<nav aria-label="Migas de pan">` con `aria-current="page"` en la última; el separador es un ícono oculto.',
          'En el celular, si hay `back` se ve solo `back`; las acciones bajan debajo del título.',
        ]}
      >
        <PageHeaderDemo />
      </CatalogBlock>

      <CatalogBlock
        id="section"
        purpose="La unidad de jerarquía: título + aire + contenido, en lugar de una tarjeta por bloque."
        yes="Cada bloque de una página («Pide atención», «Próximos vencimientos»)."
        no="Meter cada bloque en una tarjeta: la jerarquía se arma con tipografía y espacio."
        usage={`<Section title="Próximos vencimientos" description="Los próximos 7 días"
  actions={<Button size="sm" variant="secondary">Ver todos</Button>}>
  …
</Section>`}
        a11y={[
          'Es un `<section>` con `aria-labelledby` al título: una región con nombre para el lector.',
          '`headingLevel` 2 o 3 según dónde va; el orden de encabezados no salta niveles.',
        ]}
      >
        <SectionDemo />
      </CatalogBlock>

      <CatalogBlock
        id="card"
        purpose="Agrupa lo que va junto: cartulina, pelo y radio de 12 px, sin sombra."
        yes="Un bloque autocontenido o una tarjeta que es un link (`asChild` + `interactive`)."
        no="Una tarjeta adentro de otra, una lista en tarjeta (`DataTable`) o una fila de KPIs (`KPIGroup`)."
        usage={`<Card>
  <CardHeader>
    <CardTitle>Cuenta corriente</CardTitle>
    <CardDescription>Lo que le debés</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
<Card asChild interactive><Link href={href}>…</Link></Card>`}
        a11y={[
          'Interactiva: foco «afuera» y presionado con `--active`, sin escala (es ancha).',
          'El relleno va en una sola clase: un `p-0` del que llama gana en todos los anchos.',
        ]}
      >
        <CardDemo />
      </CatalogBlock>

      <CatalogBlock
        id="kpi"
        compat="`StatCard` dibuja un `KPI` en su propia tarjeta y `NumberTicker` dibuja el valor final, quieto (`@deprecated`)."
        purpose="Un número, después el trabajo: la fila de KPIs es una sola tarjeta con divisores, sin animar."
        yes="Los números del Resumen y el saldo de una ficha (`type-kpi`, Fraunces)."
        no="Un número que cambia en vivo o en una columna (Fraunces no tiene cifras tabulares): ahí va `type-amount`."
        usage={`<KPIGroup>
  <KPI label="Reservas 30 d" value="412" delta={{ value: '+12 %', direction: 'up', tone: 'positive' }} />
  <KPI label="Vencido" value={<Amount cents={vencido} decimals={0} />} status={<DueStatus dueDate={…} />} />
  <KPI label="Saldo" value={<Amount cents={saldo} decimals={0} />} href={\`/\${slug}/proveedores\`} />
</KPIGroup>`}
        a11y={[
          'El grupo es un `<dl>`: el lector lee pares etiqueta-valor, no números sueltos.',
          'La variación se lee entera: «subió 12 % vs. mes anterior».',
          'Con `href`, el KPI entero es el link (una sola parada de Tab, foco «adentro»).',
        ]}
      >
        <KpiDemo />
      </CatalogBlock>

      <CatalogBlock
        id="separator"
        purpose="Piezas chicas: el pelo (`Separator`), el scroll propio (`ScrollArea`), las teclas (`Kbd`, `KbdShortcut`) y las iniciales (`Avatar`)."
        yes="Separar grupos con significado (`decorative={false}`), listas largas en un popover, atajos en menús y la paleta."
        no="Un separador por cada fila (la tabla ya pone el pelo) o los caracteres ⌘ y ↵, que Inter no tiene."
        usage={`<Separator />
<ScrollArea className="max-h-60">…</ScrollArea>
<KbdShortcut keys={['mod', 'k']} />
<Avatar size="sm"><AvatarFallback>LG</AvatarFallback></Avatar>`}
        a11y={[
          '`Separator` es decorativo por defecto (`role="none"`); con `decorative={false}` es `role="separator"`.',
          '`KbdShortcut` decide ⌘ o Ctrl después de montar (sin error de hidratación) y suma el nombre para el lector.',
          'El viewport de `ScrollArea` se puede enfocar y scrollear con el teclado.',
        ]}
      >
        <MiscDemo />
      </CatalogBlock>

      <CatalogBlock
        id="tooltip"
        purpose="`Tooltip` nombra un ícono o completa un texto cortado; `InfoTip` explica un término."
        yes="Botones de ícono, textos truncados (`Tooltip`) y «¿Qué es esto?» al lado de una etiqueta (`InfoTip`)."
        no="Información esencial en un tooltip: con el dedo no se ve."
        usage={`<Tooltip>
  <TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label="Editar"><Pencil /></Button></TooltipTrigger>
  <TooltipContent>Editar</TooltipContent>
</Tooltip>
<InfoTip label="Qué son los cubiertos">La cantidad de personas atendidas.</InfoTip>`}
        a11y={[
          'Aparece al pasar o al enfocar (400 ms el primero, los siguientes al toque); Esc lo cierra.',
          '`InfoTip`: con el dedo es un popover que se abre al tocar; su botón tiene nombre propio.',
        ]}
      >
        <TooltipDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
