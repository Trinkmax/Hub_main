import { notFound } from 'next/navigation'
import { arcaCardState } from '@/components/administracion/guias/arca-guide-model'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { loadPostingCatalog } from '@/lib/accounting/context'
import { buildSetup, treasuryTones } from '@/lib/accounting/home'
import { ONBOARDING_ITEMS } from '@/lib/accounting/onboarding'
import {
  type ClosedPeriodCheckRow,
  getAccessOverview,
  getAccountingSettings,
  getIntegrity,
  type IntegrityCheckRow,
  listFiscalYears,
  listSalesMethods,
  listSalesPoints,
  listTreasuryAccounts,
  type QueryOutcome,
  settleQuery,
  verifyClosedPeriods,
} from '@/lib/accounting/queries'
import { getOnboarding } from '@/lib/accounting/queries/onboarding'
import { getArcaOverview } from '@/lib/arca/queries'
import { configSteps, setupNextView } from '../../configurar/_lib/setup-next'
import { PARTY_KIND_ORDER } from '../_lib/cobros'
import type { SystemPartyRow } from '../_lib/payloads'
import type { ArcaTileState } from '../_lib/portada'
import { ROOMS } from '../_lib/rooms'
import { AccessPanel } from './access-panel'
import { ArcaPanel } from './arca-panel'
import { IntegrityPanel } from './integrity-panel'
import { MethodsPanel } from './methods-panel'
import { AccountantDrawer } from './portada/accountant-drawer'
import { SettingsBoard } from './portada/settings-board'
import { SetupNext, SetupPills } from './portada/setup-next'
import { SalesPointsPanel } from './sales-points-panel'
import { PeriodSettingsForm, SasSettingsForm } from './settings-forms'
import { FiscalYearsList, PeriodSettingsView, SasSettingsView } from './settings-views'
import { TreasuriesPanel } from './treasuries-panel'

/**
 * Las habitaciones de Ajustes y la portada, como Server Components que cargan
 * cada uno lo suyo (antes era un `switch` dentro de la página, que esperaba
 * todo antes de dibujar nada). La página pone el marco y cada uno llega por
 * streaming, detrás de su esqueleto.
 *
 * Si una lectura falla, el bloque conserva su lugar y lo dice («No pudimos
 * cargar esto» + «Reintentar»): nunca tira la pantalla entera. Las lecturas
 * son las mismas de siempre; lo que cambia es cómo se muestran.
 */

export type RoomContext = {
  tenantSlug: string
  tenantId: string
  /** `/<bar>/administracion`. */
  base: string
  userId: string
  /** Puede cargar. Quien no puede (la contadora) no recibe ningún control. */
  canWrite: boolean
  isOwner: boolean
  /** Da accesos (y puede cargar). */
  isAdmin: boolean
  today: string
}

// ─── La portada ──────────────────────────────────────────────────────────────

/**
 * La portada: lo próximo de la puesta en marcha, los seis objetos y el cajón
 * de la contadora. Tres lecturas en paralelo (el catálogo, la guía «Cómo
 * arrancar» y los accesos); una que falla no tira las otras.
 */
export async function Portada({ ctx }: { ctx: RoomContext }) {
  const [catalog, onboarding, access, arca] = await Promise.all([
    settleQuery(loadPostingCatalog(ctx.tenantId)),
    settleQuery(getOnboarding(ctx.tenantId)),
    settleQuery(getAccessOverview(ctx.tenantId, { includeMembers: ctx.isOwner })),
    arcaRoomState(ctx.tenantId),
  ])
  const settings = catalog.ok ? catalog.data.settings : null
  const guide = onboarding.ok ? onboarding.data : null
  const strip = buildSetup({
    summary: null,
    settings,
    onboarding: guide,
    canWrite: ctx.canWrite,
    base: ctx.base,
  })
  const board = (
    <SettingsBoard
      base={ctx.base}
      catalog={catalog.ok ? catalog.data : null}
      onboarding={onboarding.ok ? onboarding.data : undefined}
      access={access.ok ? access.data : null}
      showMembers={ctx.isOwner}
      arcaState={arca}
    />
  )

  if (!ctx.canWrite) {
    return (
      <div className="space-y-6">
        <SetupPills steps={strip.steps} />
        <AccountantDrawer base={ctx.base} mine />
        {board}
      </div>
    )
  }

  const steps = configSteps(strip)
  const view = setupNextView(steps, {
    openingPending: settings
      ? settings.openingStatus === 'pending'
      : steps.some((s) => s.id === 'opening' && !s.done),
    cuitMissing: settings ? !settings.cuit : false,
    noMethods: catalog.ok ? !catalog.data.methods.some((m) => m.active) : false,
  })
  return (
    <div className="space-y-6">
      <SetupNext view={view} guideHref={strip.guideHref} />
      {board}
      <AccountantDrawer base={ctx.base} mine={false} />
    </div>
  )
}

// ─── B1 · Accesos ────────────────────────────────────────────────────────────

export async function AccesosRoom({ ctx }: { ctx: RoomContext }) {
  const result = await settleQuery(getAccessOverview(ctx.tenantId, { includeMembers: ctx.isOwner }))
  if (!result.ok) return <PanelError title={ROOMS.accesos.title} message={result.message} />
  return (
    <AccessPanel
      tenantSlug={ctx.tenantSlug}
      overview={result.data}
      currentUserId={ctx.userId}
      isAdmin={ctx.isAdmin}
      canWrite={ctx.canWrite}
      showMembers={ctx.isOwner}
    />
  )
}

// ─── B2 · Cajas y cuentas ────────────────────────────────────────────────────

export async function CajasRoom({ ctx }: { ctx: RoomContext }) {
  const [rows, catalog] = await Promise.all([
    settleQuery(listTreasuryAccounts(ctx.tenantId, { includeInactive: true })),
    settleQuery(loadPostingCatalog(ctx.tenantId)),
  ])
  if (!rows.ok) return <PanelError title={ROOMS.cajas.title} message={rows.message} />
  // Si el catálogo falla, las tarjetas salen igual: el saldo dice «—».
  const balances: Record<string, number> = {}
  if (catalog.ok) for (const t of catalog.data.treasuries) balances[t.id] = t.balanceCents
  return (
    <TreasuriesPanel
      tenantSlug={ctx.tenantSlug}
      rows={rows.data}
      balances={balances}
      tones={treasuryTones(rows.data.filter((t) => t.active))}
      readOnly={!ctx.canWrite}
      afterCreate={
        !catalog.ok
          ? 'plain'
          : catalog.data.settings.openingStatus === 'pending'
            ? 'opening'
            : 'view'
      }
    />
  )
}

// ─── B3 · Medios de cobro (y la lista de CUIT de «Plataformas») ──────────────

export async function MediosRoom({ ctx, cuitOpen }: { ctx: RoomContext; cuitOpen: boolean }) {
  const [methods, catalog] = await Promise.all([
    settleQuery(listSalesMethods(ctx.tenantId, { includeInactive: true })),
    settleQuery(loadPostingCatalog(ctx.tenantId)),
  ])
  if (!methods.ok) return <PanelError title={ROOMS.medios.title} message={methods.message} />
  if (!catalog.ok) return <PanelError title={ROOMS.medios.title} message={catalog.message} />
  // Quienes pueden pagar un medio, más los partícipes del sistema y los bancos (la lista de CUIT).
  const parties: SystemPartyRow[] = catalog.data.parties
    .filter(
      (p) =>
        p.systemKey !== null ||
        p.kind === 'bank' ||
        p.kind === 'card_processor' ||
        p.kind === 'payment_wallet' ||
        p.kind === 'delivery_platform',
    )
    .sort(
      (a, b) =>
        (PARTY_KIND_ORDER[a.kind] ?? 9) - (PARTY_KIND_ORDER[b.kind] ?? 9) ||
        a.name.localeCompare(b.name, 'es'),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      systemKey: p.systemKey,
      taxId: p.taxId,
      active: p.active,
      commissionVatMode: p.commissionVatMode,
      rates: p.rates,
      updatedAt: p.updatedAt,
    }))
  return (
    <MethodsPanel
      tenantSlug={ctx.tenantSlug}
      methods={methods.data}
      treasuries={catalog.data.treasuries.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        active: t.active,
        bankPartyId: t.bankPartyId,
      }))}
      parties={parties}
      readOnly={!ctx.canWrite}
      cuitOpen={cuitOpen || !ctx.canWrite}
    />
  )
}

// ─── B4 · Datos de la SAS ────────────────────────────────────────────────────

/** «¿De dónde saco estos datos?»: los pasos de la guía, para no escribirlos dos veces. */
const SAS_HOW = ONBOARDING_ITEMS.find((item) => item.id === 'sas_data')?.how ?? []

export async function SasRoom({ ctx }: { ctx: RoomContext }) {
  const result = await settleQuery(getAccountingSettings(ctx.tenantId))
  if (!result.ok) return <PanelError title={ROOMS.sas.title} message={result.message} />
  if (!result.data) notFound()
  return ctx.canWrite ? (
    <SasSettingsForm
      key={result.data.updatedAt}
      tenantSlug={ctx.tenantSlug}
      settings={result.data}
      today={ctx.today}
      how={SAS_HOW}
    />
  ) : (
    <SasSettingsView settings={result.data} />
  )
}

/**
 * El estado de ARCA como lo dice su habitación: la conexión de producción más los pasos
 * marcados de la guía. La portada y Puntos de venta lo leen de acá para decir lo mismo que
 * `ArcaPanel`. `null` = no se pudo leer (cada lugar cae en lo que ya sabía).
 */
async function arcaRoomState(tenantId: string): Promise<ArcaTileState | null> {
  const result = await settleQuery(getArcaOverview(tenantId))
  if (!result.ok) return null
  return arcaCardState(result.data.connections.produccion, result.data.guide.produccion.summary)
}

// ─── B5 · Puntos de venta ────────────────────────────────────────────────────

export async function PuntosRoom({ ctx }: { ctx: RoomContext }) {
  const [points, arca] = await Promise.all([
    settleQuery(listSalesPoints(ctx.tenantId, { includeInactive: true })),
    arcaRoomState(ctx.tenantId),
  ])
  if (!points.ok) {
    return <PanelError title={ROOMS['puntos-de-venta'].title} message={points.message} />
  }
  return (
    <SalesPointsPanel
      tenantSlug={ctx.tenantSlug}
      points={points.data}
      readOnly={!ctx.canWrite}
      // Si ARCA no se pudo leer, la franja dice solo «Abrir ARCA».
      arca={arca}
    />
  )
}

// ─── D · ARCA ────────────────────────────────────────────────────────────────

export async function ArcaRoom({ ctx }: { ctx: RoomContext }) {
  // Mientras las migraciones de ARCA no estén aplicadas, la lectura falla y se ve «No pudimos
  // cargar esto» con «Reintentar», como cualquier habitación.
  const result = await settleQuery(getArcaOverview(ctx.tenantId))
  if (!result.ok) return <PanelError title={ROOMS.arca.title} message={result.message} />
  return <ArcaPanel slug={ctx.tenantSlug} overview={result.data} canWrite={ctx.canWrite} />
}

// ─── B6 · Ejercicio ──────────────────────────────────────────────────────────

export async function EjercicioRoom({ ctx }: { ctx: RoomContext }) {
  const [settings, years] = await Promise.all([
    settleQuery(getAccountingSettings(ctx.tenantId)),
    settleQuery(listFiscalYears(ctx.tenantId)),
  ])
  return (
    <div className="space-y-6">
      {years.ok ? (
        <FiscalYearsList
          years={years.data}
          cierresHref={`${ctx.base}/libros/cierres`}
          today={ctx.today}
        />
      ) : (
        <PanelError title="Los meses del ejercicio" message={years.message} />
      )}
      {!settings.ok ? (
        <PanelError title="Avisos y vencimientos" message={settings.message} />
      ) : settings.data ? (
        ctx.canWrite ? (
          <PeriodSettingsForm
            key={settings.data.updatedAt}
            tenantSlug={ctx.tenantSlug}
            settings={settings.data}
          />
        ) : (
          <PeriodSettingsView settings={settings.data} />
        )
      ) : null}
    </div>
  )
}

// ─── B7 · Integridad ─────────────────────────────────────────────────────────

export async function IntegridadRoom({ ctx, ran }: { ctx: RoomContext; ran: boolean }) {
  let checks: QueryOutcome<IntegrityCheckRow[]> | null = null
  let closed: QueryOutcome<ClosedPeriodCheckRow[]> | null = null
  if (ran) {
    ;[checks, closed] = await Promise.all([
      settleQuery(getIntegrity(ctx.tenantId)),
      settleQuery(verifyClosedPeriods(ctx.tenantId)),
    ])
  }
  return (
    <IntegrityPanel
      verifyHref={`${ctx.base}/ajustes?tab=integridad&verificar=1`}
      ran={ran}
      checks={checks}
      closed={closed}
    />
  )
}
