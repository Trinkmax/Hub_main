import {
  CalendarCheck,
  Check,
  CircleHelp,
  FileText,
  type LucideIcon,
  ReceiptText,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CloseReview, ReviewAction, ReviewItem, ReviewRow, ReviewRowId } from '../_lib/review'

/**
 * El cuerpo del paso 1 de «Fin de mes»: los renglones de la revisión, siempre
 * en el mismo orden, cada uno con su píldora de estado y, adentro, una acción
 * por cosa. Lo que está bien dice literal qué se revisó; lo que no, qué falta y
 * el botón para resolverlo sin salir de la pantalla (las hojas se abren encima).
 *
 * La contadora ve los mismos renglones sin ningún botón (`closeReview` ya le
 * saca las acciones; además `ActionButton` no se dibuja en solo lectura).
 * Server-safe.
 */

const ROW_ICON: Readonly<Record<ReviewRowId, LucideIcon>> = {
  closes: CalendarCheck,
  purchases: ReceiptText,
  money: Wallet,
  papers: FileText,
  other: CircleHelp,
}

/** 44 px donde se toca con el dedo; en la compu, la medida de siempre. */
const ACTION_SIZE = 'h-11 max-w-full md:pointer-fine:h-9'

function ActionControl({ action, primary }: { action: ReviewAction; primary: boolean }) {
  const variant = primary ? 'default' : 'outline'
  // Un nombre largo («Contar Banco de la Provincia de Córdoba») se corta, entero en el `title`.
  const label = <span className="truncate">{action.label}</span>
  if (action.kind === 'sheet') {
    return (
      <ActionButton
        action={action.sheet}
        params={action.params}
        variant={variant}
        title={action.label}
        className={cn(ACTION_SIZE, 'max-w-[18rem]')}
      >
        {label}
      </ActionButton>
    )
  }
  return (
    <Button asChild variant={variant} className={cn(ACTION_SIZE, 'max-w-[18rem]')}>
      <Link href={action.href} title={action.label}>
        {label}
      </Link>
    </Button>
  )
}

function ItemBlock({
  item,
  strip,
  primaryAction,
}: {
  item: ReviewItem
  strip: ReactNode
  /** La acción que va rellena en esta pantalla (una sola), o `null`. */
  primaryAction: ReviewAction | null
}) {
  // Algo que todavía no toca: una línea gris con su link, sin título ni botones.
  if (item.soft) {
    const [link] = item.actions
    return (
      <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
        {item.title}
        {item.detail ? ` ${item.detail}` : null}
        {link?.kind === 'href' ? (
          <>
            {' '}
            <Link
              href={link.href}
              className="rounded-sm font-medium whitespace-nowrap text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </Link>
          </>
        ) : null}
      </p>
    )
  }
  return (
    <div className="space-y-2.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-pretty">{item.title}</p>
        {item.detail ? (
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{item.detail}</p>
        ) : null}
      </div>

      {item.recurring && item.recurring.length > 0 ? (
        <ul className="divide-y divide-border/50 rounded-xl bg-secondary/50 px-3">
          {item.recurring.map((row) => (
            <li key={row.id ?? row.text} className="flex items-center justify-between gap-3 py-2">
              {/* Celular: el nombre arriba y «venció el 10/10 · $ 850.000» abajo (en un renglón
                  se cortaba justo la fecha y el importe). Compu: todo en un renglón. */}
              <span
                className="min-w-0 text-sm sm:flex sm:items-baseline sm:gap-1.5"
                title={row.text}
              >
                <span className="block truncate font-medium sm:font-normal">{row.name}</span>
                <span aria-hidden className="text-muted-foreground max-sm:hidden">
                  ·
                </span>
                <span className="block shrink-0 text-xs whitespace-nowrap tabular-nums text-muted-foreground sm:text-sm">
                  {row.meta}
                </span>
              </span>
              {row.action ? (
                <ActionControl action={row.action} primary={row.action === primaryAction} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {strip}

      {item.actions.length > 0 || item.more ? (
        <div className="flex flex-wrap items-center gap-2">
          {item.more ? <span className="text-sm text-muted-foreground">{item.more}</span> : null}
          {item.actions.map((action) => (
            <ActionControl
              key={`${action.kind}-${action.label}`}
              action={action}
              primary={action === primaryAction}
            />
          ))}
        </div>
      ) : null}

      {item.help ? (
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
          {item.help.text}{' '}
          <Link
            href={item.help.href}
            className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.help.label}
          </Link>
        </p>
      ) : null}
      {item.note ? (
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{item.note}</p>
      ) : null}
    </div>
  )
}

function RowBlock({
  row,
  strip,
  primaryAction,
}: {
  row: ReviewRow
  strip: ReactNode
  primaryAction: ReviewAction | null
}) {
  const Icon = ROW_ICON[row.id]
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          row.tone === 'ok' ? 'bg-success/12 text-success' : 'bg-secondary text-foreground/70',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">{row.title}</h3>
          <StatusPill tone={row.tone} icon={row.tone === 'ok' ? Check : undefined}>
            {row.pill}
          </StatusPill>
        </div>
        {row.okText ? (
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{row.okText}</p>
        ) : null}
        {row.items.map((item, index) => (
          <ItemBlock
            key={item.key}
            item={item}
            // El almanaque acompaña al primer aviso del renglón de cierres.
            strip={index === 0 && row.showStrip ? strip : null}
            primaryAction={primaryAction}
          />
        ))}
        {row.payroll ? (
          <div className="flex flex-col items-start gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {row.payroll.text}
            </p>
            <ActionControl action={row.payroll.action} primary={false} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function ReviewStep({
  review,
  strip,
  primaryAction,
}: {
  review: CloseReview
  /** El almanaque de cierres del mes (`CloseStrip`), ya armado; `null` si no se pudo leer. */
  strip: ReactNode
  /** EL botón primario de la pantalla mientras toque este paso (`firstReviewAction`). */
  primaryAction: ReviewAction | null
}) {
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border/60">
        {review.rows.map((row) => (
          <RowBlock key={row.id} row={row} strip={strip} primaryAction={primaryAction} />
        ))}
      </ul>
      {review.info.length > 0 ? (
        <ul className="space-y-2 border-t border-border/60 pt-4">
          {review.info.map((text) => (
            // Celular: la píldora arriba del texto (al costado lo apretaba a cuatro renglones).
            <li
              key={text}
              className="flex flex-col items-start gap-1.5 text-sm sm:flex-row sm:gap-x-2"
            >
              <StatusPill tone="info">Para la contadora</StatusPill>
              <span className="min-w-0 text-muted-foreground text-pretty sm:flex-1">{text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
