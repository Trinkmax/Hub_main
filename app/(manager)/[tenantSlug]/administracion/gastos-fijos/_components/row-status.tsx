import type { ReactNode } from 'react'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { cn } from '@/lib/utils'
import type { RowTone } from '../_lib/planilla-words'

const TONE: Readonly<Record<RowTone, string>> = {
  ok: 'border-transparent bg-success/10 text-success',
  warn: 'border-transparent bg-warning/15 text-warning-text',
  bad: 'border-transparent bg-destructive/10 text-destructive',
  muted: 'border-border/70 bg-secondary text-muted-foreground',
}

/** La etiqueta de estado de un renglón: «Vencido», «Por vencer», «Falta $ X». */
export function StatusTag({ tone, children }: { tone: RowTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[5px] border px-[7px] py-px text-[11.5px] whitespace-nowrap',
        TONE[tone],
      )}
    >
      {children}
    </span>
  )
}

/** El sello «Pagado» o la etiqueta, según lo que se diga del renglón. Server-safe. */
export function StatusMark({
  label,
  tone,
  stamp,
  thud = false,
}: {
  label: string
  tone: RowTone
  stamp: boolean
  /** Recién se pagó: el sello cae. Solo ahí. */
  thud?: boolean
}) {
  if (stamp) {
    return (
      <Stamp tone="ok" thud={thud}>
        {label}
      </Stamp>
    )
  }
  return <StatusTag tone={tone}>{label}</StatusTag>
}
