'use client'

import { Check, ChevronRight, GraduationCap, Minus, Plus, Unlock } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { dayLabel, differenceWords } from '@/lib/pos/cash/screen'
import type { RegisterRef, ShiftRow } from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import { cn } from '@/lib/utils'

/**
 * Los turnos anteriores, por día. Quien está en la caja ve los de hoy; los dueños, los de
 * cualquier fecha. Tocar uno abre su resumen y su cinta.
 */
export function ShiftsSheet({
  open,
  shifts,
  registers,
  currentId,
  ownerView,
  practice,
  timeZone,
  onClose,
  onPick,
  onPractice,
}: {
  open: boolean
  shifts: ReadonlyArray<ShiftRow>
  registers: ReadonlyArray<RegisterRef>
  /** El turno que se está mirando. */
  currentId: string | null
  /** Los dueños ven cualquier fecha; la caja, el día. */
  ownerView: boolean
  practice: boolean
  timeZone: string
  onClose: () => void
  onPick: (shift: ShiftRow) => void
  /** Entrar o salir del carril de práctica. */
  onPractice: () => void
}) {
  const days: { day: string; rows: ShiftRow[] }[] = []
  for (const shift of shifts) {
    const last = days.at(-1)
    if (last && last.day === shift.service_day) last.rows.push(shift)
    else days.push({ day: shift.service_day, rows: [shift] })
  }
  const registerName = (id: string) =>
    registers.length > 1 ? (registers.find((register) => register.id === id)?.name ?? null) : null

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet caja-sheet', posFont.variable)}
        data-testid="turnos-hoja"
      >
        <SheetGrabber />
        <div className="pos-sheet-body caja-sheet-body">
          <div className="caja-sheet-head">
            <SheetTitle className="pos-sheet-title caja-sheet-title">
              {ownerView ? 'Turnos anteriores' : 'Los turnos de hoy'}
            </SheetTitle>
            <SheetDescription className="caja-sheet-sub is-ink">
              Tocá uno para ver su resumen y su cinta.
              {ownerView ? '' : ' Los de otros días los ven los dueños.'}
            </SheetDescription>
          </div>

          {days.length === 0 ? (
            <p className="caja-sheet-sub is-ink">
              {ownerView
                ? 'Todavía no hay turnos en esta sucursal.'
                : 'Todavía no hubo turnos hoy.'}
            </p>
          ) : (
            <div className="caja-days">
              {days.map(({ day, rows }) => (
                <section key={day} className="caja-day">
                  <h3>{capitalize(dayLabel(day, 'long'))}</h3>
                  <ul>
                    {rows.map((shift) => {
                      const isOpen = shift.status === 'open'
                      const result =
                        shift.difference_cents === null
                          ? null
                          : differenceWords(shift.difference_cents, 'past')
                      const name = [registerName(shift.register_id), shift.label ?? 'Turno']
                        .filter(Boolean)
                        .join(' · ')
                      return (
                        <li key={shift.id}>
                          <button
                            type="button"
                            className="caja-shift"
                            aria-current={shift.id === currentId ? 'true' : undefined}
                            onClick={() => onPick(shift)}
                            data-testid={`turno-${shift.id}`}
                          >
                            <span>
                              <b>{name}</b>
                              <small>
                                {clockAt(shift.opened_at, timeZone)}
                                {shift.closed_at ? ` a ${clockAt(shift.closed_at, timeZone)}` : ''}
                                {' · '}
                                {shift.closed_by_name
                                  ? `cerró ${shift.closed_by_name}`
                                  : `abrió ${shift.opened_by_name}`}
                              </small>
                            </span>
                            {isOpen ? (
                              <span className="caja-result is-open">
                                <Unlock aria-hidden strokeWidth={2.6} />
                                Abierto
                              </span>
                            ) : result ? (
                              <span
                                className={cn(
                                  'caja-result',
                                  result.kind === 'short' && 'is-short',
                                  result.kind === 'over' && 'is-over',
                                )}
                              >
                                {result.kind === 'exact' ? (
                                  <Check aria-hidden strokeWidth={3} />
                                ) : result.kind === 'short' ? (
                                  <Minus aria-hidden strokeWidth={3} />
                                ) : (
                                  <Plus aria-hidden strokeWidth={3} />
                                )}
                                {result.text}
                              </span>
                            ) : null}
                            <ChevronRight aria-hidden />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <button
            type="button"
            className="caja-shift is-wrap"
            onClick={onPractice}
            data-testid="turnos-practica"
          >
            <span>
              <b>{practice ? 'Salir de la práctica' : 'Turno de práctica'}</b>
              <small>
                {practice
                  ? 'Volvé a la caja de verdad.'
                  : 'Abrir, cobrar y cerrar para aprender: no toca los números.'}
              </small>
            </span>
            <GraduationCap aria-hidden />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
