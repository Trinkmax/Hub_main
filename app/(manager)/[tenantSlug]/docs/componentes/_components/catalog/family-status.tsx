'use client'

import { CalendarX2, CircleSlash, Inbox, PencilLine, Plus, Upload } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DueStatus } from '@/components/ui/due-status'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ClosedPeriodCallout } from '@/components/ui/page-templates'
import { Progress } from '@/components/ui/progress'
import {
  ListSkeleton,
  Skeleton,
  SkeletonCardGrid,
  SkeletonForm,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton'
import { StatusBadge, type StatusMap } from '@/components/ui/status-badge'
import { toastUndo, UNDO_MS } from '@/components/ui/toast'
import { addDays } from '@/lib/dates/civil'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { wait } from './demo-utils'
import { tourId } from './registry'

// ─── Badge y StatusBadge ─────────────────────────────────────────────────────

const TONES: ReadonlyArray<{ tone: BadgeTone; label: string }> = [
  { tone: 'neutral', label: 'Borrador' },
  { tone: 'brand', label: 'Nuevo' },
  { tone: 'success', label: 'Pagada' },
  { tone: 'warning', label: 'Vence pronto' },
  { tone: 'danger', label: 'Vencida' },
  { tone: 'info', label: 'Programada' },
  { tone: 'gold', label: 'Socio oro' },
]

type ReservationStatus = 'pending' | 'confirmed' | 'arrived' | 'no_show' | 'cancelled'

const RESERVATION_STATUS: StatusMap<ReservationStatus> = {
  pending: { label: 'Pendiente', tone: 'warning', description: 'Falta que el cliente confirme' },
  confirmed: { label: 'Confirmada', tone: 'info' },
  arrived: { label: 'Llegó', tone: 'success' },
  no_show: { label: 'No vino', tone: 'danger', icon: CircleSlash },
  cancelled: { label: 'Cancelada', tone: 'neutral', icon: CalendarX2 },
}

function BadgeDemo() {
  const { basePath } = useCatalog()
  return (
    <DemoStack>
      <DemoRow label="Suaves (el aspecto por defecto)">
        {TONES.map((item, index) => (
          <Badge
            key={item.tone}
            tone={item.tone}
            data-tour={index === 0 ? tourId('badge') : undefined}
          >
            {item.label}
          </Badge>
        ))}
      </DemoRow>
      <DemoRow label="Con punto, con ícono y de 24 px">
        <Badge tone="success" dot>
          Al día
        </Badge>
        <Badge tone="danger" dot>
          Vencida
        </Badge>
        <Badge tone="info" icon={PencilLine}>
          Editada
        </Badge>
        <Badge tone="brand" size="md">
          Recomendado
        </Badge>
      </DemoRow>
      <DemoRow label="Contorno y sólidas (solo el sello dorado y la cuenta de sin leer)">
        <Badge appearance="outline">Archivada</Badge>
        <Badge appearance="outline" tone="danger">
          Rechazada
        </Badge>
        <Badge appearance="solid" tone="gold">
          Oro
        </Badge>
        <Badge appearance="solid" tone="brand">
          3<span className="sr-only"> sin leer</span>
        </Badge>
      </DemoRow>
      <DemoRow label="Como link (asChild, 24 px)">
        <Badge asChild tone="warning" size="md" dot>
          <Link href={`${basePath}#badge`}>2 por vencer</Link>
        </Badge>
      </DemoRow>
      <DemoRow label="StatusBadge: el estado sale de un mapa del dominio">
        {(Object.keys(RESERVATION_STATUS) as ReservationStatus[]).map((status, index) => (
          <StatusBadge
            key={status}
            status={status}
            map={RESERVATION_STATUS}
            data-tour={index === 0 ? tourId('status-badge') : undefined}
          />
        ))}
      </DemoRow>
    </DemoStack>
  )
}

// ─── DueStatus ───────────────────────────────────────────────────────────────

function DueStatusDemo() {
  const { today } = useCatalog()
  const cases: ReadonlyArray<{ label: string; dueDate: string | null; settled?: boolean }> = [
    { label: 'Vencida', dueDate: addDays(today, -3) },
    { label: 'Vence hoy', dueDate: today },
    { label: 'Vence pronto', dueDate: addDays(today, 5) },
    { label: 'Al día', dueDate: addDays(today, 22) },
    { label: 'Pagada', dueDate: addDays(today, -10), settled: true },
    { label: 'Sin vencimiento', dueDate: null },
  ]
  return (
    <DemoStack>
      <DemoRow label="En línea (punto + palabras)" stack>
        <ul className="grid gap-2 type-body sm:grid-cols-2">
          {cases.map((item, index) => (
            <li key={item.label}>
              <DueStatus
                dueDate={item.dueDate}
                settled={item.settled}
                today={today}
                data-tour={index === 0 ? tourId('due-status') : undefined}
              />
            </li>
          ))}
        </ul>
      </DemoRow>
      <DemoRow label="Como etiqueta, con la fecha">
        {cases.slice(0, 4).map((item) => (
          <DueStatus
            key={item.label}
            variant="badge"
            showDate
            dueDate={item.dueDate}
            today={today}
          />
        ))}
      </DemoRow>
    </DemoStack>
  )
}

// ─── Callout ─────────────────────────────────────────────────────────────────

function CalloutDemo() {
  const { basePath } = useCatalog()
  const [dismissed, setDismissed] = React.useState(false)
  return (
    <DemoStack>
      <Callout tone="info" title="Solo lectura" data-tour={tourId('callout')}>
        Tenés acceso de lectura: podés ver y exportar todo.
      </Callout>
      <Callout tone="success" title="Asiento generado">
        Quedó en el libro diario con el número 128.
      </Callout>
      <Callout
        tone="warning"
        title="Mostramos los primeros 1.000 movimientos"
        action={
          <Button type="button" size="sm" variant="secondary">
            Acotar el período
          </Button>
        }
      >
        Acotá el período para ver todo.
      </Callout>
      <Callout tone="danger" title="No pudimos guardar">
        Revisá los campos marcados y probá de nuevo.
      </Callout>
      <Callout tone="neutral">Datos de ejemplo: nada de esto es real.</Callout>
      <ClosedPeriodCallout period="Septiembre" adjustmentHref={`${basePath}#callout`} />
      {dismissed ? (
        <Button type="button" variant="link" onClick={() => setDismissed(false)}>
          Mostrar de nuevo el aviso que se cierra
        </Button>
      ) : (
        <Callout tone="info" title="Novedad" onDismiss={() => setDismissed(true)}>
          Ahora podés exportar el libro diario a Excel.
        </Callout>
      )}
    </DemoStack>
  )
}

// ─── Progress ────────────────────────────────────────────────────────────────

function ProgressDemo() {
  const [done, setDone] = React.useState(3)
  const total = 5
  return (
    <DemoStack>
      <DemoRow label="Determinado (se mueve con transform en 220 ms)" stack>
        <Progress
          value={(done / total) * 100}
          label="Configuración del bar"
          valueText={`${done.toString()} de ${total.toString()} tareas`}
          data-tour={tourId('progress')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setDone((n) => Math.max(0, n - 1))}
          >
            Restar una
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setDone((n) => Math.min(total, n + 1))}
          >
            Sumar una
          </Button>
          <span className="type-small text-muted-foreground">
            {done} de {total} tareas
          </span>
        </div>
      </DemoRow>
      <DemoRow label="Tonos y tamaños" stack>
        <Progress value={92} tone="warning" size="sm" label="Cupo de la cena" valueText="92 %" />
        <Progress value={100} tone="success" label="Importación" valueText="Completa" />
        <Progress value={18} tone="danger" label="Presupuesto de pauta" valueText="18 % restante" />
      </DemoRow>
      <DemoRow label="Indeterminado" stack>
        <Progress value={null} label="Importando movimientos" />
      </DemoRow>
    </DemoStack>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonDemo() {
  const { density } = useCatalog()
  return (
    <DemoStack>
      <DemoRow label="Skeleton y SkeletonText" stack>
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" data-tour={tourId('skeleton')} />
          <SkeletonText lines={2} className="flex-1" />
        </div>
      </DemoRow>
      <DemoRow label="Encabezado y KPIs" stack>
        <SkeletonPageHeader actions={1} />
        <SkeletonKPIGroup count={4} />
      </DemoRow>
      <DemoRow label={`Tabla (densidad ${density === 'compact' ? 'compacta' : 'cómoda'})`} stack>
        <SkeletonTable
          rows={4}
          columns={4}
          density={density}
          data-tour={tourId('skeleton-table')}
        />
      </DemoRow>
      <DemoRow label="Formulario, grilla de tarjetas y lista" stack>
        <SkeletonForm fields={2} />
        <SkeletonCardGrid count={2} />
        <ListSkeleton rows={2} />
      </DemoRow>
    </DemoStack>
  )
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

function EmptyStateDemo() {
  return (
    <DemoStack>
      <EmptyState
        icon={Inbox}
        title="Todavía no cargaste proveedores"
        description="Cargá el primero para llevar su cuenta corriente."
        action={
          <Button type="button">
            <Plus aria-hidden="true" />
            Nuevo proveedor
          </Button>
        }
        secondaryAction={
          <Button type="button" variant="secondary">
            Importar desde Excel
          </Button>
        }
        data-tour={tourId('empty-state')}
      />
      <EmptyState
        size="sm"
        title="Sin movimientos en el período"
        description="Probá con otro mes."
      />
      <EmptyState
        variant="dashed"
        icon={Upload}
        title="Arrastrá el Excel acá"
        description="O tocá para elegirlo."
      />
    </DemoStack>
  )
}

// ─── ErrorState ──────────────────────────────────────────────────────────────

function ErrorStateDemo() {
  const { tenantSlug } = useCatalog()
  const [showPage, setShowPage] = React.useState(false)
  const error = React.useMemo(
    () => Object.assign(new Error('Ejemplo'), { digest: '3f2a9c71e4b0' }),
    [],
  )
  return (
    <DemoStack>
      <DemoRow label="En línea (adentro de una tabla o una tarjeta): role=alert" stack>
        <ErrorState
          size="sm"
          description="No pudimos cargar los movimientos."
          onRetry={() => wait(1200)}
          data-tour={tourId('error-state')}
        />
      </DemoRow>
      <DemoRow label="De página: el título recibe el foco al aparecer" stack>
        {showPage ? (
          <>
            <ErrorState
              title="Algo se rompió en esta pantalla"
              error={error}
              onRetry={() => wait(1200)}
              homeHref={`/${tenantSlug}`}
            />
            <Button type="button" variant="link" onClick={() => setShowPage(false)}>
              Esconder el error de página
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setShowPage(true)}>
            Mostrar el error de página
          </Button>
        )}
      </DemoRow>
    </DemoStack>
  )
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

function ToastDemo() {
  const [status, setStatus] = React.useState<'confirmada' | 'no-vino'>('confirmada')
  const [dialogOpen, setDialogOpen] = React.useState(false)

  function markNoShow() {
    setStatus('no-vino')
    toastUndo('Marcaste «No vino»', {
      description: 'Mesa 12 · 21:30 · 4 personas',
      onUndo: () => setStatus('confirmada'),
    })
  }

  return (
    <DemoStack>
      <DemoRow label="Los cinco tonos (el tono va solo en el ícono)">
        <Button
          type="button"
          variant="secondary"
          onClick={() => toast.success('Proveedor guardado')}
        >
          Éxito
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            toast.error('No pudimos guardar', { description: 'Probá de nuevo en un rato.' })
          }
        >
          Error
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => toast.warning('El cupo de la cena está al 92 %')}
        >
          Aviso
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => toast.info('Hay una versión nueva del plan de cuentas')}
        >
          Info
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            toast.promise(wait(1800), {
              loading: 'Exportando el libro…',
              success: 'Libro exportado',
              error: 'No pudimos exportar',
            })
          }
        >
          Cargando
        </Button>
      </DemoRow>
      <DemoRow
        label={`toastUndo: «Deshacer» de ${(UNDO_MS / 1000).toString()} s, quieto mientras tiene el foco`}
      >
        <Button type="button" onClick={markNoShow} disabled={status === 'no-vino'}>
          Marcar «No vino»
        </Button>
        <span role="status" className="type-small text-muted-foreground">
          Reserva: {status === 'no-vino' ? 'no vino' : 'confirmada'}
        </span>
      </DemoRow>
      <DemoRow label="Un aviso sobre un diálogo abierto no lo cierra">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="secondary">
              Abrir un diálogo
            </Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Cambiar la mesa</DialogTitle>
              <DialogDescription>
                Tocá el aviso o su «Deshacer»: el diálogo sigue abierto.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  toastUndo('Mesa cambiada a la 14', {
                    onUndo: () => {
                      toast('Volvió a la 12')
                    },
                  })
                }
              >
                Mostrar un aviso
              </Button>
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={() => setDialogOpen(false)}>
                Listo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DemoRow>
    </DemoStack>
  )
}

export function StatusFamily() {
  return (
    <CatalogFamily id="estado">
      <CatalogBlock
        id="badge"
        compat="El `variant` viejo se lee como `tone` + `appearance`: `default` → marca, `destructive` → peligro, `outline` → neutra con contorno (`@deprecated`)."
        purpose="Etiqueta de estado: suave por defecto, con el texto siempre (nunca solo color)."
        yes="Estados de un registro (`StatusBadge` con el mapa del dominio en `lib/<dominio>/status-meta.ts`) y marcas chicas («Nuevo»)."
        no="Para una acción (`Button`) o un filtro (`FilterChip`). Sólida solo para el sello dorado y la cuenta de sin leer."
        usage={`<Badge tone="success" dot>Al día</Badge>
// lib/reservas/status-meta.ts
export const RESERVATION_STATUS: StatusMap<Status> = {
  pending: { label: 'Pendiente', tone: 'warning' },
  no_show: { label: 'No vino', tone: 'danger', icon: CircleSlash },
}
<StatusBadge status={reserva.status} map={RESERVATION_STATUS} />`}
        a11y={[
          'El punto va en el sólido del tono y lleva `aria-hidden`: el texto ya lo dice.',
          'Si una celda angosta muestra solo el punto, el texto va en `sr-only`.',
          'Como link va en `size="md"` (24 px) o con su área táctil: los 20 px de `sm` no llegan al mínimo.',
        ]}
      >
        <BadgeDemo />
      </CatalogBlock>

      <CatalogBlock
        id="due-status"
        purpose="El semáforo de vencimientos: punto + palabras, con los cortes de `lib/accounting/aging.ts`."
        yes="Columnas «Vence», el KPI «Vencido», «Próximos vencimientos»."
        no="Una fecha sin vencimiento: va la fecha sola."
        usage={`<DueStatus dueDate={factura.dueDate} settled={factura.paid} />
<DueStatus variant="badge" showDate dueDate={factura.dueDate} />`}
        a11y={[
          'El texto es la etiqueta accesible («Vencida hace 3 días»); el punto es decorativo.',
          'Los días van en cifras tabulares; si el texto no dice la fecha, queda en el `title`.',
        ]}
      >
        <DueStatusDemo />
      </CatalogBlock>

      <CatalogBlock
        id="callout"
        purpose="Un aviso que vive en la página: fondo suave, ícono y texto, sin borde de color."
        yes="Período cerrado, solo lectura, «Mostramos los primeros 1.000», «Datos de ejemplo», el error general de un formulario."
        no="Algo que pasó por una acción y se va solo (`toast`)."
        usage={`<Callout tone="warning" title="Mostramos los primeros 1.000 movimientos"
  action={<Button size="sm" variant="secondary">Acotar el período</Button>}>
  Acotá el período para ver todo.
</Callout>
<ClosedPeriodCallout period="Septiembre" adjustmentHref={nuevoAjuste} />`}
        a11y={[
          '`announce="assertive"` es `role="alert"` (un error después de enviar); `polite` es `role="status"`; lo que está desde que carga no se anuncia.',
          '«Cerrar» (`onDismiss`) tiene nombre y solo va en avisos que no vuelven a ser ciertos.',
          'El cuerpo va en texto 2: 5,73 a 5,88:1 sobre los cuatro fondos suaves.',
        ]}
      >
        <CalloutDemo />
      </CatalogBlock>

      <CatalogBlock
        id="progress"
        purpose="Cuánto falta: determinado (0–100) o indeterminado."
        yes="Tareas de configuración, cupo, una importación larga."
        no="Esperar una respuesta corta: `Spinner` o `loading` en el botón."
        usage={`<Progress value={60} label="Configuración del bar" valueText="3 de 5 tareas" />
<Progress value={null} label="Importando movimientos" />`}
        a11y={[
          '`role="progressbar"` con `aria-label` y `aria-valuetext` («3 de 5 tareas»); indeterminado dice «Cargando».',
          'Con «reducir movimiento» el indeterminado queda quieto al centro y el determinado salta sin transición.',
        ]}
      >
        <ProgressDemo />
      </CatalogBlock>

      <CatalogBlock
        id="skeleton"
        compat="`skeleton-list` y `CardGridSkeleton` son alias de los presets de `skeleton.tsx` (`@deprecated`)."
        purpose="Esqueletos que copian los altos finales: nada salta al cargar."
        yes="Cada `loading.tsx` es `PageShell` + presets, con `aria-busy` y un solo «Cargando…» (`SkeletonStatus`)."
        no="Una espera corta dentro de un control: `Spinner`."
        usage={`<PageShell aria-busy="true">
  <SkeletonStatus />
  <SkeletonPageHeader actions={1} />
  <SkeletonTable rows={8} columns={5} />
</PageShell>`}
        a11y={[
          'Los presets son decorativos (`aria-hidden`); el «Cargando…» lo dice una vez `SkeletonStatus`.',
          'Con «reducir movimiento», quietos: sin pulso.',
        ]}
      >
        <SkeletonDemo />
      </CatalogBlock>

      <CatalogBlock
        id="empty-state"
        purpose="Qué va a haber acá y cómo empezar. El título va en Fraunces: la marca vive en los vacíos."
        yes="Una lista sin datos todavía (con su acción) o sin resultados para un filtro (con «Limpiar filtros», ver `ListEmptyState`)."
        no="Un error (`ErrorState`)."
        usage={`<EmptyState icon={Inbox} title="Todavía no cargaste proveedores"
  description="Cargá el primero para llevar su cuenta corriente."
  action={<Button>Nuevo proveedor</Button>} />`}
        a11y={[
          'El título es un `div` (no corta el índice de encabezados); con `headingLevel` pasa a encabezado cuando el vacío es lo único de la pantalla.',
          'El botón dice el verbo: «Nuevo proveedor», no «Empezar».',
        ]}
      >
        <EmptyStateDemo />
      </CatalogBlock>

      <CatalogBlock
        id="error-state"
        purpose="Algo no cargó: qué pasó, qué hacer y el código para avisarnos."
        yes="El `error.tsx` de una pantalla y una fila de tabla que no pudo cargar."
        no="Un error de validación de un formulario (`FormError` y los errores del Field)."
        usage={`// app/(manager)/[tenantSlug]/error.tsx
<ErrorState headingLevel={1} title="Algo se rompió en esta pantalla"
  error={error} onRetry={reset} homeHref={\`/\${slug}\`} />`}
        a11y={[
          'En línea lleva `role="alert"`; de página, el título recibe el foco al aparecer (por eso acá se muestra a pedido).',
          '«Reintentar» muestra el spinner mientras dura y no se dispara dos veces.',
          'Nunca muestra `error.message` en producción; el código se copia entero.',
        ]}
      >
        <ErrorStateDemo />
      </CatalogBlock>

      <CatalogBlock
        id="toast"
        purpose="Avisos que informan sin gritar: el tono va solo en el ícono. El Toaster es global y sigue el tema de la página, no el del panel."
        yes="Algo que salió bien o mal después de una acción, y el «Deshacer» de un cambio que también se revierte desde la pantalla."
        no="Un borrado definitivo (va con `ConfirmDialog`) o un aviso que tiene que quedarse (`Callout`)."
        usage={`toast.success('Proveedor guardado')
toastUndo('Marcaste «No vino»', { onUndo: () => volverAConfirmada(id) })`}
        a11y={[
          'Alt + T lleva el foco a los avisos y los frena; el «Deshacer» queda quieto mientras tiene el foco (WCAG 2.2.1).',
          'En español para el lector: «Avisos» y «Cerrar aviso».',
          'Tocar un aviso nunca cierra el diálogo, la hoja o el popover de abajo (`keepOpenOnToast`).',
        ]}
      >
        <ToastDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
