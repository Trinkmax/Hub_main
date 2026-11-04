import { QR_EYE, STAR_PATH, type TicketQr } from '@/lib/ticketing/ticket-art'

/**
 * El QR de la entrada: columnas de píldoras, como la pista de sonido de una
 * película; los ojos, rollos vistos de frente, y la ✦ de HUB en el centro. Todo
 * en un solo color (`currentColor`), que siempre es una tinta bien oscura.
 *
 * Probado con ZXing (lo que usa nuestro escáner en iPhone) y con Vision (el motor
 * de la cámara del iPhone). Antes de cambiar el dibujo, repetir esa prueba: ojos
 * con agujeritos, por ejemplo, ZXing dejaba de leerlos.
 */
export function TicketQrArt({ qr, label }: { qr: TicketQr; label: string }) {
  const center = qr.size / 2
  const eyes = [
    [QR_EYE / 2, QR_EYE / 2],
    [qr.size - QR_EYE / 2, QR_EYE / 2],
    [QR_EYE / 2, qr.size - QR_EYE / 2],
  ] as const
  return (
    <svg
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full"
    >
      <path
        d={qr.path}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.86}
        strokeLinecap="round"
      />
      {eyes.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={3} fill="none" stroke="currentColor" strokeWidth={1} />
          <circle cx={x} cy={y} r={1.5} fill="currentColor" />
        </g>
      ))}
      <g transform={`translate(${center} ${center}) scale(${qr.hole * 0.46})`}>
        <path d={STAR_PATH} fill="currentColor" />
      </g>
    </svg>
  )
}
