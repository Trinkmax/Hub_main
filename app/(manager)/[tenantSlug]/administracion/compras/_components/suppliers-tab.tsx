import { CircleCheck, SearchX } from 'lucide-react'
import Link from 'next/link'
import { EmptyTeach, PanelError } from '@/components/administracion/kit'
import { Planilla, PlanillaFoot } from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
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
import {
  libretaGroupTotals,
  libretaTotalizerItems,
  libretaView,
  supplierShortName,
} from '../_lib/libreta'
import { comprasHref, firstParam, newPurchaseHref } from '../_lib/links'
import {
  canPickAccount,
  isVisibleSupplier,
  supplierAccountOptions,
  supplierCategoryChoices,
  supplierFilterOf,
} from '../_lib/suppliers'
import { BulkSuppliersDialog } from './bulk-suppliers-dialog'
import { ClassifyHint, LibretaList, LibretaToolbar } from './libreta-list'
import { SheetEmpty } from './planilla-bits'
import { SheetSkeleton, TotalizerSkeleton } from './planilla-skeleton'
import { SupplierAccountProvider, type SupplierAccountRow } from './supplier-account-picker'
import { type SorterItem, SupplierSorter } from './supplier-sorter'

const MATCH = { filter: matchesPartyFilter, query: matchesPartyQuery }

/**
 * Lo que lee la pestaña «Proveedores», UNA vez: los saldos del grupo entero
 * (sin filtro ni búsqueda), la ficha de cada uno (su categoría) y, para quien
 * carga, el plan. El totalizador, los contadores del filtro, la lista y el
 * clasificador salen de acá: nunca dicen cosas distintas.
 *
 * Las fichas y el plan van aparte de los saldos: si fallan, la planilla se ve
 * igual, sin categoría ni «Elegir categoría».
 */
export type LibretaData = {
  list: QueryOutcome<PartyList>
  classes: QueryOutcome<Map<string, PartyClassification>>
  plan: QueryOutcome<AccountRow[]> | null
  /** Para saber si faltan los saldos iniciales (el totalizador no dice «$ 0»). */
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
 * La pantalla de proveedores: el totalizador y la planilla, con la búsqueda, el filtro y el «⋯»
 * arriba de la tabla. El vacío se decide ANTES de montar la tabla: el bar sin proveedores ve una
 * oración y el botón del primer paso.
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
  const { list, classes, plan, settings } = await data
  if (!list.ok) return <PanelError title="Proveedores" message={list.message} />

  const q = firstParam(sp.q).slice(0, 80)
  const { value: filter } = supplierFilterOf(firstParam(sp.filtro))
  const classMap = classes.ok ? classes.data : null
  const searching = q !== '' || filter !== 'todos'
  const view = libretaView({ rows: list.data.rows, classes: classMap, filter, q, match: MATCH })
  // Un impuesto con deuda también cuenta: su filtro tiene que estar a mano aunque no haya proveedores.
  const hasAnyone = list.data.rows.some((r) => isVisibleSupplier(r, 'all'))
  const existingNames = list.data.rows.map((row) => row.partyName)
  // A dónde vuelve «Compra» al guardar: a esta lista, como estaba.
  const backHref = comprasHref(tenantSlug, 'proveedores', {
    filtro: filter === 'todos' ? null : filter,
    vista: filter === 'sin-clasificar' ? 'lista' : null,
    q: q || null,
  })

  // El bar que todavía no cargó a nadie: una oración y el primer paso.
  const firstSteps = (
    <SheetEmpty
      action={
        canWrite ? (
          <Button asChild size="sm" className="h-10 md:pointer-fine:h-8">
            <Link href={newPurchaseHref(tenantSlug, { volver: comprasHref(tenantSlug) })}>
              Cargar una compra
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
      Todavía no hay proveedores. Aparecen solos cuando cargás la primera compra.
    </SheetEmpty>
  )
  if (!hasAnyone && !searching) return <Planilla>{firstSteps}</Planilla>

  // «Elegir categoría» desde el ⋯ de la fila: solo quien carga, y solo si se leyó el plan.
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

  const table =
    filter === 'sin-clasificar' && !classes.ok ? (
      <SheetEmpty>{classes.message}</SheetEmpty>
    ) : view.shown.length === 0 ? (
      filter === 'sin-clasificar' && q === '' ? (
        <SheetEmpty>No queda ninguno sin categoría.</SheetEmpty>
      ) : !searching ? (
        firstSteps
      ) : (
        <SheetEmpty
          action={
            <Button asChild variant="outline" size="sm" className="h-10 md:pointer-fine:h-8">
              <Link href={comprasHref(tenantSlug)} scroll={false}>
                Ver todos
              </Link>
            </Button>
          }
        >
          {q ? `Nadie con «${q}» en esta vista.` : 'Nadie en esta vista.'}
        </SheetEmpty>
      )
    ) : (
      <LibretaList
        tenantSlug={tenantSlug}
        view={view}
        canWrite={canWrite}
        pickable={pickable}
        backHref={backHref}
      />
    )

  const sheet = (
    <Planilla>
      <LibretaToolbar
        tenantSlug={tenantSlug}
        counts={view.counts}
        filter={filter}
        q={q}
        canWrite={canWrite}
        existingNames={existingNames}
        exportHref={exportHref(tenantSlug, 'saldos-proveedores', { hasta: today })}
        exportFileName={`saldos-proveedores-${today}.csv`}
      />
      {table}
      {canWrite && filter === 'sin-clasificar' && view.shown.length > 0 ? (
        <PlanillaFoot>
          <ClassifyHint tenantSlug={tenantSlug} />
        </PlanillaFoot>
      ) : null}
    </Planilla>
  )

  return (
    <>
      <Totalizer
        items={libretaTotalizerItems(libretaGroupTotals(list.data.rows, filter), {
          // Si la lectura de la configuración falla, dice lo cargado (como antes).
          openingPending: settings.ok && settings.data?.openingStatus === 'pending',
        })}
      />
      {picker ? (
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
    </>
  )
}

/**
 * «Clasificar proveedores» (`?filtro=sin-clasificar`, para quien carga): el mazo
 * de fichas. Se llega por el «⋯» de la planilla.
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
            <Link href={backHref}>Volver a proveedores</Link>
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

/** El totalizador y la hoja, con la búsqueda y el filtro arriba de las filas. */
export function LibretaSkeleton() {
  return (
    <>
      <TotalizerSkeleton items={3} />
      <SheetSkeleton
        rows={8}
        columns={3}
        head={
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-64 max-w-full rounded-lg" />
            <Skeleton className="h-8 w-96 max-w-full rounded-lg" />
          </div>
        }
      />
    </>
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
