'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { Camera, Keyboard, Loader2, QrCode, RotateCcw, User2 } from 'lucide-react'
import { useCallback, useState, useTransition } from 'react'
import { toast } from 'sonner'
// Los dos paneles de staff se comparten con la caja (/acreditar): el mozo con el
// celular y el cajero con la tablet tienen que ver EXACTAMENTE lo mismo.
import { PunchStamper } from '@/app/(manager)/[tenantSlug]/acreditar/_components/punch-stamper'
import { RedemptionPanel } from '@/app/(manager)/[tenantSlug]/acreditar/_components/redemption-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPhoneForDisplay } from '@/lib/phone'
import { lookupCustomerByQr } from '@/lib/points/actions'
import { parseScannedCode } from '@/lib/redemptions/scan'

// Escáner único del salón. El mozo no elige "qué" está escaneando: el parser
// reconoce los dos QR que circulan (ver lib/redemptions/scan.ts) y la pantalla
// se acomoda sola.
//
//   /v/<redeem_token> → validar y entregar el canje
//   /c/<qr_token>     → el socio en mano: sellarle las tarjetas
//
// Un código pegado a mano se interpreta como canje: acá se tipea cuando la
// cámara no engancha el QR del beneficio.

type Step = 'idle' | 'scanning' | 'resolving' | 'manual' | 'redemption' | 'customer'
type Customer = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
}

export function ValidateScreen({
  tenantSlug,
  initialCode,
}: {
  tenantSlug: string
  initialCode: string | null
}): React.JSX.Element {
  const [step, setStep] = useState<Step>(initialCode ? 'redemption' : 'idle')
  const [redeemToken, setRedeemToken] = useState<string | null>(initialCode)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [lookupBusy, startLookup] = useTransition()

  const resolveCode = useCallback(
    (raw: string) => {
      const scanned = parseScannedCode(raw, 'redemption')
      if (!scanned) {
        setStep('idle')
        toast.error('No reconocimos el código. Probá de nuevo o pegalo a mano.')
        return
      }
      if (scanned.kind === 'redemption') {
        setRedeemToken(scanned.token)
        setStep('redemption')
        return
      }
      // El QR personal del socio necesita un viaje al server para resolverlo. Sin
      // este estado el mozo escanea, la cámara se cierra, y se queda mirando los
      // dos botones del inicio sin ninguna señal de que algo está pasando —
      // parece que el escaneo no funcionó y vuelve a intentar.
      setStep('resolving')
      startLookup(async () => {
        const r = await lookupCustomerByQr(tenantSlug, scanned.token)
        if (!r.ok) {
          setStep('idle')
          toast.error(r.message)
          return
        }
        setCustomer(r.customer)
        setStep('customer')
      })
    },
    [tenantSlug],
  )

  const reset = () => {
    setStep('idle')
    setRedeemToken(null)
    setCustomer(null)
    setManualCode('')
  }

  if (step === 'redemption' && redeemToken) {
    return <RedemptionPanel tenantSlug={tenantSlug} redeemToken={redeemToken} onReset={reset} />
  }

  if (step === 'customer' && customer) {
    return (
      <div className="space-y-6">
        <div className="card-hairline rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <User2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium leading-tight">
                {customer.first_name} {customer.last_name}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {formatPhoneForDisplay(customer.phone)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Puntos</p>
              <p className="font-display text-base font-semibold tabular-nums">
                {customer.points_balance.toLocaleString('es-AR')}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground text-balance">
            Este es su QR personal, no un canje. Podés sellarle las tarjetas acá abajo.
          </p>
        </div>

        <PunchStamper
          tenantSlug={tenantSlug}
          customerId={customer.id}
          customerName={customer.first_name}
        />

        <Button variant="ghost" onClick={reset} className="h-11 w-full gap-2">
          <RotateCcw className="size-4" />
          Escanear otro código
        </Button>
      </div>
    )
  }

  if (step === 'resolving') {
    return (
      <div className="card-hairline flex flex-col items-center gap-3 rounded-2xl border bg-card p-10 text-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Buscando al socio…
        </p>
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
              resolveCode(code)
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
          Apuntá al código que te muestra el socio.
        </p>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="lg" className="h-11" onClick={() => setStep('idle')}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 gap-1.5"
            onClick={() => setStep('manual')}
          >
            <Keyboard className="size-4" />
            Cargar a mano
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
          if (!manualCode.trim()) return
          resolveCode(manualCode)
        }}
        className="card-hairline space-y-3 rounded-2xl border bg-card p-6"
      >
        <Label htmlFor="validar-code">Pegá o escribí el código</Label>
        <Input
          id="validar-code"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="El código largo que muestra la billetera"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Es el mismo que aparece abajo del QR, en la pantalla del socio.
        </p>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" className="h-11" onClick={() => setStep('idle')}>
            Volver
          </Button>
          <Button type="submit" disabled={lookupBusy} className="h-11 gap-1.5">
            {lookupBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Buscar
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="card-hairline space-y-4 rounded-2xl border bg-card p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
          <QrCode className="size-5" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground text-balance">
          Cuando el socio quiere usar un beneficio te muestra un código desde su billetera.
          Escanealo y te decimos qué entregarle.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={() => setStep('scanning')} size="xl" className="h-16 gap-2">
          <Camera className="size-5" />
          Escanear
        </Button>
        <Button
          onClick={() => setStep('manual')}
          size="xl"
          variant="outline"
          className="h-16 gap-2"
        >
          <Keyboard className="size-5" />
          Cargar a mano
        </Button>
      </div>
    </div>
  )
}
