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
import { NBSP } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useMasterAction } from '../ajustes/_components/use-master-action'
import type { AttentionAction, AttentionTone, AttentionView } from './summary-copy'

const PILL_TONE = { danger: 'late', warning: 'warn', info: 'info' } as const

/** El punto de color de un renglón cuando la píldora no hace falta. */
const DOT_TONE: Readonly<Record<AttentionTone, string>> = {
  danger: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-info',
}

/**
 * En oscuro el botón en contorno toma el fondo de la página, más oscuro que la
 * tarjeta, y se ve como un bloque negro: acá queda transparente con su borde.
 */
const OUTLINE_ON_DARK = 'dark:border-foreground/25 dark:bg-transparent'

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
 * Cada renglón: quién o qué arriba, el detalle en gris y el importe; el botón
 * a la derecha (o debajo, si no entra). Con `quietWhenUniform`, si todos los
 * renglones tienen el mismo estado no se repite la misma píldora en cada uno
 * (cuatro «Vencido» en columna, debajo de un texto que ya dice «venció hace
 * 41 días»): queda un punto de color antes del nombre. Si hay mezcla, la
 * píldora vuelve, porque ahí sí distingue.
 *
 * En modo lectura no hay botones: la contadora lee los mismos renglones.
 */
export function AttentionRows({
  views,
  words,
  quietWhenUniform = false,
  className,
}: {
  views: readonly AttentionView[]
  words: AttentionWords
  /** Sin píldora cuando todos los renglones dicen lo mismo (el texto ya lo dice). */
  quietWhenUniform?: boolean
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
            className={cn(size, OUTLINE_ON_DARK)}
            onClick={() => openAction(action.action, action.params)}
          >
            {action.label}
          </Button>
        )
      case 'link':
        return (
          <Button key={key} asChild variant="outline" className={cn(size, OUTLINE_ON_DARK)}>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )
      case 'retry':
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            className={cn(size, OUTLINE_ON_DARK)}
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

  const first = views[0]
  const quiet = quietWhenUniform && first !== undefined && views.every((v) => v.tone === first.tone)

  return (
    <div className={className}>
      <ul className="divide-y divide-border/60">
        {views.map((view) => {
          // «Proveedor · 3 comprobantes · venció hace 41 días»: el nombre va primero y más
          // fuerte; el resto, en gris. Un texto sin «·» va entero en un renglón.
          const cut = view.text.indexOf(' · ')
          const subject = cut > 0 ? view.text.slice(0, cut) : view.text
          const detail = cut > 0 ? view.text.slice(cut + 3) : null
          return (
            <li
              key={view.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-[11rem] flex-1 space-y-0.5">
                <p className="flex items-start gap-2 text-sm text-foreground text-pretty">
                  {quiet ? (
                    <span
                      aria-hidden
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT_TONE[view.tone])}
                    />
                  ) : null}
                  <span className={cn('min-w-0', detail !== null && 'font-medium')}>
                    <VoucherText text={subject} />
                  </span>
                </p>
                {detail !== null ? (
                  <p className={cn('text-xs text-muted-foreground text-pretty', quiet && 'pl-4')}>
                    {/* Espacio duro antes de cada «·»: un renglón nunca empieza con el punto. */}
                    <VoucherText text={detail.replace(/ · /g, `${NBSP}· `)} />
                  </p>
                ) : null}
                {quiet && view.amountCents === null ? null : (
                  <p
                    className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1', quiet && 'pl-4')}
                  >
                    {quiet ? null : (
                      <StatusPill tone={PILL_TONE[view.tone]}>{words[view.tone]}</StatusPill>
                    )}
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
                  </p>
                )}
              </div>
              {!readOnly && view.actions.length > 0 ? (
                <div className="ml-auto flex flex-wrap justify-end gap-2">
                  {view.actions.map((action, index) => control(action, `${view.key}:${index}`))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
