import { Plus, X } from 'lucide-react'
import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import {
  comprasHref,
  gastosFijosFillHref,
  gastosFijosHref,
  recurringHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { Amount } from '@/components/administracion/amount'
import { LedgerRail, type LedgerTone, PillLink } from '@/components/administracion/kit'
import {
  addMonthsToYearMonth,
  MONTH_NAMES_SHORT,
  monthOf,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  INVOICE_BUCKET_LABELS,
  matchesSheetQuery,
  monthWord,
  type Sheet,
  type SheetFilter,
  type SheetGroup,
  type SheetItem,
  type SheetQuery,
  sheetCarry,
  sheetFilterPills,
  shownTotals,
} from '../_lib/planilla-words'
import { SheetHead } from './sheet-head'
import { SheetColumnLabels, SheetFold, SheetRow } from './sheet-row'
import { VoidedNotice } from './voided-notice'

/**
 * La planilla de gastos fijos del mes: UNA sola hoja, como la que ya llevan
 * los socios. Arriba, el número que manda con lo que sigue; en el medio, los
 * renglones colgados del día en que vencen (el margen de la hoja es la columna
 * «Vencimiento» de su planilla); al pie, la fila de suma.
 *
 * - No es un calendario: 31 gastos el mismo día revientan una celda; acá son
 *   31 renglones bajo un mismo día.
 * - No es una bandeja por etapas: el renglón no se mueve cuando lo pagás.
 * - La hoja no lleva `overflow-hidden`: rompería el margen del día, que queda
 *   pegado arriba mientras se recorre su grupo.
 *
 * Los filtros, el mes y el renglón abierto viven en la URL (`?mes=`, `?ver=`,
 * `?categoria=`, `?factura=`, `?abrir=`): un socio le puede pasar el link a otro.
 */

/** Dónde se pega lo que queda fijo al bajar: debajo del topbar y de la barra de la sección. */
const STICKY_TOP = 'top-[calc(3.5rem+var(--adm-nav-h,0px))]'
const LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'
const QUIET_LINK =
  'inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0'

const isOverdue = (item: SheetItem) =>
  item.line.state === 'overdue' || (item.line.state === 'no_amount' && item.line.pastDue)

function groupTone(items: readonly SheetItem[]): LedgerTone {
  if (items.some(isOverdue)) return 'late'
  if (items.length > 0 && items.every((item) => item.line.state === 'paid')) return 'ok'
  return 'muted'
}

/**
 * «SÁB 10 OCT», «2 gastos», «$ 880.000», «falta $ 10.000»: el margen del día en
 * angosto, en partes que bajan de renglón ENTERAS (un «falta» separado de su
 * importe se lee como un número suelto).
 *
 * Suma lo que se ve: con un filtro puesto, los renglones que quedaron. Con un
 * solo gasto alcanza con el día: el renglón de abajo ya dice cuánto es.
 */
function groupParts(group: SheetGroup, shown: readonly SheetItem[]): string[] {
  const day = group.day
  const parts = [
    `${WEEKDAY_NAMES_SHORT[weekdayOf(day)] ?? ''} ${Number(day.slice(8, 10))} ${MONTH_NAMES_SHORT[Number(day.slice(5, 7)) - 1] ?? ''}`,
  ]
  if (shown.length > 1) {
    const due = shown.reduce(
      (sum, { line }) => sum + (line.remainingCents !== null ? (line.dueCents ?? 0) : 0),
      0,
    )
    const remaining = shown.reduce((sum, { line }) => sum + (line.remainingCents ?? 0), 0)
    parts.push(`${shown.length} gastos`)
    if (due > 0) parts.push(formatCentsShort(due))
    if (remaining > 0 && remaining < due) parts.push(`falta ${formatCentsShort(remaining)}`)
  }
  if (group.place === 'before') parts.push('de antes')
  if (group.place === 'ahead') parts.push('adelantado')
  return parts
}

/**
 * El rótulo de un tramo de la hoja ancha, UNA vez donde empieza: «Quedó de
 * antes» antes del primer día arrastrado y «Vence en noviembre» donde arranca
 * el mes (repetido encima de cada día eran ocho filas con el mismo rótulo).
 */
function stretchLabel(
  place: SheetGroup['place'],
  previous: SheetGroup['place'] | undefined,
  mes: string,
): string | null {
  if (place === previous) return null
  if (place === 'before') return 'Quedó de antes'
  if (place === 'ahead') return 'Pagado por adelantado'
  // El mes abre la hoja: no hace falta decir de qué mes es.
  return previous === undefined ? null : `Vence en ${mes}`
}

export function SheetView({
  sheet,
  tenantSlug,
  canWrite,
  query,
  openId,
  miscAccountId,
  pasteList,
}: {
  sheet: Sheet
  tenantSlug: string
  canWrite: boolean
  query: SheetQuery
  /** `?abrir=<uuid>`: el renglón que entra abierto. */
  openId: string | null
  /** La cuenta «Gastos varios», para ofrecer cambiarla. */
  miscAccountId: string | null
  /** «Pegar una lista» (solo para quien carga y si se pudo leer el plan). */
  pasteList: ReactNode
}) {
  const { month } = sheet
  const mes = monthWord(month)
  const base = { mes: month }
  const href = (extra: Readonly<Record<string, string | null>>) =>
    gastosFijosHref(tenantSlug, { ...base, ...extra })
  const pills = sheetFilterPills(sheet)
  const pillKeys = new Set(pills.map((pill) => pill.key))
  const filterHref = (filter: SheetFilter) =>
    pillKeys.has(filter) ? href({ ver: filter }) : undefined

  const matches = (item: SheetItem) => matchesSheetQuery(item, query) || item.row.id === openId
  const filtering = query.ver !== null || query.categoria !== null || query.factura !== null
  const groups = sheet.groups
    .map((group) => ({ group, shown: group.items.filter(matches) }))
    .filter(({ shown }) => shown.length > 0)
  const shownCount = groups.reduce((sum, { shown }) => sum + shown.length, 0)
  const later = sheet.later.filter(matches)
  const off = sheet.off.filter(matches)
  const categoryName =
    query.categoria === null
      ? null
      : ([...sheet.items, ...sheet.later, ...sheet.off].find(
          (item) => item.row.accountId === query.categoria,
        )?.row.accountName ?? 'Esa categoría')
  const openIn = (list: readonly SheetItem[]) => list.some((item) => item.row.id === openId)

  // La columna «Cuota» existe solo si alguno es en cuotas.
  const cuotas = [...sheet.items, ...sheet.later, ...sheet.off].some(
    (item) => item.line.installment !== null,
  )
  const row = (item: SheetItem, underDay: boolean) => (
    <SheetRow
      key={item.row.id}
      item={item}
      month={month}
      canWrite={canWrite}
      cuotas={cuotas}
      // En los plegados de abajo no hay margen del día ni «Pagar» a la vista.
      payInRow={underDay}
      underDay={underDay}
      defaultOpen={item.row.id === openId}
      isMisc={miscAccountId !== null && item.row.accountId === miscAccountId}
    />
  )

  const installmentsLeft = [...sheet.items, ...sheet.later]
    .filter((item) => item.line.installment !== null && item.row.amountCents !== null)
    .reduce(
      (sum, item) => sum + (item.row.amountCents ?? 0) * (item.line.installment?.remaining ?? 0),
      0,
    )

  return (
    <div className="space-y-5">
      <section
        aria-label={`Planilla de gastos fijos de ${mes}`}
        className="card-hairline rounded-2xl border bg-card shadow-xs"
      >
        <SheetHead
          sheet={sheet}
          canWrite={canWrite}
          fillHref={gastosFijosFillHref(tenantSlug)}
          miscHref={gastosFijosFillHref(tenantSlug, { ver: 'varios' })}
          nextMonthHref={gastosFijosHref(tenantSlug, { mes: addMonthsToYearMonth(month, 1) })}
          currentMonthHref={gastosFijosHref(tenantSlug, { mes: monthOf(sheet.today) })}
          filterHref={filterHref}
        />

        {sheet.items.length > 0 ? (
          <div className="@container/ledger border-t border-border/60">
            {sheet.voided.length > 0 || pills.length > 0 || filtering ? (
              <div className="space-y-3 px-3 pt-3 pb-1 @[28rem]/ledger:px-4">
                <VoidedNotice items={sheet.voided} canWrite={canWrite} />
                {pills.length > 0 || filtering ? (
                  <nav
                    aria-label="Filtros de la planilla"
                    className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
                  >
                    <PillLink
                      href={href({})}
                      scroll={false}
                      active={!filtering}
                      count={sheet.items.length}
                      className="pointer-coarse:h-11"
                    >
                      Todo
                    </PillLink>
                    {pills.map((pill) => (
                      <PillLink
                        key={pill.key}
                        href={href({ ver: pill.key })}
                        scroll={false}
                        active={query.ver === pill.key}
                        count={pill.count}
                        className="pointer-coarse:h-11"
                      >
                        {pill.label}
                      </PillLink>
                    ))}
                    {categoryName !== null ? (
                      <ActiveFilter label={categoryName} clearHref={href({ ver: query.ver })} />
                    ) : null}
                    {query.factura !== null ? (
                      <ActiveFilter
                        label={INVOICE_BUCKET_LABELS[query.factura]}
                        clearHref={href({ ver: query.ver, categoria: query.categoria })}
                      />
                    ) : null}
                  </nav>
                ) : null}
              </div>
            ) : null}

            {shownCount > 0 ? (
              <>
                <div className="hidden items-end pt-3 pb-2 @[58rem]/ledger:flex">
                  <span
                    aria-hidden
                    className="w-14 shrink-0 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground @[28rem]/ledger:w-16"
                  >
                    Vence
                  </span>
                  <SheetColumnLabels cuotas={cuotas} />
                </div>
                <div className="relative border-t border-border/60">
                  {groups.map(({ group, shown }, index) => {
                    const stretch = stretchLabel(group.place, groups[index - 1]?.group.place, mes)
                    return (
                      <Fragment key={group.day}>
                        {stretch ? (
                          // Solo en la hoja ancha: en angosto cada día ya lo dice en su línea.
                          <p
                            aria-hidden
                            className="hidden border-b border-border/60 bg-secondary/40 py-1.5 pr-4 pl-20 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground @[40rem]/ledger:block"
                          >
                            {stretch}
                          </p>
                        ) : null}
                        <DayGroup group={group} shown={shown} today={sheet.today}>
                          {shown.map((item) => row(item, true))}
                        </DayGroup>
                      </Fragment>
                    )
                  })}
                  {/* La raya del margen: una sola, de arriba abajo, cálida como la de un cuaderno. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-16 hidden w-px bg-adm-s5/35 @[40rem]/ledger:block"
                  />
                </div>
              </>
            ) : (
              <p className="border-t border-border/60 px-4 py-6 text-sm text-muted-foreground">
                {emptyFilterText(query, later.length)}{' '}
                <Link href={href({})} scroll={false} className={LINK}>
                  Ver todo
                </Link>
              </p>
            )}
          </div>
        ) : null}

        <SheetFoot
          sheet={sheet}
          shown={groups.flatMap(({ shown }) => shown)}
          filtering={filtering}
          installmentsLeft={query.ver === 'en-cuotas' ? installmentsLeft : null}
          comprasHref={comprasHref(tenantSlug)}
          addHref={canWrite ? recurringHref(tenantSlug, 'nuevo') : null}
        />
      </section>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {canWrite ? (
          <Link href={gastosFijosFillHref(tenantSlug, { ver: 'todos' })} className={QUIET_LINK}>
            Editar montos y días de corrido
          </Link>
        ) : null}
        {pasteList}
        <Link
          href={`/${tenantSlug}/administracion/guias/dia-a-dia#receta-gasto-fijo`}
          className={QUIET_LINK}
        >
          ¿Cómo se paga un gasto fijo?
        </Link>
      </div>

      {later.length > 0 ? (
        <SheetFold
          key={`later-${filtering || openIn(later) ? 'open' : 'closed'}`}
          title={`No vencen en ${mes}`}
          count={later.length}
          hint="Vencen más adelante o no son de todos los meses."
          defaultOpen={filtering || openIn(later)}
        >
          {later.map((item) => row(item, false))}
        </SheetFold>
      ) : null}
      {off.length > 0 ? (
        <SheetFold
          key={`off-${openIn(off) ? 'open' : 'closed'}`}
          title="En pausa o terminados"
          count={off.length}
          defaultOpen={openIn(off)}
        >
          {off.map((item) => row(item, false))}
        </SheetFold>
      ) : null}
    </div>
  )
}

function emptyFilterText(query: SheetQuery, laterMatches: number): string {
  if (laterMatches > 0) return 'Este mes no hay ninguno así: los que hay están más abajo.'
  switch (query.ver) {
    case 'vencido':
      return 'No hay ninguno vencido.'
    case 'por-vencer':
      return 'No hay ninguno por vencer.'
    case 'pagado':
      return 'Todavía no pagaste ninguno.'
    case 'sin-monto':
      return 'Todos tienen monto.'
    case 'en-cuotas':
      return 'Ninguno es en cuotas.'
    default:
      return 'No hay ninguno así este mes.'
  }
}

/** Un filtro que vino de un dibujo («Alquiler», «Sin factura»): relleno, con su «×» para sacarlo. */
function ActiveFilter({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <Link
      href={clearHref}
      scroll={false}
      aria-label={`Quitar el filtro ${label}`}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3 text-[13px] font-medium whitespace-nowrap text-background outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
    >
      {label}
      <X aria-hidden className="size-3.5" />
    </Link>
  )
}

/** Los renglones de un día, con su margen: el día en grande a la izquierda (o en una línea, en angosto). */
function DayGroup({
  group,
  shown,
  today,
  children,
}: {
  group: SheetGroup
  shown: readonly SheetItem[]
  today: string
  children: ReactNode
}) {
  const { day } = group
  const isToday = day === today
  const headingId = `dia-${day}-titulo`
  const parts = groupParts(group, shown)

  return (
    <section
      id={`dia-${day}`}
      aria-labelledby={headingId}
      className="relative flex scroll-mt-32 border-b border-border/60 last:border-b-0"
    >
      {/* El margen del día (la columna «Vencimiento» de la planilla): pegado arriba mientras dura su
          grupo. En oscuro el margen va un tono arriba de la hoja: debajo de la pestaña, al lado de
          renglones teñidos, el fondo pelado se veía como un hueco negro. */}
      <div aria-hidden className="hidden w-16 shrink-0 dark:bg-secondary/40 @[40rem]/ledger:block">
        <div
          className={cn('sticky flex', STICKY_TOP, isToday && 'ring-2 ring-primary/40 ring-inset')}
        >
          <LedgerRail
            label={MONTH_NAMES_SHORT[Number(day.slice(5, 7)) - 1]}
            value={String(Number(day.slice(8, 10)))}
            unit={isToday ? 'hoy' : WEEKDAY_NAMES_SHORT[weekdayOf(day)]}
            tone={groupTone(shown)}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* En angosto, la línea del día (pegada arriba); en la hoja ancha lo dice el margen y el
            título queda solo para lectores. */}
        <h3
          id={headingId}
          className={cn(
            'sticky z-[2] flex flex-wrap gap-x-1.5 border-b border-border/60 bg-card/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground backdrop-blur @[28rem]/ledger:px-4 @[40rem]/ledger:sr-only',
            STICKY_TOP,
          )}
        >
          {parts.map((part, index) => (
            <span key={part} className="whitespace-nowrap">
              {part}
              {index < parts.length - 1 ? ' ·' : null}
            </span>
          ))}
        </h3>
        {/* Un día con un solo renglón: el renglón ocupa todo el alto del margen (que mide tres
            líneas), así su tinte no deja una franja pelada abajo. */}
        <ul className="flex flex-1 flex-col [&>li:only-child]:flex [&>li:only-child]:flex-1 [&>li:only-child]:flex-col [&>li:only-child]:justify-center">
          {children}
        </ul>
      </div>
    </section>
  )
}

/** Una cifra de la fila de suma: su rótulo y su importe. La que manda va en Fraunces. */
function Sum({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="contents sm:flex sm:items-baseline sm:gap-2">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd
        className={cn(
          'text-right',
          strong ? 'font-serif text-xl font-semibold leading-none tracking-tight' : 'tabular-nums',
        )}
      >
        <Amount cents={cents} decimals={0} />
      </dd>
    </div>
  )
}

/**
 * La fila de suma de la planilla y, punteada como su renglón vacío, «＋ Agregar
 * un gasto fijo».
 *
 * Suma lo que se ve arriba: con un filtro puesto, los renglones que quedaron
 * (y el total del mes pasa a una línea gris). Mirando el mes que viene, lo que
 * quedó de antes va con su nombre, nunca como «Total de noviembre».
 */
function SheetFoot({
  sheet,
  shown,
  filtering,
  installmentsLeft,
  comprasHref: comprasLink,
  addHref,
}: {
  sheet: Sheet
  /** Los renglones que se ven en la hoja (con el filtro puesto). */
  shown: readonly SheetItem[]
  filtering: boolean
  installmentsLeft: number | null
  comprasHref: string
  addHref: string | null
}) {
  const { progress, items, month } = sheet
  const mes = monthWord(month)
  if (items.length === 0 && addHref === null && progress.priorOpenCents === 0) return null
  const filtered = filtering && shown.length !== items.length
  const carry = sheetCarry(sheet)
  const part = shownTotals(shown)
  const own = carry?.ownTotals ?? null
  const ownSums = carry?.own.some((item) => item.line.remainingCents !== null) ?? false
  // Lo que se suma: lo que deja el filtro, lo del mes (si hay algo de antes aparte) o todo.
  const noAmount = filtered ? part.noAmount : progress.noAmountDue
  const sums = filtered
    ? shown.some((item) => item.line.remainingCents !== null)
    : progress.countedRows > 0
  const many = items.length === 1 ? '1 gasto' : `${items.length} gastos`
  const count = filtered ? `${shown.length} de ${many}` : many
  const none = filtered ? shown.length : items.length

  return (
    <div className="border-t border-border/60">
      {items.length > 0 ? (
        <div className="flex flex-col gap-x-6 gap-y-2 px-4 py-3.5 text-sm sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:px-5">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{count}</span>
            {!sums
              ? ` · ${none === 1 ? 'no tiene monto todavía' : 'ninguno tiene monto todavía'}`
              : noAmount > 0
                ? ` · ${noAmount} sin monto: no ${noAmount === 1 ? 'suma' : 'suman'}`
                : ''}
          </p>
          {!sums ? null : filtered ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6">
              <Sum
                label={shown.length === 1 ? 'Este gasto' : `Estos ${shown.length} suman`}
                cents={part.totalCents}
              />
              {part.paidCents > 0 ? <Sum label="Ya pagaste" cents={part.paidCents} /> : null}
              <Sum strong label="Te falta" cents={part.remainingCents} />
            </dl>
          ) : carry ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6">
              {carry.cents > 0 ? (
                <Sum strong={!ownSums} label="Quedó de antes" cents={carry.cents} />
              ) : null}
              {own && ownSums ? (
                <Sum strong label={`Te falta de ${mes}`} cents={own.remainingCents} />
              ) : null}
            </dl>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6">
              <Sum label={`Total de ${mes}`} cents={progress.totalCents} />
              <Sum label="Ya pagaste" cents={progress.paidCents} />
              <Sum strong label="Te falta" cents={progress.remainingCents} />
            </dl>
          )}
        </div>
      ) : null}
      {filtered && !carry && progress.countedRows > 0 ? (
        <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
          Todo {mes}: {many}, total <Amount cents={progress.totalCents} decimals={0} />, te falta{' '}
          <Amount cents={progress.remainingCents} decimals={0} />.
        </p>
      ) : null}
      {installmentsLeft !== null && installmentsLeft > 0 ? (
        <p className="border-t border-border/60 px-4 py-3 text-sm sm:px-5">
          En cuotas te quedan{' '}
          <Amount cents={installmentsLeft} decimals={0} className="font-medium" /> en total.
        </p>
      ) : null}
      {progress.priorOpenCents > 0 ? (
        <p className="border-t border-border/60 px-4 py-3 text-sm text-pretty sm:px-5">
          Aparte, de meses anteriores te quedan{' '}
          <Amount cents={progress.priorOpenCents} decimals={0} className="font-semibold" /> sin
          pagar.{' '}
          <Link href={comprasLink} className={LINK}>
            Ver en Compras y pagos
          </Link>
        </p>
      ) : null}
      {addHref ? (
        <Link
          href={addHref}
          className={cn(
            'flex min-h-12 items-center gap-2 rounded-b-2xl border-t border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-cream-tint hover:text-foreground sm:px-5',
            'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )}
        >
          <Plus aria-hidden className="size-4" />
          Agregar un gasto fijo
        </Link>
      ) : null}
    </div>
  )
}
