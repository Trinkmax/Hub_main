'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { Camera, CheckCircle2, Keyboard, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AwardForm, type AwardResultData } from '@/components/loyalty/award-form'
import { CustomerHeader } from '@/components/loyalty/customer-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CustomerByQr } from '@/lib/customers/queries'
import { lookupCustomerByQr } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import { parseScannedCode } from '@/lib/redemptions/scan'
import { PunchStamper } from './punch-stamper'
import { RedemptionPanel } from './redemption-panel'

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

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

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
      <div className="space-y-6">
        <div className="card-hairline rounded-2xl border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto size-12 text-primary" aria-hidden />
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
            +{lastResult.points_awarded.toLocaleString('es-AR')} puntos
          </h2>
          <p className="text-sm text-muted-foreground">
            Para {customer.first_name} {customer.last_name}
            {' · '}
            {fmtCents(lastResult.amount_cents)} pagados
          </p>
          <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
            Nuevo balance
          </p>
          <p className="font-display text-3xl font-semibold tabular-nums">
            {lastResult.new_balance.toLocaleString('es-AR')}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={reset} className="gap-2">
              <RotateCcw className="size-3.5" aria-hidden />
              Acreditar a otro cliente
            </Button>
          </div>
        </div>

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
      <div className="space-y-4">
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
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4">
        <div className="overflow-hidden rounded-xl">
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
        <p className="text-center text-xs text-muted-foreground text-balance">
          {lookupBusy
            ? 'Buscando cliente…'
            : 'Apuntá la cámara: sirve tanto el QR personal del socio como el de un canje.'}
        </p>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setStep('idle')}>
            Cancelar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStep('manual')} className="gap-1.5">
            <Keyboard className="size-3.5" aria-hidden />
            Cargar manual
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'manual') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!manualToken.trim()) return
          resolveToken(manualToken)
        }}
        className="card-hairline space-y-3 rounded-2xl border bg-card p-6"
      >
        <Label htmlFor="manual-token">Pegá el código del socio o del canje</Label>
        <Input
          id="manual-token"
          autoFocus
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder=".../c/abc123… , .../v/abc123… o el código suelto"
        />
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setStep('idle')}>
            Volver
          </Button>
          <Button type="submit" disabled={lookupBusy} className="gap-1.5">
            {lookupBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Buscar
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="card-hairline space-y-3 rounded-2xl border bg-card p-6">
      <p className="text-sm text-muted-foreground text-balance">
        Escaneá el QR del socio para acreditar puntos y sellar tarjetas, o el de un canje para
        entregarlo. La pantalla se acomoda sola.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={() => setStep('scanning')} size="lg" className="h-16 gap-2">
          <Camera className="size-5" aria-hidden />
          Escanear QR
        </Button>
        <Button
          onClick={() => setStep('manual')}
          size="lg"
          variant="outline"
          className="h-16 gap-2"
        >
          <Keyboard className="size-5" aria-hidden />
          Cargar manual
        </Button>
      </div>
    </div>
  )
}
