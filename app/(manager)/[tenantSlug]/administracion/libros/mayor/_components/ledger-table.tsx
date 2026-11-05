'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { MouseEvent } from 'react'
import { Amount } from '@/components/administracion/amount'
import { Planilla, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
import { VoucherText } from '@/components/administracion/voucher-text'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { SLIDING_SHEET } from '../../_components/book-page'
import { OpenEntryButton, useEntryPanel } from '../../_components/entry-panel'
import type { LedgerViewRow } from '../_lib/ledger-rows'

/** El mismo renglón de `PRow`, en `motion`: la fila reimputada se va con una animación corta. */
const ROW =
  'group/row border-b border-border/60 transition-colors last:border-b-0 hover:bg-primary/[0.04] motion-reduce:transition-none'
const ROW_FLAGGED = 'bg-warning/10 hover:bg-warning/15'

function entryNumber(row: LedgerViewRow) {
  if (row.number === null) return 'Ver'
  return (
    <span className={row.provisional ? 'italic' : undefined}>
      #{row.number}
      {row.provisional ? <span className="sr-only"> (provisorio)</span> : null}
    </span>
  )
}

function Money({ cents }: { cents: number }) {
  return cents ? <Amount cents={cents} currency={false} /> : null
}

/**
 * La hoja del Mayor: Fecha · Asiento · Comprobante · Debe · Haber · Saldo, con el saldo inicial arriba
 * y la doble raya abajo. Tocar una fila abre el panel del asiento; con el teclado, el botón del número
 * de asiento. La fila cuya cuenta no es la habitual va marcada y dice por qué.
 *
 * Las filas entran quietas (`initial={false}`): solo se anima la que se va al reimputar.
 */
export function LedgerTable({
  rows,
  caption,
  opening,
  totals,
  closingCents,
  emptyText,
}: {
  rows: readonly LedgerViewRow[]
  caption: string
  /** Primera página: «Saldo inicial»; las siguientes: «Viene de la página anterior». */
  opening: { label: string; balanceCents: number } | null
  /** Debe y Haber de todo el período, si se saben. */
  totals: { debitCents: number; creditCents: number } | null
  /** El saldo final: solo en la última página. */
  closingCents: number | null
  emptyText: string
}) {
  const { open, rowLeft } = useEntryPanel()
  const reduceMotion = useReducedMotion()

  function openRow(event: MouseEvent<HTMLTableRowElement>, row: LedgerViewRow) {
    const target = event.target as HTMLElement
    if (target.closest('a, button') || !row.entryId) return
    if (window.getSelection()?.toString()) return
    open(row.entryId, event.currentTarget.querySelector('button'))
  }

  return (
    <Planilla className={SLIDING_SHEET}>
      <PTable minWidth={720} label={caption}>
        <thead>
          <tr>
            <PTh>Fecha</PTh>
            <PTh>Asiento</PTh>
            <PTh>Comprobante</PTh>
            <PTh align="right">Debe</PTh>
            <PTh align="right">Haber</PTh>
            <PTh align="right">Saldo</PTh>
          </tr>
        </thead>
        <tbody>
          {opening ? (
            <tr className="border-b border-border/60 bg-secondary/30">
              <PTd colSpan={5} className="text-muted-foreground">
                {opening.label}
              </PTd>
              <PTd align="right">
                <Amount cents={opening.balanceCents} side currency={false} />
              </PTd>
            </tr>
          ) : null}
          <AnimatePresence initial={false} onExitComplete={rowLeft}>
            {rows.map((row) => (
              <motion.tr
                key={row.key}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, x: 32, transition: { duration: 0.22, ease: 'easeOut' } }
                }
                onClick={(event) => openRow(event, row)}
                className={cn(ROW, row.entryId && 'cursor-pointer', row.flag && ROW_FLAGGED)}
              >
                <PTd className="align-top whitespace-nowrap text-muted-foreground">
                  {formatIsoDay(row.date)}
                </PTd>
                <PTd className="align-top whitespace-nowrap">
                  {row.entryId ? (
                    <OpenEntryButton
                      entryId={row.entryId}
                      aria-label={
                        row.number === null
                          ? `Ver el asiento del ${formatIsoDay(row.date)}`
                          : `Ver el asiento ${row.number}${row.provisional ? ' (provisorio)' : ''}`
                      }
                    >
                      {entryNumber(row)}
                    </OpenEntryButton>
                  ) : null}
                </PTd>
                <PTd className="align-top">
                  <span className="block text-pretty">
                    {row.label ? <VoucherText text={row.label} /> : 'Asiento'}
                    {row.detail ? (
                      <span className="text-muted-foreground"> · {row.detail}</span>
                    ) : null}
                  </span>
                  {row.flag ? (
                    <span className="block text-xs font-medium text-destructive">{row.flag}</span>
                  ) : null}
                </PTd>
                <PTd align="right" className="align-top">
                  <Money cents={row.debitCents} />
                </PTd>
                <PTd align="right" className="align-top">
                  <Money cents={row.creditCents} />
                </PTd>
                <PTd align="right" className="align-top">
                  <Amount cents={row.balanceCents} side currency={false} />
                </PTd>
              </motion.tr>
            ))}
          </AnimatePresence>
          {rows.length === 0 ? (
            <tr>
              <PTd colSpan={6} className="py-6 text-center text-muted-foreground">
                {emptyText}
              </PTd>
            </tr>
          ) : null}
        </tbody>
        {closingCents !== null ? (
          <tfoot>
            <PTotalRow>
              <PTd colSpan={3} className="font-semibold">
                Saldo de la cuenta
              </PTd>
              <PTd align="right" className="font-semibold">
                {totals ? <Amount cents={totals.debitCents} currency={false} /> : null}
              </PTd>
              <PTd align="right" className="font-semibold">
                {totals ? <Amount cents={totals.creditCents} currency={false} /> : null}
              </PTd>
              <PTd align="right" className="font-semibold">
                <Amount cents={closingCents} side currency={false} />
              </PTd>
            </PTotalRow>
          </tfoot>
        ) : null}
      </PTable>
    </Planilla>
  )
}
