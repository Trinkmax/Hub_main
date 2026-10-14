import { ArrowRight, CircleCheck } from 'lucide-react'
import { Meter } from '@/components/administracion/charts/meter'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { MoneyHero } from '@/components/administracion/kit/hero'
import { Panel, PanelSection } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  type FixedProgress,
  fixedDueRows,
  fixedProgress,
  type PayableTrancheKey,
  payableAttention,
  payablesTranches,
} from '@/lib/accounting/home'
import { formatCentsShort } from '@/lib/money'
import { AttentionRows, type AttentionWords } from './attention-rows'
import { PanelLink } from './block-states'
import type { HomeData } from './home-data'
import { type AttentionView, attentionView, fixedDueViews } from './summary-copy'

/**
 * Los tres tramos de la deuda. Acá el color SÍ es un estado (vencido / por
 * vencer), por eso van los de estado y no los de serie; la leyenda de la barra
 * lo dice con palabras.
 */
const TRANCHE_SWATCH: Readonly<Record<PayableTrancheKey, string>> = {
  overdue: 'bg-destructive',
  week: 'bg-warning',
  later: 'bg-adm-neutral',
}

const PAY_WORDS: AttentionWords = { danger: 'Vencido', warning: 'Por vencer', info: 'Aviso' }

/** Cuántos renglones con [Pagar] entran antes de mandar a la lista completa. */
const MAX_ROWS = 3

/**
 * «Lo que tenés que pagar»: cuánto se les debe a los proveedores y cuán
 * urgente es (vencido · vence esta semana · más adelante), los que hay que
 * pagar primero con su botón, y abajo los gastos fijos del mes.
 *
 * Los gastos fijos usan las mismas cuentas que su pestaña (`fixedProgress`):
 * el «Te falta de gasto fijo» de acá es el «Falta pagar» de allá. Debajo, los
 * que tocan pagar (hasta tres, del más atrasado), cada uno con su «Pagar» (y,
 * si es uno solo, también «Lo pago después» y «Este mes no se paga»): la
 * acción al lado del número, sin salir a la planilla. (La tarjeta de «Hoy te
 * toca» los cuenta y por eso no se repiten en «Avisos»: acá es donde se
 * pagan.) Si ninguno
 * tiene monto no se muestra «$ 0» (sería decir «está todo pago»): se dice que
 * faltan los montos.
 *
 * Lo mismo con la deuda del bar recién configurado: sin saldos iniciales y sin
 * ninguna compra a pagar cargada no dice «No le debés nada a nadie · $ 0» al
 * lado de un héroe que dice «Todavía no sé cuánta plata hay» (`unknown`).
 */
export async function PayablesBlock({ data, className }: { data: HomeData; className?: string }) {
  const [summaryResult, recurringResult, paymentsResult, settingsResult] = await Promise.all([
    data.summary,
    data.recurring,
    data.payments,
    data.settings,
  ])
  const { base, canWrite, today } = data
  const summary = summaryResult.ok ? summaryResult.data : null
  // Con los saldos iniciales sin cargar (ahí va lo que el bar ya debía), un cero no es un dato.
  const openingPending = settingsResult.ok && settingsResult.data?.openingStatus === 'pending'
  const tranches = summary ? payablesTranches(summary.payables, { openingPending }) : null
  // Los avisos llegan topeados: lo que queda se completa con los proveedores con algo
  // vencido, así «3 renglones y 6 más» suma los 9 que dice el título.
  const pay = summary
    ? payableAttention(summary.attention, MAX_ROWS, tranches?.partiesRed ?? null)
    : { rows: [], more: 0 }
  const views = pay.rows.map((item, index) => attentionView(item, today, base, index))
  const fixed = recurringResult.ok
    ? fixedProgress(recurringResult.data, paymentsResult.ok ? paymentsResult.data : null, today)
    : null
  const dueRows = recurringResult.ok ? fixedDueRows(recurringResult.data) : []
  const due = {
    views: fixedDueViews(dueRows.slice(0, MAX_ROWS), today, base),
    more: Math.max(0, dueRows.length - MAX_ROWS),
  }

  return (
    <Panel
      title={tranches?.title ?? 'Lo que tenés que pagar'}
      action={<PanelLink href={`${base}/compras`}>Ver compras</PanelLink>}
      className={className}
    >
      <PanelSection className="space-y-4">
        {tranches?.unknown ? (
          // El bar recién configurado: ni «$ 0» ni «no le debés nada». Qué va a aparecer acá.
          <div className="space-y-1.5 text-sm">
            <p className="text-pretty">{tranches.sentence}</p>
            <p className="text-muted-foreground text-pretty">
              Y cada compra que cargues para pagar después aparece acá, con su vencimiento.
            </p>
          </div>
        ) : tranches ? (
          <>
            <MoneyHero
              size="md"
              label="Le debés a proveedores"
              cents={tranches.totalCents}
              // Cuántos proveedores son lo dice el título; acá, cuánto de esto ya venció.
              sentence={tranches.sentence ?? undefined}
            />
            {tranches.isEmpty ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground text-pretty">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                Cuando cargues una compra que pagás después, aparece acá con su vencimiento.
              </p>
            ) : (
              <SplitBar
                segments={tranches.tranches.map((t) => ({
                  key: t.key,
                  label: t.label,
                  cents: t.cents,
                  swatch: TRANCHE_SWATCH[t.key],
                }))}
              />
            )}
            {tranches.note ? (
              <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
                {tranches.note}
              </p>
            ) : null}
          </>
        ) : (
          <MoneyHero
            size="md"
            label="Le debés a proveedores"
            cents={null}
            sentence={
              summary
                ? 'Todavía no está disponible.'
                : 'No pudimos cargar lo que les debés a los proveedores.'
            }
          />
        )}

        {views.length > 0 ? (
          <div className="border-t border-border/60 pt-4">
            <AttentionRows views={views} words={PAY_WORDS} quietWhenUniform />
            {pay.more > 0 ? (
              <PanelLink href={`${base}/compras?tab=proveedores`} className="mt-3">
                {pay.more === 1 ? 'Y 1 más' : `Y ${pay.more} más`}: ver todo lo que debés
                <ArrowRight className="size-3.5" aria-hidden />
              </PanelLink>
            ) : null}
          </div>
        ) : null}
      </PanelSection>

      <PanelSection
        title="Gastos fijos del mes"
        action={<PanelLink href={`${base}/gastos-fijos`}>Ver gastos fijos</PanelLink>}
      >
        {fixed ? (
          <FixedExpenses
            fixed={fixed}
            due={due}
            base={base}
            canWrite={canWrite}
            paymentsMissing={!paymentsResult.ok}
          />
        ) : (
          <p className="text-sm text-muted-foreground text-pretty">
            No pudimos cargar los gastos fijos. Probá de nuevo en un rato.
          </p>
        )}
      </PanelSection>
    </Panel>
  )
}

/** Los gastos fijos que tocan, con su «Pagar», y cuántos más hay en la planilla. */
function DueFixedRows({
  due,
  href,
}: {
  due: { views: readonly AttentionView[]; more: number }
  href: string
}) {
  if (due.views.length === 0) return null
  return (
    <div className="border-t border-border/60 pt-4">
      <AttentionRows views={due.views} words={PAY_WORDS} quietWhenUniform />
      {due.more > 0 ? (
        <PanelLink href={href} className="mt-3">
          {due.more === 1 ? 'Y 1 más' : `Y ${due.more} más`}: ver gastos fijos
          <ArrowRight className="size-3.5" aria-hidden />
        </PanelLink>
      ) : null}
    </div>
  )
}

function FixedExpenses({
  fixed,
  due,
  base,
  canWrite,
  paymentsMissing,
}: {
  fixed: FixedProgress
  /** Los que tocan pagar, ya como renglones con sus acciones (`fixedDueViews`). */
  due: { views: readonly AttentionView[]; more: number }
  base: string
  canWrite: boolean
  /** No se pudo leer lo pagado: lo ya cargado cuenta como sin pagar. */
  paymentsMissing: boolean
}) {
  const href = `${base}/gastos-fijos`

  if (fixed.state === 'empty') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-pretty">{fixed.sentence}</p>
        <p className="text-sm text-muted-foreground text-pretty">
          El alquiler, la luz, los sueldos: se cargan una vez y acá ves cuánto te falta pagar cada
          mes.
        </p>
        {canWrite ? (
          <PanelLink href={href}>
            Cargar gastos fijos
            <ArrowRight className="size-3.5" aria-hidden />
          </PanelLink>
        ) : null}
      </div>
    )
  }

  if (fixed.state === 'no_amounts' || fixed.state === 'nothing_due') {
    return (
      <div className="space-y-3">
        {/* Sin total no hay avance que medir: el riel queda punteado, nunca en «$ 0». */}
        <Meter valueCents={0} totalCents={0} label="Gastos fijos pagados" />
        <p className="text-sm text-pretty">{fixed.sentence}</p>
        {fixed.state === 'nothing_due' && fixed.missingAmount > 0 ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {fixed.missingAmount === 1
              ? 'Hay 1 sin monto: completalo para saber cuánto te va a faltar.'
              : `Hay ${fixed.missingAmount} sin monto: completalos para saber cuánto te va a faltar.`}
          </p>
        ) : null}
        {canWrite && fixed.missingAmount > 0 ? (
          // «Completar la planilla» (`gastosFijosFillHref`): los montos de todos de corrido,
          // sin abrir uno por uno.
          <PanelLink href={`${href}/completar`}>
            Completar los montos
            <ArrowRight className="size-3.5" aria-hidden />
          </PanelLink>
        ) : null}
        <DueFixedRows due={due} href={href} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Te falta de gasto fijo</p>
          <p className="font-serif text-2xl font-semibold leading-tight tracking-tight tabular-nums">
            {formatCentsShort(fixed.remainingCents)}
          </p>
        </div>
        {fixed.overdueCents > 0 ? (
          <StatusPill tone="late">{formatCentsShort(fixed.overdueCents)} vencido</StatusPill>
        ) : fixed.remainingCents === 0 ? (
          <StatusPill tone="ok">Al día</StatusPill>
        ) : null}
      </div>
      <Meter
        valueCents={fixed.paidCents}
        totalCents={fixed.totalCents}
        label="Gastos fijos pagados"
      />
      <p className="text-sm text-muted-foreground text-pretty">{fixed.sentence}</p>
      {fixed.noAmountDue > 0 || fixed.priorOpenCents > 0 || paymentsMissing ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {fixed.noAmountDue > 0 ? (
            <li>
              {fixed.noAmountDue === 1
                ? 'Hay 1 que vence este mes y no tiene monto: no suma.'
                : `Hay ${fixed.noAmountDue} que vencen este mes y no tienen monto: no suman.`}
            </li>
          ) : null}
          {fixed.priorOpenCents > 0 ? (
            <li>
              Aparte quedaron {formatCentsShort(fixed.priorOpenCents)} sin pagar de meses
              anteriores.
            </li>
          ) : null}
          {paymentsMissing ? (
            <li>No pudimos leer lo que ya pagaste: puede faltar restar algún pago.</li>
          ) : null}
        </ul>
      ) : null}
      <DueFixedRows due={due} href={href} />
    </div>
  )
}
