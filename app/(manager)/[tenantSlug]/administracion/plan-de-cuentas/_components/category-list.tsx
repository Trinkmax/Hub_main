'use client'

import { ArrowRight, Plus, Search, Tags, X } from 'lucide-react'
import Link from 'next/link'
import { useId, useMemo, useState } from 'react'
import { plural } from '@/components/administracion/format'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Panel } from '@/components/administracion/kit/panel'
import { Button } from '@/components/ui/button'
import {
  type CategoryListGroup,
  categoryCount,
  categoryListGroups,
  categoryUsedText,
  filterCategoryGroups,
  usedCategoryCount,
} from '../_lib/categories'
import { useChartWorkspace } from './workspace-context'

/**
 * «Tus categorías»: lo que un socio ve del plan de cuentas. No el árbol de 228
 * cuentas con código, sino la lista de «¿En qué se gastó?»: las mismas
 * categorías, en los mismos grupos y con los mismos nombres que aparecen al
 * cargar un gasto. Tocar una abre su hoja (la de siempre); «Agregar en …» abre
 * el alta corta, que pide el nombre y para qué se usa.
 *
 * Sin barras: cuánto va a cada categoría ya se dibuja en el Resumen («En qué se
 * va la plata»). Acá, en gris, va lo anotado en el año o «sin uso» (con casi nada cargado,
 * solo lo que tiene importe: el aviso de arriba explica el resto). La contadora
 * (solo lectura) ve la misma lista sin ningún botón de alta.
 */

/**
 * «Nueva categoría» del encabezado: abre el alta corta sin grupo elegido (se elige ahí mismo). No se
 * dibuja en solo lectura. `quiet` = en contorno: el vacío de la búsqueda la repite y el botón
 * relleno de la vista sigue siendo el del encabezado.
 */
export function NewCategoryButton({ quiet = false }: { quiet?: boolean } = {}) {
  const { readOnly, createAccount } = useChartWorkspace()
  if (readOnly) return null
  return (
    <Button
      type="button"
      variant={quiet ? 'outline' : 'default'}
      className="h-11 gap-2 md:pointer-fine:h-9"
      onClick={() => createAccount(undefined, { simple: true })}
    >
      <Plus className="size-4" aria-hidden />
      Nueva categoría
    </Button>
  )
}

/** Con menos categorías usadas que esto, la lista explica qué va a aparecer. */
const FEW_USED = 3

export function CategoryList({
  suppliersHref,
}: {
  /** Compras y pagos › Proveedores sin categoría. */
  suppliersHref: string
}) {
  const { index, readOnly, balancesAvailable, openAccount, createAccount } = useChartWorkspace()
  const [query, setQuery] = useState('')
  const searchId = useId()

  const groups = useMemo(() => categoryListGroups(index.ordered), [index])
  const total = categoryCount(groups)
  const shown = useMemo(() => filterCategoryGroups(groups, query), [groups, query])
  const fewUsed = balancesAvailable && usedCategoryCount(groups) < FEW_USED

  if (total === 0) {
    return (
      <EmptyTeach
        icon={Tags}
        title="Todavía no hay categorías"
        action={readOnly ? undefined : <NewCategoryButton />}
      >
        Son las que vas a elegir en «¿En qué se gastó?» al cargar un gasto o una compra. En el plan
        son las cuentas que tienen ese tilde: están en «Plan completo».
      </EmptyTeach>
    )
  }

  return (
    <Panel
      title={`Tenés ${plural(total, 'categoría', 'categorías')} para clasificar lo que gastás`}
      description="Son las que aparecen en «¿En qué se gastó?» cuando cargás un gasto o una compra."
    >
      <div className="space-y-5">
        <div className="relative max-w-md">
          <label htmlFor={searchId} className="sr-only">
            Buscar una categoría
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar una categoría"
            autoComplete="off"
            className="h-11 w-full rounded-full border border-border/70 bg-card pr-11 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Borrar la búsqueda"
              className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:right-1 md:pointer-fine:size-9"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        {fewUsed && !query ? (
          <p className="rounded-xl bg-secondary/50 px-3 py-2.5 text-sm text-pretty">
            Todavía cargaste muy pocos gastos: cuando cargues, acá vas a ver cuánto fue a cada
            categoría.
          </p>
        ) : null}

        {shown.length === 0 ? (
          // El vacío de la búsqueda ofrece el alta: los «Agregar en …» no están a la vista acá.
          <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
            <p className="text-sm text-muted-foreground text-pretty">
              No encontramos ninguna categoría con «{query.trim()}». Probá con otra palabra
              {readOnly ? '.' : ' o creala.'}
            </p>
            <NewCategoryButton quiet />
          </div>
        ) : (
          <div className="gap-x-10 lg:columns-2">
            {shown.map((group) => (
              <CategoryGroupBlock
                key={group.id}
                group={group}
                showUsed={balancesAvailable}
                // Casi sin gastos (un bar que recién arranca) el aviso de arriba ya lo dice: un
                // «sin uso» en cada uno de los 51 renglones era ruido. Solo va lo que tiene importe.
                quietUnused={fewUsed}
                onOpen={(id) => openAccount(id, { simple: true })}
                onAdd={
                  readOnly || group.parentId === null
                    ? null
                    : () => createAccount(group.parentId, { simple: true })
                }
              />
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-border/60 pt-4">
          {balancesAvailable ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Lo anotado en cada categoría en lo que va del año. Si la compra fue con Factura A, va
              sin el IVA.
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-pretty">
            <span className="text-muted-foreground">
              ¿Siempre le comprás lo mismo a un proveedor? Ponele su categoría de siempre y no la
              elegís más.
            </span>
            <Link
              href={suppliersHref}
              className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              Clasificar proveedores
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </p>
        </div>
      </div>
    </Panel>
  )
}

function CategoryGroupBlock({
  group,
  showUsed,
  quietUnused,
  onOpen,
  onAdd,
}: {
  group: CategoryListGroup
  /** Hay saldos: se muestra lo anotado (o «sin uso»). */
  showUsed: boolean
  /** Sin «sin uso»: solo se dice el importe de las que tienen. */
  quietUnused: boolean
  onOpen: (id: string) => void
  /** `null` = sin alta (la contadora, o un grupo que no es una cuenta del plan). */
  onAdd: (() => void) | null
}) {
  return (
    <section className="mb-6 break-inside-avoid">
      <div className="mb-1 px-2">
        {/* «Personal · 3 categorías»: el número nunca va suelto al lado del nombre. */}
        <h3 className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {group.name}
          <span className="font-normal normal-case tracking-normal tabular-nums">
            · {plural(group.items.length, 'categoría', 'categorías')}
          </span>
        </h3>
        {group.note ? (
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{group.note}</p>
        ) : null}
      </div>
      <ul>
        {group.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-pretty">{item.shortName}</span>
                {item.description ? (
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {item.description}
                  </span>
                ) : null}
              </span>
              {showUsed && !(quietUnused && !((item.usedCents ?? 0) > 0)) ? (
                <span className="shrink-0 text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                  {categoryUsedText(item.usedCents)}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9"
        >
          <Plus className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Agregar en {group.name}</span>
        </button>
      ) : null}
    </section>
  )
}
