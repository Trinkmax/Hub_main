import {
  Banknote,
  Bike,
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CreditCard,
  FileUp,
  HandCoins,
  Landmark,
  type LucideIcon,
  Plus,
  QrCode,
  ReceiptText,
  Repeat,
  Wallet,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { dueRail } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/libreta'
import { InstallmentDots } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/installment-dots'
import {
  TickBox,
  type TickState,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/tick-box'
import { Verdict } from '@/components/administracion/acciones/ajustar-piezas'
import { countSubmitLabel, countVerdict } from '@/components/administracion/acciones/ajustar-vista'
import { ACTION_TITLES } from '@/components/administracion/acciones/types'
import { MonthStrip } from '@/components/administracion/charts/month-strip'
import { ScaledMock } from '@/components/administracion/guias/arca-mock/scaled-mock'
import { PileSheet } from '@/components/administracion/importar/review/paper-pile'
import { LedgerList, LedgerRail, LedgerRow } from '@/components/administracion/kit/ledger'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { StepCard } from '@/components/administracion/kit/step'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit/ticket'
import {
  LAUNCHER_DESCRIPTION,
  LAUNCHER_GROUPS,
  LAUNCHER_TITLE,
  type LauncherItem,
  launcherGroups,
} from '@/components/administracion/nav/launcher-items'
import {
  GUIDE_PAPERS,
  type GuideLauncherKey,
  type GuideScene,
  type GuideScreen,
  type PaperId,
  SCREEN_LABELS,
} from '@/lib/accounting/guides'
import { proposalBadge, reviewHero, reviewTitle } from '@/lib/imports/ui/review-copy'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  MOCK_WIDTH,
  MockAmount,
  MockCanvas,
  MockCheckRow,
  MockChips,
  MockField,
  MockIcon,
  MockInput,
  MockPage,
  MockPrimary,
  MockSecondary,
  MockSheet,
  Tap,
} from './mock-kit'
import { PaperArt } from './station-art'

/**
 * Las pantallas simuladas de las recetas del día a día: una por lo que hay que mirar o tocar,
 * dibujadas con las piezas de la sección (el ticket, el renglón con margen de cuaderno, el paso
 * numerado, el casillero y los puntitos de cuotas, el resultado del conteo) para que se parezcan
 * a la pantalla de verdad.
 *
 * Solo entran piezas que no cambian con el ancho de la VENTANA: el dibujo mide siempre lo mismo
 * (`MOCK_WIDTH`) y su alto está medido a mano. Una pieza con cortes `sm:` se vería distinta en la
 * compu y en el celular; por eso la pregunta de «Importar» y las tarjetas de «¿Cuándo le pagás?»
 * van dibujadas acá, y al paso numerado se le fija el aire (`STEP`).
 *
 * Los rótulos son los de la pantalla de HOY: salen de `SCREEN_LABELS`, `ACTION_TITLES` y
 * `launcher-items`, y un test comprueba que sigan escritos en el código de cada pantalla. Si una
 * pantalla cambia un nombre, se cambia acá en el mismo momento.
 *
 * Los datos son de ejemplo y neutros: ni el bar, ni su CUIT, ni nombres de personas, ni importes
 * que se parezcan a los de nadie (el marco los rotula «Ejemplo»). La plata se escribe en centavos
 * y se muestra con `lib/money`, como en la app.
 */

const L = SCREEN_LABELS

const money = (cents: number) => formatCentsShort(cents)
const digits = (cents: number) => formatCentsShort(cents, { currency: false })

const DAY = 'Mié 07/10'
/** Como lo escribe el botón del cierre: el día entero. */
const DAY_LONG = 'miércoles 07/10'
const SUPPLIER = 'Distribuidora del Centro'
const SHOP = 'Verdulería Los Álamos'

// ─── Lo que comparten varias escenas ─────────────────────────────────────────

/** El día de «hoy» de los dibujos: de ahí salen los «vencido hace N días» del margen. */
const TODAY = '2026-10-07'

/**
 * El aire de un paso numerado en una PÁGINA, fijo: sin esto `StepCard` se agranda desde `sm`
 * (el ancho de la ventana) y el dibujo mediría distinto en la compu que en el celular.
 */
const STEP = 'p-3.5 sm:p-3.5'
/** El mismo paso adentro de una HOJA: sin tarjeta propia, como en «Registrar un cobro». */
const SHEET_STEP = 'border-0 bg-transparent p-0 shadow-none before:hidden sm:p-0'

/** La pregunta de una hoja: en Fraunces, un escalón debajo del título. */
function Question({ children }: { children: ReactNode }) {
  return (
    <p className="font-serif text-[17px] leading-snug font-semibold tracking-tight">{children}</p>
  )
}

/** Una pregunta de la hoja con lo que se contesta debajo. */
function Asked({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Question>{label}</Question>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground text-pretty">{hint}</p> : null}
    </div>
  )
}

/** Las cajas para elegir, con su saldo al lado: la elegida, rellena. */
function TreasuryChips({
  items,
}: {
  items: ReadonlyArray<{ name: string; cents: number; active?: boolean }>
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.name}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap',
            // La elegida, en el verde del botón y sin tilde: como `TreasuryPicker`.
            item.active
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/70 bg-card text-foreground',
          )}
        >
          {item.name}
          <span className="font-normal tabular-nums opacity-75">{money(item.cents)}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * Una lista con margen de cuaderno, ocho píxeles más ancha de cada lado: así pasa los 20rem
 * desde los que el importe va al lado del nombre, como se ve en un celular.
 */
const WIDE_LEDGER = '-mx-2 w-auto'

/** Un link callado de la pantalla («Cambiar», «Es una nota de crédito»). */
function QuietLink({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground underline underline-offset-4">
      {children}
    </span>
  )
}

/** El importe de un renglón con margen, con su rótulo chico arriba («Le debés»). */
function RowAmount({ label, cents }: { label?: string; cents: number }) {
  return (
    <span className="block text-right">
      {label ? (
        <span className="block text-[11px] font-normal text-muted-foreground">{label}</span>
      ) : null}
      <span className="font-medium tabular-nums">{money(cents)}</span>
    </span>
  )
}

// ─── El lanzador ─────────────────────────────────────────────────────────────

/**
 * El lanzador «¿Qué querés cargar?», con la misma forma que el de verdad: lo de todos los días
 * arriba, en dos tarjetas grandes, y lo demás en renglones. Los textos, el orden y los dos grupos
 * salen de `launcher-items` (la fuente del lanzador): si cambia allá, cambia acá.
 */
function LauncherScene({ pick }: { pick: GuideLauncherKey }) {
  const { daily, sometimes } = launcherGroups()
  const group = 'px-4 text-[11px] font-medium text-muted-foreground'
  const card = (item: LauncherItem) => (
    <span className="flex h-full w-full flex-col gap-2 rounded-2xl border border-border/70 bg-card p-3 shadow-2xs">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <item.icon aria-hidden className="size-4" />
      </span>
      <span className="block font-serif text-[15px] leading-tight font-semibold tracking-tight">
        {item.title}
      </span>
      <span className="block text-[11px] leading-snug text-muted-foreground text-pretty">
        {item.hint}
      </span>
    </span>
  )
  const row = (item: LauncherItem) => (
    <span className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-foreground/80">
        <item.icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-pretty">{item.title}</span>
        <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
      </span>
    </span>
  )
  return (
    <MockCanvas>
      <div className="px-4 pt-4 pb-3">
        <p className="font-serif text-lg leading-tight font-semibold tracking-tight">
          {LAUNCHER_TITLE}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{LAUNCHER_DESCRIPTION}</p>
      </div>
      {daily.length > 0 ? (
        <>
          <p className={group}>{LAUNCHER_GROUPS.daily}</p>
          {/* Con aire arriba: ahí cae la etiqueta «Tocá acá» sin pisar el rótulo del grupo. */}
          <ul className="mt-4 grid grid-cols-2 gap-2 px-3">
            {daily.map((item) => (
              <li key={item.key} className="flex">
                {item.key === pick ? <Tap rounded="rounded-[18px]">{card(item)}</Tap> : card(item)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className={cn(group, 'mt-3')}>{LAUNCHER_GROUPS.sometimes}</p>
      <ul className="mx-3 mt-1.5 mb-3 space-y-0.5 rounded-2xl bg-secondary/50 p-1.5">
        {sometimes.map((item) => (
          // El renglón marcado lleva aire arriba y abajo: la etiqueta y el anillo no pisan el
          // texto del renglón de arriba ni el título del de abajo.
          <li key={item.key} className={item.key === pick ? 'pt-3 pb-2.5' : undefined}>
            {item.key === pick ? <Tap>{row(item)}</Tap> : row(item)}
          </li>
        ))}
      </ul>
    </MockCanvas>
  )
}

// ─── El cierre del día ───────────────────────────────────────────────────────

const SALES: ReadonlyArray<{
  key: string
  label: string
  goes: string
  cents: number
  icon: LucideIcon
}> = [
  { key: 'efectivo', label: 'Efectivo', goes: 'Entra a Caja', cents: 18_450_000, icon: Banknote },
  {
    key: 'qr',
    label: 'QR Mercado Pago',
    goes: 'Queda en camino',
    cents: 9_620_000,
    icon: QrCode,
  },
  {
    key: 'debito',
    label: 'Débito',
    goes: 'Llega el jue 08/10',
    cents: 7_130_000,
    icon: CreditCard,
  },
  {
    key: 'credito',
    label: 'Crédito',
    goes: 'Llega el sáb 17/10',
    cents: 5_800_000,
    icon: CreditCard,
  },
  {
    key: 'apps',
    label: 'Apps de delivery',
    goes: 'Llega el mié 21/10',
    cents: 4_200_000,
    icon: Bike,
  },
]
const SALES_TOTAL = SALES.reduce((sum, row) => sum + row.cents, 0)
const SALES_INVOICED = 31_000_000

function CloseMethodsScene() {
  return (
    <MockPage
      crumb="Ventas"
      title={L.cierre.title}
      aside={<StatusPill tone="muted">{DAY}</StatusPill>}
    >
      <p className="flex items-start gap-2 font-medium">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          1
        </span>
        <span className="pt-0.5">{L.cierre.methods}</span>
      </p>
      <ul className="space-y-2">
        {SALES.map((row, index) => {
          const input = (
            <MockInput mono className="justify-end">
              {money(row.cents)}
            </MockInput>
          )
          return (
            <li key={row.key} className="flex items-center gap-2.5">
              <MockIcon icon={row.icon} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.label}</span>
                <span className="block text-[11px] text-muted-foreground">{row.goes}</span>
              </span>
              <span className="w-[112px] shrink-0">
                {index === 0 ? (
                  <Tap label="Escribí acá" rounded="rounded-[12px]">
                    {input}
                  </Tap>
                ) : (
                  input
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t border-border/60 pt-3">
        <span className="text-xs text-muted-foreground">{L.cierre.total}</span>
        <span className="font-serif text-2xl leading-none font-semibold tracking-tight">
          {money(SALES_TOTAL)}
        </span>
      </div>
    </MockPage>
  )
}

function CloseTicketScene() {
  return (
    <MockCanvas className="px-4 py-4">
      <Ticket>
        <TicketHeader title={L.cierre.title} subtitle={DAY} />
        <TicketRule />
        {SALES.map((row) => (
          <TicketRow key={row.key} label={row.label} value={money(row.cents)} />
        ))}
        <TicketRule double />
        <TicketTotal label={L.cierre.total} value={money(SALES_TOTAL)} />
        <TicketRule />
        <TicketRow label={L.cierre.withInvoice} value={money(SALES_INVOICED)} />
        <TicketRow label={L.cierre.withoutInvoice} value={money(SALES_TOTAL - SALES_INVOICED)} />
      </Ticket>
      <div className="mt-auto pt-5">
        <Tap>
          <MockPrimary>
            {L.cierre.save} {DAY_LONG}
          </MockPrimary>
        </Tap>
      </div>
    </MockCanvas>
  )
}

// ─── El gasto ────────────────────────────────────────────────────────────────

const EXPENSE = 1_250_000
const RENT = 95_000_000
// Redondos a propósito: son de ejemplo y no tienen que parecerse al saldo de ningún bar.
const CASH_BEFORE = 28_650_000
const BANK_BEFORE = 218_000_000
// El IVA que trae adentro un total con 21 %.
const EXPENSE_VAT = Math.round((EXPENSE * 21) / 121)

function PaperChoice({ paper, tap }: { paper: PaperId; tap: boolean }) {
  const chosen = GUIDE_PAPERS.find((p) => p.id === paper)
  const grid = (
    <span className="grid w-full grid-cols-2 gap-2">
      {GUIDE_PAPERS.map((p) => {
        const active = p.id === paper
        return (
          <span
            key={p.id}
            className={cn(
              // Ajustado para que «Remito o nada» entre en un renglón también dentro de un paso.
              'relative flex items-center gap-1.5 rounded-xl border bg-card px-2 py-2 shadow-2xs',
              active ? 'border-primary bg-accent/50 ring-2 ring-primary/25' : 'border-border/70',
            )}
          >
            <PaperArt id={p.id} className="h-8 shrink-0" />
            <span className="min-w-0 text-xs leading-tight font-medium">{p.title}</span>
            {active ? (
              // En la esquina, montado sobre el borde: así no tapa el final del nombre.
              <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                <Check aria-hidden className="size-2.5" strokeWidth={3.5} />
              </span>
            ) : null}
          </span>
        )
      })}
    </span>
  )
  return (
    <span className="block w-full space-y-2">
      {tap ? <Tap label="Elegí acá">{grid}</Tap> : grid}
      {chosen ? (
        <span className="block text-[11px] text-muted-foreground text-pretty">{chosen.lead}</span>
      ) : null}
    </span>
  )
}

function ExpenseScene({
  focus,
  paper,
}: {
  focus: 'amount' | 'category' | 'paper'
  paper: PaperId
}) {
  // La receta del gasto fijo muestra el alquiler; las demás, una compra chica.
  const fixed = focus === 'category'
  const amount = fixed ? RENT : EXPENSE
  const amountField = <MockAmount>{digits(amount)}</MockAmount>
  // Desde «Pagar» en Gastos fijos, el gasto fijo ya viene elegido: no hay nada que tocar.
  const category = fixed ? (
    <Tap label="Ya viene elegido">
      <span className="flex w-full items-start justify-between gap-3 rounded-xl border border-border/70 bg-card/50 p-3">
        <span className="min-w-0">
          <span className="block font-medium">Alquiler</span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat aria-hidden className="size-3 shrink-0" />
            {L.gasto.fixedMark} «Alquiler» · venció el 05/10
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{L.gasto.pickOther}</span>
      </span>
    </Tap>
  ) : (
    <MockChips items={[{ label: 'Verduras y frutas', active: true, tick: true }]} />
  )
  return (
    <MockSheet title={ACTION_TITLES.gasto}>
      <MockField label={L.gasto.amount}>
        {focus === 'amount' ? <Tap label="Escribí acá">{amountField}</Tap> : amountField}
      </MockField>
      <MockField label={L.gasto.target}>{category}</MockField>
      <MockField
        label={L.gasto.treasury}
        hint={
          fixed
            ? `Banco: hoy ${money(BANK_BEFORE)} → queda ${money(BANK_BEFORE - amount)}`
            : `Caja: hoy ${money(CASH_BEFORE)} → queda ${money(CASH_BEFORE - amount)}`
        }
      >
        <MockChips
          items={[
            { label: 'Caja', active: !fixed },
            { label: 'Mercado Pago' },
            { label: 'Banco', active: fixed },
          ]}
        />
      </MockField>
      <MockField label={L.gasto.paper}>
        <PaperChoice paper={paper} tap={focus === 'paper'} />
        {paper === 'sin' ? (
          <span className="flex items-center gap-1 pt-0.5 text-xs font-medium text-primary">
            <Plus aria-hidden className="size-3.5" />
            {L.gasto.remito}
          </span>
        ) : null}
      </MockField>
    </MockSheet>
  )
}

function ExpenseTicketScene({ paper }: { paper: 'factura_a' | 'sin' }) {
  const invoiced = paper === 'factura_a'
  return (
    <MockSheet
      title={ACTION_TITLES.gasto}
      footer={
        <>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-4 rounded-[5px] border-2 border-border bg-card" />
            {L.gasto.another}
          </span>
          <Tap>
            <MockPrimary>
              {L.gasto.save} · {money(EXPENSE)}
            </MockPrimary>
          </Tap>
        </>
      }
    >
      <Ticket>
        <TicketHeader title={SHOP} subtitle={`${DAY} · Verduras y frutas`}>
          <TicketStamp tone={invoiced ? 'factura' : 'sin'}>
            {invoiced ? L.gasto.stampA : L.gasto.stampNone}
          </TicketStamp>
        </TicketHeader>
        <TicketRule />
        {invoiced ? (
          <>
            <TicketRow label={L.gasto.ticketNet} value={money(EXPENSE - EXPENSE_VAT)} />
            <TicketRow label="IVA 21 %" hint={L.gasto.ticketVat} value={money(EXPENSE_VAT)} />
            <TicketRule double />
          </>
        ) : null}
        <TicketTotal label={`${L.gasto.ticketTotal} Caja`} value={money(EXPENSE)} />
        <TicketNote>{invoiced ? L.gasto.noteA : L.gasto.noteNone}</TicketNote>
      </Ticket>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ChevronRight aria-hidden className="size-3.5" />
        {L.gasto.books}
      </p>
    </MockSheet>
  )
}

// ─── La compra que queda a pagar ─────────────────────────────────────────────

const INVOICE_1 = 8_400_000
const INVOICE_2 = 4_250_000
const DELIVERY_NOTE = 1_800_000
/** Lo que ya se le debía al proveedor del ejemplo antes de esta compra. */
const OWED_BEFORE = INVOICE_2

/** Una de las dos respuestas de «¿Cuándo le pagás?»: el dibujo, el título y lo que pasa. */
function PayWhenCard({
  icon: Icon,
  title,
  note,
  active = false,
}: {
  icon: LucideIcon
  title: string
  note: string
  active?: boolean
}) {
  return (
    <span
      className={cn(
        'relative flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 shadow-2xs',
        active ? 'border-primary bg-accent/50 ring-2 ring-primary/25' : 'border-border/70',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1 pr-5">
        <span className="block font-medium leading-tight">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground text-pretty">{note}</span>
      </span>
      {active ? (
        <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check aria-hidden className="size-2.5" strokeWidth={3.5} />
        </span>
      ) : (
        <span className="absolute top-2 right-2 size-4 rounded-full border-2 border-border bg-card" />
      )}
    </span>
  )
}

/**
 * «Cargar una compra que debo», en dos mitades (entera no entra en un celular): arriba, a quién
 * y qué papel; abajo, cuánto es, cuándo le pagás y el botón, que dice el importe.
 */
function PurchaseScene({ paper, part }: { paper: 'factura' | 'remito'; part: 'paper' | 'pay' }) {
  const invoiced = paper === 'factura'
  const total = invoiced ? INVOICE_1 : DELIVERY_NOTE

  if (part === 'paper') {
    return (
      <MockPage crumb="Compras y pagos" title={L.compra.title}>
        <StepCard open n={1} state="done" title={L.compra.who} className={STEP}>
          <div className="flex items-start justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
            <p className="min-w-0">
              <span className="block font-medium">{SUPPLIER}</span>
              <span className="mt-0.5 block text-xs">
                {L.compra.owedToday}{' '}
                <span className="font-semibold tabular-nums">{money(OWED_BEFORE)}</span>
              </span>
            </p>
            <QuietLink>{L.compra.change}</QuietLink>
          </div>
        </StepCard>
        <StepCard open n={2} state="current" title={L.compra.paper} className={STEP}>
          <div className="space-y-3.5">
            <PaperChoice paper={invoiced ? 'factura_a' : 'sin'} tap />
            {invoiced ? (
              <MockField label={L.compra.number}>
                <MockInput mono>0003 – 00001290</MockInput>
              </MockField>
            ) : (
              <MockField label={L.compra.remito}>
                <MockInput mono>0001-00000412</MockInput>
              </MockField>
            )}
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              {L.compra.notPurchase}
              <QuietLink>{L.compra.creditNote}</QuietLink>
              <QuietLink>{L.compra.debitNote}</QuietLink>
            </p>
          </div>
        </StepCard>
      </MockPage>
    )
  }

  return (
    <MockPage
      crumb="Compras y pagos"
      title={L.compra.title}
      footer={
        <Tap>
          <MockPrimary className="rounded-full">
            {L.compra.save} · {money(total)}
          </MockPrimary>
        </Tap>
      }
    >
      <StepCard open n={3} state="done" title={L.compra.amount} className={STEP}>
        <MockField label={L.compra.total}>
          <MockAmount>{digits(total)}</MockAmount>
        </MockField>
      </StepCard>
      <StepCard open n={4} state="current" title={L.compra.payWhen} className={STEP}>
        <div className="space-y-3.5">
          <span className="grid gap-2">
            <PayWhenCard
              active
              icon={CalendarClock}
              title={L.compra.payLater}
              note={L.compra.payLaterNote}
            />
            <PayWhenCard icon={HandCoins} title={L.compra.paidNow} note={L.compra.paidNowNote} />
          </span>
          <MockField label={L.compra.due}>
            <MockChips
              items={[
                { label: L.compra.dueSameDay },
                { label: 'En 7 días' },
                { label: 'En 15 días', active: true },
                { label: 'En 30 días' },
              ]}
            />
          </MockField>
        </div>
      </StepCard>
    </MockPage>
  )
}

// ─── Pagar ───────────────────────────────────────────────────────────────────

/** Los proveedores a los que se les debe, del más atrasado al que vence más lejos. */
const OWED: ReadonlyArray<{ name: string; due: string; cents: number }> = [
  { name: SUPPLIER, due: '2026-09-25', cents: INVOICE_1 + INVOICE_2 + DELIVERY_NOTE },
  { name: 'Frigorífico del Sur', due: '2026-10-09', cents: 6_120_000 },
  { name: SHOP, due: '2026-10-28', cents: 2_350_000 },
]

/** Las compras sin pagar del proveedor elegido: cada una con su vencimiento y su tilde. */
const DEBTS: ReadonlyArray<{
  key: string
  label: string
  due: string
  cents: number
  on: boolean
}> = [
  { key: 'a', label: 'Factura A 0003-00001290', due: '2026-09-25', cents: INVOICE_1, on: true },
  { key: 'b', label: 'Factura A 0003-00001302', due: '2026-10-09', cents: INVOICE_2, on: true },
  { key: 'c', label: 'Remito 0001-00000412', due: '2026-10-30', cents: DELIVERY_NOTE, on: false },
]

/** El tilde de un renglón que se elige tocándolo. */
function TickMark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2',
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-transparent',
      )}
    >
      <Check aria-hidden className="size-3.5" strokeWidth={3.25} />
    </span>
  )
}

function PayScene({ part }: { part: 'who' | 'what' }) {
  if (part === 'who') {
    return (
      <MockSheet title={ACTION_TITLES.pagar} description={L.pagar.description}>
        <Asked label={L.pagar.who}>
          <p className="text-[11px] font-medium text-muted-foreground">{L.pagar.urgent}</p>
          <Tap label="Elegí acá" rounded="rounded-[20px]" className={WIDE_LEDGER}>
            <LedgerList aria-label={L.pagar.urgent} className="w-full">
              {OWED.map((row) => (
                <LedgerRow
                  key={row.name}
                  rail={<LedgerRail {...dueRail(row.due, TODAY)} />}
                  title={row.name}
                  amount={
                    <span className="flex items-center gap-1">
                      <RowAmount label={L.pagar.owes} cents={row.cents} />
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </span>
                  }
                />
              ))}
            </LedgerList>
          </Tap>
          <p className="pt-1 text-[11px] font-medium text-muted-foreground">{L.pagar.search}</p>
          <span className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground shadow-2xs">
            <span className="min-w-0 flex-1 truncate">Elegí un proveedor</span>
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </span>
        </Asked>
        <Asked label={L.pagar.notSupplier}>
          <span className="flex items-center gap-2.5 rounded-xl bg-secondary/50 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-accent-foreground shadow-2xs">
              <Repeat aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1 font-medium">{L.pagar.fixed}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </span>
        </Asked>
      </MockSheet>
    )
  }

  const paying = DEBTS.filter((d) => d.on).reduce((sum, d) => sum + d.cents, 0)
  const all = DEBTS.reduce((sum, d) => sum + d.cents, 0)
  return (
    <MockSheet
      title={`${ACTION_TITLES.pagar} a ${SUPPLIER}`}
      description={L.pagar.description}
      footer={
        <Tap>
          <MockPrimary>
            {ACTION_TITLES.pagar} {money(paying)}
          </MockPrimary>
        </Tap>
      }
    >
      <Asked label={L.pagar.invoices}>
        <MockChips
          items={[
            { label: `${L.pagar.overdue} ${money(INVOICE_1)}` },
            { label: `${L.pagar.all} ${money(all)}` },
          ]}
        />
        <LedgerList aria-label="Compras sin pagar" className={WIDE_LEDGER}>
          {DEBTS.map((d) => (
            <LedgerRow
              key={d.key}
              rail={<LedgerRail {...dueRail(d.due, TODAY)} />}
              tint={d.on ? 'ok' : undefined}
              title={
                <span className="inline-flex items-start gap-2">
                  <TickMark on={d.on} />
                  <span>{d.label}</span>
                </span>
              }
              amount={<RowAmount cents={d.cents} />}
            />
          ))}
        </LedgerList>
      </Asked>
      <Asked
        label={L.pagar.treasury}
        hint={`Banco: hoy ${money(BANK_BEFORE)} → queda ${money(BANK_BEFORE - paying)}`}
      >
        <TreasuryChips
          items={[
            { name: 'Banco', cents: BANK_BEFORE, active: true },
            { name: 'Caja', cents: CASH_BEFORE },
          ]}
        />
      </Asked>
    </MockSheet>
  )
}

// ─── Me entró plata ──────────────────────────────────────────────────────────

const SALE_MONDAY = 7_130_000
const SALE_TUESDAY = 6_480_000
const DEDUCTIONS = 245_000
const COLLECTED = SALE_MONDAY + SALE_TUESDAY - DEDUCTIONS

/**
 * «Registrar un cobro», en dos mitades (entera no entra en un celular): `amount` = quién te pagó,
 * cuánto te entró y a dónde · `sales` = de qué ventas es y qué te descontaron.
 */
function CollectScene({ part }: { part: 'amount' | 'sales' }) {
  const who = (
    <StepCard
      open
      n={1}
      state="done"
      className={SHEET_STEP}
      title={L.cobrar.who}
      summary={`Tarjetas de débito · te debe ${money(SALE_MONDAY + SALE_TUESDAY)}`}
    />
  )
  const save = (
    <MockPrimary>
      {L.cobrar.save} · entraron {money(COLLECTED)}
    </MockPrimary>
  )

  if (part === 'amount') {
    return (
      <MockSheet title={ACTION_TITLES.cobrar} footer={save}>
        {who}
        <div className="border-t border-border/60 pt-4">
          <StepCard open n={2} state="current" className={SHEET_STEP} title={L.cobrar.step}>
            <div className="space-y-3.5">
              <MockField label={L.cobrar.amount}>
                <Tap label="Escribí acá">
                  <MockAmount>{digits(COLLECTED)}</MockAmount>
                </Tap>
              </MockField>
              <MockField
                label={L.cobrar.into}
                hint={`Banco: hoy ${money(BANK_BEFORE)} → queda ${money(BANK_BEFORE + COLLECTED)}`}
              >
                <TreasuryChips
                  items={[
                    { name: 'Banco', cents: BANK_BEFORE, active: true },
                    { name: 'Caja', cents: CASH_BEFORE },
                  ]}
                />
              </MockField>
              <MockField label={L.cobrar.day}>
                <MockInput>06/10/2026</MockInput>
              </MockField>
            </div>
          </StepCard>
        </div>
        <div className="border-t border-border/60 pt-4">
          <StepCard open n={3} state="todo" className={SHEET_STEP} title={L.cobrar.sales} />
        </div>
      </MockSheet>
    )
  }

  return (
    <MockSheet title={ACTION_TITLES.cobrar} footer={save}>
      {who}
      <div className="border-t border-border/60 pt-4">
        <StepCard
          open
          n={2}
          state="done"
          className={SHEET_STEP}
          title={L.cobrar.step}
          summary={`${money(COLLECTED)} a Banco · mar 06/10`}
        />
      </div>
      <div className="border-t border-border/60 pt-4">
        <StepCard open n={3} state="current" className={SHEET_STEP} title={L.cobrar.sales}>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">{L.cobrar.pending}</p>
              <Tap label="Tildá acá">
                <span className="block w-full space-y-1.5">
                  <MockCheckRow
                    checked
                    title="Débito · 04/10"
                    meta={<span className="text-muted-foreground">tenía que llegar el 05/10</span>}
                    amount={money(SALE_MONDAY)}
                  />
                  <MockCheckRow
                    checked
                    title="Débito · 05/10"
                    meta={<span className="text-muted-foreground">tenía que llegar el 06/10</span>}
                    amount={money(SALE_TUESDAY)}
                  />
                </span>
              </Tap>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-serif text-lg leading-tight font-semibold tracking-tight">
              <span>
                {L.cobrar.discounted} <span className="tabular-nums">{money(DEDUCTIONS)}</span>{' '}
                <span className="font-sans text-xs font-normal text-muted-foreground">(1,8 %)</span>
              </span>
              <StatusPill tone="muted" className="font-sans">
                {L.cobrar.estimated}
              </StatusPill>
            </p>
            <MockField label={L.cobrar.deductions}>
              <span className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-2xs">
                <span>Comisión</span>
                <span className="tabular-nums">{money(DEDUCTIONS)}</span>
              </span>
            </MockField>
          </div>
        </StepCard>
      </div>
    </MockSheet>
  )
}

// ─── Contar la caja ──────────────────────────────────────────────────────────

const CASH_COUNTED = 28_500_000

/**
 * «¿Coincide la caja?», en sus tres renglones: qué caja, lo que dice el sistema y lo que hay de
 * verdad. El resultado es la pieza de la hoja (`Verdict`) con sus palabras de verdad: falta en
 * ámbar, nunca en rojo.
 */
function CountScene() {
  const verdict = countVerdict({
    mode: 'cash',
    name: 'Caja',
    diff: CASH_COUNTED - CASH_BEFORE,
    countedCents: CASH_COUNTED,
    ticked: 0,
    pendingTicked: 0,
  })
  return (
    <MockSheet
      title={L.ajustar.title}
      description={L.ajustar.description}
      footer={<MockPrimary>{countSubmitLabel('adjust', 0)}</MockPrimary>}
    >
      <Asked label={L.ajustar.treasury}>
        <TreasuryChips
          items={[
            { name: 'Caja', cents: CASH_BEFORE, active: true },
            { name: 'Mercado Pago', cents: 9_620_000 },
            { name: 'Banco', cents: BANK_BEFORE },
          ]}
        />
      </Asked>
      <div className="rounded-xl bg-secondary/50 px-3.5 py-3">
        <p className="flex items-baseline justify-between gap-3">
          <span className="font-medium">{L.ajustar.book}</span>
          <span className="font-serif text-xl leading-none font-semibold tracking-tight tabular-nums">
            {money(CASH_BEFORE)}
          </span>
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {L.ajustar.loaded} {L.ajustar.never}
        </p>
      </div>
      <Asked label={L.ajustar.counted}>
        <Tap label="Escribí acá">
          <MockAmount>{digits(CASH_COUNTED)}</MockAmount>
        </Tap>
      </Asked>
      <Verdict verdict={verdict} />
    </MockSheet>
  )
}

// ─── Importar ────────────────────────────────────────────────────────────────

const MP_ROWS: ReadonlyArray<{
  key: string
  month: string
  day: string
  label: string
  cents: number
  fee: number
}> = [
  { key: 'a', month: 'oct', day: '05', label: 'QR', cents: 9_620_000, fee: 115_000 },
  { key: 'b', month: 'oct', day: '05', label: 'Transferencia', cents: 3_840_000, fee: 31_000 },
  { key: 'c', month: 'oct', day: '06', label: 'QR', cents: 8_890_000, fee: 106_000 },
]

/** La subida de un archivo, con sus tres pasos: el primero hecho, el segundo abierto. */
function ImportUploadScene({ source }: { source: 'mercado_pago' | 'arca' }) {
  const arca = source === 'arca'
  return (
    <MockPage crumb="Importar" title={arca ? L.importar.titleArca : L.importar.titleMercadoPago}>
      <StepCard
        n={1}
        state="done"
        keepMounted={false}
        title={arca ? L.importar.stepGetArca : L.importar.stepGetMercadoPago}
        summary={arca ? 'Pedí septiembre' : 'Pedí del 05/10 al 06/10'}
      />
      <StepCard n={2} state="current" title={L.importar.stepUpload} className={STEP}>
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-border bg-card/60 px-3 py-5 text-center">
          <MockIcon icon={FileUp} className="size-10" />
          <p className="mt-2.5 font-serif text-base leading-snug font-semibold tracking-tight text-balance">
            {arca ? L.importar.dropArca : L.importar.dropMercadoPago}
          </p>
          <span className="mt-4 inline-flex">
            <Tap className="w-auto" rounded="rounded-[12px]">
              <MockSecondary>{L.importar.choose}</MockSecondary>
            </Tap>
          </span>
        </div>
      </StepCard>
      <StepCard n={3} state="todo" keepMounted={false} title={L.importar.stepReview} />
      <p className="text-[11px] text-muted-foreground text-pretty">{L.importar.promise}</p>
    </MockPage>
  )
}

/** El número de arriba de la revisión y la pila del archivo, una hojita por comprobante. */
function ReviewHead({
  source,
  tally,
  readyCents,
}: {
  source: 'mp_release' | 'arca_recibidos'
  tally: { questions: number; ready: number; already: number }
  readyCents: number
}) {
  const full = { ...tally, posted: 0, out: 0, total: tally.questions + tally.ready + tally.already }
  const hero = reviewHero({ source, tally: full, readyCents })
  const sheets = (group: 'ready' | 'questions' | 'already', n: number) =>
    Array.from({ length: n }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: hojitas iguales de un mismo grupo
      <PileSheet key={`${group}-${i}`} group={group} className="h-[26px] w-5" />
    ))
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3.5 py-3 shadow-2xs">
      {hero.label ? (
        <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {hero.label}
        </p>
      ) : null}
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-2 font-serif leading-none font-semibold tracking-tight">
          <span className="text-4xl">{hero.value}</span>
          {hero.unit ? (
            <span className="font-sans text-xs font-medium tracking-normal text-muted-foreground">
              {hero.unit}
            </span>
          ) : null}
        </p>
        <span aria-hidden className="flex gap-1 pb-0.5">
          {sheets('ready', tally.ready)}
          {sheets('questions', tally.questions)}
          {sheets('already', tally.already)}
        </span>
      </div>
    </div>
  )
}

/** El estado de una hoja del archivo, con las palabras de la revisión. */
function ProposalPill({ status, reason }: { status: 'ready' | 'skipped'; reason?: string }) {
  const badge = proposalBadge(status, reason)
  return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
}

function ImportReviewScene({ source }: { source: 'mercado_pago' | 'arca' }) {
  if (source === 'mercado_pago') {
    return (
      <MockPage
        crumb="Importar"
        title={reviewTitle({
          source: 'mp_release',
          stage: 'pending',
          periodFrom: '2026-10-05',
          periodTo: '2026-10-06',
        })}
        footer={
          <Tap>
            <MockPrimary>Cargar {MP_ROWS.length} movimientos</MockPrimary>
          </Tap>
        }
      >
        <ReviewHead
          source="mp_release"
          tally={{ questions: 0, ready: MP_ROWS.length, already: 0 }}
          readyCents={0}
        />
        <LedgerList aria-label="Listos para cargar" className={WIDE_LEDGER}>
          {MP_ROWS.map((row) => (
            <LedgerRow
              key={row.key}
              rail={<LedgerRail label={row.month} value={row.day} />}
              title={row.label}
              meta={`Comisión e impuestos ${money(row.fee)}`}
              amount={
                <span className="flex flex-col items-end gap-1">
                  <ProposalPill status="ready" />
                  <span className="tabular-nums">{money(row.cents)}</span>
                </span>
              }
            />
          ))}
        </LedgerList>
      </MockPage>
    )
  }
  return (
    <MockPage
      crumb="Importar"
      title={reviewTitle({
        source: 'arca_recibidos',
        stage: 'pending',
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
      })}
    >
      <ReviewHead
        source="arca_recibidos"
        tally={{ questions: 1, ready: 1, already: 1 }}
        readyCents={INVOICE_2}
      />
      {/* La pregunta en la mano: el riel ámbar dice que espera una respuesta. */}
      <div className="relative rounded-2xl border border-border/70 bg-card py-3.5 pr-3.5 pl-[18px] shadow-2xs">
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-l-2xl bg-warning" />
        <p className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Pregunta 1 de 1
        </p>
        <p className="mt-1 font-serif text-lg leading-snug font-semibold tracking-tight">
          {L.importar.sameOrOther}
        </p>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          Ya cargaste Factura B 0002-00000871 con el mismo proveedor y el mismo total.
        </p>
        <span className="mt-3.5 flex flex-col gap-2.5">
          <Tap rounded="rounded-[12px]">
            <MockSecondary className="h-11 w-full">{L.importar.same}</MockSecondary>
          </Tap>
          <MockSecondary className="h-11">{L.importar.different}</MockSecondary>
        </span>
      </div>
      {/* El importe arriba, en la línea del título, como en la revisión de verdad; el estado
          debajo. Con aire abajo: el renglón no queda pegado al borde del dibujo. */}
      <LedgerList aria-label="No se cargan" className={WIDE_LEDGER}>
        <LedgerRow
          rail={<LedgerRail label="sep" value="14" />}
          title="Factura A 0003-00001290"
          meta={
            <>
              <span className="block">{SUPPLIER}</span>
              <span className="mt-1.5 flex">
                <ProposalPill status="skipped" reason="already_loaded" />
              </span>
            </>
          }
          amount={money(INVOICE_1)}
        />
      </LedgerList>
    </MockPage>
  )
}

// ─── Corregir ────────────────────────────────────────────────────────────────

/** Unos renglones grises: «la pantalla donde estabas», sin distraer. */
function FadedRows({ count }: { count: number }) {
  return (
    <span className="block space-y-2 opacity-60">
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: renglones de relleno, todos iguales
          key={i}
          className="flex h-11 items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3"
        >
          <span className="h-2 w-24 rounded-full bg-muted-foreground/25" />
          <span className="ml-auto h-2 w-12 rounded-full bg-muted-foreground/25" />
        </span>
      ))}
    </span>
  )
}

function UndoScene() {
  return (
    <MockCanvas>
      <div className="flex-1 px-4 pt-4">
        <FadedRows count={3} />
      </div>
      <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-lg">
        <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
        <p className="min-w-0 flex-1">
          <span className="block font-medium">
            {L.gasto.saved} · {money(EXPENSE)}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">{SHOP} · Caja</span>
        </p>
        <Tap className="w-auto shrink-0" rounded="rounded-[11px]">
          <MockSecondary className="h-9">Deshacer</MockSecondary>
        </Tap>
      </div>
    </MockCanvas>
  )
}

function VoidScene() {
  return (
    <MockCanvas className="relative">
      <div className="px-4 pt-4">
        <p className="text-[11px] text-muted-foreground">Compras y pagos › Comprobantes</p>
        <p className="mt-0.5 font-serif text-xl leading-tight font-semibold tracking-tight">
          Factura A 0003-00001290
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {SUPPLIER} · {money(INVOICE_1)}
        </p>
      </div>
      <div className="px-4 pt-4">
        <FadedRows count={4} />
      </div>
      {/* El velo oscurece en los dos temas (con `foreground` aclaraba en oscuro). */}
      <span className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-x-3 top-[5.25rem] space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xl">
        <p className="font-serif text-base leading-snug font-semibold tracking-tight">
          ¿Anulás Factura A 0003-00001290?
        </p>
        <p className="text-xs text-muted-foreground text-pretty">
          {L.comprobante.voidNote} libros.
        </p>
        <MockField label="Motivo">
          <MockInput>Cargué mal el importe</MockInput>
        </MockField>
        <span className="flex justify-end gap-2.5 pt-1">
          <MockSecondary>{L.comprobante.cancel}</MockSecondary>
          <Tap className="w-auto" rounded="rounded-[12px]">
            <span className="flex h-10 items-center justify-center rounded-lg bg-destructive px-4 text-[13px] font-semibold text-destructive-foreground">
              {L.comprobante.void}
            </span>
          </Tap>
        </span>
      </div>
    </MockCanvas>
  )
}

// ─── Fin de mes · gastos fijos ───────────────────────────────────────────────

const REVIEW_ROWS: ReadonlyArray<{
  key: string
  title: string
  icon: LucideIcon
  /** El aviso de ese renglón, si tiene. */
  notice?: string
}> = [
  { key: 'closes', title: L.cierreMes.closes, icon: CalendarCheck },
  { key: 'purchases', title: L.cierreMes.purchases, icon: ReceiptText },
  {
    key: 'money',
    title: L.cierreMes.money,
    icon: Wallet,
    notice: `${L.cierreMes.uncounted} septiembre`,
  },
  { key: 'papers', title: L.cierreMes.papers, icon: Landmark },
]

/** «Fin de mes»: el año en pestañas y los tres pasos, con el primero abierto. */
function MonthCloseScene() {
  return (
    <MockPage crumb="Libros" title={L.cierreMes.title}>
      <MonthStrip
        months={[
          { key: '2026-09', label: 'Sep', state: 'to_close', selected: true },
          { key: '2026-10', label: 'Oct', state: 'current' },
          { key: '2026-11', label: 'Nov', state: 'future' },
          { key: '2026-12', label: 'Dic', state: 'future' },
        ]}
      />
      <StepCard open n={1} state="current" title={L.cierreMes.review} className={STEP}>
        <Tap label="Mirá acá">
          {/* Aire arriba adentro del anillo: la etiqueta queda sobre el borde, no sobre la
              píldora del primer renglón. */}
          <ul className="w-full divide-y divide-border/60 pt-2.5">
            {REVIEW_ROWS.map((row) => (
              <li key={row.key} className="py-2 first:pt-0 last:pb-0">
                <p className="flex items-center gap-2.5">
                  <MockIcon icon={row.icon} className="size-7" />
                  <span className="min-w-0 flex-1 font-medium">{row.title}</span>
                  {row.notice ? (
                    <StatusPill tone="warn">1 aviso</StatusPill>
                  ) : (
                    <StatusPill tone="ok" icon={Check}>
                      {L.cierreMes.noNotices}
                    </StatusPill>
                  )}
                </p>
                {row.notice ? (
                  <p className="mt-1 pl-[38px] text-xs text-muted-foreground">{row.notice}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Tap>
      </StepCard>
      <StepCard open n={2} state="todo" title="Cerrá septiembre" className={STEP}>
        <MockSecondary className="h-11 w-full rounded-full">Cerrar septiembre</MockSecondary>
      </StepCard>
      <StepCard
        open
        n={3}
        state="todo"
        title={L.cierreMes.send}
        summary={L.cierreMes.sendWhen}
        className={STEP}
      />
    </MockPage>
  )
}

const LIGHT = 18_000_000
const FRIDGE = 12_000_000

/** El «Pagar» de un renglón de la planilla: el botón chico de contorno, como el de verdad. */
function RowPay() {
  return (
    <span className="flex h-8 items-center rounded-full border border-border bg-card px-3.5 text-xs font-medium shadow-2xs">
      {L.gastosFijos.pay}
    </span>
  )
}

/** Un renglón de la planilla: el casillero, el nombre y el monto; debajo, cómo va y su «Pagar». */
function FixedRow({
  tick,
  name,
  cents,
  status,
  dots,
  pay = false,
}: {
  tick: TickState
  name: string
  cents: number
  /** Cómo va, en palabras: una píldora si es un estado, texto gris si es solo una fecha. */
  status: ReactNode
  dots?: ReactNode
  pay?: boolean
}) {
  return (
    <span className="flex w-full items-start gap-2.5 px-3 py-2.5">
      <TickBox state={tick} label="" className="mt-0.5 size-5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{name}</span>
          <span className="shrink-0 font-medium tabular-nums">{money(cents)}</span>
        </span>
        <span className="mt-1 flex min-h-8 items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            {dots}
            {status}
          </span>
          {pay ? <RowPay /> : null}
        </span>
      </span>
    </span>
  )
}

/** La línea de un día, como la planilla en un celular: «Lun 5 oct · 1 gasto · $ 950.000». */
function FixedBand({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'border-b border-border/60 bg-secondary/40 px-3 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </p>
  )
}

/**
 * La planilla de gastos fijos como se ve en un celular: cuánto falta este mes y, adentro, «Lo que
 * sigue» con el botón grande del que vence primero; debajo, los renglones agrupados por el día,
 * cada uno con su casillero, su monto, sus puntitos si es en cuotas y su «Pagar». `due`: el
 * alquiler vencido, con «Tocá acá» en el botón grande · `paid`: el alquiler ya tildado y «Lo que
 * sigue» nombrando la luz.
 */
function FixedScene({ state }: { state: 'due' | 'paid' }) {
  const paid = state === 'paid'
  const total = RENT + LIGHT + FRIDGE
  const left = paid ? LIGHT + FRIDGE : total
  const nextPay = (
    <MockPrimary className="mt-2.5 h-11">{`${L.gastosFijos.pay} ${money(paid ? LIGHT : RENT)}`}</MockPrimary>
  )
  const rent = (
    <FixedRow
      tick={paid ? 'done' : 'empty'}
      name="Alquiler"
      cents={RENT}
      status={
        paid ? (
          <StatusPill tone="ok">{L.gastosFijos.paid} 07/10</StatusPill>
        ) : (
          <StatusPill tone="late">Venció hace 2 días</StatusPill>
        )
      }
      pay={!paid}
    />
  )
  return (
    <MockPage crumb="Administración" title={L.gastosFijos.title}>
      <div className="rounded-2xl border border-border/70 bg-card px-3.5 py-3 shadow-2xs">
        <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {L.gastosFijos.pending} · octubre
        </p>
        <p className="mt-1 font-serif text-3xl leading-none font-semibold tracking-tight">
          {money(left)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground text-pretty">
          {paid
            ? `Pagaste ${money(RENT)} de ${money(total)}. Te faltan 2.`
            : `Son 3 gastos de octubre. 1 ya venció: ${money(RENT)}.`}
        </p>
        <div className="mt-3 rounded-xl bg-secondary/50 p-3">
          <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {L.gastosFijos.next}
          </p>
          <p className="mt-1 font-serif text-[17px] leading-snug font-semibold tracking-tight">
            {paid ? 'Luz' : 'Alquiler'}
          </p>
          <p className="mt-1 flex items-center text-[11px] text-muted-foreground">
            {paid ? (
              'Vence el jueves 15/10'
            ) : (
              <StatusPill tone="late">Venció hace 2 días</StatusPill>
            )}
          </p>
          {paid ? nextPay : <Tap rounded="rounded-[14px]">{nextPay}</Tap>}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Después: {paid ? 'Heladera.' : 'Luz y 1 más.'}
          </p>
        </div>
      </div>
      {/* Sin `overflow-hidden`: el anillo de «Quedó pago» se sale del renglón y no se recorta. */}
      <div className="rounded-2xl border border-border/70 bg-card shadow-2xs">
        <FixedBand className="rounded-t-2xl">Lun 5 oct · 1 gasto · {money(RENT)}</FixedBand>
        {paid ? (
          // Con aire alrededor: el anillo no pisa las líneas de los días ni el borde.
          <span className="block px-2 py-2.5">
            <Tap label="Quedó pago" rounded="rounded-[12px]">
              {rent}
            </Tap>
          </span>
        ) : (
          rent
        )}
        <FixedBand>Jue 15 oct · 2 gastos · {money(LIGHT + FRIDGE)}</FixedBand>
        <span className="block divide-y divide-border/60">
          <FixedRow
            tick="empty"
            name="Luz"
            cents={LIGHT}
            status={<span>Vence el jueves 15/10</span>}
            pay
          />
          <FixedRow
            tick="empty"
            name="Heladera"
            cents={FRIDGE}
            dots={<InstallmentDots current={2} total={6} remaining={5} />}
            status={<span>cuota 2 de 6</span>}
            pay
          />
        </span>
      </div>
    </MockPage>
  )
}

// ─── La pantalla de cada escena ──────────────────────────────────────────────

/**
 * El alto del dibujo de cada escena, en px (lo que no entra se recorta). Están medidos sobre el
 * dibujo ya renderizado; si una escena cambia de contenido, hay que volver a medirla.
 */
function sceneHeight(scene: GuideScene): number {
  switch (scene.kind) {
    case 'launcher':
      // El renglón de «Cada tanto» marcado lleva 22 px de aire (ver `LauncherScene`).
      return launcherGroups().daily.some((item) => item.key === scene.pick) ? 582 : 604
    case 'close':
      return scene.part === 'methods' ? 416 : 496
    case 'expense':
      if (scene.focus === 'category') return 556
      return scene.paper === 'sin' ? 532 : 510
    case 'expense-ticket':
      return scene.paper === 'factura_a' ? 552 : 456
    case 'purchase':
      if (scene.part === 'pay') return 662
      return scene.paper === 'remito' ? 590 : 574
    case 'pay':
      return scene.part === 'who' ? 554 : 572
    case 'collect':
      return scene.part === 'amount' ? 616 : 664
    case 'count':
      return 612
    case 'import':
      if (scene.phase === 'upload') return 552
      return scene.source === 'arca' ? 558 : 536
    case 'undo':
      return 262
    case 'void':
      return 372
    case 'month-close':
      return 698
    case 'fixed':
      return scene.state === 'due' ? 640 : 652
  }
}

function Scene({ scene }: { scene: GuideScene }) {
  switch (scene.kind) {
    case 'launcher':
      return <LauncherScene pick={scene.pick} />
    case 'close':
      return scene.part === 'methods' ? <CloseMethodsScene /> : <CloseTicketScene />
    case 'expense':
      return <ExpenseScene focus={scene.focus} paper={scene.paper} />
    case 'expense-ticket':
      return <ExpenseTicketScene paper={scene.paper} />
    case 'purchase':
      return <PurchaseScene paper={scene.paper} part={scene.part} />
    case 'pay':
      return <PayScene part={scene.part} />
    case 'collect':
      return <CollectScene part={scene.part} />
    case 'count':
      return <CountScene />
    case 'import':
      return scene.phase === 'upload' ? (
        <ImportUploadScene source={scene.source} />
      ) : (
        <ImportReviewScene source={scene.source} />
      )
    case 'undo':
      return <UndoScene />
    case 'void':
      return <VoidScene />
    case 'month-close':
      return <MonthCloseScene />
    case 'fixed':
      return <FixedScene state={scene.state} />
  }
}

/** El dibujo solo, en su lienzo (para probarlo o mirarlo fuera del marco). */
export function GuideScenePreview({ scene }: { scene: GuideScene }) {
  return (
    <div style={{ width: MOCK_WIDTH, height: sceneHeight(scene) }} className="overflow-hidden">
      <Scene scene={scene} />
    </div>
  )
}

/**
 * Una pantalla simulada, con su marco. El marco dice «Ejemplo» y nada más: los rótulos son los de
 * la pantalla de hoy (por eso ya no lleva «Puede verse distinto») y los importes son inventados.
 */
export function GuideMock({ screen }: { screen: GuideScreen }) {
  return (
    <ScaledMock
      width={MOCK_WIDTH}
      height={sceneHeight(screen.scene)}
      label={screen.label}
      frameLabel="Ejemplo"
      surfaceClassName="bg-background"
    >
      <Scene scene={screen.scene} />
    </ScaledMock>
  )
}
