'use client'

import { CircleCheck } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Amount } from '@/components/administracion/amount'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import { skipRecurringDue } from '@/lib/accounting/actions/master'
import type { SummaryAttentionItem } from '@/lib/accounting/queries/summary'
import { cn } from '@/lib/utils'
import { useMasterAction } from '../ajustes/_components/use-master-action'
import { type AttentionAction, type AttentionTone, attentionView } from './summary-copy'

const DOT: Readonly<Record<AttentionTone, string>> = {
  danger: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-info',
}

/**
 * «Necesita atención» (H.4): hasta 8 filas por urgencia, cada una con su
 * acción a un toque. Las hojas se abren sobre el Resumen; lo que es una
 * pantalla (cierre del día, factura del gasto fijo) va por link.
 */
export function AttentionList({
  items,
  today,
  base,
}: {
  items: readonly SummaryAttentionItem[]
  today: string
  base: string
}) {
  const { openAction, tenantSlug, readOnly } = useAccounting()
  const { pending, run } = useMasterAction()
  const views = items.map((item, index) => attentionView(item, today, base, index))

  if (views.length === 0) {
    return (
      <p className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
        <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
        Nada pendiente. Está todo al día.
      </p>
    )
  }

  const control = (action: AttentionAction, key: string) => {
    const size = 'h-11 md:h-8'
    switch (action.type) {
      case 'sheet':
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            className={size}
            onClick={() => openAction(action.action, action.params)}
          >
            {action.label}
          </Button>
        )
      case 'link':
        return (
          <Button key={key} asChild variant="outline" size="sm" className={size}>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )
      case 'skip':
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(size, 'text-muted-foreground')}
            disabled={pending}
            onClick={() =>
              run(() =>
                skipRecurringDue(tenantSlug, { id: action.recurringId, dueDate: action.dueDate }),
              )
            }
          >
            {action.label}
          </Button>
        )
    }
  }

  return (
    <ul className="divide-y divide-border/60">
      {views.map((view) => (
        <li
          key={view.key}
          // Desde sm, en una fila; si el texto quedaría angosto (menos de 16rem),
          // los botones bajan a una segunda línea, alineados a la derecha.
          className="flex flex-col gap-2.5 px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:basis-64">
            <span
              aria-hidden="true"
              className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[view.tone])}
            />
            <p className="min-w-0 text-sm text-foreground text-pretty">
              {/* Espacio duro antes de cada «·»: un renglón nunca empieza con el punto. */}
              <VoucherText text={view.text.replace(/ · /g, ' · ')} />
            </p>
          </div>
          {view.amountCents !== null ? (
            <span className="whitespace-nowrap pl-[18px] text-sm font-medium sm:pl-0 sm:text-right">
              {view.amountPrefix ? (
                <span className="mr-1 text-xs font-normal text-muted-foreground">
                  {view.amountPrefix}
                </span>
              ) : null}
              <Amount cents={Math.abs(view.amountCents)} decimals={0} />
            </span>
          ) : null}
          {!readOnly && view.actions.length > 0 ? (
            <div className="flex flex-wrap gap-2 pl-[18px] sm:ml-auto sm:shrink-0 sm:pl-0">
              {view.actions.map((action, index) => control(action, `${view.key}:${index}`))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
