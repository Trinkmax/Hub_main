'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Amount } from '@/components/administracion/amount'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import { skipRecurringDue } from '@/lib/accounting/actions/master'
import { cn } from '@/lib/utils'
import { useMasterAction } from '../ajustes/_components/use-master-action'
import type { AttentionAction, AttentionTone, AttentionView } from './summary-copy'

const PILL_TONE = { danger: 'late', warning: 'warn', info: 'info' } as const

/** La palabra de la píldora según la urgencia: el color nunca va solo. */
export type AttentionWords = Readonly<Record<AttentionTone, string>>

/**
 * Renglones de aviso con su acción a un toque: los usan «Lo que tenés que
 * pagar» (lo vencido y lo que vence, con [Pagar]) y «Avisos» (todo lo demás).
 * La frase, la urgencia y la acción ya vienen armadas del servidor
 * (`attentionView`, puro y con tests); acá solo se dibujan y se conectan los
 * botones: las hojas se abren sobre el Resumen y lo que es una pantalla va por
 * link.
 *
 * En modo lectura no hay botones: la contadora lee los mismos renglones.
 */
export function AttentionRows({
  views,
  words,
  className,
}: {
  views: readonly AttentionView[]
  words: AttentionWords
  className?: string
}) {
  const { openAction, tenantSlug, readOnly } = useAccounting()
  const { pending, run } = useMasterAction()
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()

  const control = (action: AttentionAction, key: string) => {
    const size = 'h-11 md:h-9'
    switch (action.type) {
      case 'sheet':
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            className={size}
            onClick={() => openAction(action.action, action.params)}
          >
            {action.label}
          </Button>
        )
      case 'link':
        return (
          <Button key={key} asChild variant="outline" className={size}>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )
      case 'retry':
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            className={size}
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {refreshing ? 'Cargando…' : action.label}
          </Button>
        )
      case 'skip':
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
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
    <div className={className}>
      <ul className="divide-y divide-border/60">
        {views.map((view) => (
          <li key={view.key} className="space-y-2 py-3.5 first:pt-0 last:pb-0">
            {/* Primero quién o qué; abajo, en un renglón, el estado, el importe y el botón.
                Así entra igual en media columna que en el ancho entero, y en el celular. */}
            <p className="text-sm text-foreground text-pretty">
              {/* Espacio duro antes de cada «·»: un renglón nunca empieza con el punto. */}
              <VoucherText text={view.text.replace(/ · /g, ' · ')} />
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusPill tone={PILL_TONE[view.tone]}>{words[view.tone]}</StatusPill>
              {view.amountCents !== null ? (
                <span className="whitespace-nowrap text-sm font-semibold">
                  {view.amountPrefix ? (
                    <span className="mr-1 text-xs font-normal text-muted-foreground">
                      {view.amountPrefix}
                    </span>
                  ) : null}
                  <Amount cents={Math.abs(view.amountCents)} decimals={0} />
                </span>
              ) : null}
              {!readOnly && view.actions.length > 0 ? (
                <div className="ml-auto flex flex-wrap justify-end gap-2">
                  {view.actions.map((action, index) => control(action, `${view.key}:${index}`))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
