import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PillLink } from './pill'

/**
 * Las vistas de una pantalla: el segundo nivel de una sección, cuando se ve
 * UNA vista por vez y la elección vive en la URL (`?tab=`, `?ver=`, `?mes=`).
 * «El mes · Plata por cobrar · Lo que llegó · Facturas».
 *
 * La activa va RELLENA en tinta: el verde queda para la barra de la sección,
 * así se ve de un vistazo cuál es el primer nivel y cuál el segundo. En el
 * celular la fila se desliza (se desvanece a la derecha para que se note que
 * sigue); desde `sm`, si no entran todas, bajan de renglón: ninguna queda
 * cortada ni escondida. Donde se toca con el dedo cada píldora mide 44 px.
 *
 * - `shortLabel`: el nombre corto, para el celular («Por cobrar»).
 * - `count`: un contador, adentro de su pastilla.
 * - `ariaLabel`: lo que escucha un lector en lugar del texto, cuando el texto
 *   solo no alcanza («Octubre, este mes: 3 por pagar»).
 * - `disabled`: una vista que hoy no tiene nada («Cargados · 0»): se dibuja
 *   apagada, con su contador, y no se puede tocar ni enfocar.
 * - `scroll`: `false` para que cambiar de vista no salte arriba de la página.
 * - `aside`: el control de período de esa vista. Va a la derecha si entra al
 *   lado de las vistas; si no, baja solo a su propio renglón.
 *
 * Cuándo NO: para filtros (esos son `PillLink` / `Pill` sueltos, con
 * contador); para pasos (`StepRail`); para más de ~8 destinos; ni para moverse
 * entre secciones (eso es la barra).
 */

export type ViewPillItem = {
  key: string
  label: string
  shortLabel?: string
  href: string
  icon?: LucideIcon
  count?: ReactNode
  active: boolean
  /** El nombre para lectores, si el texto visible no alcanza. */
  ariaLabel?: string
  /** Apagada: se ve, con su contador, pero no es un link. */
  disabled?: boolean
  /** Se le pasa al link: `false` para no saltar arriba al cambiar de vista. */
  scroll?: boolean
}

/**
 * La medida de cada píldora: 44 px donde se toca con el dedo (celular, tablet)
 * y 36 px en una compu con mouse. El corte es por tipo de puntero y no por
 * ancho: en un iPad siguen midiendo 44.
 */
const PILL_SIZE =
  'h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'

/** El aspecto de una píldora en reposo (el de `PillLink`), para la que está apagada. */
const PILL_OFF =
  'inline-flex shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-card font-medium text-foreground opacity-50'

function PillText({ item }: { item: ViewPillItem }) {
  if (!item.shortLabel) return <>{item.label}</>
  return (
    <>
      <span className="sm:hidden">{item.shortLabel}</span>
      <span className="max-sm:hidden">{item.label}</span>
    </>
  )
}

export function ViewPills({
  label,
  items,
  aside,
  className,
}: {
  /** El `aria-label` del `<nav>`: «Vistas de Ventas». */
  label: string
  items: readonly ViewPillItem[]
  aside?: ReactNode
  className?: string
}) {
  if (items.length === 0 && !aside) return null
  return (
    // `flex-wrap`: si las vistas y el `aside` no entran lado a lado, el `aside`
    // baja solo a su renglón, a cualquier ancho (con el menú abierto, una
    // notebook tiene menos lugar que una tablet).
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3', className)}>
      {items.length > 0 ? (
        <nav aria-label={label} className="min-w-0 max-w-full">
          {/* El margen negativo deja lugar al anillo de foco, que si no se
              corta contra el borde del área que desliza. En el celular la fila
              desliza y el relleno de la derecha saca la última píldora de la
              zona desvanecida; desde `sm` baja de renglón en vez de deslizar. */}
          <ul className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {items.map((item) => (
              <li
                key={item.key}
                // Al entrar, la fila arranca mostrando la vista elegida (donde
                // el navegador lo soporta; en el resto arranca desde el principio).
                // SOLO en el celular, donde la fila es la que desliza: desde `sm` la
                // fila no desliza y «el que desliza más cercano» pasa a ser la PÁGINA,
                // que arrancaba corrida hasta dejar la píldora arriba (y el título y
                // la barra, afuera de la pantalla).
                className={cn('shrink-0', item.active && 'max-sm:[scroll-initial-target:nearest]')}
              >
                {item.disabled ? (
                  // Sin link y fuera del orden de Tab: es texto, con su contador.
                  // Un lector lo lee como lo que es (una vista que hoy no lleva a nada).
                  <span aria-disabled="true" className={cn(PILL_OFF, PILL_SIZE)}>
                    {item.ariaLabel ? <span className="sr-only">{item.ariaLabel}</span> : null}
                    <span aria-hidden={item.ariaLabel ? true : undefined} className="contents">
                      {item.icon ? <item.icon aria-hidden className="size-4 shrink-0" /> : null}
                      <span>
                        <PillText item={item} />
                      </span>
                      {item.count !== undefined && item.count !== null ? (
                        <span className="rounded-full bg-secondary px-1.5 py-px font-mono text-[11px] tabular-nums">
                          {item.count}
                        </span>
                      ) : null}
                    </span>
                  </span>
                ) : (
                  <PillLink
                    href={item.href}
                    scroll={item.scroll}
                    active={item.active}
                    activeTone="ink"
                    icon={item.icon}
                    count={item.count}
                    aria-label={item.ariaLabel}
                    className={PILL_SIZE}
                  >
                    <PillText item={item} />
                  </PillLink>
                )}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {aside ? (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{aside}</div>
      ) : null}
    </div>
  )
}
