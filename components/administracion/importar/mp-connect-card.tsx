import { PlugZap } from 'lucide-react'

/**
 * Lugar reservado para conectar Mercado Pago por API (diseño §4.2.4, WP12):
 * con el token conectado, el reporte se pide y se baja solo todos los días y
 * acá aparecen «Traer ahora» y el estado de la sincronización. Hasta entonces,
 * solo cuenta que viene. Server-safe.
 */
export function MpConnectCard({ className }: { className?: string }) {
  return (
    <section
      aria-label="Conexión directa con Mercado Pago"
      className={
        className ??
        'flex items-start gap-3 rounded-xl border border-dashed border-border/80 bg-card/50 p-4 text-sm'
      }
    >
      <PlugZap className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-muted-foreground text-pretty">
        <span className="font-medium text-foreground">Próximamente, sin bajar archivos:</span> vas a
        poder conectar tu cuenta de Mercado Pago y vamos a traer los movimientos solos todos los
        días. Vos solo revisás y confirmás.
      </p>
    </section>
  )
}
