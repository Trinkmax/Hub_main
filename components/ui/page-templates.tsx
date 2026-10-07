import { Lock, type LucideIcon, SearchX } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { Callout, type CalloutProps } from '@/components/ui/callout'
import { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state'
import { PageShell, type PageShellProps, type PageShellWidth } from '@/components/ui/page-shell'
import { cn } from '@/lib/utils'

/**
 * Plantillas de pantalla del panel (kit HUB §5): Resumen, Lista, Ficha,
 * Formulario, Libro o reporte y Estado de cuenta, más los patrones que las
 * cruzan (§5.7: solo lectura y período cerrado).
 *
 * Son Server Components que componen slots y no traen datos: la página arma
 * el `PageHeader`, la tabla o el formulario y los pasa ya armados. Lo que la
 * plantilla fija es el orden, el aire entre bloques y lo que cambia en el
 * celular, para que todas las pantallas del mismo tipo se lean igual.
 *
 * - Server-safe: sin hooks ni `'use client'`. También se pueden renderizar
 *   adentro de un componente cliente.
 * - El orden del DOM es el orden visual en todos los anchos (nada de `order`):
 *   el lector de pantalla y el Tab recorren lo mismo que se ve.
 * - Cada plantilla pasa `...props` a su raíz (un `PageShell`), incluidos
 *   `data-tour`, `aria-busy` e `id`.
 * - Sirven también para el `loading.tsx`: los mismos slots con los presets de
 *   `skeleton.tsx`, `aria-busy` en la raíz y un solo `<SkeletonStatus />`.
 *
 * ```tsx
 * // En solo lectura la acción que modifica no se dibuja; «Exportar» queda.
 * <ListTemplate
 *   header={
 *     <PageHeader
 *       title="Proveedores"
 *       actions={canWrite ? <Button asChild><Link href={nuevo}>Nuevo proveedor</Link></Button> : null}
 *     />
 *   }
 *   readOnly={!canWrite}
 * >
 *   <DataTable … toolbar={…} pagination={…} empty={<ListEmptyState … />} />
 * </ListTemplate>
 * ```
 */

/** Un `<PageHeader … />` armado por la página (con `back`, `meta` y `actions`). */
export type TemplateHeader = React.ReactNode

/**
 * La raíz es un `PageShell`: ancho, relleno y 32 px entre bloques. Sin
 * `title`: el atributo HTML se confundiría con el título de la página, que va
 * en el `header`.
 */
type TemplateRootProps = Omit<PageShellProps, 'children' | 'width' | 'title'>

type TemplateCommonProps = {
  header: TemplateHeader
  /**
   * Avisos entre el encabezado y el contenido (§5.7): `ClosedPeriodCallout`,
   * «Datos de ejemplo»… Van en el orden en que llegan, debajo del de solo
   * lectura.
   */
  notice?: React.ReactNode
  /**
   * Vista de solo lectura (rol Contabilidad: ve y exporta, no modifica).
   * Dibuja `ReadOnlyCallout` arriba del contenido y marca la raíz con
   * `data-readonly`.
   *
   * Las acciones que modifican **no se dibujan** (ni deshabilitadas: un botón
   * apagado sin explicación es ruido): eso lo hace la página al armar el
   * encabezado y el formulario. «Exportar» y los filtros quedan. El permiso
   * real lo controla el server con `requireRole`; esto es solo la vista.
   */
  readOnly?: boolean
}

/** ¿El slot trae algo para dibujar? `null`, `undefined`, los booleanos y `''` no dibujan nada. */
function hasNode(node: React.ReactNode): boolean {
  return node !== null && node !== undefined && typeof node !== 'boolean' && node !== ''
}

/**
 * Un slot opcional con su `data-slot` (el gancho estable del kit para el CSS y
 * los tests). `empty:hidden`: si lo que llega es un componente que no dibuja
 * nada (un `FormError` sin mensaje), el envoltorio vacío no suma los 32 px
 * del `gap` del `PageShell`.
 */
function TemplateSlot({
  name,
  className,
  children,
}: {
  name: string
  className?: string
  children: React.ReactNode
}) {
  if (!hasNode(children)) return null
  return (
    <div data-slot={name} className={cn('min-w-0 empty:hidden', className)}>
      {children}
    </div>
  )
}

/** Solo lectura primero (es lo que más cambia cómo se usa la pantalla), después los demás avisos. */
function TemplateNotices({ readOnly, notice }: { readOnly: boolean; notice: React.ReactNode }) {
  if (!readOnly && !hasNode(notice)) return null
  return (
    <div data-slot="template-notices" className="flex min-w-0 flex-col gap-3 empty:hidden">
      {readOnly ? <ReadOnlyCallout /> : null}
      {notice}
    </div>
  )
}

/**
 * Ficha y estado de cuenta en el celular (§5.3): las acciones del encabezado
 * bajan debajo del título (eso ya lo hace `PageHeader`) y la principal, que va
 * última, ocupa todo el ancho. Se apunta por `data-slot` y solo al encabezado
 * de la plantilla, que es hijo directo de la raíz.
 */
const MOBILE_PRIMARY_FULL =
  'max-sm:[&>[data-slot=page-header]_[data-slot=page-actions]>:last-child]:w-full'

/**
 * Una columna principal y otra al costado, solo si entran las dos (el patrón
 * «sidebar» de flex-wrap): la principal crece (`999`) y no baja de su mínimo;
 * la del costado parte de 20 rem. Si la suma no entra, la del costado baja
 * abajo sola. Nunca de costado antes de `lg`.
 *
 * Por qué no una grilla en `lg`: desde `lg` el menú lateral ocupa 256 px, así
 * que a 1024 px quedan 704 px de contenido y una grilla de dos columnas
 * dejaría el formulario (o la tabla) en 350 px. Así la columna aparece cuando
 * hay lugar de verdad: el formulario (34 + 20 rem) desde unos 1.220 px con el
 * menú abierto y desde 1.024 con el menú plegado; la ficha (40 + 20 rem),
 * desde unos 1.310 y 1.060.
 */
const SIDE_BODY = 'lg:flex-row lg:flex-wrap lg:items-start'
const SIDE_COLUMN = 'lg:w-auto lg:flex-[1_1_20rem]'

// ─── Resumen ─────────────────────────────────────────────────────────────────

export type SummaryTemplateProps = TemplateRootProps &
  TemplateCommonProps & {
    /** `<KPIGroup>` con los números clave, sin animar (4 KPIs van 2 × 2 en el celular). */
    kpis: React.ReactNode
    /**
     * `<Section title="Pide atención">`: filas-link con `DueStatus` o `Badge`,
     * sin una tarjeta por ítem. Dos tercios desde `lg`; en el celular, primero.
     */
    attention?: React.ReactNode
    /** `<Section title="Accesos">`: una lista de links. Un tercio desde `lg`. */
    shortcuts?: React.ReactNode
    /** Lo demás, una `Section` por bloque (el gráfico de visitas sobre cartulina). */
    children?: React.ReactNode
    /** Default `default`. */
    width?: PageShellWidth
  }

/**
 * Resumen del dueño y Resumen contable (§5.1): encabezado (con el saludo en
 * hora de Córdoba como `context`) → KPIs → «Pide atención» (2/3) y «Accesos»
 * (1/3) → el resto. Si llega solo uno de los dos, ocupa todo el ancho.
 */
function SummaryTemplate({
  header,
  kpis,
  attention,
  shortcuts,
  children,
  notice,
  readOnly = false,
  width = 'default',
  className,
  ...props
}: SummaryTemplateProps) {
  const hasAttention = hasNode(attention)
  const hasShortcuts = hasNode(shortcuts)
  const split = hasAttention && hasShortcuts
  return (
    <PageShell
      data-slot="summary-template"
      data-readonly={readOnly ? '' : undefined}
      width={width}
      className={className}
      {...props}
    >
      {header}
      <TemplateNotices readOnly={readOnly} notice={notice} />
      <TemplateSlot name="summary-template-kpis">{kpis}</TemplateSlot>
      {hasAttention || hasShortcuts ? (
        <div
          data-slot="summary-template-work"
          className={cn('grid min-w-0 gap-8', split && 'lg:grid-cols-3')}
        >
          <TemplateSlot name="summary-template-attention" className={cn(split && 'lg:col-span-2')}>
            {attention}
          </TemplateSlot>
          <TemplateSlot name="summary-template-shortcuts">{shortcuts}</TemplateSlot>
        </div>
      ) : null}
      {children}
    </PageShell>
  )
}

// ─── Lista ───────────────────────────────────────────────────────────────────

export type ListTemplateProps = TemplateRootProps &
  TemplateCommonProps & {
    /**
     * `<DataTableToolbar>`: buscador (`name="q"`), filtros por URL (GET) y
     * «Exportar». Si la `DataTable` ya lo trae en su prop `toolbar`, no va acá.
     */
    toolbar?: React.ReactNode
    /** La `DataTable` (cómoda, filas-link, tarjetas en el celular) con su vacío (`ListEmptyState`). */
    children: React.ReactNode
    /** `<Pagination>`. Si la `DataTable` ya lo trae en su prop `pagination`, no va acá. */
    pagination?: React.ReactNode
    /** Default `default`. */
    width?: PageShellWidth
  }

/**
 * Proveedores, comprobantes, reservas, personas (§5.2): encabezado → barra de
 * herramientas → tabla → paginación. Entre la barra, la tabla y la paginación
 * van 12 px, lo mismo que deja la `DataTable` cuando los trae ella: los dos
 * caminos se ven igual.
 */
function ListTemplate({
  header,
  toolbar,
  children,
  pagination,
  notice,
  readOnly = false,
  width = 'default',
  className,
  ...props
}: ListTemplateProps) {
  return (
    <PageShell
      data-slot="list-template"
      data-readonly={readOnly ? '' : undefined}
      width={width}
      className={className}
      {...props}
    >
      {header}
      <TemplateNotices readOnly={readOnly} notice={notice} />
      <div data-slot="list-template-body" className="flex min-w-0 flex-col gap-3">
        <TemplateSlot name="list-template-toolbar">{toolbar}</TemplateSlot>
        {children}
        <TemplateSlot name="list-template-pagination">{pagination}</TemplateSlot>
      </div>
    </PageShell>
  )
}

export type ListEmptyStateProps = Omit<
  EmptyStateProps,
  'icon' | 'title' | 'description' | 'action' | 'secondaryAction'
> & {
  /** ¿Hay búsqueda o filtros activos? Decide cuál de los dos vacíos se ve. */
  filtered: boolean
  /** La misma ruta sin `q` ni filtros: adonde lleva «Limpiar filtros». */
  clearHref: string
  /** Ícono del vacío de verdad (el filtrado usa `SearchX`). */
  icon?: LucideIcon
  /** Qué va a haber acá: «Todavía no cargaste proveedores». */
  title: React.ReactNode
  /** Cómo empezar: «Cargá el primero para llevar su cuenta corriente.» */
  description?: React.ReactNode
  /** El CTA del vacío de verdad («Nuevo proveedor»). En solo lectura, nada. */
  action?: React.ReactNode
  /** Otra salida del vacío de verdad («Importar desde Excel»). El filtrado no la muestra. */
  secondaryAction?: React.ReactNode
  /** Default «No hay resultados con estos filtros». */
  filteredTitle?: React.ReactNode
  /** Default «Probá con otra búsqueda o limpiá los filtros para ver todo.» */
  filteredDescription?: React.ReactNode
}

/**
 * El vacío de una lista (§5.2), para el `empty` de la `DataTable`: distingue
 * «sin datos todavía» (con su CTA) de «sin resultados para el filtro» (con
 * «Limpiar filtros»). Sin esto, una búsqueda que no encuentra nada le dice al
 * dueño que no cargó nada. `size="sm"` por defecto: va adentro de la tabla.
 */
function ListEmptyState({
  filtered,
  clearHref,
  icon,
  title,
  description,
  action,
  secondaryAction,
  filteredTitle = 'No hay resultados con estos filtros',
  filteredDescription = 'Probá con otra búsqueda o limpiá los filtros para ver todo.',
  size = 'sm',
  ...props
}: ListEmptyStateProps) {
  if (filtered) {
    return (
      <EmptyState
        data-slot="list-empty-state"
        data-filtered=""
        icon={SearchX}
        title={filteredTitle}
        description={filteredDescription}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={clearHref}>Limpiar filtros</Link>
          </Button>
        }
        size={size}
        {...props}
      />
    )
  }
  return (
    <EmptyState
      data-slot="list-empty-state"
      icon={icon}
      title={title}
      description={description}
      action={action}
      secondaryAction={secondaryAction}
      size={size}
      {...props}
    />
  )
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

export type DetailTemplateProps = TemplateRootProps &
  TemplateCommonProps & {
    /** `<KPIGroup>`: Saldo · Vencido (con `DueStatus`) · Vence en 7 días. Tres KPIs van 1 × 3 en el celular. */
    summary?: React.ReactNode
    /** `<TabsNav>`: cada pestaña con su ruta (Movimientos · Comprobantes · Pagos · Datos). */
    tabs?: React.ReactNode
    /** El contenido de la pestaña activa. */
    children: React.ReactNode
    /**
     * Una columna al costado de las pestañas (datos fijos, notas). Va al
     * costado solo si entran las dos; si no, abajo del contenido.
     */
    aside?: React.ReactNode
    /** Default `default`. */
    width?: PageShellWidth
  }

/**
 * Proveedor, cliente, socio (§5.3): encabezado con `back`, `meta` y acciones →
 * KPIs → pestañas → contenido. Las pestañas van pegadas a su contenido (24 px)
 * y la columna del costado acompaña a las dos, porque no cambia con la
 * pestaña. En el celular la acción principal del encabezado ocupa todo el
 * ancho.
 */
function DetailTemplate({
  header,
  summary,
  tabs,
  children,
  aside,
  notice,
  readOnly = false,
  width = 'default',
  className,
  ...props
}: DetailTemplateProps) {
  const hasAside = hasNode(aside)
  return (
    <PageShell
      data-slot="detail-template"
      data-readonly={readOnly ? '' : undefined}
      width={width}
      className={cn(MOBILE_PRIMARY_FULL, className)}
      {...props}
    >
      {header}
      <TemplateNotices readOnly={readOnly} notice={notice} />
      <TemplateSlot name="detail-template-summary">{summary}</TemplateSlot>
      <div
        data-slot="detail-template-body"
        className={cn('flex min-w-0 flex-col gap-8', hasAside && SIDE_BODY)}
      >
        <div
          data-slot="detail-template-main"
          className={cn(
            'flex min-w-0 flex-col gap-6',
            // 40 rem: lo que necesita una tabla de movimientos sin pasar a scroll.
            hasAside && 'lg:min-w-[40rem] lg:flex-[999_1_0%]',
          )}
        >
          <TemplateSlot name="detail-template-tabs">{tabs}</TemplateSlot>
          {children}
        </div>
        <TemplateSlot name="detail-template-aside" className={SIDE_COLUMN}>
          {aside}
        </TemplateSlot>
      </div>
    </PageShell>
  )
}

// ─── Formulario ──────────────────────────────────────────────────────────────

export type FormTemplateProps = TemplateRootProps &
  TemplateCommonProps & {
    /**
     * El `<form>` con sus `FormSection` y, al final, `FormActions` (el de
     * `@/components/ui/form-actions`, que además lleva el foco al primer error
     * cuando vuelve la respuesta del server). En solo lectura: `Field
     * readOnly`, `EntryEditor` como `EntryPreview` y sin `FormActions`.
     */
    children: React.ReactNode
    /**
     * `EntryPreview` o una ayuda. Al costado y fija mientras se baja (con el
     * mismo mínimo que el resto de las columnas al costado); en el celular,
     * debajo del formulario, arriba de la barra fija de acciones.
     */
    aside?: React.ReactNode
    /**
     * `compact`: una columna de 3xl en todos los anchos (el `aside`, si hay,
     * va abajo). `comfortable`: página de 6xl; con `aside`, formulario de 3xl
     * y el `aside` al costado; sin `aside`, el formulario usa todo el ancho
     * (grillas como el asiento manual). Default: `comfortable` con `aside`,
     * `compact` sin.
     */
    width?: 'compact' | 'comfortable'
  }

/**
 * Celular (§5.4): la barra de `FormActions` va fija abajo y escribe su alto en
 * `<html>` como `--sticky-actions-h`. Su lugar se reserva al final de la
 * plantilla y no al final del `<form>` (que es donde la barra lo reserva
 * sola): así el `aside`, que va después del formulario, queda entero arriba
 * de la barra, en lugar de con un hueco antes y tapado al final. Con
 * `h-auto`, el envoltorio de una barra fija mide 0 y el de una que no es fija
 * (ventana de menos de 480 px de alto) mide lo que su barra; en ese caso la
 * variable no existe y queda el relleno de siempre (24 px).
 */
const FORM_MOBILE_ACTIONS = [
  'max-sm:[&_[data-slot=form-actions]]:h-auto',
  'max-sm:pb-[calc(var(--sticky-actions-h,0px)+1.5rem)]',
].join(' ')

/**
 * Comprobante, pago, reserva (§5.4): encabezado (con `back`, que ya cancela)
 * → formulario en una columna de `max-w-3xl` → `aside`.
 *
 * - **Foco al primer error:** lo hace el `FormActions` de
 *   `@/components/ui/form-actions` cuando el `<form action>` deja de estar
 *   pendiente. Un formulario sin esa barra usa `useFocusFirstInvalid(formRef,
 *   state)` de `@/components/ui/field`.
 * - **Una sola principal**, última a la derecha: la acción más frecuente (en
 *   un comprobante de compra, «Guardar»; «Guardar y pagar» es secundaria).
 * - **En el celular**, dos acciones como máximo en la barra fija: «Cancelar»
 *   sale de la barra porque el `back` del encabezado ya cancela.
 * - **Solo lectura** (`readOnly` o un mes cerrado con `ClosedPeriodCallout`):
 *   los campos con `readOnly` y sin `FormActions`.
 */
function FormTemplate({
  header,
  children,
  aside,
  width,
  notice,
  readOnly = false,
  className,
  ...props
}: FormTemplateProps) {
  const hasAside = hasNode(aside)
  const resolvedWidth = width ?? (hasAside ? 'comfortable' : 'compact')
  const sideBySide = hasAside && resolvedWidth === 'comfortable'
  return (
    <PageShell
      data-slot="form-template"
      data-readonly={readOnly ? '' : undefined}
      width={resolvedWidth}
      className={cn(FORM_MOBILE_ACTIONS, className)}
      {...props}
    >
      {header}
      <TemplateNotices readOnly={readOnly} notice={notice} />
      <div
        data-slot="form-template-body"
        className={cn('flex min-w-0 flex-col gap-8', sideBySide && SIDE_BODY)}
      >
        <div
          data-slot="form-template-main"
          className={cn(
            'w-full min-w-0',
            hasAside && 'max-w-3xl',
            // 34 rem: un FieldRow de tres (tipo, punto de venta, número) sin apretarse.
            sideBySide && 'lg:w-auto lg:min-w-[34rem] lg:flex-[999_1_0%]',
          )}
        >
          {children}
        </div>
        <TemplateSlot
          name="form-template-aside"
          className={cn(
            'w-full max-w-3xl',
            sideBySide && [SIDE_COLUMN, 'lg:sticky lg:top-[calc(var(--topbar-h)+1rem)]'],
          )}
        >
          {aside}
        </TemplateSlot>
      </div>
    </PageShell>
  )
}

// ─── Libro o reporte ─────────────────────────────────────────────────────────

export type ReportTemplateProps = TemplateRootProps &
  TemplateCommonProps & {
    /** Franja de totales (opcional): «Debe $ 18.420.000 · Haber $ 18.420.000 · Debe = Haber». */
    totals?: React.ReactNode
    /** `LedgerTable` o `DataTable` compacta (`mobile="scroll"`, primera columna fija, `tfoot` con la regla doble). */
    children: React.ReactNode
    /** Notas al pie del libro: «D = saldo deudor · A = saldo acreedor». */
    notes?: React.ReactNode
    /** Default `default`; `wide` para libros con muchas columnas (IVA compras). */
    width?: PageShellWidth
  }

/**
 * Diario, mayor, IVA, sumas y saldos, «Cómo nos fue» (§5.5): encabezado (con
 * el `PeriodPicker` y el `ExportButton` en las acciones) → totales → libro →
 * notas, a 16 px entre sí: son una sola pieza. El período va en la URL y lo
 * comparten todos los reportes; con más de 1.000 filas la consulta agrega en
 * SQL o marca `truncated`.
 */
function ReportTemplate({
  header,
  totals,
  children,
  notes,
  notice,
  readOnly = false,
  width = 'default',
  className,
  ...props
}: ReportTemplateProps) {
  return (
    <PageShell
      data-slot="report-template"
      data-readonly={readOnly ? '' : undefined}
      width={width}
      className={className}
      {...props}
    >
      {header}
      <TemplateNotices readOnly={readOnly} notice={notice} />
      <div data-slot="report-template-body" className="flex min-w-0 flex-col gap-4">
        <TemplateSlot name="report-template-totals">{totals}</TemplateSlot>
        {children}
        <TemplateSlot
          name="report-template-notes"
          className="max-w-prose type-small text-pretty text-muted-foreground"
        >
          {notes}
        </TemplateSlot>
      </div>
    </PageShell>
  )
}

// ─── Estado de cuenta ────────────────────────────────────────────────────────

export type StatementTemplateProps = TemplateRootProps &
  TemplateCommonProps & {
    /**
     * `<KPIGroup>` (Saldo · Vencido con `DueStatus` · Vence en 7 días) y la
     * `AgingBar` con su leyenda (compacta en el celular), a 16 px.
     */
    balance: React.ReactNode
    /** `<TabsNav>`: Movimientos · Comprobantes · Pagos · Datos. Las cajas no tienen pestañas. */
    tabs?: React.ReactNode
    /** La `LedgerTable` (Fecha · Comprobante · Vence · Facturas · Pagos · Saldo; `mobile="cards"`). */
    children: React.ReactNode
    /** `<Section title="Próximos vencimientos">`: una lista con `DueStatus`. */
    upcoming?: React.ReactNode
    /** Default `default`. */
    width?: PageShellWidth
  }

/**
 * Proveedores, clientes, cajas (§5.6): encabezado → saldo y antigüedad →
 * pestañas → libro → próximos vencimientos. Como la ficha, en el celular la
 * acción principal del encabezado ocupa todo el ancho.
 */
function StatementTemplate({
  header,
  balance,
  tabs,
  children,
  upcoming,
  notice,
  readOnly = false,
  width = 'default',
  className,
  ...props
}: StatementTemplateProps) {
  return (
    <PageShell
      data-slot="statement-template"
      data-readonly={readOnly ? '' : undefined}
      width={width}
      className={cn(MOBILE_PRIMARY_FULL, className)}
      {...props}
    >
      {header}
      <TemplateNotices readOnly={readOnly} notice={notice} />
      <TemplateSlot name="statement-template-balance" className="flex flex-col gap-4">
        {balance}
      </TemplateSlot>
      <div data-slot="statement-template-body" className="flex min-w-0 flex-col gap-6">
        <TemplateSlot name="statement-template-tabs">{tabs}</TemplateSlot>
        {children}
      </div>
      <TemplateSlot name="statement-template-upcoming">{upcoming}</TemplateSlot>
    </PageShell>
  )
}

// ─── Patrones que cruzan las plantillas (§5.7) ───────────────────────────────

/** El texto del aviso de solo lectura (§5.7). */
const READ_ONLY_MESSAGE = 'Tenés acceso de lectura: podés ver y exportar todo.'

export type ReadOnlyCalloutProps = Omit<CalloutProps, 'tone'>

/**
 * El aviso del rol de solo lectura (§5.7): `Callout tone="info"` arriba del
 * contenido, una vez por pantalla y sin anuncio (está desde que carga: no
 * aparece por una acción). Las plantillas con `readOnly` lo dibujan solas;
 * suelto sirve para pantallas que no usan plantilla.
 */
function ReadOnlyCallout({ children, ...props }: ReadOnlyCalloutProps) {
  return (
    <Callout data-slot="read-only-callout" tone="info" {...props}>
      {children ?? READ_ONLY_MESSAGE}
    </Callout>
  )
}

export type ClosedPeriodCalloutProps = Omit<CalloutProps, 'tone' | 'icon' | 'title'> & {
  /** El mes cerrado como se lee en la pantalla: «Septiembre», «Septiembre 2026». */
  period: React.ReactNode
  /**
   * Adonde lleva «Nuevo asiento de ajuste». Sin esto, el aviso va sin acción
   * (lo que ve la contadora). Una `action` explícita gana: la ficha de un
   * comprobante ofrece también nota de crédito y «Anular con fecha de hoy».
   */
  adjustmentHref?: string
}

/**
 * Período cerrado (§5.7: «una vez cerrado, ese mes no se toca; las
 * correcciones van con un asiento de ajuste»). `Callout tone="neutral"` con
 * `Lock`, sin anuncio: va arriba de un comprobante de un mes cerrado, que se
 * abre en solo lectura. «Septiembre está cerrado. Para corregir, cargá un
 * asiento de ajuste.» + «Nuevo asiento de ajuste».
 */
function ClosedPeriodCallout({
  period,
  adjustmentHref,
  action,
  children,
  ...props
}: ClosedPeriodCalloutProps) {
  const adjustment = adjustmentHref ? (
    <Button asChild variant="secondary" size="sm">
      <Link href={adjustmentHref}>Nuevo asiento de ajuste</Link>
    </Button>
  ) : undefined
  return (
    <Callout
      data-slot="closed-period-callout"
      tone="neutral"
      icon={Lock}
      title={<>{period} está cerrado</>}
      action={action ?? adjustment}
      {...props}
    >
      {children ?? 'Para corregir, cargá un asiento de ajuste.'}
    </Callout>
  )
}

export {
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
}
