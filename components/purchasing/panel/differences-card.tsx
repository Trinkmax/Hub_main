'use client'

import { Copy, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatDayMonth, isoDayInCordoba } from '@/lib/dates'
import { closeDifferences } from '@/lib/purchasing/order-actions'
import { expectedPacks, type PurOrder, type PurSupplier } from '@/lib/purchasing/types'
import { formatQty, packsText } from '@/lib/purchasing/units'
import { claimMessage, whatsappLink } from '@/lib/purchasing/whatsapp'

/** Lo que llegó distinto: el reclamo armado por WhatsApp y «Cerrar». Lo que faltó vuelve solo al próximo pedido. */
export function DifferencesCard({
  slug,
  order,
  supplier,
  senderName,
}: {
  slug: string
  order: PurOrder
  supplier: PurSupplier | null
  senderName: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const diffs = order.lines.filter(
    (l) => l.receivedState === 'partial' || l.receivedState === 'missing',
  )
  const receivedDay = order.receivedAt ? isoDayInCordoba(order.receivedAt) : null
  const message = claimMessage({
    senderName,
    contactName: supplier?.contactName ?? null,
    receivedDate: receivedDay,
    lines: diffs.map((l) => ({
      name: l.name,
      packs: expectedPacks(l),
      packLabel: l.packLabel,
      packSize: l.packSize,
      unit: l.unit,
      receivedPacks: l.receivedPacks ?? 0,
    })),
  })
  const wa = supplier ? whatsappLink(supplier.whatsapp, message) : null

  const close = () =>
    start(async () => {
      const res = await closeDifferences({ slug, orderId: order.id })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success('Cerrado. Lo que faltó vuelve solo en el próximo pedido sugerido.')
      router.refresh()
    })

  return (
    <article className="rounded-3xl border-2 border-destructive/35 bg-card p-5 shadow-xs">
      <h3 className="text-lg font-semibold">{supplier?.name ?? 'Sin proveedor'}</h3>
      <p className="text-sm text-muted-foreground">
        Recibió {order.receivedByName ?? 'la cocina'}
        {receivedDay ? ` el ${formatDayMonth(receivedDay)}` : ''} · {diffs.length}{' '}
        {diffs.length === 1 ? 'diferencia' : 'diferencias'}
      </p>

      <div className="mt-3 hidden grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-3 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:grid">
        <span>Producto</span>
        <span className="text-right">Esperado</span>
        <span className="text-right">Llegó</span>
        <span className="text-right">Diferencia</span>
      </div>
      <ul className="mt-1 divide-y divide-border/70 border-y border-border/70">
        {diffs.map((l) => {
          const exp = expectedPacks(l)
          const got = l.receivedPacks ?? 0
          return (
            <li
              key={l.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
            >
              <span className="font-semibold">{l.name}</span>
              <span className="text-right text-sm sm:text-[0.95rem]">
                <span className="text-muted-foreground sm:hidden">esperado </span>
                {packsText({
                  packs: exp,
                  packLabel: l.packLabel,
                  packSize: l.packSize,
                  unit: l.unit,
                })}
              </span>
              <span className="text-sm font-semibold text-destructive sm:text-right sm:text-[0.95rem]">
                <span className="font-normal text-muted-foreground sm:hidden">llegó </span>
                {got <= 0
                  ? 'Nada'
                  : packsText({
                      packs: got,
                      packLabel: l.packLabel,
                      packSize: l.packSize,
                      unit: l.unit,
                    })}
              </span>
              <span className="text-right text-sm tabular-nums sm:text-[0.95rem]">
                {got - exp > 0 ? '+' : ''}
                {formatQty(got - exp)}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Si no lo reclamás, lo que faltó entra solo en el próximo pedido sugerido.
        </p>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 font-semibold hover:bg-muted"
            >
              <MessageCircle className="size-4" aria-hidden />
              Reclamar por WhatsApp
            </a>
          ) : (
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(message)
                  .then(() => toast.success('Reclamo copiado.'))
              }
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 font-semibold hover:bg-muted"
            >
              <Copy className="size-4" aria-hidden />
              Copiar el reclamo
            </button>
          )}
          <Button type="button" className="h-11 rounded-xl" onClick={close} disabled={pending}>
            Cerrar
          </Button>
        </div>
      </div>
    </article>
  )
}
