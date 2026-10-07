import { Landmark, Plus } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ActionButton, QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { getAccountingSettings, getSummary, settleQuery } from '@/lib/accounting/queries'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { AttentionList } from './_resumen/attention-list'
import { FirstSteps } from './_resumen/first-steps'
import { firstStepsCookieName } from './_resumen/first-steps-cookie'
import { RetryButton } from './_resumen/retry-button'
import { SummaryActions } from './_resumen/summary-actions'
import {
  BooksStatusCard,
  SummaryCard,
  SummaryKpis,
  ThisMonthCard,
  TreasuriesCard,
} from './_resumen/summary-blocks'
import { headerDateLine, lastClosedLine, openMonthLine } from './_resumen/summary-copy'
import { Callout } from './ajustes/_components/form-bits'

/**
 * Resumen de Administración (H.4): «¿cómo estamos de plata?» y qué hacer hoy,
 * con una sola lectura (`acc_report_summary`). El dueño ve las acciones y
 * «Necesita atención»; la contadora, los mismos números sin acciones y el
 * estado de los libros.
 */
export default async function AdministracionResumenPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(base)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }

  const tenantId = access.tenant.id
  const canWrite = access.accounting.write
  const today = todayInCordoba()

  const [summaryResult, settingsResult, cookieStore] = await Promise.all([
    settleQuery(getSummary(tenantId, { asOf: today })),
    settleQuery(getAccountingSettings(tenantId)),
    cookies(),
  ])
  const settings = settingsResult.ok ? settingsResult.data : null
  const summary = summaryResult.ok ? summaryResult.data : null
  const stepsHidden = cookieStore.get(firstStepsCookieName(tenantSlug))?.value === '1'

  const openingPending = settings?.openingStatus === 'pending'
  const cuitMissing = settings !== null && !settings.cuit
  // Recién configurada: ningún comprobante todavía (ni la apertura).
  const isNew = settings !== null && !settings.hasDocuments
  const dateLine = headerDateLine(today)

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Resumen
            <ReadOnlyBadge />
          </>
        }
        description={[dateLine, settings?.legalName].filter(Boolean).join(' · ') || undefined}
        actions={<SummaryActions base={base} />}
      />

      {openingPending ? (
        canWrite ? (
          <Callout
            tone="warning"
            title="Te faltan los saldos iniciales"
            action={
              <Button asChild className="h-11 md:h-9">
                <Link href={`${base}/configurar`}>Cargar saldos iniciales</Link>
              </Button>
            }
          >
            Cargá lo que había en cada caja y lo que se debía al{' '}
            {formatIsoDay(settings?.booksStartDate)}, o elegí «Arrancar en cero».
          </Callout>
        ) : (
          <Callout tone="info" title="Faltan los saldos iniciales">
            Los dueños todavía no cargaron lo que había al empezar los libros.
          </Callout>
        )
      ) : null}

      {cuitMissing ? (
        <Callout
          tone="warning"
          title="Falta el CUIT de la SAS: los libros de IVA lo necesitan."
          action={
            canWrite ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`${base}/ajustes?tab=sas`}>Completar</Link>
              </Button>
            ) : undefined
          }
        >
          {canWrite ? null : 'Pedíselo a los dueños: se carga en Ajustes › Datos de la SAS.'}
        </Callout>
      ) : null}

      {!summary ? (
        <EmptyState
          icon={Landmark}
          title="No pudimos cargar el resumen."
          description={summaryResult.ok ? undefined : summaryResult.message}
          action={<RetryButton />}
        />
      ) : (
        <>
          {isNew ? null : (
            <SummaryKpis
              summary={summary}
              today={today}
              vatRegistered={settings ? settings.ivaCondition === 'responsable_inscripto' : true}
            />
          )}

          {/* Recién configurada: al dueño le dicen qué hacer los primeros pasos (si no los ocultó). */}
          {isNew && !(canWrite && !stepsHidden) ? (
            <EmptyState
              icon={Landmark}
              title="Todavía no hay movimientos"
              description={
                canWrite
                  ? 'Empezá por el cierre de ayer o por un gasto: cada cosa que cargues se suma acá.'
                  : 'Cuando los dueños carguen gastos y cierres del día, vas a ver acá cómo está la plata de la SAS.'
              }
              action={
                canWrite ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild variant="outline" className="h-11 md:h-9">
                      <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
                    </Button>
                    <ActionButton action="gasto" className="h-11 gap-2 md:h-9">
                      <Plus className="size-4" aria-hidden />
                      Nuevo gasto
                    </ActionButton>
                  </div>
                ) : undefined
              }
            />
          ) : null}

          {canWrite && !stepsHidden ? <FirstSteps base={base} steps={summary.firstSteps} /> : null}

          {isNew ? null : (
            <div className={canWrite ? 'grid gap-6 lg:grid-cols-3' : 'grid gap-6 lg:grid-cols-2'}>
              {canWrite ? (
                <SummaryCard
                  title="Necesita atención"
                  description="Lo más urgente primero."
                  className="lg:col-span-2"
                >
                  <AttentionList
                    items={summary.attention.filter(
                      (item) => !(cuitMissing && item.kind === 'sas_cuit_missing'),
                    )}
                    today={today}
                    base={base}
                  />
                </SummaryCard>
              ) : (
                <BooksStatusCard
                  books={summary.books}
                  base={base}
                  lastClosedText={lastClosedLine(summary.books)}
                  openMonthText={openMonthLine(summary.books)}
                />
              )}
              <ThisMonthCard summary={summary} today={today} base={base} />
            </div>
          )}

          <TreasuriesCard treasuries={summary.treasuries} base={base} />
        </>
      )}

      <QuickActionsBar />
    </PageShell>
  )
}
