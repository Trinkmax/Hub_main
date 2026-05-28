'use client'

import { TriangleAlert, Users } from 'lucide-react'
import type { SalonOccupancy } from '@/lib/sessions-waiter/queries'
import { cn } from '@/lib/utils'

export function OccupancyBanner({ occupancy }: { occupancy: SalonOccupancy }) {
  const { totalSeats, occupiedSeats, availableSeats, openSessions, overCapacity } = occupancy
  const ratio =
    totalSeats !== null && totalSeats > 0 ? Math.min(occupiedSeats / totalSeats, 1.5) : null

  return (
    <div
      className={cn(
        'card-hairline rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs',
        overCapacity && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="size-4" aria-hidden />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Ocupación</p>
            <p className="font-serif text-lg font-semibold tabular-nums">
              {totalSeats !== null ? (
                <>
                  {occupiedSeats} <span className="text-muted-foreground">/ {totalSeats}</span>
                  <span className="ml-1 text-sm font-normal text-muted-foreground">personas</span>
                </>
              ) : (
                <>
                  {occupiedSeats}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">comensales</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="text-right text-sm">
          <p className="text-muted-foreground">
            {openSessions} {openSessions === 1 ? 'mesa abierta' : 'mesas abiertas'}
          </p>
          {availableSeats !== null ? (
            <p className="font-medium tabular-nums">
              {availableSeats === 0 ? 'Sin lugares' : `${availableSeats} libres`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              <em>Configurá la capacidad en Ajustes</em>
            </p>
          )}
        </div>
      </div>
      {ratio !== null ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-[width] duration-[var(--duration-base)]',
              overCapacity ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
          />
        </div>
      ) : null}
      {overCapacity ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" aria-hidden />
          Sobrecapacidad: hay más comensales declarados que lugares.
        </p>
      ) : null}
    </div>
  )
}
