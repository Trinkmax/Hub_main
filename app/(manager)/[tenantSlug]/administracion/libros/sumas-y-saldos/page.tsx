import { CircleAlert, CircleCheck, Scale } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import {
  exportHref,
  getTrialBalance,
  settleQuery,
  type TrialBalance,
  type TrialBalanceRow,
} from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BookPage, WideBookHint } from '../_components/book-page'
import { ChipLink } from '../_components/chip-link'
import { ExportButton } from '../_components/export-button'
import { RangePicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { requireBooksAccess } from '../_lib/page-access'
import { bookHref, firstParam, periodParams, resolveBookRange } from '../_lib/periods'
import {
  deepestTrialLevel,
  isActiveTrialChip,
  isZeroTrialRow,
  netOf,
  parseTrialLevel,
  type TrialLevel,
  trialLevelChips,
  visibleTrialRows,
} from '../_lib/trial'

export const metadata = { title: 'Sumas y saldos' }

/** Sangría por nivel (1 a 5 en el plan estándar; un plan más hondo se queda en la última). */
const INDENT = ['', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'] as const

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
  const ctx = await loadBookContext(tenantId, today)

  // «Antes de la refundición» solo tiene sentido al cierre de un ejercicio ya cerrado.
  const closedYearEnd = ctx.years.some((y) => y.status === 'closed' && y.endDate === shown.to)
  const beforeFyResult = closedYearEnd && firstParam(sp.antes_refundicion) === '1'

  const trial = range.ok
    ? await settleQuery(
        getTrialBalance(tenantId, {
          from: range.from,
          to: range.to,
          excludeFyResult: beforeFyResult,
        }),
      )
    : null

  const period = periodParams(shown)
  const levelChips = trialLevelChips(trial?.ok ? deepestTrialLevel(trial.data.rows) : 5)
  const keep = {
    ...period,
    nivel: level === 'todo' ? null : String(level),
    todas: includeZero ? '1' : null,
    antes_refundicion: beforeFyResult ? '1' : null,
  }
  const exportLink = exportHref(tenantSlug, 'sumas-y-saldos', {
    desde: shown.from,
    hasta: shown.to,
    antesRefundicion: beforeFyResult,
  })

  return (
    <BookPage
      backHref={bookHref(`${base}/libros`, shown.month ? { mes: shown.month } : {})}
      title="Sumas y saldos"
      description={`El balance de comprobación · ${shown.label}${beforeFyResult ? ' · antes de la refundición' : ''}`}
      actions={
        <ExportButton
          href={exportLink}
          fileName={`administracion-${tenantSlug}-sumas-y-saldos-${shown.from}_${shown.to}.csv`}
        />
      }
      toolbar={
        <div className="space-y-3">
          <RangePicker
            range={shown}
            today={today}
            fiscalYear={ctx.fiscalYear}
            minMonth={ctx.minMonth}
          />
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Nivel de detalle</legend>
              <span aria-hidden className="text-xs font-medium text-muted-foreground">
                Nivel
              </span>
              {levelChips.map((l) => (
                <ChipLink
                  key={l.label}
                  href={bookHref(path, { ...keep, nivel: l.param })}
                  active={isActiveTrialChip(l, level)}
                  aria-label={l.aria}
                >
                  {l.label}
                </ChipLink>
              ))}
            </fieldset>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <ChipLink
              href={bookHref(path, { ...keep, todas: includeZero ? null : '1' })}
              active={includeZero}
            >
              Mostrar cuentas en cero
            </ChipLink>
            {closedYearEnd ? (
              <ChipLink
                href={bookHref(path, { ...keep, antes_refundicion: beforeFyResult ? null : '1' })}
                active={beforeFyResult}
              >
                Antes de la refundición
              </ChipLink>
            ) : null}
          </div>
        </div>
      }
    >
      {!range.ok ? <PeriodError message={range.message} /> : null}
      {trial && !trial.ok ? <QueryErrorBlock code={trial.code} message={trial.message} /> : null}
      {trial?.ok ? (
        <TrialView
          trial={trial.data}
          level={level}
          includeZero={includeZero}
          base={base}
          periodLink={period}
          showAllHref={bookHref(path, { ...keep, todas: '1' })}
          label={shown.label}
          nothingLoaded={ctx.settings !== null && !ctx.settings.hasDocuments}
        />
      ) : null}
    </BookPage>
  )
}

/** Un saldo con su lado («1.240.000,00 D»); en cero, una raya. */
function SideAmount({ debit, credit }: { debit: number; credit: number }) {
  const net = netOf(debit, credit)
  if (net === 0) {
    return (
      <span className="text-muted-foreground/70">
        <span aria-hidden>—</span>
        <span className="sr-only">Sin saldo</span>
      </span>
    )
  }
  return <Amount cents={net} side currency={false} />
}

function TrialView({
  trial,
  level,
  includeZero,
  base,
  periodLink,
  showAllHref,
  label,
  nothingLoaded,
}: {
  trial: TrialBalance
  level: TrialLevel
  includeZero: boolean
  base: string
  periodLink: Record<string, string | undefined>
  showAllHref: string
  label: string
  nothingLoaded: boolean
}) {
  const rows = visibleTrialRows(trial.rows, { level, includeZero })
  const allZero = trial.rows.every(isZeroTrialRow)

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title={
          nothingLoaded ? 'Todavía no hay nada cargado' : `Sin saldos ni movimientos en ${label}`
        }
        description={
          allZero
            ? 'Cuando haya asientos, acá vas a ver el saldo de cada cuenta: lo que había al empezar, lo que se movió y cómo terminó.'
            : 'Con este nivel no queda ninguna cuenta con saldo. Probá con más detalle.'
        }
        action={
          allZero && !includeZero ? (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={showAllHref} scroll={false}>
                Ver el plan entero en cero
              </Link>
            </Button>
          ) : null
        }
      />
    )
  }

  const t = trial.totals
  const seal = trial.balanced ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
      <CircleCheck className="size-3" aria-hidden />
      Debe = Haber
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
      <CircleAlert className="size-3" aria-hidden />
      No cuadra por {formatCents(trial.differenceCents)}: avisanos
    </span>
  )
  return (
    <>
      <WideBookHint>
        En el celular ves el saldo de cada cuenta. El detalle completo se lee mejor en la compu.
      </WideBookHint>
      {/* Compu y tablet: el balance completo. */}
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">{`Sumas y saldos, ${label}`}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="min-w-56">Cuenta</DataTableHeader>
                <DataTableHeader className="whitespace-nowrap text-right">
                  Saldo inicial
                </DataTableHeader>
                <DataTableHeader className="text-right">Debe</DataTableHeader>
                <DataTableHeader className="text-right">Haber</DataTableHeader>
                <DataTableHeader className="text-right">Saldo</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <TrialRow
                  key={row.accountId || row.code}
                  row={row}
                  base={base}
                  periodLink={periodLink}
                />
              ))}
            </DataTableBody>
            <tfoot className="bg-secondary/30 font-semibold">
              <tr className="border-t border-border align-top">
                <DataTableCell>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    Totales
                    {seal}
                  </span>
                </DataTableCell>
                <DataTableCell className="text-right">
                  <SidePair debit={t.openingDebitCents} credit={t.openingCreditCents} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={t.periodDebitCents} currency={false} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={t.periodCreditCents} currency={false} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <SidePair debit={t.closingDebitCents} credit={t.closingCreditCents} />
                </DataTableCell>
              </tr>
            </tfoot>
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>

      {/* Celular: cada cuenta con su saldo final; tocarla abre su mayor. */}
      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul aria-label={`Sumas y saldos, ${label}`} className="divide-y divide-border/60">
          {rows.map((row) => {
            const isGroup = !row.postable && !row.isVirtual
            const body = (
              <>
                <span className="min-w-0">
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {row.code}
                  </span>
                  <span
                    className={cn(
                      'block truncate text-sm',
                      isGroup && 'font-semibold',
                      row.isVirtual && 'italic',
                    )}
                  >
                    {row.name}
                  </span>
                </span>
                <span className={cn('shrink-0 text-sm', isGroup && 'font-semibold')}>
                  <SideAmount debit={row.closingDebitCents} credit={row.closingCreditCents} />
                </span>
              </>
            )
            return (
              <li key={row.accountId || row.code}>
                {row.accountId && !row.isVirtual ? (
                  <Link
                    href={bookHref(`${base}/libros/mayor`, {
                      ...periodLink,
                      cuenta: row.accountId,
                    })}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
          <li className="flex items-center justify-between gap-3 bg-secondary/30 px-4 py-3 text-sm font-semibold">
            <span className="flex flex-wrap items-center gap-2">
              Totales
              {seal}
            </span>
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Saldo: D = deudor, A = acreedor. Los totales suman las cuentas imputables (los grupos ya son
        subtotales). Tocá una cuenta para ver su mayor.
      </p>
    </>
  )
}

/** Los totales de una columna de saldos: deudores y acreedores, que tienen que dar igual. */
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
  base,
  periodLink,
}: {
  row: TrialBalanceRow
  base: string
  periodLink: Record<string, string | undefined>
}) {
  const isGroup = !row.postable && !row.isVirtual
  const indent = INDENT[Math.min(Math.max(row.level - 1, 0), INDENT.length - 1)] ?? ''
  const name = (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[11px] text-muted-foreground">{row.code}</span>
      <span className={cn(isGroup && 'font-semibold', row.isVirtual && 'italic')}>{row.name}</span>
      {!row.active ? <span className="text-xs text-muted-foreground">(inactiva)</span> : null}
    </span>
  )
  return (
    <tr className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint">
      <DataTableCell className={cn('py-2', indent)}>
        {row.accountId && !row.isVirtual ? (
          <Link
            href={bookHref(`${base}/libros/mayor`, { ...periodLink, cuenta: row.accountId })}
            className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </Link>
        ) : (
          name
        )}
        {row.isVirtual ? (
          <span className="block max-w-xs text-xs font-normal not-italic text-muted-foreground">
            Resultados de ejercicios que todavía no se cerraron. Desaparece cuando se cierra el
            ejercicio anterior.
          </span>
        ) : null}
      </DataTableCell>
      <DataTableCell className={cn('py-2 text-right', isGroup && 'font-semibold')}>
        <SideAmount debit={row.openingDebitCents} credit={row.openingCreditCents} />
      </DataTableCell>
      <DataTableCell className={cn('py-2 text-right', isGroup && 'font-semibold')}>
        {row.periodDebitCents ? <Amount cents={row.periodDebitCents} currency={false} /> : null}
      </DataTableCell>
      <DataTableCell className={cn('py-2 text-right', isGroup && 'font-semibold')}>
        {row.periodCreditCents ? <Amount cents={row.periodCreditCents} currency={false} /> : null}
      </DataTableCell>
      <DataTableCell className={cn('py-2 text-right', isGroup && 'font-semibold')}>
        <SideAmount debit={row.closingDebitCents} credit={row.closingCreditCents} />
      </DataTableCell>
    </tr>
  )
}
