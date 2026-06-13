import { QrCode } from 'lucide-react'
import Image from 'next/image'

// QR personal del cliente. Así el staff acredita y canjea puntos en la caja.
// Server component — el data URL llega ya generado desde la page.

export function PersonalQr({
  qrDataUrl,
  qrToken,
}: {
  qrDataUrl: string
  qrToken: string
}): React.JSX.Element {
  return (
    <section
      aria-label="Tu QR personal"
      className="card-hairline overflow-hidden rounded-2xl border bg-card p-6 text-center shadow-md"
    >
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        <QrCode className="size-3.5" aria-hidden="true" />
        Tu QR
      </div>

      <div className="mx-auto mt-4 size-56 max-w-full overflow-hidden rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border/60">
        <Image
          src={qrDataUrl}
          alt="Tu código QR personal"
          width={224}
          height={224}
          className="size-full"
          unoptimized
          priority
        />
      </div>

      <p className="mx-auto mt-4 max-w-[30ch] text-balance text-sm text-muted-foreground">
        Mostrá este QR en la caja para sumar y canjear puntos.
      </p>

      <code className="mt-3 inline-block select-all rounded bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
        {qrToken.slice(0, 8)}…{qrToken.slice(-4)}
      </code>
    </section>
  )
}
