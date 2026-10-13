import {
  Banknote,
  Bike,
  Check,
  ChevronRight,
  CircleCheck,
  CreditCard,
  type LucideIcon,
  QrCode,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { ACTION_TITLES } from '@/components/administracion/acciones/types'
import { ScaledMock } from '@/components/administracion/guias/arca-mock/scaled-mock'
import { StatusPill } from '@/components/administracion/kit/status-pill'
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
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
} from '@/components/administracion/nav/launcher-items'
import {
  GUIDE_PAPERS,
  type GuideLauncherKey,
  type GuideScene,
  type GuideScreen,
  type PaperId,
} from '@/lib/accounting/guides'
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
 * dibujadas con las piezas de la sección (el ticket, las píldoras de estado) para que se
 * parezcan a la pantalla de verdad. Llevan el sello «Puede verse distinto»: si la pantalla real
 * cambia, el dibujo puede quedar un paso atrás (todas las instrucciones están también en texto).
 *
 * Los datos son de ejemplo y neutros: ni el bar, ni su CUIT, ni nombres de personas. La plata
 * se escribe en centavos y se muestra con `lib/money`, como en la app.
 */

const money = (cents: number) => formatCentsShort(cents)
const digits = (cents: number) => formatCentsShort(cents, { currency: false })

const DAY = 'Mié 07/10'
const SUPPLIER = 'Distribuidora del Centro'
const SHOP = 'Verdulería Los Álamos'

// ─── El lanzador ─────────────────────────────────────────────────────────────

function LauncherScene({ pick }: { pick: GuideLauncherKey }) {
  return (
    <MockCanvas>
      <div className="px-4 pt-4 pb-4">
        <p className="font-serif text-lg leading-tight font-semibold tracking-tight">
          {LAUNCHER_TITLE}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{LAUNCHER_DESCRIPTION}</p>
      </div>
      <ul className="space-y-1.5 px-3 pb-3">
        {LAUNCHER_ITEMS.map((item) => {
          const row = (
            <span className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card px-2.5 py-2 shadow-2xs">
              <MockIcon icon={item.icon} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-pretty">{item.title}</span>
                <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
              </span>
            </span>
          )
          return <li key={item.key}>{item.key === pick ? <Tap>{row}</Tap> : row}</li>
        })}
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
    label: 'Mercado Pago · QR',
    goes: 'En camino: entra hoy',
    cents: 9_620_000,
    icon: QrCode,
  },
  {
    key: 'debito',
    label: 'Tarjeta de débito',
    goes: 'Llega el 08/10',
    cents: 7_130_000,
    icon: CreditCard,
  },
  {
    key: 'credito',
    label: 'Tarjeta de crédito',
    goes: 'Llega el 17/10',
    cents: 5_800_000,
    icon: CreditCard,
  },
  { key: 'apps', label: 'Apps de delivery', goes: 'Llega el 21/10', cents: 4_200_000, icon: Bike },
]
const SALES_TOTAL = SALES.reduce((sum, row) => sum + row.cents, 0)
const SALES_INVOICED = 31_000_000

function CloseMethodsScene() {
  return (
    <MockPage
      crumb="Ventas"
      title="Cierre del día"
      aside={<StatusPill tone="muted">{DAY}</StatusPill>}
    >
      <p className="flex items-start gap-2 font-medium">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          1
        </span>
        <span className="pt-0.5">¿Cuánto se vendió y cómo te pagaron?</span>
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
        <span className="text-xs text-muted-foreground">Total del día</span>
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
        <TicketHeader title="Cierre del día" subtitle={DAY} />
        <TicketRule />
        {SALES.map((row) => (
          <TicketRow key={row.key} label={row.label} value={money(row.cents)} />
        ))}
        <TicketRule double />
        <TicketTotal label="Total vendido" value={money(SALES_TOTAL)} />
        <TicketRule />
        <TicketRow label="Con factura" value={money(SALES_INVOICED)} />
        <TicketRow label="Sin factura" value={money(SALES_TOTAL - SALES_INVOICED)} />
      </Ticket>
      <div className="mt-auto pt-5">
        <Tap>
          <MockPrimary>Guardar el cierre</MockPrimary>
        </Tap>
      </div>
    </MockCanvas>
  )
}

// ─── El gasto ────────────────────────────────────────────────────────────────

const EXPENSE = 1_250_000
const RENT = 95_000_000
const CASH_BEFORE = 39_475_700
const BANK_BEFORE = 218_040_000
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
              'relative flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2 shadow-2xs',
              active ? 'border-primary bg-accent/50 ring-2 ring-primary/25' : 'border-border/70',
            )}
          >
            <PaperArt id={p.id} className="h-9 shrink-0" />
            <span className="min-w-0 text-xs leading-tight font-medium">{p.title}</span>
            {active ? (
              <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
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
  const category = fixed ? (
    <MockChips
      items={[{ label: 'Alquiler', active: true }, { label: 'Luz' }, { label: 'Internet' }]}
    />
  ) : (
    <MockChips items={[{ label: 'Verduras y frutas', active: true }]} />
  )
  return (
    <MockSheet title={ACTION_TITLES.gasto}>
      <MockField label="¿Cuánto?">
        {focus === 'amount' ? <Tap label="Escribí acá">{amountField}</Tap> : amountField}
      </MockField>
      <MockField
        label="¿En qué se gastó?"
        hint={fixed ? 'Los gastos fijos de este mes van primero.' : undefined}
      >
        {fixed ? <Tap label="Elegí acá">{category}</Tap> : category}
      </MockField>
      <MockField
        label="¿Con qué pagaste?"
        hint={
          fixed
            ? `Banco: ${money(BANK_BEFORE)} → ${money(BANK_BEFORE - amount)}`
            : `Caja: ${money(CASH_BEFORE)} → ${money(CASH_BEFORE - amount)}`
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
      <MockField label="¿Qué papel te dieron?">
        <PaperChoice paper={paper} tap={focus === 'paper'} />
      </MockField>
    </MockSheet>
  )
}

function ExpenseTicketScene({ paper }: { paper: PaperId }) {
  const invoiced = paper !== 'sin'
  return (
    <MockSheet
      title={ACTION_TITLES.gasto}
      footer={
        <>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-4 rounded-[5px] border-2 border-border bg-card" />
            Cargar otro después
          </span>
          <Tap>
            <MockPrimary>Guardar</MockPrimary>
          </Tap>
        </>
      }
    >
      <Ticket>
        <TicketHeader title={SHOP} subtitle={`${DAY} · Verduras y frutas`}>
          <TicketStamp tone={invoiced ? 'factura' : 'sin'}>
            {paper === 'factura_a' ? 'Con factura A' : invoiced ? 'Con factura' : 'Sin factura'}
          </TicketStamp>
        </TicketHeader>
        <TicketRule />
        <TicketRow strong label="Salen de Caja" value={money(EXPENSE)} />
        {paper === 'factura_a' ? (
          <TicketRow label="Recuperás de IVA" value={money(EXPENSE_VAT)} />
        ) : null}
        <TicketNote>Queda registrado en los libros.</TicketNote>
      </Ticket>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ChevronRight aria-hidden className="size-3.5" />
        Ver cómo queda en los libros
      </p>
    </MockSheet>
  )
}

// ─── La compra que queda a pagar ─────────────────────────────────────────────

const INVOICE_1 = 8_400_000
const INVOICE_2 = 4_250_000
const DELIVERY_NOTE = 1_800_000

function PurchaseScene() {
  return (
    <MockPage
      crumb="Compras y pagos"
      title="Cargar una compra que debo"
      footer={
        <span className="flex items-center gap-2.5">
          <MockSecondary className="h-12 rounded-xl">Guardar y pagar…</MockSecondary>
          <Tap className="flex-1">
            <MockPrimary>Guardar</MockPrimary>
          </Tap>
        </span>
      }
    >
      <MockField label="¿A quién le compraste?" hint="Va a «Bebidas», como siempre.">
        <MockInput>{SUPPLIER}</MockInput>
      </MockField>
      <MockField label="¿Qué papel te dieron?">
        <MockChips
          items={[
            { label: 'Factura A', active: true },
            { label: 'Factura B o C' },
            { label: 'Tique' },
            { label: 'Sin factura' },
          ]}
        />
      </MockField>
      <div className="grid grid-cols-2 gap-2.5">
        <MockField label="Número">
          <MockInput mono>0003-00001290</MockInput>
        </MockField>
        <MockField label="Total">
          <MockInput mono>{money(INVOICE_1)}</MockInput>
        </MockField>
      </div>
      <MockField label="¿Cuándo vence?" hint="A 21 días, como siempre con este proveedor.">
        <MockInput>Mié 28/10</MockInput>
      </MockField>
    </MockPage>
  )
}

// ─── Pagar ───────────────────────────────────────────────────────────────────

function PayScene() {
  return (
    <MockSheet
      title={`Pagar a ${SUPPLIER}`}
      description={`Le debés ${money(INVOICE_1 + INVOICE_2 + DELIVERY_NOTE)}`}
      footer={
        <Tap>
          <MockPrimary>Pagar {money(INVOICE_1 + INVOICE_2)}</MockPrimary>
        </Tap>
      }
    >
      <MockField label="¿Qué facturas pagás?">
        <span className="block space-y-1.5">
          <MockCheckRow
            checked
            title="Factura A 0003-00001290"
            meta={<StatusPill tone="late">Vencida</StatusPill>}
            amount={money(INVOICE_1)}
          />
          <MockCheckRow
            checked
            title="Factura A 0003-00001302"
            meta={<StatusPill tone="warn">Vence el 16/10</StatusPill>}
            amount={money(INVOICE_2)}
          />
          <MockCheckRow
            title="Remito 0001-00000412"
            meta={<StatusPill tone="muted">Vence el 30/10</StatusPill>}
            amount={money(DELIVERY_NOTE)}
          />
        </span>
      </MockField>
      <MockField label="¿Con qué pagás?">
        <MockChips
          items={[{ label: 'Banco', active: true }, { label: 'Caja' }, { label: 'Mercado Pago' }]}
        />
      </MockField>
    </MockSheet>
  )
}

// ─── Me entró plata ──────────────────────────────────────────────────────────

const SALE_MONDAY = 7_130_000
const SALE_TUESDAY = 6_480_000
const DEDUCTIONS = 245_000

function CollectScene() {
  return (
    <MockSheet title={ACTION_TITLES.cobrar} footer={<MockPrimary>Guardar</MockPrimary>}>
      <MockField label="¿Quién te pagó?">
        <MockChips
          items={[
            { label: 'Tarjeta de débito', active: true },
            { label: 'Tarjeta de crédito' },
            { label: 'App de delivery' },
          ]}
        />
      </MockField>
      <MockField label="¿De qué ventas es?">
        <Tap label="Tildá acá">
          <span className="block w-full space-y-1.5">
            <MockCheckRow
              checked
              title="Ventas del lun 05/10"
              meta={<span className="text-muted-foreground">En camino</span>}
              amount={money(SALE_MONDAY)}
            />
            <MockCheckRow
              checked
              title="Ventas del mar 06/10"
              meta={<span className="text-muted-foreground">En camino</span>}
              amount={money(SALE_TUESDAY)}
            />
          </span>
        </Tap>
      </MockField>
      <div className="grid grid-cols-2 gap-2.5">
        <MockField label="Entró a">
          <MockInput>Banco</MockInput>
        </MockField>
        <MockField label="¿Cuánto entró?">
          <MockInput mono>{money(SALE_MONDAY + SALE_TUESDAY - DEDUCTIONS)}</MockInput>
        </MockField>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Descuentos: {money(DEDUCTIONS)}
        <StatusPill tone="muted">Estimado</StatusPill>
      </p>
    </MockSheet>
  )
}

// ─── Contar la caja ──────────────────────────────────────────────────────────

const CASH_COUNTED = 39_350_000

function CountScene() {
  return (
    <MockSheet
      title="¿Coincide la caja?"
      description="Contá lo que hay de verdad y lo comparamos."
      footer={<MockPrimary>Guardar la diferencia</MockPrimary>}
    >
      <MockField label="¿Qué caja contaste?">
        <MockChips
          items={[{ label: 'Caja', active: true }, { label: 'Mercado Pago' }, { label: 'Banco' }]}
        />
      </MockField>
      <p className="flex items-baseline justify-between rounded-xl bg-secondary/50 px-3 py-2.5">
        <span className="text-muted-foreground">El sistema dice</span>
        <span className="font-mono tabular-nums">{money(CASH_BEFORE)}</span>
      </p>
      <MockField label="¿Cuánto hay de verdad?">
        <Tap label="Escribí acá">
          <MockAmount>{digits(CASH_COUNTED)}</MockAmount>
        </Tap>
      </MockField>
      <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <p>
          <span className="block font-semibold">Faltan {money(CASH_BEFORE - CASH_COUNTED)}</span>
          <span className="block text-[11px] text-muted-foreground">
            Queda anotado como faltante de caja.
          </span>
        </p>
      </div>
    </MockSheet>
  )
}

// ─── Importar ────────────────────────────────────────────────────────────────

const MP_ROWS: ReadonlyArray<{ key: string; label: string; cents: number; fee: number }> = [
  { key: 'a', label: 'Lun 05/10 · QR', cents: 9_620_000, fee: 115_000 },
  { key: 'b', label: 'Lun 05/10 · Transferencia', cents: 3_840_000, fee: 31_000 },
  { key: 'c', label: 'Mar 06/10 · QR', cents: 8_890_000, fee: 106_000 },
]

function ImportUploadScene({ source }: { source: 'mercado_pago' | 'arca' }) {
  const arca = source === 'arca'
  return (
    <MockPage crumb="Importar" title={arca ? 'Compras de ARCA' : 'Mercado Pago'}>
      <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-border bg-card/60 px-4 py-6 text-center">
        <MockIcon icon={Upload} className="size-10" />
        <p className="mt-2.5 font-medium">Arrastrá el archivo acá</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {arca ? '«Mis Comprobantes» › Recibidos' : 'El reporte de «Liquidaciones»'}
        </p>
        <span className="mt-4 inline-flex">
          <Tap className="w-auto" rounded="rounded-[12px]">
            <MockSecondary>Elegir archivo</MockSecondary>
          </Tap>
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Nada se carga solo: primero lo revisás vos.
      </p>
    </MockPage>
  )
}

function ImportReviewScene({ source }: { source: 'mercado_pago' | 'arca' }) {
  if (source === 'mercado_pago') {
    return (
      <MockPage
        crumb="Importar › Mercado Pago"
        title="Revisá lo que encontramos"
        footer={
          <Tap>
            <MockPrimary>Cargar {MP_ROWS.length} cobros</MockPrimary>
          </Tap>
        }
      >
        <ul className="space-y-2">
          {MP_ROWS.map((row) => (
            <li
              key={row.key}
              className="rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-2xs"
            >
              <p className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{row.label}</span>
                <span className="shrink-0 font-mono tabular-nums">{money(row.cents)}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Comisión e impuestos: {money(row.fee)} · Entra {money(row.cents - row.fee)}
              </p>
            </li>
          ))}
        </ul>
      </MockPage>
    )
  }
  return (
    <MockPage crumb="Importar › ARCA" title="Revisá lo que encontramos">
      <ul className="space-y-2">
        <li className="rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-2xs">
          <p className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">Factura A 0003-00001290</span>
            <span className="shrink-0 font-mono tabular-nums">{money(INVOICE_1)}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{SUPPLIER}</p>
          <p className="mt-1.5 flex">
            <StatusPill tone="ok" icon={CircleCheck}>
              Ya está cargado
            </StatusPill>
          </p>
        </li>
        <li className="rounded-xl border border-warning/40 bg-card px-3 py-2.5 shadow-2xs">
          <p className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">Factura B 0002-00000871</span>
            <span className="shrink-0 font-mono tabular-nums">{money(6_120_000)}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Frigorífico del Sur</p>
          <p className="mt-2 text-xs text-pretty">
            Ya cargaste algo con el mismo proveedor y el mismo total. ¿Es otro comprobante?
          </p>
          <span className="mt-2.5 flex flex-col gap-2.5">
            <MockSecondary>Es otro: cargalo</MockSecondary>
            <Tap rounded="rounded-[12px]">
              <MockSecondary className="w-full">Es el mismo: no lo cargues</MockSecondary>
            </Tap>
          </span>
        </li>
      </ul>
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
          <span className="block font-medium">Gasto guardado</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {money(EXPENSE)} · {SHOP}
          </span>
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
      <span className="absolute inset-0 bg-foreground/35" />
      <div className="absolute inset-x-3 top-[5.25rem] space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xl">
        <p className="font-serif text-base leading-snug font-semibold tracking-tight">
          ¿Anulás Factura A 0003-00001290?
        </p>
        <p className="text-xs text-muted-foreground text-pretty">
          Queda anulado con tu nombre y el motivo (no se borra) y deja de contar en los libros.
        </p>
        <MockField label="Motivo">
          <MockInput>Cargué mal el importe</MockInput>
        </MockField>
        <span className="flex justify-end gap-2.5 pt-1">
          <MockSecondary>Cancelar</MockSecondary>
          <Tap className="w-auto" rounded="rounded-[12px]">
            <span className="flex h-10 items-center justify-center rounded-lg bg-destructive px-4 text-[13px] font-semibold text-destructive-foreground">
              Anular
            </span>
          </Tap>
        </span>
      </div>
    </MockCanvas>
  )
}

// ─── Fin de mes · gastos fijos ───────────────────────────────────────────────

function Notice({ tone, children }: { tone: 'warn' | 'ok'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CircleCheck : TriangleAlert
  return (
    <li className="flex items-center gap-2.5 px-3 py-2.5">
      <Icon
        aria-hidden
        className={cn('size-4 shrink-0', tone === 'ok' ? 'text-success' : 'text-warning')}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

function MonthCloseScene() {
  return (
    <MockPage
      crumb="Libros"
      title="Cierres de mes"
      aside={<StatusPill tone="muted">Octubre · abierto</StatusPill>}
      footer={
        <span className="flex items-center gap-2.5">
          <MockSecondary className="h-12 rounded-xl">Exportar</MockSecondary>
          <MockPrimary className="flex-1">Cerrar octubre</MockPrimary>
        </span>
      }
    >
      <p className="text-xs text-muted-foreground">Antes de cerrar, mirá esto:</p>
      <Tap label="Mirá acá">
        <ul className="w-full divide-y divide-border/60 rounded-xl border border-border/70 bg-card shadow-2xs">
          <Notice tone="warn">Faltan 2 cierres del día</Notice>
          <Notice tone="warn">Falta contar una caja: Mercado Pago</Notice>
          <Notice tone="ok">Compras de ARCA: al día</Notice>
        </ul>
      </Tap>
    </MockPage>
  )
}

const FIXED: ReadonlyArray<{
  key: string
  name: string
  due: string
  cents: number
  approx?: boolean
  paid?: boolean
}> = [
  { key: 'alquiler', name: 'Alquiler', due: 'Venció el 10/10', cents: RENT, paid: true },
  { key: 'luz', name: 'Luz', due: 'Vence el 15/10', cents: 18_000_000, approx: true },
  { key: 'internet', name: 'Internet', due: 'Vence el 20/10', cents: 3_800_000 },
]

function FixedScene() {
  const pending = FIXED.filter((row) => !row.paid).reduce((sum, row) => sum + row.cents, 0)
  return (
    <MockPage
      crumb="Administración"
      title="Gastos fijos"
      aside={<StatusPill tone="muted">Octubre</StatusPill>}
    >
      <ul className="space-y-2">
        {FIXED.map((row) => {
          const line = (
            <span className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-2xs">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{row.name}</span>
                <span className="block text-[11px] text-muted-foreground">{row.due}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono tabular-nums">
                  {row.approx ? 'aprox. ' : ''}
                  {money(row.cents)}
                </span>
                {row.paid ? (
                  <StatusPill tone="ok" icon={Check}>
                    Pago
                  </StatusPill>
                ) : (
                  <StatusPill tone="warn">Sin pagar</StatusPill>
                )}
              </span>
            </span>
          )
          return <li key={row.key}>{row.paid ? <Tap label="Quedó pago">{line}</Tap> : line}</li>
        })}
      </ul>
      <p className="flex items-baseline justify-between border-t border-border/60 pt-3">
        <span className="text-xs text-muted-foreground">Te falta de gasto fijo</span>
        <span className="font-serif text-xl leading-none font-semibold tracking-tight">
          aprox. {money(pending)}
        </span>
      </p>
    </MockPage>
  )
}

// ─── La pantalla de cada escena ──────────────────────────────────────────────

/** El alto del dibujo de cada escena, en px (lo que no entra se recorta: medidos a mano). */
function sceneHeight(scene: GuideScene): number {
  switch (scene.kind) {
    case 'launcher':
      return 552
    case 'close':
      return scene.part === 'methods' ? 416 : 520
    case 'expense':
      return scene.focus === 'category' ? 536 : 514
    case 'expense-ticket':
      return scene.paper === 'factura_a' ? 484 : 452
    case 'purchase':
      return 548
    case 'pay':
      return 468
    case 'collect':
      return 528
    case 'count':
      return 468
    case 'import':
      if (scene.phase === 'upload') return 312
      return scene.source === 'arca' ? 380 : 344
    case 'undo':
      return 262
    case 'void':
      return 372
    case 'month-close':
      return 346
    case 'fixed':
      return 368
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
      return <PurchaseScene />
    case 'pay':
      return <PayScene />
    case 'collect':
      return <CollectScene />
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
      return <FixedScene />
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

/** Una pantalla simulada con su marco «Así se ve en Administración». */
export function GuideMock({ screen }: { screen: GuideScreen }) {
  return (
    <ScaledMock
      width={MOCK_WIDTH}
      height={sceneHeight(screen.scene)}
      label={screen.label}
      frameLabel="Así se ve en Administración"
      surfaceClassName="bg-background"
      approximate
    >
      <Scene scene={screen.scene} />
    </ScaledMock>
  )
}
