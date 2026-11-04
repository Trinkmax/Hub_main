'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { parseScannedCode } from '@/lib/redemptions/scan'
import type { DoorFunction } from '@/lib/ticketing/door'
import { TicketDoorPanel } from './ticket-door-panel'
import {
  forgetCameraDenied,
  rememberCameraDenied,
  useCameraGuard,
  useRecentCode,
} from './use-camera-guard'
import './door.css'

type Mode = 'camera' | 'denied' | 'manual'

/**
 * La pestaña Puerta: la cámara prendida y, arriba, cómo va la sala. Solo entiende
 * entradas: si le muestran otro QR del bar, lo dice en vez de abrir otra pantalla.
 */
export function DoorScreen({
  tenantSlug,
  initialCode,
  today,
}: {
  tenantSlug: string
  initialCode: string | null
  today: DoorFunction[]
}) {
  const [token, setToken] = useState<string | null>(initialCode)
  const [mode, setMode] = useState<Mode>('camera')
  const [manual, setManual] = useState('')
  const recent = useRecentCode()
  useCameraGuard(() => setMode('denied'), !initialCode)

  const resolve = useCallback(
    (raw: string, fromCamera: boolean) => {
      const scanned = parseScannedCode(raw, 'ticket')
      if (scanned?.kind === 'ticket') {
        if (!(fromCamera && recent.isRecent(scanned.token))) setToken(scanned.token)
        return
      }
      if (scanned) {
        toast.error('Ese QR no es de una entrada. Para sumar puntos, andá a «Sumar puntos».')
      } else {
        toast.error('No reconocimos el código. Probá de nuevo o cargá el número de la entrada.')
      }
    },
    [recent],
  )

  if (token) {
    return (
      <TicketDoorPanel
        tenantSlug={tenantSlug}
        token={token}
        onDone={() => {
          recent.remember(token)
          setToken(null)
          setManual('')
          setMode('camera')
          // Que recargar no reabra la última entrada (llegó con ?code= desde /e/).
          if (window.location.search) {
            window.history.replaceState(null, '', window.location.pathname)
          }
        }}
      />
    )
  }

  return (
    <div className="door door-scan -mx-4 -mt-3">
      <RoomSign today={today} />

      {mode === 'camera' ? (
        <>
          <div className="door-lens">
            <Scanner
              onScan={(codes: IDetectedBarcode[]) => {
                const code = codes[0]?.rawValue
                if (code) resolve(code, true)
              }}
              onError={(e) => {
                const msg = e instanceof Error ? e.message : ''
                if (/denied|NotAllowed|Permission/i.test(msg)) rememberCameraDenied()
                else toast.error(msg || 'No pudimos abrir la cámara.')
                setMode('denied')
              }}
              constraints={{ facingMode: 'environment' }}
              scanDelay={350}
              allowMultiple={false}
              formats={['qr_code']}
              components={{ finder: false, torch: true }}
            />
            <div className="door-finder" aria-hidden />
          </div>
          <div className="space-y-2 px-4 pt-4 pb-5">
            <p className="text-center text-base text-balance">
              Apuntá al QR de la entrada que te muestra el cliente.
            </p>
            <button
              type="button"
              className="door-btn door-btn-soft w-full"
              onClick={() => setMode('manual')}
            >
              <Keyboard className="size-5" aria-hidden />
              Cargar el número a mano
            </button>
          </div>
        </>
      ) : null}

      {mode === 'denied' ? (
        <div className="space-y-3 px-4 py-8 text-center">
          <CameraOff className="mx-auto size-9" aria-hidden />
          <h2 className="font-[family-name:var(--door-serif)] text-2xl font-semibold">
            Sin acceso a la cámara
          </h2>
          <p className="text-sm text-balance opacity-80">
            Habilitala en los permisos del navegador para escanear, o cargá el número de la entrada.
          </p>
          <button
            type="button"
            className="door-btn door-btn-main w-full"
            onClick={() => {
              forgetCameraDenied()
              setMode('camera')
            }}
          >
            <Camera className="size-5" aria-hidden />
            Reintentar con la cámara
          </button>
          <button
            type="button"
            className="door-btn door-btn-soft w-full"
            onClick={() => setMode('manual')}
          >
            <Keyboard className="size-5" aria-hidden />
            Cargar el número a mano
          </button>
        </div>
      ) : null}

      {mode === 'manual' ? (
        <form
          className="space-y-3 px-4 py-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (manual.trim()) resolve(manual, false)
          }}
        >
          <label className="block text-base font-semibold" htmlFor="door-code">
            Número de la entrada
          </label>
          <input
            id="door-code"
            className="door-field-input"
            // biome-ignore lint/a11y/noAutofocus: se abrió recién para escribir este número
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="A1B2 C3D4"
          />
          <p className="text-sm opacity-75">Son los 8 caracteres que están debajo del QR.</p>
          <button type="submit" className="door-btn door-btn-main w-full">
            Buscar
          </button>
          <button
            type="button"
            className="door-btn door-btn-soft w-full"
            onClick={() => setMode('camera')}
          >
            <ScanLine className="size-5" aria-hidden />
            Volver a la cámara
          </button>
        </form>
      ) : null}
    </div>
  )
}

/** El cartel de la sala: qué función hay hoy y cuántos entraron. */
function RoomSign({ today }: { today: DoorFunction[] }) {
  if (today.length === 0) {
    return (
      <div className="door-sign">
        <p className="text-sm opacity-80">Hoy no hay funciones con entrada.</p>
      </div>
    )
  }
  return (
    <div className="door-sign space-y-1">
      {today.map((f) => (
        <div key={f.event_id} className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate font-[family-name:var(--door-serif)] text-xl font-semibold tracking-[-0.02em]">
            {f.title}
            <span className="ml-2 font-sans text-sm font-normal opacity-70">{f.time} hs</span>
          </p>
          <p className="shrink-0 text-sm tabular-nums">
            <strong className="text-lg">{f.inside}</strong>
            <span className="opacity-70"> de {f.expected} adentro</span>
          </p>
        </div>
      ))}
    </div>
  )
}
