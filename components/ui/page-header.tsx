import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { type BreadcrumbItem, Breadcrumb as BreadcrumbNav, crumbLinkClass } from './breadcrumb'

/** @deprecated usá `BreadcrumbItem` de `@/components/ui/breadcrumb`. */
export type Breadcrumb = BreadcrumbItem

export type PageHeaderBack = {
  href: string
  /** El nombre de adonde se vuelve: «Proveedores», no «Volver». */
  label: string
}

export type PageHeaderProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  /** Una o dos líneas que explican la pantalla. Va en un `<div>`: los loaders pasan `<Skeleton>`. */
  description?: React.ReactNode
  /** Botones de la página; la acción principal va última. */
  actions?: React.ReactNode
  /** «← Proveedores» (ícono `ArrowLeft`: Inter no tiene la flecha). */
  back?: PageHeaderBack
  /** Migas, cuando hay dos niveles o más. En el celular, si también hay `back`, se ve solo `back`. */
  breadcrumbs?: ReadonlyArray<BreadcrumbItem>
  /**
   * Línea de contexto arriba del título, 13 px en minúscula normal: «Buenas
   * tardes, HUB». Solo si aporta (nunca el nombre de la sección: el menú ya
   * ubica).
   */
  context?: React.ReactNode
  /** Datos clave en una fila: pasá un array y se separan con `·` («CUIT … · Responsable inscripto»). */
  meta?: React.ReactNode
  /** `<TabsNav>` o `<TabsList>` pegado abajo, con su pelo. */
  tabs?: React.ReactNode
  /**
   * @deprecated se dibuja como línea de contexto de 13 px sin mayúsculas (igual
   * que `context`). Si era un «volver», usá `back`.
   */
  eyebrow?: React.ReactNode
}

/**
 * Las acciones abarcan en escritorio las filas que haya a su izquierda (título,
 * descripción, meta) y se apoyan abajo. Clases enteras para que Tailwind las
 * genere: no se arman con plantillas.
 */
const ACTIONS_ROW_SPAN = ['sm:row-span-1', 'sm:row-span-2', 'sm:row-span-3'] as const

/**
 * Encabezado de página del kit (§3.5). Server-safe. De arriba hacia abajo:
 *
 * | Fila        | Qué lleva                                     | `data-slot`        |
 * |-------------|-----------------------------------------------|--------------------|
 * | Contexto    | volver, migas o contexto (13 px, apagado)     | `page-context`     |
 * | Título      | el único `<h1>` de la página, `type-title`    | `page-title`       |
 * | Acciones    | a la derecha y abajo en escritorio; en el celular debajo del título | `page-actions` |
 * | Descripción | `type-body` apagado, `max-w-2xl`              | `page-description` |
 * | Meta        | `type-small` separado por `·`                 | `page-meta`        |
 * | Pestañas    | lo que llega en `tabs`                        | `page-tabs`        |
 *
 * Los `data-slot` son el gancho estable para el CSS (el `.wa` de Mensajería
 * achica el título y esconde el contexto por `data-slot`, no por clases) y
 * para los tests.
 *
 * Compatibilidad: `eyebrow` (83 usos) se sigue viendo, como contexto y sin
 * mayúsculas, hasta que cada lote lo pase a `back`, `breadcrumbs` o `context`.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  breadcrumbs,
  context,
  meta,
  tabs,
  eyebrow,
  className,
  children,
  ...props
}: PageHeaderProps) {
  const crumbs = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : null
  const contextLine = context ?? eyebrow
  const hasContext = Boolean(back || crumbs || contextLine)
  const metaItems = meta === undefined || meta === null ? [] : React.Children.toArray(meta)
  // Misma regla que antes: un `description` vacío o falso no deja una fila en blanco.
  const hasDescription = Boolean(description)
  const actionsSpan = ACTIONS_ROW_SPAN[(hasDescription ? 1 : 0) + (metaItems.length > 0 ? 1 : 0)]

  return (
    <div data-slot="page-header" className={cn('flex flex-col gap-4', className)} {...props}>
      <div className="flex flex-col gap-2">
        {hasContext ? (
          <div
            data-slot="page-context"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 type-small text-muted-foreground"
          >
            {back ? (
              <Link
                href={back.href}
                data-slot="page-back"
                className={cn(
                  crumbLinkClass,
                  'inline-flex items-center gap-1',
                  crumbs && 'sm:hidden',
                )}
              >
                <ArrowLeft aria-hidden="true" className="size-3.5 shrink-0" />
                {back.label}
              </Link>
            ) : null}
            {crumbs ? (
              <BreadcrumbNav items={crumbs} className={cn(back && 'max-sm:hidden')} />
            ) : null}
            {contextLine ? (
              // div y no p/span: los loaders pasan <Skeleton> (un div) como eyebrow.
              <div data-slot="page-eyebrow" className="min-w-0 text-pretty">
                {contextLine}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6">
          <h1
            data-slot="page-title"
            className="min-w-0 break-words type-title sm:col-start-1 sm:row-start-1"
          >
            {title}
          </h1>
          {actions ? (
            <div
              data-slot="page-actions"
              className={cn(
                'flex flex-wrap items-center gap-2 max-sm:mt-1 sm:col-start-2 sm:row-start-1 sm:self-end sm:justify-end',
                actionsSpan,
              )}
            >
              {actions}
            </div>
          ) : null}
          {hasDescription ? (
            // div (no <p>): description acepta ReactNode y varios loading.tsx le
            // pasan <Skeleton> (un div); div dentro de p es HTML inválido y
            // dispara errores de hidratación.
            <div
              data-slot="page-description"
              className="max-w-2xl text-pretty type-body text-muted-foreground sm:col-start-1"
            >
              {description}
            </div>
          ) : null}
          {metaItems.length > 0 ? (
            <div
              data-slot="page-meta"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 type-small text-muted-foreground sm:col-start-1"
            >
              {metaItems.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fila fija de datos que no se reordena
                <React.Fragment key={index}>
                  {index > 0 ? <span aria-hidden="true">·</span> : null}
                  <span className="min-w-0">{item}</span>
                </React.Fragment>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {tabs ? <div data-slot="page-tabs">{tabs}</div> : null}
      {children}
    </div>
  )
}
