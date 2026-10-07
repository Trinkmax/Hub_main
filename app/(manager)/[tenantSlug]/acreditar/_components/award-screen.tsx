'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { Camera, CircleCheck, Keyboard, RotateCcw } from 'lucide-react'
import { useCallback, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AwardForm, type AwardResultData } from '@/components/loyalty/award-form'
import { CustomerHeader } from '@/components/loyalty/customer-header'
import { PunchStamper } from '@/components/loyalty/punch-stamper'
import { RedemptionPanel } from '@/components/loyalty/redemption-panel'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { CustomerByQr } from '@/lib/customers/queries'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import { lookupCustomerByQr } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import { parseScannedCode } from '@/lib/redemptions/scan'

// Un solo escáner para los dos QR que circulan por el bar (ver
// lib/redemptions/scan.ts): el personal del socio (/c/…) acredita puntos y sella
// tarjetas; el de un canje (/v/…) abre la validación. Nadie tiene que acordarse
// de qué pantalla abrir. Un token pelado (carga manual) se interpreta como QR de
// socio, que es lo que se tipea acá el 99% de las veces.
//
// La ficha del socio y el form de monto → puntos son los MISMOS componentes que
// usa el salón (`components/loyalty/*`): el mozo con el celular y el cajero con
// la tablet tienen que ver exactamente lo mismo.

type Step = 'idle' | 'scanning' | 'manual' | 'confirm' | 'success' | 'redemption'

export function AwardScreen({
  tenantSlug,
  earnRate,
}: {
  tenantSlug: string
  earnRate: EarnRate | null
}) {
  const [step, setStep] = useState<Step>('idle')
  const [manualToken, setManualToken] = useState('')
  const [customer, setCustomer] = useState<CustomerByQr | null>(null)
  const [lastResult, setLastResult] = useState<AwardResultData | null>(null)
  const [redeemToken, setRedeemToken] = useState<string | null>(null)
  const [lookupBusy, startLookup] = useTransition()

  const resolveToken = useCallback(
    (raw: string) => {
      const scanned = parseScannedCode(raw, 'customer')
      if (!scanned) {
        toast.error('No reconocimos el código. Probá de nuevo o pegalo a mano.')
        return
      }
      if (scanned.kind === 'redemption') {
        setRedeemToken(scanned.token)
        setStep('redemption')
        return
      }
      startLookup(async () => {
        const r = await lookupCustomerByQr(tenantSlug, scanned.token)
        if (!r.ok) {
          toast.error(r.message)
          return
        }
        setCustomer(r.customer)
        setStep('confirm')
      })
    },
    [tenantSlug],
  )

  const reset = () => {
    setStep('idle')
    setManualToken('')
    setCustomer(null)
    setLastResult(null)
    setRedeemToken(null)
  }

  if (step === 'redemption' && redeemToken) {
    return <RedemptionPanel tenantSlug={tenantSlug} redeemToken={redeemToken} onReset={reset} />
  }

  if (step === 'success' && lastResult && customer) {
    return (
      <div className="flex flex-col gap-6">
        <Card padding="lg" className="items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-text">
            <CircleCheck aria-hidden="true" className="size-6" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="type-kpi">+{formatNumber(lastResult.points_awarded)} puntos</h2>
            <p className="type-body text-muted-foreground">
              Para {customer.first_name} {customer.last_name}
              {' · '}
              <span className="type-amount">
                {formatCents(lastResult.amount_cents, { decimals: 0 })}
              </span>{' '}
              pagados
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="type-label text-muted-foreground">Nuevo saldo</p>
            <p className="type-kpi">{formatNumber(lastResult.new_balance)}</p>
          </div>
          <Button onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Acreditar a otro cliente
          </Button>
        </Card>

        {/* Sigue a mano después de acreditar: sellar es otra acción de la misma
            visita y obligar a re-escanear el QR era pura fricción. */}
        <PunchStamper
          tenantSlug={tenantSlug}
          customerId={customer.id}
          customerName={customer.first_name}
        />
      </div>
    )
  }

  if (step === 'confirm' && customer) {
    return (
      <div className="flex flex-col gap-4">
        <CustomerHeader customer={customer} />

        <AwardForm
          tenantSlug={tenantSlug}
          customerId={customer.id}
          customerFirstName={customer.first_name}
          earnRate={earnRate}
          onAwarded={(r) => {
            setLastResult(r)
            setStep('success')
          }}
          onCancel={reset}
        />

        <PunchStamper
          tenantSlug={tenantSlug}
          customerId={customer.id}
          customerName={customer.first_name}
        />
      </div>
    )
  }

  if (step === 'scanning') {
    return (
      <Card padding="sm" className="gap-4 p-4">
        <div className="overflow-hidden rounded-lg">
          <Scanner
            onScan={(codes: IDetectedBarcode[]) => {
              const code = codes[0]?.rawValue
              if (!code) return
              setStep('idle')
              resolveToken(code)
            }}
            onError={(e) => {
              const msg = e instanceof Error ? e.message : 'No pudimos acceder a la cámara.'
              toast.error(msg)
              setStep('idle')
            }}
            constraints={{ facingMode: 'environment' }}
            scanDelay={400}
            allowMultiple={false}
            components={{ finder: true, torch: true }}
          />
        </div>
        <p className="text-center text-balance type-small text-muted-foreground" aria-live="polite">
          {lookupBusy
            ? 'Buscando al cliente…'
            : 'Apuntá la cámara al QR: sirve el personal del socio y el de un canje.'}
        </p>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep('idle')}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => setStep('manual')}>
            <Keyboard aria-hidden="true" />
            Cargar a mano
          </Button>
        </div>
      </Card>
    )
  }

  if (step === 'manual') {
    return (
      <Card asChild>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!manualToken.trim()) return
            resolveToken(manualToken)
          }}
        >
          <Field
            label="Código del socio o del canje"
            hint="Pegá el link entero (…/c/… o …/v/…) o solo el código."
          >
            <Input
              // Se llega acá tocando «Cargar a mano»: el foco va directo al campo.
              autoFocus
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="…/c/abc123 o abc123"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep('idle')}>
              Volver
            </Button>
            <Button type="submit" loading={lookupBusy} loadingText="Buscando…">
              Buscar
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <Card>
      <p className="text-balance type-body text-muted-foreground">
        Escaneá el QR del socio para acreditar puntos y sellar tarjetas, o el de un canje para
        entregarlo. La pantalla se acomoda sola.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={() => setStep('scanning')} size="lg">
          <Camera aria-hidden="true" />
          Escanear QR
        </Button>
        <Button onClick={() => setStep('manual')} size="lg" variant="secondary">
          <Keyboard aria-hidden="true" />
          Cargar a mano
        </Button>
      </div>
    </Card>
  )
}
