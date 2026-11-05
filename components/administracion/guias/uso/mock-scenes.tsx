import { CircleCheck, FileUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Verdict } from '@/components/administracion/acciones/ajustar-piezas'
import { countSubmitLabel, countVerdict } from '@/components/administracion/acciones/ajustar-vista'
import { ScaledMock } from '@/components/administracion/guias/arca-mock/scaled-mock'
import { PileSheet } from '@/components/administracion/importar/review/paper-pile'
import { LedgerList, LedgerRail, LedgerRow } from '@/components/administracion/kit/ledger'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { StepCard } from '@/components/administracion/kit/step'
import {
  LAUNCHER_DESCRIPTION,
  LAUNCHER_TITLE,
  type LauncherItem,
  launcherGroups,
} from '@/components/administracion/nav/launcher-items'
import {
  type GuideLauncherKey,
  type GuideScene,
  type GuideScreen,
  SCREEN_LABELS,
} from '@/lib/accounting/guides'
import { proposalBadge, reviewHero, reviewTitle } from '@/lib/imports/ui/review-copy'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  MOCK_WIDTH,
  MockAmount,
  MockCanvas,
  MockField,
  MockIcon,
  MockInput,
  MockPage,
  MockPrimary,
  MockSecondary,
  MockSheet,
  Tap,
} from './mock-kit'

/**
 * Las pantallas simuladas de las recetas: pocas, y solo de lo que no cambia seguido (el menú de
 * «+ Cargar», contar la caja, la subida de un archivo, «Deshacer» y «Anular»). El resto de cada
 * receta se cuenta con palabras: una maqueta por pantalla obligaba a cambiar todo dos veces.
 *
 * Solo entran piezas que no cambian con el ancho de la VENTANA: el dibujo mide siempre lo mismo
 * (`MOCK_WIDTH`) y su alto está dado a mano. Los rótulos salen de `SCREEN_LABELS` y de
 * `launcher-items`, y un test comprueba que sigan escritos en el código de cada pantalla.
 *
 * Los datos son de ejemplo y neutros: ni el bar, ni su CUIT, ni nombres de personas, ni importes
 * que se parezcan a los de nadie (el marco los rotula «Ejemplo»). La plata se escribe en centavos
 * y se muestra con `lib/money`, como en la app.
 */

const L = SCREEN_LABELS

const money = (cents: number) => formatCentsShort(cents)
const digits = (cents: number) => formatCentsShort(cents, { currency: false })

const SUPPLIER = 'Distribuidora del Centro'
const SHOP = 'Verdulería Los Álamos'
const EXPENSE = 1_250_000
const CASH_BEFORE = 28_650_000
const BANK_BEFORE = 218_000_000
const INVOICE_1 = 8_400_000
const INVOICE_2 = 4_250_000

/** El aire de un paso numerado en una PÁGINA, fijo: sin esto `StepCard` se agranda desde `sm`. */
const STEP = 'p-3.5 sm:p-3.5'

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

// ─── El menú de «+ Cargar» ───────────────────────────────────────────────────

/**
 * El menú «¿Qué cargás?», con la misma forma que el de verdad: las cuatro de todos los días, con
 * cuándo se usa cada una, y las demás en una fila chica. Los textos y el orden salen de
 * `launcher-items` (la fuente del menú): si cambia allá, cambia acá.
 */
function LauncherScene({ pick }: { pick: GuideLauncherKey }) {
  const { daily, sometimes } = launcherGroups()
  const row = (item: LauncherItem) => (
    <span className="block w-full rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-2xs">
      <span className="block font-semibold">{item.title}</span>
      <span className="block text-[11px] leading-snug text-muted-foreground text-pretty">
        {item.hint}
      </span>
    </span>
  )
  const chip = (item: LauncherItem) => (
    <span className="inline-flex h-8 items-center rounded-full border border-border/70 bg-card px-3 text-xs font-medium whitespace-nowrap">
      {item.title}
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
      {/* Con aire arriba: ahí cae la etiqueta «Tocá acá» sin pisar lo de arriba. */}
      <ul className="grid gap-2 px-3 pt-3">
        {daily.map((item) => (
          <li key={item.key} className="flex">
            {item.key === pick ? <Tap rounded="rounded-[14px]">{row(item)}</Tap> : row(item)}
          </li>
        ))}
      </ul>
      <ul className="mx-3 mt-4 mb-3 flex flex-wrap gap-x-1.5 gap-y-3 pt-2">
        {sometimes.map((item) => (
          <li key={item.key}>
            {item.key === pick ? (
              <Tap className="w-auto" rounded="rounded-full">
                {chip(item)}
              </Tap>
            ) : (
              chip(item)
            )}
          </li>
        ))}
      </ul>
    </MockCanvas>
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
          <span className="block font-medium">Factura cargada y pagada · {money(EXPENSE)}</span>
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

// ─── La pantalla de cada escena ──────────────────────────────────────────────

/** El alto del dibujo de cada escena, en px (lo que no entra se recorta). */
function sceneHeight(scene: GuideScene): number {
  switch (scene.kind) {
    case 'launcher':
      return 470
    case 'count':
      return 612
    case 'import':
      if (scene.phase === 'upload') return 552
      return scene.source === 'arca' ? 558 : 536
    case 'undo':
      return 262
    case 'void':
      return 372
  }
}

function Scene({ scene }: { scene: GuideScene }) {
  switch (scene.kind) {
    case 'launcher':
      return <LauncherScene pick={scene.pick} />
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
 * la pantalla de hoy y los importes son inventados.
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
