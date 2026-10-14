import { BookOpenText, CircleCheck, SearchX } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { EmptyTeach, PanelError } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type AccountingSettings,
  type AccountRow,
  exportHref,
  getAccountingSettings,
  listAccounts,
  listParties,
  type PartyList,
  type QueryOutcome,
  settleQuery,
} from '@/lib/accounting/queries'
import { matchesPartyFilter, matchesPartyQuery } from '@/lib/accounting/queries/parties'
import {
  listPartyClassifications,
  type PartyClassification,
} from '@/lib/accounting/queries/party-classification'
import { libretaView, supplierShortName } from '../_lib/libreta'
import { comprasHref, firstParam, newPurchaseHref } from '../_lib/links'
import {
  canPickAccount,
  countClassifiable,
  countUnclassified,
  isVisibleSupplier,
  supplierAccountOptions,
  supplierCategoryChoices,
  supplierFilterOf,
} from '../_lib/suppliers'
import { BulkSuppliersDialog } from './bulk-suppliers-dialog'
import { LibretaHero } from './libreta-hero'
import { LibretaList, LibretaToolbar } from './libreta-list'
import { SupplierAccountProvider, type SupplierAccountRow } from './supplier-account-picker'
import { type SorterItem, SupplierSorter } from './supplier-sorter'
import { UnclassifiedStrip } from './unclassified-strip'

const MATCH = { filter: matchesPartyFilter, query: matchesPartyQuery }

/** Cuántos «sin deuda» se asoman cuando la mayoría todavía no tiene categoría. */
export const SETTLED_PREVIEW_UNSORTED = 4

/**
 * Lo que lee la pestaña «Proveedores», UNA vez: los saldos del grupo entero
 * (sin filtro ni búsqueda), la ficha de cada uno (su categoría) y, para quien
 * carga, el plan. El héroe, los contadores de las píldoras, la lista y el
 * clasificador salen de acá: nunca dicen cosas distintas.
 *
 * Las fichas y el plan van aparte de los saldos: si fallan, la libreta se ve
 * igual, sin categoría ni «Elegir categoría».
 */
export type LibretaData = {
  list: QueryOutcome<PartyList>
  classes: QueryOutcome<Map<string, PartyClassification>>
  plan: QueryOutcome<AccountRow[]> | null
  /** Para saber si faltan los saldos iniciales (el héroe no dice «$ 0» ni «nada»). */
  settings: QueryOutcome<AccountingSettings | null>
}

/** Arranca las lecturas sin esperarlas: cada bloque espera la suya detrás de su `Suspense`. */
export function loadLibreta(tenantId: string, canWrite: boolean): Promise<LibretaData> {
  return Promise.all([
    settleQuery(listParties(tenantId, { group: 'payables' })),
    settleQuery(listPartyClassifications(tenantId, 'payables')),
    canWrite ? settleQuery(listAccounts(tenantId)) : null,
    settleQuery(getAccountingSettings(tenantId)),
  ]).then(([list, classes, plan, settings]) => ({ list, classes, plan, settings }))
}

/** Las categorías como botones y el plan completo, armados del plan de cuentas. */
function categoryChoices(
  plan: readonly AccountRow[],
  classes: ReadonlyMap<string, PartyClassification> | null,
  inUse: ReadonlySet<string>,
) {
  // «Las que más usás»: cuántos proveedores tienen ya cada categoría.
  const usage = new Map<string, number>()
  for (const info of classes?.values() ?? []) {
    if (info.defaultAccountId) {
      usage.set(info.defaultAccountId, (usage.get(info.defaultAccountId) ?? 0) + 1)
    }
  }
  return {
    choices: supplierCategoryChoices(plan, usage),
    usage,
    accounts: supplierAccountOptions(plan, inUse),
  }
}

/**
 * A1 · «Le debés a proveedores»: el número de la portada. Espera la lectura de
 * la pestaña; si falló, lo dice en su lugar y el resto de la pantalla sigue.
 */
export async function SuppliersHeroBlock({
  data,
  tenantSlug,
  canWrite = false,
  className,
}: {
  data: Promise<LibretaData>
  tenantSlug: string
  /** Quien carga ve la acción del momento al lado del número. */
  canWrite?: boolean
  className?: string
}) {
  const { list, settings } = await data
  if (!list.ok) {
    return (
      <PanelError title="Le debés a proveedores" message={list.message} className={className} />
    )
  }
  // Si la lectura de la configuración falla, el héroe dice lo cargado (como antes).
  const openingPending = settings.ok && settings.data?.openingStatus === 'pending'
  const rows = list.data.rows
  return (
    <LibretaHero
      tenantSlug={tenantSlug}
      totals={list.data.totals}
      debtors={rows.filter((r) => r.debtCents > 0).length}
      overdueParties={rows.filter((r) => r.overdueCents > 0).length}
      hasSuppliers={rows.some((r) => isVisibleSupplier(r, 'all'))}
      openingPending={openingPending}
      canWrite={canWrite}
      className={className}
    />
  )
}

/** La silueta de tres renglones de libreta, para el bar que todavía no tiene proveedores. */
function LibretaSilhouette() {
  const rows = [
    { name: 'w-32', bar: 'w-24', amount: 'w-16' },
    { name: 'w-24', bar: 'w-14', amount: 'w-14' },
    { name: 'w-28', bar: 'w-8', amount: 'w-12' },
  ]
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
      {rows.map((row, index) => (
        <div key={row.name} className={index > 0 ? 'flex border-t border-border/60' : 'flex'}>
          <div className="flex w-10 shrink-0 flex-col items-center justify-center gap-1 border-r border-adm-s5/35 py-2.5">
            <span className="h-1 w-5 rounded-full bg-muted-foreground/25" />
            <span className="h-3 w-4 rounded-sm bg-muted-foreground/35" />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5">
            <div className="space-y-1.5">
              <span className={`block h-2 rounded-full bg-muted-foreground/35 ${row.name}`} />
              <span className={`block h-1.5 rounded-full bg-adm-neutral ${row.bar}`} />
            </div>
            <span className={`h-2.5 rounded-full bg-muted-foreground/30 ${row.amount}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * A3 + A4 · la franja de los que no tienen categoría y la libreta: la barra
 * (buscador, filtros con su contador, «Agregar de una lista», «Exportar
 * saldos») y la hoja con sus tres grupos. El vacío se decide ANTES de montar la
 * hoja: el bar sin proveedores ve qué va a aparecer y el botón del primer paso.
 */
export async function SuppliersBody({
  data,
  tenantSlug,
  sp,
  today,
  canWrite,
}: {
  data: Promise<LibretaData>
  tenantSlug: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
  canWrite: boolean
}) {
  const { list, classes, plan } = await data
  if (!list.ok) return <PanelError title="Tu libreta de proveedores" message={list.message} />

  const q = firstParam(sp.q).slice(0, 80)
  const { value: filter } = supplierFilterOf(firstParam(sp.filtro))
  const classMap = classes.ok ? classes.data : null
  const searching = q !== '' || filter !== 'todos'
  const pending = classMap ? countUnclassified(classMap.values()) : 0
  const classifiable = classMap ? countClassifiable(classMap.values()) : 0
  // El bar recién arrancado: casi ninguno tiene categoría y los «sin deuda» eran doce renglones
  // iguales con su «Elegir categoría» antes de la franja que los clasifica de un tirón. Con la
  // mayoría sin clasificar se asoman unos pocos (el resto, detrás de «Ver los N que faltan»).
  const fewSettled = canWrite && !searching && pending > 0 && pending * 2 > classifiable
  const view = libretaView({
    rows: list.data.rows,
    classes: classMap,
    filter,
    q,
    match: MATCH,
    preview: fewSettled ? SETTLED_PREVIEW_UNSORTED : undefined,
  })
  const hasSuppliers = list.data.rows.some((r) => isVisibleSupplier(r, 'all'))
  const existingNames = list.data.rows.map((row) => row.partyName)
  const exportLink = exportHref(tenantSlug, 'saldos-proveedores', { hasta: today })
  // A dónde vuelve «Cargarle una compra» al guardar: a esta lista, como estaba.
  const backHref = comprasHref(tenantSlug, 'proveedores', {
    filtro: filter === 'todos' ? null : filter,
    q: q || null,
  })

  // «Elegir categoría» desde el renglón: solo quien carga, y solo si se leyó el plan.
  const pickableRows: SupplierAccountRow[] = view.shown.flatMap(({ row, info, state }) =>
    info && state && canPickAccount(state)
      ? [
          {
            partyId: row.partyId,
            name: row.partyName,
            displayName: supplierShortName(row),
            kind: row.partyKind,
            updatedAt: info.updatedAt,
            accountId: info.defaultAccountId,
          },
        ]
      : [],
  )
  const picker =
    canWrite && plan?.ok
      ? categoryChoices(
          plan.data,
          classMap,
          new Set(pickableRows.flatMap((r) => (r.accountId ? [r.accountId] : []))),
        )
      : null
  const pickable = picker ? new Set(pickableRows.map((r) => r.partyId)) : new Set<string>()

  const toolbar = (
    <LibretaToolbar
      tenantSlug={tenantSlug}
      counts={view.counts}
      filter={filter}
      q={q}
      canWrite={canWrite}
      existingNames={existingNames}
      exportHref={exportLink}
      exportFileName={`saldos-proveedores-${today}.csv`}
    />
  )

  // El bar que todavía no cargó a nadie: qué va a aparecer acá y el primer paso.
  if (!hasSuppliers && !searching) {
    return (
      <EmptyTeach
        icon={BookOpenText}
        title="Acá va tu libreta de proveedores"
        illustration={<LibretaSilhouette />}
        action={
          canWrite ? (
            <Button asChild className="h-11 rounded-full px-5">
              <Link href={newPurchaseHref(tenantSlug, { volver: comprasHref(tenantSlug) })}>
                Cargar una compra que debo
              </Link>
            </Button>
          ) : undefined
        }
        secondary={
          canWrite ? (
            <BulkSuppliersDialog
              tenantSlug={tenantSlug}
              existingNames={existingNames}
              variant="link"
              label="Pegar la lista de mis proveedores"
            />
          ) : undefined
        }
      >
        Cada proveedor tiene su hoja: lo que te dejó, lo que le pagaste y lo que le debés. Se arma
        sola cuando cargás la primera compra.
      </EmptyTeach>
    )
  }

  const sheet: ReactNode =
    view.shown.length === 0 ? (
      filter === 'sin-clasificar' && q === '' ? (
        <EmptyTeach icon={CircleCheck} title="No queda ninguno sin categoría">
          Los que cargues de ahora en más aparecen acá hasta que les elijas una.
        </EmptyTeach>
      ) : (
        <EmptyTeach
          icon={SearchX}
          title={q ? `Nadie con «${q}» en esta vista` : 'Nadie en esta vista'}
          action={
            <Button asChild variant="outline" className="h-11 rounded-full px-5 md:h-9">
              <Link href={comprasHref(tenantSlug)} scroll={false}>
                Ver todos
              </Link>
            </Button>
          }
        >
          {q ? 'Probá con otro nombre o sacá el filtro.' : 'Probá con «Todos».'}
        </EmptyTeach>
      )
    ) : (
      <LibretaList
        tenantSlug={tenantSlug}
        view={view}
        today={today}
        canWrite={canWrite}
        pickable={pickable}
        backHref={backHref}
      />
    )

  const strip =
    canWrite && !searching ? (
      <UnclassifiedStrip tenantSlug={tenantSlug} pending={pending} total={classifiable} />
    ) : null
  // En esta pantalla lo primero es lo que se debe: con deuda a la vista, la invitación a
  // ordenar las categorías va DEBAJO de la libreta. Sin deuda no hay nada que apure y ordenar
  // la casa es lo que toca: ahí va arriba.
  const stripFirst = view.debt.length === 0

  return (
    // `flex` + `gap` y no `space-y`: en el celular la barra de la libreta se desarma
    // (`contents`) para mandar «Agregar de una lista» y «Exportar saldos» debajo de la hoja.
    <div className="flex flex-col gap-5">
      {stripFirst ? strip : null}
      {toolbar}
      {filter === 'sin-clasificar' && !classes.ok ? (
        <PanelError title="Proveedores sin categoría" message={classes.message} />
      ) : picker ? (
        <SupplierAccountProvider
          tenantSlug={tenantSlug}
          accounts={picker.accounts}
          categories={picker.choices}
          rows={pickableRows}
        >
          {sheet}
        </SupplierAccountProvider>
      ) : (
        sheet
      )}
      {stripFirst ? null : strip}
    </div>
  )
}

/**
 * A5 · «Clasificar proveedores» (`?filtro=sin-clasificar`, para quien carga):
 * el mazo de fichas. La página no dibuja acá el héroe, la puerta ni la franja.
 */
export async function SupplierSorterBlock({
  data,
  tenantSlug,
  sp,
}: {
  data: Promise<LibretaData>
  tenantSlug: string
  sp: Readonly<Record<string, string | string[] | undefined>>
}) {
  const { list, classes, plan } = await data
  if (!list.ok) return <PanelError title="Proveedores sin categoría" message={list.message} />
  if (!classes.ok) return <PanelError title="Proveedores sin categoría" message={classes.message} />
  if (!plan?.ok) {
    return (
      <PanelError
        title="Proveedores sin categoría"
        message={plan?.message ?? 'No pudimos leer las categorías.'}
      />
    )
  }

  const q = firstParam(sp.q).slice(0, 80)
  const view = libretaView({
    rows: list.data.rows,
    classes: classes.data,
    filter: 'sin-clasificar',
    q,
    match: MATCH,
  })
  const queue: SorterItem[] = view.shown.flatMap(({ row, info }) =>
    info
      ? [
          {
            partyId: row.partyId,
            name: row.partyName,
            displayName: supplierShortName(row),
            kind: row.partyKind,
            updatedAt: info.updatedAt,
          },
        ]
      : [],
  )
  const backHref = comprasHref(tenantSlug)

  if (queue.length === 0) {
    return (
      <EmptyTeach
        icon={q ? SearchX : CircleCheck}
        title={q ? `Nadie sin categoría con «${q}»` : 'No queda ninguno sin categoría'}
        action={
          <Button asChild variant="outline" className="h-11 rounded-full px-5 md:h-9">
            <Link href={backHref}>Volver a la libreta</Link>
          </Button>
        }
      >
        {q
          ? 'Probá con otro nombre.'
          : 'Los que cargues de ahora en más aparecen acá hasta que les elijas una.'}
      </EmptyTeach>
    )
  }

  const { choices, usage, accounts } = categoryChoices(plan.data, classes.data, new Set())
  return (
    <SupplierSorter
      // Otra búsqueda es otra cola: la isla se rearma solo ahí.
      key={q}
      tenantSlug={tenantSlug}
      queue={queue}
      options={choices.options}
      featured={choices.featured}
      usage={[...usage.entries()]}
      accounts={accounts}
      backHref={backHref}
      listHref={comprasHref(tenantSlug, 'proveedores', {
        filtro: 'sin-clasificar',
        vista: 'lista',
        q: q || null,
      })}
    />
  )
}

// ─── Mientras carga, con la forma real ───────────────────────────────────────

/** El héroe: rótulo, número de 48 px, barra de 12 px y tres renglones de leyenda. */
export function HeroSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`card-hairline rounded-2xl border bg-card p-5 shadow-xs sm:p-6 ${className ?? ''}`}
      aria-busy="true"
    >
      <span className="sr-only">Cargando lo que les debés a los proveedores…</span>
      <Skeleton className="h-3 w-44" />
      <Skeleton className="mt-3 h-12 w-64 max-w-full sm:h-14" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <Skeleton className="mt-5 h-3 w-full rounded-full" />
      <div className="mt-4 space-y-2.5">
        {['a', 'b', 'c'].map((k) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** La barra de la lista y una hoja con seis renglones y su margen. */
export function LibretaSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only">Cargando la libreta…</span>
      <div className="space-y-3">
        <Skeleton className="h-11 w-full rounded-full lg:max-w-sm" />
        <div className="flex gap-1.5 overflow-hidden">
          {/* Las seis píldoras de filtro: la clave es el filtro, no el ancho (dos miden lo mismo). */}
          {[
            { key: 'todos', width: 'w-20' },
            { key: 'con-deuda', width: 'w-28' },
            { key: 'vencidos', width: 'w-24' },
            { key: 'a-favor', width: 'w-20' },
            { key: 'impuestos', width: 'w-40' },
            { key: 'sin-categoria', width: 'w-32' },
          ].map((pill) => (
            <Skeleton
              key={pill.key}
              className={`h-11 shrink-0 rounded-full md:h-9 ${pill.width}`}
            />
          ))}
        </div>
      </div>
      <div className="card-hairline overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="divide-y divide-border/60">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <div key={k} className="flex">
              <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-r border-adm-s5/35 py-3 sm:w-16">
                <Skeleton className="h-2 w-8" />
                <Skeleton className="h-5 w-6" />
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
                <Skeleton className="h-5 w-24 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** El clasificador: el avance, la cola y la ficha con sus botones. */
export function SorterSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only">Cargando los proveedores sin categoría…</span>
      <div className="flex items-center gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-2 w-64 max-w-full rounded-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <Skeleton className="hidden h-96 rounded-2xl lg:block" />
        <div className="card-hairline space-y-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-5 w-48" />
          <div className="flex flex-wrap gap-2">
            {['w-28', 'w-40', 'w-36', 'w-32', 'w-44', 'w-24', 'w-20'].map((w) => (
              <Skeleton key={w} className={`h-11 rounded-full ${w}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
