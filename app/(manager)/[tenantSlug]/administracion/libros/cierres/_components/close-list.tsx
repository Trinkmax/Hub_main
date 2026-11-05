import Link from 'next/link'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { PRow, PTable, PTd } from '@/components/administracion/planilla'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ClickableBody } from '../../_components/clickable-body'
import type { CloseLine } from '../_lib/close-lines'
import type { ReviewAction } from '../_lib/review'

/**
 * El checklist del cierre: una fila por cosa, con su etiqueta, qué pasa y el botón para resolverlo
 * sin salir de la pantalla (las hojas se abren encima). La contadora ve los mismos renglones sin
 * botones de carga (`closeReview` ya se los saca; además `ActionButton` no se dibuja en solo lectura).
 * Server-safe.
 */

/** 44 px donde se toca con el dedo; en la compu, chico. */
const ACTION_SIZE = 'h-11 max-w-full md:pointer-fine:h-8'

function ActionControl({ action, rowAction }: { action: ReviewAction; rowAction: boolean }) {
  // Un nombre largo («Contar Banco de la Provincia de Córdoba») se corta, entero en el `title`.
  const label = <span className="truncate">{action.label}</span>
  if (action.kind === 'sheet') {
    return (
      <ActionButton
        action={action.sheet}
        params={action.params}
        variant="outline"
        title={action.label}
        className={cn(ACTION_SIZE, 'max-w-[18rem]')}
      >
        {label}
      </ActionButton>
    )
  }
  return (
    <Button asChild variant="outline" size="sm" className={cn(ACTION_SIZE, 'max-w-[18rem]')}>
      <Link href={action.href} title={action.label} data-row-action={rowAction ? '' : undefined}>
        {label}
      </Link>
    </Button>
  )
}

/**
 * En el celular no es una tabla que se desliza: el botón que resuelve cada cosa no se puede quedar
 * afuera de la pantalla. La etiqueta y el texto van al lado, y los botones abajo.
 */
const PHONE_ROW = 'max-sm:grid max-sm:grid-cols-[6.75rem_minmax(0,1fr)]'

const LINK =
  'font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring'

function CloseRow({ line }: { line: CloseLine }) {
  const firstHref = line.actions.find((action) => action.kind === 'href')
  return (
    <PRow className={cn(PHONE_ROW, firstHref && 'cursor-pointer')}>
      <PTd className="w-24 align-top whitespace-nowrap max-sm:w-auto">
        <StatusPill tone={line.tone}>{line.tag}</StatusPill>
      </PTd>
      <PTd className="align-top">
        <p className={cn('text-pretty', line.tone !== 'ok' && 'font-medium')}>{line.title}</p>
        {line.detail ? <p className="text-muted-foreground text-pretty">{line.detail}</p> : null}
        {line.recurring.length > 0 ? (
          <ul className="mt-1.5 divide-y divide-border/50 rounded-lg bg-secondary/50 px-2.5">
            {line.recurring.map((row) => (
              <li
                key={row.id ?? row.text}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="min-w-0 sm:flex sm:items-baseline sm:gap-1.5" title={row.text}>
                  <span className="block truncate">{row.name}</span>
                  <span className="block shrink-0 text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                    {row.meta}
                  </span>
                </span>
                {row.action ? <ActionControl action={row.action} rowAction={false} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {line.more ? <p className="mt-1 text-muted-foreground">{line.more}</p> : null}
        {line.help ? (
          <p className="mt-1 text-xs text-muted-foreground text-pretty">
            {line.help.text}{' '}
            <Link href={line.help.href} className={LINK}>
              {line.help.label}
            </Link>
          </p>
        ) : null}
        {line.note ? (
          <p className="mt-1 text-xs text-muted-foreground text-pretty">{line.note}</p>
        ) : null}
      </PTd>
      <PTd
        align="right"
        className={cn(
          'align-top whitespace-normal max-sm:col-span-2 max-sm:pt-0 max-sm:text-left',
          line.actions.length === 0 && 'max-sm:hidden',
        )}
      >
        {line.actions.length > 0 ? (
          <span className="inline-flex flex-wrap justify-end gap-1.5 max-sm:justify-start">
            {line.actions.map((action) => (
              <ActionControl
                key={`${action.kind}-${action.label}`}
                action={action}
                rowAction={action === firstHref}
              />
            ))}
          </span>
        ) : null}
      </PTd>
    </PRow>
  )
}

export function CloseList({ lines, label }: { lines: readonly CloseLine[]; label: string }) {
  return (
    <PTable minWidth={0} label={label} className="max-sm:block">
      <ClickableBody className="max-sm:block">
        {lines.map((line) => (
          <CloseRow key={line.key} line={line} />
        ))}
      </ClickableBody>
    </PTable>
  )
}
