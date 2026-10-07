'use client'

import { Check, CircleCheck, Sparkles, Stamp, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { AwardPreview, awardButtonLabel } from '@/components/loyalty/award-preview'
import { CustomerHeader } from '@/components/loyalty/customer-header'
import { PunchStamper } from '@/components/loyalty/punch-stamper'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Field, FormActions } from '@/components/ui/field'
import { MoneyField } from '@/components/ui/money-field'
import { Section } from '@/components/ui/section'
import { formatTime } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import { formatPhoneForDisplay } from '@/lib/phone'
import type { EarnRate } from '@/lib/points/earn-rate'
import { previewPoints } from '@/lib/points/preview'
import type { RecentQrAward } from '@/lib/points/queries'
import type { ReservationWithJoins } from '@/lib/salon/types'
import type { BoardActions } from './operativo-board'

/**
 * El socio detrás de la reserva, y el momento de sumarle puntos.
 *
 * Con socio: la misma ficha que Acreditar (nivel, saldo) y si ya sumó esta
 * noche. "Sumar puntos" abre el monto en pesos (`MoneyField` del kit) con la
 * devolución en vivo (cuántos puntos suma). Sin socio pero con teléfono: se
 * vincula (o se crea) con un toque. El anfitrión ve todo en lectura: los
 * puntos los suma caja (roles de la RPC).
 *
 * Es una sección del panel (título + pelo), no una tarjeta: el panel ya es la
 * superficie y una tarjeta nunca va adentro de otra.
 */
export function MemberPanel({
  tenantSlug,
  reservation: r,
  award,
  earnRate,
  canAward,
  canLink,
  primary = true,
  actions,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  award: RecentQrAward | null
  earnRate: EarnRate | null
  canAward: boolean
  /** Puede vincular/crear el socio (STAFF); el anfitrión sí, aunque no sume puntos. */
  canLink: boolean
  /** «Sumar puntos» como acción principal. `false` si el panel ya tiene una (Llegó). */
  primary?: boolean
  actions: BoardActions
}) {
  const customer = r.customer ?? null
  const [mode, setMode] = useState<'idle' | 'amount' | 'success' | 'stamps'>('idle')
  const [cents, setCents] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [last, setLast] = useState<{ points: number; balance: number } | null>(null)

  // Cero no es un consumo: no hay nada que acreditar.
  const amount = cents !== null && cents > 0 ? cents : null
  const points = previewPoints(amount ?? 0, earnRate)
  const noRules = earnRate === null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer || amount === null || busy) return
    setBusy(true)
    const res = await actions.award(r.id, customer.id, amount)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    setLast({ points: res.points, balance: res.newBalance })
    setCents(null)
    setMode('success')
  }

  // ── Sin socio ──────────────────────────────────────────────────────
  if (!customer) {
    const phone = r.guest_phone
    return (
      <Section title="Club" headingLevel={3} divider className="gap-3">
        {phone ? (
          <>
            <p className="type-body">
              Esta reserva no está vinculada a un socio.{' '}
              <span className="text-muted-foreground">
                Con el teléfono <span className="type-amount">{formatPhoneForDisplay(phone)}</span>{' '}
                se busca o se crea la ficha.
              </span>
            </p>
            {canLink ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                loading={linking}
                onClick={async () => {
                  setLinking(true)
                  await actions.linkCustomer(r.id)
                  setLinking(false)
                }}
              >
                <UserPlus aria-hidden="true" />
                Vincular al club
              </Button>
            ) : (
              <p className="type-caption text-muted-foreground">Lo vincula caja al cobrar.</p>
            )}
          </>
        ) : (
          <p className="type-body text-muted-foreground">
            Sin teléfono no hay socio que vincular. Cargalo desde la edición completa o escaneá su
            QR en Acreditar.
          </p>
        )}
      </Section>
    )
  }

  return (
    <Section title="Club" headingLevel={3} divider className="gap-3">
      <CustomerHeader customer={customer} framed={false} />

      {award && mode !== 'success' ? (
        <Callout tone="success" icon={Sparkles}>
          Ya sumó{' '}
          <strong className="font-medium text-foreground type-amount">
            +{formatNumber(award.points)} pts
          </strong>{' '}
          a las <span className="type-amount">{formatTime(award.created_at)}</span>
          {award.amount_cents > 0 ? (
            <>
              {' · '}
              <span className="type-amount">
                {formatCents(award.amount_cents, { decimals: 0 })}
              </span>
            </>
          ) : null}
          .
        </Callout>
      ) : null}

      {canAward ? (
        <>
          {mode === 'idle' ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant={primary ? 'primary' : 'secondary'}
                className="flex-1"
                onClick={() => setMode('amount')}
              >
                <Sparkles aria-hidden="true" />
                {award ? 'Sumar otra consumición' : 'Sumar puntos'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMode('stamps')}
                aria-label="Sellar tarjeta"
              >
                <Stamp aria-hidden="true" />
                <span className="hidden sm:inline">Sellar</span>
              </Button>
            </div>
          ) : null}

          {mode === 'amount' ? (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Field
                label={`¿Cuánto pagó ${customer.first_name}?`}
                hint={<AwardPreview points={points} earnRate={earnRate} />}
              >
                <MoneyField
                  size="lg"
                  decimals="auto"
                  required
                  autoFocus
                  onCentsChange={(next) => setCents(next)}
                />
              </Field>
              <FormActions sticky={false}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setMode('idle')
                    setCents(null)
                  }}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="sm:flex-1"
                  loading={busy}
                  loadingText="Sumando…"
                  disabled={!busy && (amount === null || noRules || !points)}
                >
                  {awardButtonLabel(points)}
                </Button>
              </FormActions>
            </form>
          ) : null}

          {mode === 'success' && last ? (
            <div
              role="status"
              className="flex flex-col items-center gap-1 rounded-lg bg-success-soft p-4 text-center"
            >
              <CircleCheck
                className="size-6 text-success-text"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <p className="type-kpi text-success-text">+{formatNumber(last.points)} pts</p>
              <p className="type-caption text-muted-foreground">
                Nuevo saldo:{' '}
                <strong className="font-semibold text-foreground type-amount">
                  {formatNumber(last.balance)}
                </strong>
              </p>
              <div className="mt-2 flex justify-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setMode('stamps')}
                >
                  <Stamp aria-hidden="true" />
                  Sellar tarjeta
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode('idle')}>
                  <Check aria-hidden="true" />
                  Listo
                </Button>
              </div>
            </div>
          ) : null}

          {mode === 'stamps' ? (
            <div className="flex flex-col gap-2">
              <PunchStamper
                tenantSlug={tenantSlug}
                customerId={customer.id}
                customerName={customer.first_name}
                framed={false}
                headingLevel={4}
              />
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setMode('idle')}
              >
                Listo
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="type-caption text-muted-foreground">Los puntos los suma caja al cobrar.</p>
      )}
    </Section>
  )
}
