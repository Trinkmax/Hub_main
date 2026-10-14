'use client'

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  type LucideIcon,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartTable } from '@/components/administracion/charts/chart-parts'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { Panel } from '@/components/administracion/kit/panel'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveSalesMethod } from '@/lib/accounting/actions/master'
import type { SalesMethodRow } from '@/lib/accounting/queries/settings'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  arrivalWord,
  type ChargeBreakdown,
  CLOSE_GROUP_META,
  chargeBreakdown,
  chargeTitle,
  closeGroupTitle,
  flowText,
  type GroupedMethod,
  groupCloseMethods,
  moveId,
  rateLabel,
  reorderPlan,
  SAMPLE_GROSS_CENTS,
  splitsAGroup,
  withCloseGroup,
} from '../_lib/cobros'
import { methodRowPayload, type SystemPartyRow } from '../_lib/payloads'
import { formatBp } from '../_lib/percent'
import { CloseColumnTicket } from './close-column-ticket'
import { MethodDialog, type MethodTreasury } from './method-dialog'
import { type MethodNet, MethodRow } from './method-row'
import { PartyDialog, type PartyDialogTarget } from './party-dialog'
import { SystemPartiesList } from './system-parties-panel'
import { useMasterAction } from './use-master-action'

/**
 * Ajustes › Medios de cobro: cómo te pagan, en el orden de tu cierre del día.
 *
 * Junta lo que antes eran dos pestañas («Medios» y «Plataformas»): de cada
 * medio se ve a dónde va lo cobrado, cuándo llega y cuánto te descuentan, todo
 * en la misma fila. Los medios van agrupados igual que en el paso 1 del Cierre
 * del día, y a la derecha está el objeto de la habitación: «Tu columna del
 * cierre», que se redibuja al prender, apagar o reordenar.
 *
 * Ningún control manda algo que antes no mandaba: el interruptor de un medio
 * guarda solo el medio (la app se prende desde su propio formulario) y la
 * comisión se guarda con el formulario de siempre. Lo único nuevo es «Guardar
 * el orden»: el mismo envío que mandaban las flechas, una vez por cada medio
 * que cambió de lugar.
 */

export type MethodsPanelTreasury = MethodTreasury & { bankPartyId: string | null }

type Row = GroupedMethod<SalesMethodRow> & {
  party: SystemPartyRow | null
  /** Tiene a alguien que descuenta (tarjeta, app, billetera). */
  charges: boolean
  breakdown: ChargeBreakdown | null
  net: MethodNet
  flow: string
}

/** Los tipos de medio donde alguien cobra por el bar. */
const chargingKind = (kind: SalesMethodRow['kind']) =>
  kind === 'settled_now' || kind === 'receivable'

function GroupIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-primary shadow-2xs"
    >
      <Icon className="size-4" />
    </span>
  )
}

export function MethodsPanel({
  tenantSlug,
  methods,
  treasuries,
  parties,
  readOnly,
  cuitOpen,
}: {
  tenantSlug: string
  /** Todos los medios (prendidos y apagados), en el orden de Ajustes. */
  methods: readonly SalesMethodRow[]
  treasuries: readonly MethodsPanelTreasury[]
  /** Quienes pueden pagar un medio, más los partícipes del sistema y los bancos (la lista de CUIT). */
  parties: readonly SystemPartyRow[]
  readOnly: boolean
  /** La lista de CUIT, abierta de entrada (`?tab=participes`, o la contadora). */
  cuitOpen: boolean
}) {
  const router = useRouter()
  const base = `/${tenantSlug}/administracion`
  const { pending, run } = useMasterAction()
  const [editing, setEditing] = useState<SalesMethodRow | 'new' | null>(null)
  const [partyTarget, setPartyTarget] = useState<PartyDialogTarget | null>(null)
  /** En «Cambiar el orden»: los ids de los prendidos en el orden que se está armando. */
  const [order, setOrder] = useState<string[] | null>(null)
  const [savingOrder, startSavingOrder] = useTransition()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(parties.map((p) => [p.id, p]))
    return withCloseGroup(methods, { treasuries, parties }).map((m) => {
      const party = m.partyId ? (byId.get(m.partyId) ?? null) : null
      const charges = chargingKind(m.kind) && party !== null
      const breakdown = charges ? chargeBreakdown(party?.rates) : null
      const net: MethodNet =
        m.kind === 'treasury'
          ? { kind: 'whole' }
          : !charges
            ? { kind: 'none' }
            : breakdown
              ? { kind: 'amount', cents: breakdown.netCents }
              : { kind: 'missing' }
      return { ...m, party, charges, breakdown, net, flow: flowText(m) }
    })
  }, [methods, treasuries, parties])

  const active = rows.filter((m) => m.active)
  const inactive = rows.filter((m) => !m.active)
  const activeById = new Map(active.map((m) => [m.id, m]))
  const ordered = order
    ? order.map((id) => activeById.get(id)).filter((m): m is Row => m !== undefined)
    : active
  const blocks = groupCloseMethods(active)
  const headline = chargeTitle(
    active.map((m) => ({
      name: m.name,
      charges: m.charges,
      netCents: m.net.kind === 'amount' ? m.net.cents : null,
    })),
  )
  const worst = headline.worst ? active.find((m) => m.name === headline.worst?.name) : undefined

  const methodParties = parties.filter(
    (p) =>
      p.kind === 'card_processor' ||
      p.kind === 'payment_wallet' ||
      p.kind === 'delivery_platform' ||
      p.systemKey === 'senas',
  )
  const cuitParties = parties.filter((p) => p.systemKey !== null || p.kind === 'bank')

  const openParty = (party: SystemPartyRow) =>
    setPartyTarget({
      party,
      methods: active.filter((m) => m.partyId === party.id).map((m) => m.name),
    })

  const toggle = (m: Row, next: boolean) =>
    run(() => saveSalesMethod(tenantSlug, methodRowPayload(m, { active: next })), {
      quiet: true,
      onSuccess: (_row, message) => {
        const party = m.party
        // Prender el medio no prende la app: son dos guardados. Si quedó desparejo, se ofrece el otro.
        if (next && party && !party.active && party.kind === 'delivery_platform') {
          toast.success(message, {
            description: `${party.name} está apagada: para cobrar con ella, prendela también.`,
            action: { label: `Prender ${party.name}`, onClick: () => openParty(party) },
          })
        } else toast.success(message)
      },
    })

  const saveOrder = () => {
    if (!order) return
    const plan = reorderPlan(methods, order)
    if (plan.length === 0) {
      setOrder(null)
      return
    }
    const byId = new Map(methods.map((m) => [m.id, m]))
    startSavingOrder(async () => {
      for (const [index, step] of plan.entries()) {
        const method = byId.get(step.id)
        if (!method) continue
        setProgress({ done: index, total: plan.length })
        let result: Awaited<ReturnType<typeof saveSalesMethod>>
        try {
          result = await saveSalesMethod(tenantSlug, methodRowPayload(method, { sort: step.sort }))
        } catch {
          toast.error(ACC_UNREACHABLE.offline)
          break
        }
        if (!result.ok) {
          // Lo que ya se guardó queda: es un orden válido, a medio camino.
          toast.error(`No pudimos mover «${method.name}».`, {
            description: `${result.message} El resto quedó como estaba: probá de nuevo.`,
          })
          setProgress(null)
          setOrder(null)
          router.refresh()
          return
        }
        if (index === plan.length - 1) toast.success('Orden guardado.')
      }
      setProgress(null)
      setOrder(null)
      router.refresh()
    })
  }

  const whole = formatCentsShort(SAMPLE_GROSS_CENTS)
  const busy = pending || savingOrder

  // ─── La lista ──────────────────────────────────────────────────────────────

  const methodRow = (m: Row, icon?: LucideIcon) => (
    <MethodRow
      key={m.id}
      name={m.name}
      icon={icon}
      flow={m.flow}
      net={m.net}
      rateText={m.charges ? rateLabel(m.party?.rates) : null}
      charges={m.charges}
      partyOff={
        m.active && m.charges && m.party && !m.party.active
          ? { name: m.party.name, canTurnOn: m.party.kind === 'delivery_platform' }
          : null
      }
      active={m.active}
      readOnly={readOnly}
      pending={busy}
      onEdit={() => setEditing(m)}
      onToggle={(next) => toggle(m, next)}
      onRates={() => (m.party ? openParty(m.party) : undefined)}
      onTurnOnParty={() => (m.party ? openParty(m.party) : undefined)}
    />
  )

  const grouped = (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground text-pretty">
        La barra de cada medio muestra cuánto te llega de cada {whole}.
      </p>
      {blocks.map((block) => {
        const meta = CLOSE_GROUP_META[block.group]
        const title = closeGroupTitle(block.group, block.methods)
        const only = block.methods.length === 1 ? block.methods[0] : undefined
        // Un grupo de un solo medio no repite el título: el ícono va en su renglón (como en el Cierre).
        if (only) {
          return (
            <ul
              key={block.group}
              className="@container/medios rounded-xl bg-secondary/50 p-3 sm:p-4"
            >
              {methodRow(only, meta.icon)}
            </ul>
          )
        }
        const headingId = `aj-medios-${block.group}`
        return (
          <section
            key={block.group}
            aria-labelledby={headingId}
            className="@container/medios rounded-xl bg-secondary/50 p-3 sm:p-4"
          >
            <div className="flex items-center gap-2.5">
              <GroupIcon icon={meta.icon} />
              <h3 id={headingId} className="text-sm leading-tight font-semibold">
                {title}
              </h3>
            </div>
            <ul className="mt-3 divide-y divide-border/60 sm:pl-[2.625rem]">
              {block.methods.map((m) => methodRow(m))}
            </ul>
          </section>
        )
      })}
    </div>
  )

  const table = (
    <ChartTable
      caption={`Cuánto te llega de cada ${whole}, por medio de cobro`}
      columns={[
        { key: 'name', label: 'Medio' },
        { key: 'net', label: 'Te llega', align: 'right' },
        { key: 'commission', label: 'Comisión', align: 'right' },
        { key: 'vat', label: 'IVA de la comisión', align: 'right' },
        { key: 'withholdings', label: 'Retenciones', align: 'right' },
        { key: 'when', label: 'Cuándo' },
      ]}
      rows={active.map((m) => {
        const b = m.breakdown
        const cell = (cents: number | undefined) =>
          m.kind === 'treasury'
            ? formatCentsShort(0)
            : b && cents !== undefined
              ? formatCentsShort(cents)
              : '—'
        return {
          key: m.id,
          cells: [
            m.name,
            m.net.kind === 'whole'
              ? whole
              : m.net.kind === 'amount'
                ? formatCentsShort(m.net.cents)
                : m.net.kind === 'missing'
                  ? 'Falta la comisión'
                  : '—',
            cell(b?.commissionCents),
            cell(b?.commissionVatCents),
            cell(b?.withholdingsCents),
            arrivalWord(m),
          ],
        }
      })}
    />
  )

  // ─── «Cambiar el orden» ────────────────────────────────────────────────────

  const reorderList = order ? (
    <Panel
      title="Poné los medios como en tu cierre de caja"
      description="Así, en el cierre del día pegás la columna entera de una vez."
    >
      <ol className="divide-y divide-border/60">
        {ordered.map((m, index) => (
          <li key={m.id} className="flex items-center gap-3 py-1.5">
            <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={m.name}>
                {m.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {closeGroupTitle(m.group, [m])}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 rounded-full"
                disabled={busy || index === 0}
                aria-label={`Subir ${m.name}`}
                onClick={() => setOrder(moveId(order, m.id, -1))}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 rounded-full"
                disabled={busy || index === ordered.length - 1}
                aria-label={`Bajar ${m.name}`}
                onClick={() => setOrder(moveId(order, m.id, 1))}
              >
                <ArrowDown className="size-4" />
              </Button>
            </span>
          </li>
        ))}
      </ol>
      {splitsAGroup(ordered.map((m) => m.group)) ? (
        <p className="mt-3 rounded-xl bg-secondary/50 p-3 text-xs text-muted-foreground text-pretty">
          En el cierre, los medios del mismo tipo se muestran juntos.
        </p>
      ) : null}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-col-reverse gap-2 border-t border-border/60 bg-card/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] backdrop-blur sm:-mx-5 sm:flex-row sm:items-center sm:justify-end sm:px-5">
        <p aria-live="polite" className="text-xs text-muted-foreground sm:mr-auto">
          {savingOrder && progress
            ? `Guardando el orden… ${progress.done + 1} de ${progress.total}`
            : 'Todavía no se guardó nada.'}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={savingOrder}
          onClick={() => setOrder(null)}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-12 min-w-[180px] sm:h-11"
          disabled={busy}
          onClick={saveOrder}
        >
          {savingOrder ? 'Guardando…' : 'Guardar el orden'}
        </Button>
      </div>
    </Panel>
  ) : null

  // ─── La pantalla ───────────────────────────────────────────────────────────

  const ticket = (
    <CloseColumnTicket
      names={ordered.map((m) => m.name)}
      note={
        order
          ? 'Así va a quedar tu columna cuando guardes el orden.'
          : 'Es el orden de tu cierre de caja: en el cierre del día pegás la columna entera.'
      }
    />
  )
  const closeLink = readOnly ? null : (
    <p className="mt-3 text-center text-sm">
      <Link
        href={`${base}/ventas/cierre`}
        className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
      >
        Abrir el cierre del día
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </p>
  )

  return (
    <div className="space-y-6">
      {readOnly || order ? null : (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end [&>:only-child]:col-span-2">
          {active.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2"
              disabled={busy}
              onClick={() => setOrder(active.map((m) => m.id))}
            >
              <ArrowUpDown className="size-4" aria-hidden />
              Cambiar el orden
            </Button>
          ) : null}
          <Button type="button" className="h-11 gap-2" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            Agregar un medio
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-4">
          {order ? (
            reorderList
          ) : rows.length === 0 ? (
            <EmptyTeach
              title="Todavía no hay medios de cobro"
              action={
                readOnly ? undefined : (
                  <Button type="button" className="h-11 gap-2" onClick={() => setEditing('new')}>
                    <Plus className="size-4" aria-hidden />
                    Agregar un medio
                  </Button>
                )
              }
            >
              Los medios son las formas en que te pagan: efectivo, QR, tarjetas, apps. Con ellos se
              arma el cierre del día y se sabe a qué caja va cada cobro.
            </EmptyTeach>
          ) : (
            <Panel>
              <ChartFrame
                headingLevel="h2"
                title={headline.title}
                sentence={headline.sentence}
                chart={
                  active.length > 0 ? (
                    grouped
                  ) : (
                    <p className="rounded-xl bg-secondary/50 p-4 text-sm text-muted-foreground">
                      Prendé alguno de los de abajo, o agregá uno.
                    </p>
                  )
                }
                table={active.length > 0 ? table : undefined}
                footer={
                  headline.missing || worst?.breakdown ? (
                    <div className="space-y-2">
                      {headline.missing ? (
                        <p className="text-sm text-warning-text text-pretty">{headline.missing}</p>
                      ) : null}
                      {worst?.breakdown ? (
                        <Explain note="El IVA de la comisión y las retenciones son pagos a cuenta de impuestos: cómo se computan lo ve la contadora. Estos porcentajes solo precargan los cobros; nunca se registran solos.">
                          <MathRow label="Cobrado" value={formatCentsShort(SAMPLE_GROSS_CENTS)} />
                          <MathRow
                            op="−"
                            label={`Comisión (${formatBp(worst.party?.rates.commissionBp ?? 0)})`}
                            value={formatCentsShort(worst.breakdown.commissionCents)}
                          />
                          <MathRow
                            op="−"
                            label="IVA de la comisión (21 %)"
                            value={formatCentsShort(worst.breakdown.commissionVatCents)}
                          />
                          <MathRow
                            op="−"
                            label="Retenciones"
                            value={formatCentsShort(worst.breakdown.withholdingsCents)}
                          />
                          <MathRow
                            op="="
                            label={`Te llega con ${worst.name}`}
                            value={formatCentsShort(worst.breakdown.netCents)}
                          />
                        </Explain>
                      ) : null}
                    </div>
                  ) : undefined
                }
              />
            </Panel>
          )}

          {!order && inactive.length > 0 ? (
            <details className="group/off rounded-2xl bg-secondary/50">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="size-4 text-muted-foreground transition-transform group-open/off:rotate-90 motion-reduce:transition-none"
                />
                Apagados
                <span className="rounded-full bg-card px-1.5 py-px font-mono text-[11px] tabular-nums">
                  {inactive.length}
                </span>
              </summary>
              <ul className="@container/medios divide-y divide-border/60 px-4 pb-4">
                {inactive.map((m) => methodRow(m))}
              </ul>
            </details>
          ) : null}

          {/* En el celular la columna va plegada, después de la lista. */}
          {rows.length > 0 ? (
            <details
              className="group/col rounded-2xl bg-secondary/50 lg:hidden"
              open={order !== null || undefined}
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="size-4 text-muted-foreground transition-transform group-open/col:rotate-90 motion-reduce:transition-none"
                />
                Ver tu columna del cierre
              </summary>
              <div className="mx-auto max-w-sm px-4 pb-4">
                {ticket}
                {closeLink}
              </div>
            </details>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <aside
            className={cn(
              'hidden lg:sticky lg:top-[calc(5rem+var(--adm-nav-h,0px))] lg:block',
              savingOrder && 'opacity-70',
            )}
          >
            {ticket}
            {closeLink}
          </aside>
        ) : null}
      </div>

      {order ? null : (
        <SystemPartiesList
          parties={cuitParties}
          readOnly={readOnly}
          defaultOpen={cuitOpen}
          onEdit={(party) => openParty(party)}
        />
      )}

      {readOnly ? null : (
        <>
          <MethodDialog
            tenantSlug={tenantSlug}
            target={editing}
            onClose={() => setEditing(null)}
            treasuries={treasuries}
            parties={methodParties}
          />
          <PartyDialog
            tenantSlug={tenantSlug}
            target={partyTarget}
            onClose={() => setPartyTarget(null)}
          />
        </>
      )}
    </div>
  )
}
