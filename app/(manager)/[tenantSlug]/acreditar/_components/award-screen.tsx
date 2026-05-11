'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { Camera, CheckCircle2, Keyboard, Loader2, RotateCcw, Star, User2 } from 'lucide-react'
import { useCallback, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPhoneForDisplay } from '@/lib/phone'
import { awardPointsByAmount, lookupCustomerByQr } from '@/lib/points/actions'

type Step = 'idle' | 'scanning' | 'manual' | 'confirm' | 'success'
type Customer = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
}
type AwardResultData = {
  customer_id: string
  points_awarded: number
  amount_cents: number
  new_balance: number
}

// Extrae el qr_token de varios formatos posibles:
//  - URL completa "https://app/c/<token>"
//  - Path "/c/<token>"
//  - Token raw "<token>"
function extractTokenFrom(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const slashMatch = trimmed.match(/\/c\/([A-Za-z0-9_-]+)/)
  if (slashMatch?.[1]) return slashMatch[1]
  if (/^[A-Za-z0-9]{16,128}$/.test(trimmed)) return trimmed
  return null
}

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function AwardScreen({ tenantSlug }: { tenantSlug: string }) {
  const [step, setStep] = useState<Step>('idle')
  const [manualToken, setManualToken] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [amountPesos, setAmountPesos] = useState('')
  const [lastResult, setLastResult] = useState<AwardResultData | null>(null)
  const [lookupBusy, startLookup] = useTransition()
  const [awardBusy, startAward] = useTransition()

  const resolveToken = useCallback(
    (token: string) => {
      const cleaned = extractTokenFrom(token)
      if (!cleaned) {
        toast.error('No reconocimos el QR. Probá manual.')
        return
      }
      startLookup(async () => {
        const r = await lookupCustomerByQr(tenantSlug, cleaned)
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

  const onScan = (codes: IDetectedBarcode[]) => {
    const code = codes[0]?.rawValue
    if (!code) return
    setStep('idle')
    resolveToken(code)
  }

  const onManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualToken.trim()) return
    resolveToken(manualToken)
  }

  const onConfirmAward = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer) return
    const cents = Math.round(Number(amountPesos.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error('Monto inválido.')
      return
    }
    startAward(async () => {
      const r = await awardPointsByAmount(tenantSlug, {
        customer_id: customer.id,
        amount_cents: cents,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      setLastResult({
        customer_id: r.customer_id,
        points_awarded: r.points_awarded,
        amount_cents: r.amount_cents,
        new_balance: r.new_balance,
      })
      setStep('success')
    })
  }

  const reset = () => {
    setStep('idle')
    setManualToken('')
    setCustomer(null)
    setAmountPesos('')
    setLastResult(null)
  }

  if (step === 'success' && lastResult && customer) {
    return (
      <div className="card-hairline rounded-2xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-primary" />
        <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
          +{lastResult.points_awarded.toLocaleString('es-AR')} puntos
        </h2>
        <p className="text-sm text-muted-foreground">
          Para {customer.first_name} {customer.last_name}
          {' · '}
          {fmtCents(lastResult.amount_cents)} pagados
        </p>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">Nuevo balance</p>
        <p className="font-display text-3xl font-semibold tabular-nums">
          {lastResult.new_balance.toLocaleString('es-AR')}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset} className="gap-2">
            <RotateCcw className="size-3.5" />
            Acreditar a otro cliente
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'confirm' && customer) {
    return (
      <form
        onSubmit={onConfirmAward}
        className="card-hairline space-y-5 rounded-2xl border bg-card p-6"
      >
        <div className="flex items-center gap-3 rounded-lg bg-secondary/40 p-3">
          <User2 className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight">
              {customer.first_name} {customer.last_name}
            </p>
            <p className="text-xs font-mono text-muted-foreground">
              {formatPhoneForDisplay(customer.phone)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</p>
            <p className="font-display text-base font-semibold tabular-nums">
              {customer.points_balance.toLocaleString('es-AR')}
            </p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="amount-pesos">Monto pagado ($)</Label>
          <Input
            id="amount-pesos"
            type="number"
            inputMode="decimal"
            min={1}
            step="1"
            required
            autoFocus
            value={amountPesos}
            onChange={(e) => setAmountPesos(e.target.value)}
            placeholder="4500"
            className="text-2xl tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            Se acredita 1 punto por cada peso (configurable en{' '}
            <span className="font-mono">Puntos</span>).
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={reset} disabled={awardBusy}>
            Cancelar
          </Button>
          <Button type="submit" disabled={awardBusy} className="gap-2">
            {awardBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Star className="size-3.5" />
            )}
            {awardBusy ? 'Acreditando…' : 'Acreditar puntos'}
          </Button>
        </div>
      </form>
    )
  }

  if (step === 'scanning') {
    return (
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4">
        <div className="overflow-hidden rounded-xl">
          <Scanner
            onScan={onScan}
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
        <p className="text-center text-xs text-muted-foreground">
          {lookupBusy ? 'Buscando cliente…' : 'Apuntá la cámara al QR del cliente.'}
        </p>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setStep('idle')}>
            Cancelar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStep('manual')} className="gap-1.5">
            <Keyboard className="size-3.5" />
            Cargar manual
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'manual') {
    return (
      <form
        onSubmit={onManualSubmit}
        className="card-hairline space-y-3 rounded-2xl border bg-card p-6"
      >
        <Label htmlFor="manual-token">Pegá el código del cliente</Label>
        <Input
          id="manual-token"
          autoFocus
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder="https://app/c/abc123… o token raw"
        />
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setStep('idle')}>
            Volver
          </Button>
          <Button type="submit" disabled={lookupBusy} className="gap-1.5">
            {lookupBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Buscar
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="card-hairline space-y-3 rounded-2xl border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        Pedile al cliente que abra su pantalla con QR personal y elegí:
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={() => setStep('scanning')} size="lg" className="h-16 gap-2">
          <Camera className="size-5" />
          Escanear QR
        </Button>
        <Button
          onClick={() => setStep('manual')}
          size="lg"
          variant="outline"
          className="h-16 gap-2"
        >
          <Keyboard className="size-5" />
          Cargar manual
        </Button>
      </div>
    </div>
  )
}
