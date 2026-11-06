'use client'

import { Copy, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { QtyStepper } from '@/components/purchasing/qty-stepper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDayMonth, isoDayInCordoba } from '@/lib/dates'
import { relativeDayLabel } from '@/lib/purchasing/dates'
import { backToDraft, confirmOrder, confirmWithChanges } from '@/lib/purchasing/order-actions'
import type { PurOrder, PurSupplier } from '@/lib/purchasing/types'
import { packsText } from '@/lib/purchasing/units'
import { whatsappLink } from '@/lib/purchasing/whatsapp'
import { cn } from '@/lib/utils'

/** Un pedido mandado: cuando el proveedor contesta, se confirma (tal cual o con cambios) y recién ahí pasa a cocina. */
export function SentCard({
  slug,
  today,
  order,
  supplier,
}: {
  slug: string
  today: string
  order: PurOrder
  supplier: PurSupplier | null
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'ask' | 'changes'>('ask')
  const [showMessage, setShowMessage] = useState(false)
  const [viene, setViene] = useState<Map<string, number>>(
    () => new Map(order.lines.map((l) => [l.id, l.orderedPacks ?? 0])),
  )
  const [date, setDate] = useState(order.expectedDate ?? '')
  const [kitchenNote, setKitchenNote] = useState(order.kitchenNote ?? '')
  const [pending, start] = useTransition()
  const lines = order.lines.filter((l) => (l.orderedPacks ?? 0) > 0)
  const sentDay = order.sentAt ? isoDayInCordoba(order.sentAt) : null
  const resend = order.message && supplier ? whatsappLink(supplier.whatsapp, order.message) : null

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo guardar.')
        return
      }
      toast.success(done)
      router.refresh()
    })

  return (
    <article className="card-hairline rounded-3xl bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{supplier?.name ?? 'Sin proveedor'}</h3>
          <p className="text-sm text-muted-foreground">
            {sentDay ? `Enviado ${formatDayMonth(sentDay)} · ` : ''}
            {lines.length} {lines.length === 1 ? 'producto' : 'productos'}
            {order.expectedDate
              ? ` · entrega prevista ${relativeDayLabel(order.expectedDate, today)}`
              : ' · sin fecha'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {resend ? (
            <a
              href={resend}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted"
            >
              <MessageCircle className="size-4" aria-hidden />
              Reenviar WhatsApp
            </a>
          ) : null}
          {order.message ? (
            <button
              type="button"
              onClick={() => setShowMessage((v) => !v)}
              aria-expanded={showMessage}
              className="min-h-10 px-1 text-sm font-medium underline underline-offset-4"
            >
              {showMessage ? 'Ocultar mensaje' : 'Ver mensaje'}
            </button>
          ) : null}
        </div>
      </div>

      {showMessage && order.message ? (
        <div className="mt-3 rounded-2xl bg-muted/60 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm">{order.message}</pre>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(order.message ?? '')
                .then(() => toast.success('Mensaje copiado.'))
            }
            className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
          >
            <Copy className="size-3.5" aria-hidden /> Copiar
          </button>
        </div>
      ) : null}

      {mode === 'ask' ? (
        <>
          <p className="mt-4 font-semibold">¿El proveedor confirmó? ¿Hubo algún cambio?</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              className="h-11 rounded-xl"
              disabled={pending}
              onClick={() =>
                run(
                  () => confirmOrder({ slug, orderId: order.id }),
                  'Confirmado: ya le aparece a la cocina.',
                )
              }
            >
              Confirmado, va todo como se pidió
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-warning/60 bg-warning/10 text-warning-text hover:bg-warning/20"
              disabled={pending}
              onClick={() => setMode('changes')}
            >
              Hubo cambios
            </Button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => backToDraft({ slug, orderId: order.id }), 'Volvió a borrador.')
              }
              className="min-h-11 px-2 text-sm font-medium text-muted-foreground underline underline-offset-4"
            >
              Volver a borrador
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <p className="font-semibold">¿Qué cambió?</p>
          <p className="text-sm text-muted-foreground">
            Corregí lo que viene. 0 = el proveedor no lo tiene.
          </p>
          <ul className="mt-3 divide-y divide-border/70 border-y border-border/70">
            {lines.map((l) => {
              const v = viene.get(l.id) ?? 0
              return (
                <li
                  key={l.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_minmax(0,1fr)]"
                >
                  <span
                    className={cn('font-semibold', v === 0 && 'text-muted-foreground line-through')}
                  >
                    {l.name}
                  </span>
                  <span className="col-start-1 text-sm text-muted-foreground sm:col-start-auto sm:text-right">
                    Pediste{' '}
                    {packsText({
                      packs: l.orderedPacks ?? 0,
                      packLabel: l.packLabel,
                      packSize: l.packSize,
                      unit: l.unit,
                    })}
                  </span>
                  <span className="col-start-2 row-span-2 row-start-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                    <QtyStepper
                      size="sm"
                      value={v}
                      label={`Cuánto viene de ${l.name}`}
                      onChange={(n) => setViene((prev) => new Map(prev).set(l.id, n ?? 0))}
                    />
                  </span>
                  <span className="col-start-1 text-sm sm:col-start-auto">
                    {v === 0 ? (
                      <span className="text-muted-foreground">No viene</span>
                    ) : (
                      packsText({
                        packs: v,
                        packLabel: l.packLabel,
                        packSize: l.packSize,
                        unit: l.unit,
                      })
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="mt-4 grid gap-3 sm:grid-cols-[12rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor={`date-${order.id}`}>Llega el</Label>
              <Input
                id={`date-${order.id}`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`kn-${order.id}`}>Nota para la cocina (opcional)</Label>
              <Input
                id={`kn-${order.id}`}
                value={kitchenNote}
                onChange={(e) => setKitchenNote(e.target.value)}
                maxLength={500}
                placeholder="Ej.: el criollo viene recién el viernes"
                className="h-11"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setMode('ask')}
              className="min-h-11 px-2 text-sm font-medium text-muted-foreground underline underline-offset-4"
            >
              Cancelar
            </button>
            <Button
              type="button"
              className="h-11 rounded-xl"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    confirmWithChanges({
                      slug,
                      orderId: order.id,
                      lines: lines.map((l) => ({ id: l.id, confirmedPacks: viene.get(l.id) ?? 0 })),
                      expectedDate: date || null,
                      kitchenNote: kitchenNote.trim() || null,
                    }),
                  'Confirmado con los cambios: ya le aparece a la cocina.',
                )
              }
            >
              Confirmar y pasar a cocina
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}
