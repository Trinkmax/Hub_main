'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Panel } from '@/components/administracion/kit'
import {
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
  type LauncherItem,
} from '@/components/administracion/nav/launcher-items'
import { importSourceHref } from '@/lib/imports/ui/labels'
import { cn } from '@/lib/utils'
import { administracionHref, comprasHref, newPurchaseHref } from '../_lib/links'

/** Las tres situaciones de esta pantalla, por su clave del lanzador y en el orden en que pasan. */
const DOOR_KEYS = ['gasto', 'compra', 'pagar'] as const

const DOOR_ITEMS: readonly LauncherItem[] = DOOR_KEYS.flatMap((key) => {
  const item = LAUNCHER_ITEMS.find((candidate) => candidate.key === key)
  return item ? [item] : []
})

const ROW =
  'group press-lift flex min-h-14 w-full items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[4.25rem] sm:px-3.5'

const QUIET_LINK =
  'inline-flex min-h-11 items-center gap-1 rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

function DoorBody({ item }: { item: LauncherItem }) {
  const Icon = item.icon
  return (
    <>
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-accent-foreground shadow-2xs"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-pretty">{item.title}</span>
        {/* En el celular va solo el título: la libreta tiene que asomar en la primera pantalla. */}
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground text-pretty max-sm:hidden">
          {item.hint}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-[translate,color] duration-(--duration-fast) ease-(--ease-out) group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
      />
    </>
  )
}

/**
 * «¿Qué querés cargar?» de Compras y pagos: LA puerta de carga de la pantalla
 * (reemplaza a los cuatro botones del encabezado, que en el celular ni se
 * veían). Son, literalmente, tres tarjetas del lanzador (mismo título, mismo
 * ejemplo, mismo ícono, leídos de `launcher-items`): el socio ve lo mismo acá y
 * en «＋ Cargar», y la pregunta es una sola: ¿ya lo pagaste o lo quedás debiendo?
 *
 * La contadora no la ve (no se dibuja; el héroe ocupa todo el ancho).
 */
export function ComprasDoor({ tenantSlug, className }: { tenantSlug: string; className?: string }) {
  const { readOnly, openAction } = useAccounting()
  if (readOnly) return null
  const base = administracionHref(tenantSlug)

  return (
    <Panel title={LAUNCHER_TITLE} className={className}>
      <ul className="grid gap-2">
        {DOOR_ITEMS.map((item) => {
          const target = item.target
          return (
            <li key={item.key}>
              {target.kind === 'sheet' ? (
                <button type="button" onClick={() => openAction(target.action)} className={ROW}>
                  <DoorBody item={item} />
                </button>
              ) : (
                // La compra vuelve a esta pantalla al guardar o cancelar.
                <Link
                  href={newPurchaseHref(tenantSlug, { volver: comprasHref(tenantSlug) })}
                  className={ROW}
                >
                  <DoorBody item={item} />
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      <ul className={cn('mt-3 grid gap-x-4 text-xs sm:mt-4')}>
        <li>
          <Link href={importSourceHref(tenantSlug, 'arca_recibidos')} className={QUIET_LINK}>
            ¿Tenés muchas Facturas A? Bajalas de ARCA en vez de tipearlas
            <ArrowRight aria-hidden className="size-3 shrink-0" />
          </Link>
        </li>
        <li>
          <Link href={`${base}/guias/dia-a-dia`} className={QUIET_LINK}>
            ¿No sabés cuál va? Mirá la guía
            <ArrowRight aria-hidden className="size-3 shrink-0" />
          </Link>
        </li>
      </ul>
    </Panel>
  )
}
