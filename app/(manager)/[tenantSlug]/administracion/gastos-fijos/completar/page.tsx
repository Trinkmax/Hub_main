import {
  AdmHeader,
  AdmPage,
  categoryOptions,
  EmptyTeach,
  PanelError,
  PanelLink,
  PillLink,
} from '@/components/administracion/kit'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { listAccounts, listRecurringExpenses, settleQuery } from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { isPurchaseImputation, isQuickExpenseAccount } from '../../compras/_lib/accounts'
import {
  firstParam,
  gastosFijosFillHref,
  gastosFijosHref,
  isUuidLike,
  recurringHref,
} from '../../compras/_lib/links'
import { requireComprasAccess } from '../../compras/_lib/page-access'
import { FillSheet, type FillView } from './_components/fill-sheet'

export const metadata = { title: 'Completar la planilla' }

const VIEWS: readonly FillView[] = ['sin-monto', 'todos', 'varios']

/**
 * «Completar la planilla»: los montos y los días de todos los gastos fijos, de
 * corrido. Es lo infrecuente y largo (un bar que recién cargó su lista, o el
 * día que sube todo): por eso es una pantalla propia, pero no un asistente: una
 * hoja plana, dos campos por renglón, que se guarda sola.
 *
 * `?ver=sin-monto|todos|varios` elige qué renglones entran (el filtro se
 * aplica al entrar: lo que se completa no se va de la vista) y `?foco=<uuid>`
 * entra con el cursor en ese renglón. La contadora ve un aviso con la vuelta a
 * la planilla.
 */
export default async function CompletarPlanillaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])
  const backHref = gastosFijosHref(tenantSlug)
  const back = { href: backHref, label: 'Gastos fijos' }
  const { access, canWrite } = await requireComprasAccess(
    tenantSlug,
    gastosFijosFillHref(tenantSlug),
  )

  if (!canWrite) {
    return (
      <AdmPage width="compact">
        <AdmHeader
          back={back}
          title="Completar la planilla"
          description="Los montos y los días de los gastos fijos, de corrido."
        />
        <ReadOnlyNotice
          description="Esta pantalla es para cargar los montos de los gastos fijos. Con Contabilidad podés verlos en Gastos fijos."
          href={backHref}
          linkLabel="Ir a Gastos fijos"
        />
      </AdmPage>
    )
  }

  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const [rowsOutcome, accountsOutcome] = await Promise.all([
    settleQuery(listRecurringExpenses(tenantId, { today })),
    settleQuery(listAccounts(tenantId)),
  ])

  if (!rowsOutcome.ok || !accountsOutcome.ok) {
    const message = !rowsOutcome.ok
      ? rowsOutcome.message
      : !accountsOutcome.ok
        ? accountsOutcome.message
        : ''
    return (
      <AdmPage width="comfortable">
        <AdmHeader back={back} title="Completá tu planilla" />
        <PanelError title="Tus gastos fijos" message={message} />
      </AdmPage>
    )
  }

  const rows = rowsOutcome.data
  const catalog = accountsOutcome.data

  if (rows.length === 0) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader back={back} title="Completá tu planilla" />
        <EmptyTeach
          title="Todavía no hay gastos fijos para completar"
          action={<PanelLink href={recurringHref(tenantSlug, 'nuevo')}>Cargar uno</PanelLink>}
          secondary={<PanelLink href={backHref}>Volver a la planilla</PanelLink>}
        >
          Cargá el alquiler, la luz o los sueldos y después volvé acá a ponerles el monto y el día.
        </EmptyTeach>
      </AdmPage>
    )
  }

  const imputable = new Set(catalog.filter(isPurchaseImputation).map((a) => a.id))
  const quick = new Set(catalog.filter(isQuickExpenseAccount).map((a) => a.id))
  const miscAccountId = catalog.find((a) => a.systemKey === 'misc_expenses')?.id ?? null
  const missing = rows.filter((row) => row.amountCents === null).length
  const misc =
    miscAccountId === null ? 0 : rows.filter((row) => row.accountId === miscAccountId).length
  const asked = firstParam(sp.ver)
  const view: FillView = (VIEWS as readonly string[]).includes(asked)
    ? (asked as FillView)
    : missing > 0
      ? 'sin-monto'
      : 'todos'
  const focusRaw = firstParam(sp.foco)
  const focusId = isUuidLike(focusRaw) ? focusRaw : null
  const firstDay = rows[0]?.dueDay ?? null
  const sameDay =
    firstDay !== null && rows.length >= 5 && rows.every((row) => row.dueDay === firstDay)
      ? firstDay
      : null

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={back}
        title={missing > 0 ? 'Completá tu planilla' : 'Editá tu planilla'}
        description={
          missing > 0
            ? 'Poné cuánto pagás por cada uno y qué día vence. Cada renglón se guarda solo.'
            : 'Cambiá montos y días de corrido. Cada renglón se guarda solo.'
        }
      />
      <FillSheet
        // Cambiar de vista arma la lista de nuevo (el filtro se aplica al entrar).
        key={view}
        tenantSlug={tenantSlug}
        rows={rows}
        view={view}
        focusId={focusId}
        miscAccountId={miscAccountId}
        categories={categoryOptions(catalog, (id) => quick.has(id))}
        accounts={catalog
          .filter((a) => imputable.has(a.id) || !a.postable)
          .map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            postable: a.postable && imputable.has(a.id),
            active: a.active,
            description: a.description,
            parentId: a.parentId,
          }))}
        pills={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <nav aria-label="Qué renglones ver" className="flex flex-wrap items-center gap-1.5">
              {missing > 0 ? (
                <PillLink
                  href={gastosFijosFillHref(tenantSlug, { ver: 'sin-monto' })}
                  scroll={false}
                  active={view === 'sin-monto'}
                  count={missing}
                  className="pointer-coarse:h-11"
                >
                  Sin monto
                </PillLink>
              ) : null}
              <PillLink
                href={gastosFijosFillHref(tenantSlug, { ver: 'todos' })}
                scroll={false}
                active={view === 'todos'}
                count={rows.length}
                className="pointer-coarse:h-11"
              >
                Todos
              </PillLink>
              {misc > 0 ? (
                <PillLink
                  href={gastosFijosFillHref(tenantSlug, { ver: 'varios' })}
                  scroll={false}
                  active={view === 'varios'}
                  count={misc}
                  className="pointer-coarse:h-11"
                >
                  En «Gastos varios»
                </PillLink>
              ) : null}
            </nav>
            {sameDay !== null ? (
              <p className="text-sm text-muted-foreground">
                Hoy todos dicen el día {sameDay}: cambialo en los que no.
              </p>
            ) : null}
          </div>
        }
      />
    </AdmPage>
  )
}
