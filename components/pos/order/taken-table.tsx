import { Lock } from 'lucide-react'
import Link from 'next/link'

/**
 * La mesa que atiende otro mozo, vista por un mozo que llegó por un enlace (un aviso viejo, el «atrás»
 * del navegador): no se le muestra el pedido ni se le deja operar. Desde el mapa ya la ve tomada; esta
 * pantalla es la puerta de atrás cerrada (`lib/pos/floor/waiter.ts`).
 */
export function TakenTable({
  slug,
  label,
  waiter,
}: {
  slug: string
  /** El número de la mesa, si tiene. */
  label: string | null
  /** Quién la atiende. */
  waiter: string | null
}) {
  return (
    <div
      className="pos-board flex min-h-[100dvh] flex-col"
      style={{ background: 'var(--pos-board)', color: 'var(--pos-board-ink)' }}
      data-testid="mesa-tomada"
    >
      <div className="pos-empty">
        <Lock className="size-10 opacity-70" aria-hidden />
        <h2>
          {label ? `La mesa ${label}` : 'Esta mesa'} la atiende {waiter ?? 'otra persona'}
        </h2>
        <p>
          Por eso no la podés abrir ni cargarle pedidos. Si te la pasa (o te la pasa el encargado),
          la vas a ver como tuya en el mapa.
        </p>
        <Link href={`/${slug}/salon/mapa`} className="pos-btn pos-btn-primary">
          Volver al salón
        </Link>
      </div>
    </div>
  )
}
