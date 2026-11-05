import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import {
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { type Anomaly, trialAnomalies } from '@/lib/accounting/anomalies'
import {
  exportHref,
  getAccountSystemKeys,
  getTrialBalance,
  settleQuery,
  type TrialBalance,
  type TrialBalanceRow,
} from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BookPage, SLIDING_SHEET } from '../_components/book-page'
import { ClickableBody } from '../_components/clickable-body'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { SegLinks } from '../_components/seg'
import { UrlToggle } from '../_components/url-toggle'
import { loadBookContext } from '../_lib/book-context'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import {
  deepestTrialLevel,
  hasOpeningBalances,
  isActiveTrialChip,
  isZeroTrialRow,
  netOf,
  parseTrialLevel,
  type TrialLevel,
  trialLevelChips,
  trialReturnParam,
  trialRowAnchor,
  visibleTrialRows,
} from '../_lib/trial'

export const metadata = { title: 'Sumas y saldos' }

/** Sangría por nivel (1 a 5 en el plan estándar; un plan más hondo se queda en la última). */
const INDENT = ['', 'pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-14'] as const

/**
 * Sumas y saldos: la tabla clásica, para mirarla «a ojo de auditor» (Silvia, min. 10). Cada cuenta
 * con su Debe, su Haber y su saldo; los grupos en negrita; los totales con doble raya y el sello. Las
 * cuentas con el saldo al revés van marcadas, y tocar una fila lleva a su Mayor con el mismo período.
 */
export default async function SumasYSaldosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const path = `${base}/libros/sumas-y-saldos`
  const { access } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const range = resolveBookRange(sp, today)
  const shown = range.ok ? range : resolveBookRange({}, today)
  if (!shown.ok) throw new Error('período por defecto inválido')
  const level = parseTrialLevel(firstParam(sp.nivel))
  const includeZero = firstParam(sp.todas) === '1'
  const onlyOdd = firstParam(sp.raro) === '1'
  const showOpening = firstParam(sp.inicial) === '1'
  const ctx = await loadBookContext(tenantId, today)

  // «Antes de la refundición» solo tiene sentido al cierre de un ejercicio ya cerrado.
  const closedYearEnd = ctx.years.some((y) => y.status === 'closed' && y.endDate === shown.to)
  const beforeFyResult = closedYearEnd && firstParam(sp.antes_refundicion) === '1'

  const [trial, systemKeys] = await Promise.all([
    range.ok
      ? settleQuery(
          getTrialBalance(tenantId, {
            from: range.from,
            to: range.to,
            excludeFyResult: beforeFyResult,
          }),
        )
      : null,
    // Sin las claves la tabla sale igual: a lo sumo marca Sueldos a pagar de más.
    settleQuery(getAccountSystemKeys(tenantId)),
  ])

  const period = periodParams(shown)
  const anomalies = trial?.ok
    ? trialAnomalies(trial.data.rows, systemKeys.ok ? systemKeys.data : new Map())
    : new Map<string, Anomaly>()
  const levelChips = trialLevelChips(trial?.ok ? deepestTrialLevel(trial.data.rows) : 5)
  const filters = {
    nivel: level === 'todo' ? null : String(level),
    todas: includeZero ? '1' : null,
    raro: onlyOdd ? '1' : null,
    inicial: showOpening ? '1' : null,
    antes_refundicion: beforeFyResult ? '1' : null,
  }
  const keep = { ...period, ...filters }

  return (
    <BookPage
      title="Sumas y saldos"
      toolbar={
        <>
          <RangePicker
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
          <UrlToggle param="raro" checked={onlyOdd} disabled={anomalies.size === 0 && !onlyOdd}>
            Solo lo raro ({anomalies.size})
          </UrlToggle>
        </>
      }
      aside={
        trial?.ok ? (
          trial.data.balanced ? (
            <Stamp>Debe = Haber</Stamp>
          ) : (
            <Stamp tone="bad">No cuadra</Stamp>
          )
        ) : null
      }
      exports={[
        {
          href: exportHref(tenantSlug, 'sumas-y-saldos', {
            desde: shown.from,
            hasta: shown.to,
            antesRefundicion: beforeFyResult,
          }),
          fileName: `administracion-${tenantSlug}-sumas-y-saldos-${shown.from}_${shown.to}.csv`,
        },
      ]}
      below={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-xs text-muted-foreground">
              Nivel
            </span>
            <SegLinks
              label="Nivel de detalle"
              items={levelChips.map((l) => ({
                key: l.label,
                label: l.label,
                href: bookHref(path, { ...keep, nivel: l.param }),
                active: isActiveTrialChip(l, level),
              }))}
            />
          </div>
          <UrlToggle param="inicial" checked={showOpening}>
            Saldo inicial
          </UrlToggle>
          <UrlToggle param="todas" checked={includeZero}>
            Cuentas en cero
          </UrlToggle>
          {closedYearEnd ? (
            <UrlToggle param="antes_refundicion" checked={beforeFyResult}>
              Antes de la refundición
            </UrlToggle>
          ) : null}
        </div>
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {trial && !trial.ok ? <QueryErrorBlock code={trial.code} message={trial.message} /> : null}
      {trial?.ok ? (
        <TrialView
          trial={trial.data}
          anomalies={anomalies}
          level={level}
          includeZero={includeZero}
          onlyOdd={onlyOdd}
          showOpening={showOpening}
          mayorHref={(accountId) =>
            bookHref(`${base}/libros/mayor`, {
              ...period,
              cuenta: accountId,
              volver: trialReturnParam(filters),
            })
          }
          showAllHref={bookHref(path, { ...keep, todas: '1' })}
          openingHref={bookHref(path, { ...keep, inicial: '1' })}
          label={shown.label}
          nothingLoaded={ctx.settings !== null && !ctx.settings.hasDocuments}
        />
      ) : null}
    </BookPage>
  )
}

function Money({ cents }: { cents: number }) {
  return cents ? <Amount cents={cents} currency={false} /> : null
}

function TrialView({
  trial,
  anomalies,
  level,
  includeZero,
  onlyOdd,
  showOpening,
  mayorHref,
  showAllHref,
  openingHref,
  label,
  nothingLoaded,
}: {
  trial: TrialBalance
  anomalies: ReadonlyMap<string, Anomaly>
  level: TrialLevel
  includeZero: boolean
  onlyOdd: boolean
  showOpening: boolean
  mayorHref: (accountId: string) => string
  showAllHref: string
  openingHref: string
  label: string
  nothingLoaded: boolean
}) {
  const rows = onlyOdd
    ? trial.rows.filter((row) => anomalies.has(row.accountId))
    : visibleTrialRows(trial.rows, { level, includeZero })
  const allZero = trial.rows.every(isZeroTrialRow)
  const t = trial.totals
  const columns = showOpening ? 7 : 6

  return (
    <>
      {trial.balanced ? null : (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          El balance no cuadra por {formatCents(trial.differenceCents)}: avisanos.
        </p>
      )}
      <Planilla className={SLIDING_SHEET}>
        <PTable minWidth={showOpening ? 860 : 720} label={`Sumas y saldos, ${label}`}>
          <thead>
            <tr>
              <PTh>Código</PTh>
              <PTh>Cuenta</PTh>
              {showOpening ? <PTh align="right">Saldo inicial</PTh> : null}
              <PTh align="right">Debe</PTh>
              <PTh align="right">Haber</PTh>
              <PTh align="right">Saldo deudor</PTh>
              <PTh align="right">Saldo acreedor</PTh>
            </tr>
          </thead>
          <ClickableBody>
            {rows.length === 0 ? (
              <tr>
                <PTd colSpan={columns} className="py-6 text-center text-muted-foreground">
                  {onlyOdd ? (
                    `Nada raro en ${label.toLowerCase()}: ninguna cuenta tiene el saldo al revés.`
                  ) : nothingLoaded ? (
                    'Todavía no hay nada cargado.'
                  ) : (
                    <>
                      Sin saldos ni movimientos en {label.toLowerCase()}.
                      {allZero && !includeZero ? (
                        <>
                          {' '}
                          <Link
                            href={showAllHref}
                            scroll={false}
                            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Ver el plan entero en cero
                          </Link>
                        </>
                      ) : null}
                    </>
                  )}
                </PTd>
              </tr>
            ) : (
              rows.map((row) => (
                <TrialRow
                  key={row.accountId || row.code}
                  row={row}
                  anomaly={anomalies.get(row.accountId) ?? null}
                  showOpening={showOpening}
                  href={row.accountId && !row.isVirtual ? mayorHref(row.accountId) : null}
                />
              ))
            )}
          </ClickableBody>
          {rows.length > 0 && !onlyOdd ? (
            <tfoot>
              <PTotalRow>
                <PTd colSpan={2} className="font-semibold">
                  Totales
                </PTd>
                {showOpening ? (
                  <PTd align="right" className="font-semibold">
                    <SidePair debit={t.openingDebitCents} credit={t.openingCreditCents} />
                  </PTd>
                ) : null}
                <PTd align="right" className="font-semibold">
                  <Amount cents={t.periodDebitCents} currency={false} />
                </PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={t.periodCreditCents} currency={false} />
                </PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={t.closingDebitCents} currency={false} />
                </PTd>
                <PTd align="right" className="font-semibold">
                  <Amount cents={t.closingCreditCents} currency={false} />
                </PTd>
              </PTotalRow>
            </tfoot>
          ) : null}
        </PTable>
        {!showOpening && hasOpeningBalances(trial.rows) ? (
          <PlanillaFoot className="justify-start text-xs text-muted-foreground">
            <span>El saldo suma lo que cada cuenta traía de antes.</span>
            <Link
              href={openingHref}
              scroll={false}
              className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-2.5"
            >
              Ver el saldo inicial
            </Link>
          </PlanillaFoot>
        ) : null}
      </Planilla>
    </>
  )
}

/** Los totales de la columna de saldo inicial: deudores y acreedores, que tienen que dar igual. */
function SidePair({ debit, credit }: { debit: number; credit: number }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span>
        <Amount cents={debit} currency={false} />
        <span aria-hidden className="ml-1 text-muted-foreground">
          D
        </span>
        <span className="sr-only"> deudor</span>
      </span>
      <span>
        <Amount cents={credit} currency={false} />
        <span aria-hidden className="ml-1 text-muted-foreground">
          A
        </span>
        <span className="sr-only"> acreedor</span>
      </span>
    </span>
  )
}

function TrialRow({
  row,
  anomaly,
  showOpening,
  href,
}: {
  row: TrialBalanceRow
  anomaly: Anomaly | null
  showOpening: boolean
  /** Su Mayor; `null` en la línea de resultados anteriores, que no es una cuenta. */
  href: string | null
}) {
  const isGroup = !row.postable && !row.isVirtual
  const indent = INDENT[Math.min(Math.max(row.level - 1, 0), INDENT.length - 1)] ?? ''
  const strong = isGroup && 'font-semibold'
  const net = netOf(row.closingDebitCents, row.closingCreditCents)
  const opening = netOf(row.openingDebitCents, row.openingCreditCents)
  return (
    <PRow flagged={anomaly !== null} className={href ? 'cursor-pointer' : undefined}>
      <PTd className="align-top font-mono text-xs whitespace-nowrap text-muted-foreground">
        {/* A donde vuelve el Mayor: la misma cuenta, no el principio de la tabla. */}
        <span
          id={row.accountId ? trialRowAnchor(row.accountId) : undefined}
          className="scroll-mt-32"
        >
          {row.code}
        </span>
      </PTd>
      <PTd className={cn('align-top', indent)}>
        {href ? (
          <Link
            href={href}
            data-row-action=""
            className={cn(
              'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:inline-block pointer-coarse:py-1.5',
              strong,
            )}
          >
            {row.name}
          </Link>
        ) : (
          <span className={cn(strong, row.isVirtual && 'italic')}>{row.name}</span>
        )}
        {!row.active ? (
          <span className="ml-1 text-xs text-muted-foreground">(inactiva)</span>
        ) : null}
        {anomaly ? (
          <span className="block text-xs font-medium text-destructive">{anomaly.sentence}</span>
        ) : null}
        {row.isVirtual ? (
          <span className="block max-w-xs text-xs font-normal text-muted-foreground">
            Resultados de ejercicios que todavía no se cerraron. Desaparece cuando se cierra el
            ejercicio anterior.
          </span>
        ) : null}
      </PTd>
      {showOpening ? (
        <PTd align="right" className={cn('align-top', strong)}>
          {opening !== 0 ? <Amount cents={opening} side currency={false} /> : null}
        </PTd>
      ) : null}
      <PTd align="right" className={cn('align-top', strong)}>
        <Money cents={row.periodDebitCents} />
      </PTd>
      <PTd align="right" className={cn('align-top', strong)}>
        <Money cents={row.periodCreditCents} />
      </PTd>
      <PTd align="right" className={cn('align-top', strong)}>
        {net > 0 ? <Amount cents={net} currency={false} /> : null}
      </PTd>
      <PTd align="right" className={cn('align-top', strong)}>
        {net < 0 ? <Amount cents={-net} currency={false} /> : null}
      </PTd>
    </PRow>
  )
}
