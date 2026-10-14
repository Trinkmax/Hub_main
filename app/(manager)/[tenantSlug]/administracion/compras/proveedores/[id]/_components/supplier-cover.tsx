import { CircleCheck } from 'lucide-react'
import { DUE_SWATCHES } from '@/components/administracion/charts/palette'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import {
  Explain,
  HeroPanel,
  MathRow,
  MoneyHero,
  RetryButton,
  StatusPill,
} from '@/components/administracion/kit'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { PartyDetail, PartyPosition } from '@/lib/accounting/queries/parties'
import type { PadronVerification } from '@/lib/arca/queries'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { newPurchaseHref } from '../../../_lib/links'
import {
  agingMath,
  agingTranches,
  supplierFacts,
  supplierHero,
} from '../../../_lib/supplier-ledger'
import { ArcaVerification } from './arca-verification'
import { SupplierActions } from './supplier-actions'
import { SupplierFacts } from './supplier-facts'

/**
 * La tapa de la libreta de un proveedor: su nombre, cuánto le debés (con una
 * oración que lo explica y los tres tramos de urgencia), la acción del momento
 * al lado del número ([Pagarle]) y, al pie, sus tres datos de carga.
 *
 * Reemplaza a la cabecera gris + cuatro tarjetas + barra de antigüedad de
 * antes: en el celular eran dos pantallas antes de ver una compra. El detalle
 * por antigüedad (30 / 60 / +60 días) quedó adentro de «¿Cómo se calcula?».
 *
 * `tone`: `bosque` (la tapa verde, como la pizarra del Resumen) o `crema`
 * (`?tapa=crema`, para que el dueño elija mirando las dos). Sin deuda no
 * muestra «$ 0»: dice «No le debés nada».
 */
export function SupplierCover({
  tenantSlug,
  party,
  position,
  positionError,
  verification,
  canWrite,
  canPickCategory,
  tone,
  today,
  baseHref,
  exportHref,
  exportFileName,
  openingPending = false,
}: {
  tenantSlug: string
  party: PartyDetail
  /** `null` si no se pudo leer. */
  position: PartyPosition | null
  positionError: string | null
  verification: PadronVerification | null
  canWrite: boolean
  canPickCategory: boolean
  tone: 'bosque' | 'crema'
  today: string
  /** Su hoja: a dónde vuelve una compra cargada desde acá. */
  baseHref: string
  exportHref: string
  exportFileName: string
  /** Faltan los saldos iniciales: «al día» es solo por lo cargado. */
  openingPending?: boolean
}) {
  const onHero = tone === 'bosque'
  const soft = onHero ? 'text-adm-hero-muted' : 'text-muted-foreground'
  const hasTradeName = Boolean(party.tradeName && party.tradeName !== party.name)
  const shown = party.tradeName ?? party.name
  const hero = position
    ? supplierHero({
        debtCents: position.debtCents,
        creditCents: position.creditCents,
        debtCount: position.debtItems.length,
        overdueCents: position.aging.overdueCents,
        oldestDueDate: position.aging.oldestDueDate,
        nextDueDate: position.aging.nextDueDate,
        today,
        openingPending,
      })
    : null
  const hasDebt = (position?.debtCents ?? 0) > 0
  // Con toda la deuda en un solo tramo, la barra no reparte nada: la oración ya lo dice.
  const tranches = position && hasDebt ? agingTranches(position.aging) : []
  const split = tranches.filter((t) => t.cents > 0).length > 1

  return (
    <HeroPanel tone={tone} className="grid gap-5">
      <div>
        {party.kind !== 'supplier' || !party.active || !canWrite ? (
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {party.kind !== 'supplier' ? (
              <StatusPill tone="muted">{PARTY_KIND_LABELS[party.kind] ?? 'Otro'}</StatusPill>
            ) : null}
            {!party.active ? <StatusPill tone="muted">Desactivado</StatusPill> : null}
            <ReadOnlyBadge />
          </div>
        ) : null}
        <h1
          className={cn(
            'font-serif text-3xl font-semibold leading-tight tracking-[-0.015em] text-balance [overflow-wrap:anywhere] sm:text-[34px]',
            onHero && 'text-adm-hero-fg',
          )}
        >
          {shown}
        </h1>
        {hasTradeName ? <p className={cn('mt-1 text-sm text-pretty', soft)}>{party.name}</p> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        {hero === null ? (
          <div className="space-y-3">
            <p role="alert" className={cn('max-w-prose text-sm text-pretty', soft)}>
              {positionError ?? 'No pudimos leer cuánto le debés.'}
            </p>
            <RetryButton />
          </div>
        ) : hero.kind === 'clear' ? (
          <div>
            <p
              className={cn(
                'flex items-start gap-2.5 font-serif text-2xl font-semibold leading-tight tracking-tight sm:text-3xl',
                onHero && 'text-adm-hero-fg',
              )}
            >
              <CircleCheck aria-hidden className="mt-1 size-6 shrink-0 text-success" />
              {hero.title}
            </p>
            <p className={cn('mt-2 text-sm', soft)}>{hero.sentence}</p>
          </div>
        ) : (
          <MoneyHero
            // Nueve cifras no entran al tamaño más grande en un celular.
            size={hero.cents >= 100_000_000_00 ? 'lg' : 'xl'}
            tone={onHero ? 'onHero' : 'default'}
            label={hero.kind === 'debt' ? 'Le debés' : 'Tenés a favor'}
            cents={hero.cents}
            sentence={hero.sentence}
          />
        )}
        <SupplierActions
          partyId={party.id}
          partyName={shown}
          newInvoiceHref={newPurchaseHref(tenantSlug, { proveedor: party.id, volver: baseHref })}
          newCreditNoteHref={newPurchaseHref(tenantSlug, {
            tipo: 'nc',
            proveedor: party.id,
            volver: baseHref,
          })}
          exportHref={exportHref}
          exportFileName={exportFileName}
          canPay={party.active || hasDebt}
          hasDebt={hasDebt}
          canBuy={party.active}
          className="lg:justify-end"
        />
      </div>

      {position && split ? (
        // La barra, del ancho de su tabla (34rem): en la compu no queda una barra de punta a
        // punta con la leyenda que la explica ocupando la mitad.
        <div className="max-w-[34rem] space-y-3">
          <SplitBar
            ariaLabel={`Le debés ${formatCentsShort(position.debtCents)} a ${shown}, por urgencia`}
            segments={tranches.map((t) => ({
              key: t.key,
              label: t.label,
              cents: t.cents,
              swatch: DUE_SWATCHES[t.key],
            }))}
          />
          <Explain note="Lo que tenés a favor va aparte: no se resta hasta que lo usás en un pago.">
            {agingMath(position.aging).map((row, index) => (
              <MathRow
                key={row.label}
                op={row.total ? '=' : index === 0 ? undefined : '+'}
                label={row.label}
                value={formatCentsShort(row.cents)}
              />
            ))}
          </Explain>
        </div>
      ) : null}

      <div className={cn('border-t pt-4', onHero ? 'border-white/12' : 'border-border/60')}>
        <SupplierFacts
          facts={supplierFacts(party)}
          partyId={party.id}
          supplierName={shown}
          canWrite={canWrite}
          canPickCategory={canPickCategory}
          onHero={onHero}
          verification={verification ? <ArcaVerification verification={verification} /> : null}
        />
      </div>
    </HeroPanel>
  )
}
