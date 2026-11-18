'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { Camera, CameraOff, Keyboard, Loader2, ScanLine } from 'lucide-react'
import { useCallback, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { TicketDoorPanel } from '@/components/door/ticket-door-panel'
import {
  forgetCameraDenied,
  rememberCameraDenied,
  useCameraGuard,
  useRecentCode,
} from '@/components/door/use-camera-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CustomerByQr } from '@/lib/customers/queries'
import { lookupCustomerByQr } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import { parseScannedCode, type ScanKind } from '@/lib/redemptions/scan'
import { cn } from '@/lib/utils'
import { AwardFlow } from './award-flow'
import { RedemptionPanel } from './redemption-panel'

// La pantalla que más usa el mozo en el turno, y la misma que abre el dueño desde el panel
// («Sumar puntos» › Escanear): una sola implementación para los dos.
//
// Un solo escáner para los QR que circulan por el bar (ver
// lib/redemptions/scan.ts) — el mozo no elige "qué" está escaneando:
//
//   /c/<qr_token>     → el socio en mano: acreditarle el consumo y sellar
//   /v/<redeem_token> → un canje pedido: validarlo y entregarlo
//   /e/<código>       → una entrada: dejarla pasar (lo mismo que la pestaña Puerta)
//
// La cámara arranca sola al entrar: antes había que tocar "Escanear" primero,
// un toque de peaje en la acción más repetida del turno.

type Step = 'scanning' | 'denied' | 'resolving' | 'customer' | 'redemption' | 'ticket' | 'manual'

export function ScanScreen({
  tenantSlug,
  initialCode,
  earnRate,
}: {
  tenantSlug: string
  initialCode: string | null
  earnRate: EarnRate | null
}): React.JSX.Element {
  // Si venimos de /v/<token> el canje ya está resuelto: ni abrimos la cámara.
  const [step, setStep] = useState<Step>(initialCode ? 'redemption' : 'scanning')
  const [redeemToken, setRedeemToken] = useState<string | null>(initialCode)
  const [ticketToken, setTicketToken] = useState<string | null>(null)
  const [customer, setCustomer] = useState<CustomerByQr | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [manualKind, setManualKind] = useState<ScanKind>('customer')
  const [, startLookup] = useTransition()

  const recentTicket = useRecentCode()
  useCameraGuard(() => setStep('denied'), !initialCode)

  const resolveCode = useCallback(
    (raw: string, fallback: ScanKind, fromCamera = false) => {
      const scanned = parseScannedCode(raw, fallback)
      if (!scanned) {
        toast.error('No reconocimos el código. Probá de nuevo o cargalo a mano.')
        return
      }
      if (scanned.kind === 'redemption') {
        setRedeemToken(scanned.token)
        setStep('redemption')
        return
      }
      if (scanned.kind === 'ticket') {
        if (fromCamera && recentTicket.isRecent(scanned.token)) return
        setTicketToken(scanned.token)
        setStep('ticket')
        return
      }
      // El QR personal necesita un viaje al server. Sin este estado el mozo
      // escanea, la cámara se cierra, y se queda mirando la pantalla sin
      // ninguna señal de que algo está pasando.
      setStep('resolving')
      startLookup(async () => {
        const r = await lookupCustomerByQr(tenantSlug, scanned.token)
        if (!r.ok) {
          setStep('scanning')
          toast.error(r.message)
          return
        }
        setCustomer(r.customer)
        setStep('customer')
      })
    },
    [tenantSlug, recentTicket],
  )

  const reset = useCallback(() => {
    setStep('scanning')
    setRedeemToken(null)
    setTicketToken(null)
    setCustomer(null)
    setManualCode('')
    setManualKind('customer')
  }, [])

  if (step === 'redemption' && redeemToken) {
    return <RedemptionPanel tenantSlug={tenantSlug} redeemToken={redeemToken} onReset={reset} />
  }

  if (step === 'ticket' && ticketToken) {
    return (
      <TicketDoorPanel
        tenantSlug={tenantSlug}
        token={ticketToken}
        onDone={() => {
          recentTicket.remember(ticketToken)
          reset()
        }}
      />
    )
  }

  // ── Socio en mano: cargar consumo + sellar ────────────────────────────
  if (step === 'customer' && customer) {
    return (
      <AwardFlow
        tenantSlug={tenantSlug}
        customer={customer}
        earnRate={earnRate}
        onReset={reset}
        resetLabel="Escanear otro código"
        nextLabel="Escanear el próximo"
        nextIcon={<ScanLine className="size-5" aria-hidden />}
      />
    )
  }

  if (step === 'resolving') {
    return (
      <div className="card-hairline flex flex-col items-center gap-3 rounded-2xl border bg-card p-12 text-center">
        <Loader2 className="size-7 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Buscando al socio…
        </p>
      </div>
    )
  }

  // ── Carga a mano ──────────────────────────────────────────────────────
  if (step === 'manual') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!manualCode.trim()) return
          resolveCode(manualCode, manualKind)
        }}
        className="card-hairline space-y-4 rounded-2xl border bg-card p-5"
      >
        {/* El toggle es necesario, no decorativo: un token pelado es idéntico en
            socio y canje, así que alguien tiene que decir qué es. Antes el salón
            asumía SIEMPRE "canje" y todo código de socio tipeado a mano moría en
            "este código no existe". */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">¿Qué código estás cargando?</legend>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['customer', 'Socio'],
                ['redemption', 'Canje'],
                ['ticket', 'Entrada'],
              ] as const
            ).map(([kind, label]) => (
              <Button
                key={kind}
                type="button"
                variant={manualKind === kind ? 'default' : 'outline'}
                size="lg"
                className="h-12"
                aria-pressed={manualKind === kind}
                onClick={() => setManualKind(kind)}
              >
                {label}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="scan-code">Código</Label>
          <Input
            id="scan-code"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Pegá o dictá el código"
            className="h-12 font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {manualKind === 'customer'
              ? 'El socio lo ve en su billetera, abajo del QR, agrupado de a 4.'
              : manualKind === 'ticket'
                ? 'Son los 8 caracteres que están debajo del QR de la entrada.'
                : 'Es el código que acompaña al QR del beneficio.'}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="xl"
            className="h-13"
            onClick={() => setStep('scanning')}
          >
            Volver
          </Button>
          <Button type="submit" size="xl" className="h-13 flex-1">
            Buscar
          </Button>
        </div>
      </form>
    )
  }

  // ── Cámara denegada ───────────────────────────────────────────────────
  if (step === 'denied') {
    return (
      <div className="space-y-3">
        <div className="card-hairline rounded-2xl border bg-card p-8 text-center">
          <CameraOff className="mx-auto size-9 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 font-display text-lg font-semibold">Sin acceso a la cámara</h2>
          <p className="mt-1 text-sm text-muted-foreground text-balance">
            Habilitala en los permisos del navegador para escanear, o cargá el código a mano.
          </p>
        </div>
        <Button
          size="xl"
          className="h-14 w-full gap-2"
          onClick={() => {
            forgetCameraDenied()
            setStep('scanning')
          }}
        >
          <Camera className="size-5" aria-hidden />
          Reintentar con la cámara
        </Button>
        <Button
          variant="outline"
          size="xl"
          className="h-13 w-full gap-2"
          onClick={() => setStep('manual')}
        >
          <Keyboard className="size-5" aria-hidden />
          Cargar a mano
        </Button>
      </div>
    )
  }

  // ── Escaneando (estado por defecto) ───────────────────────────────────
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'card-hairline overflow-hidden rounded-2xl border bg-card',
          '[&_video]:aspect-square [&_video]:w-full [&_video]:object-cover',
        )}
      >
        <Scanner
          onScan={(codes: IDetectedBarcode[]) => {
            const code = codes[0]?.rawValue
            if (!code) return
            resolveCode(code, 'customer', true)
          }}
          onError={(e) => {
            const msg = e instanceof Error ? e.message : ''
            const denied = /denied|NotAllowed|Permission/i.test(msg)
            if (denied) {
              rememberCameraDenied()
              setStep('denied')
              return
            }
            toast.error(msg || 'No pudimos abrir la cámara.')
            setStep('denied')
          }}
          constraints={{ facingMode: 'environment' }}
          scanDelay={400}
          allowMultiple={false}
          components={{ finder: true, torch: true }}
        />
        <p className="px-4 py-3 text-center text-sm text-muted-foreground text-balance">
          Apuntá al QR que te muestra el cliente. Sirve el suyo para sumar puntos, el de un
          beneficio para entregar y el de una entrada para dejarla pasar.
        </p>
      </div>

      <Button
        variant="outline"
        size="xl"
        className="h-13 w-full gap-2"
        onClick={() => setStep('manual')}
      >
        <Keyboard className="size-5" aria-hidden />
        Cargar el código a mano
      </Button>
    </div>
  )
}
