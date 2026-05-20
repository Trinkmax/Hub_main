'use client'

import { motion } from 'motion/react'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { DayCapacityBucket } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

export function CapacityHeader({
  capacity,
  events,
}: {
  capacity: DayCapacityBucket[]
  events: ScheduledEventWithTemplate[]
}) {
  const zonePA = capacity.find((b) => b.bucket === 'zone:planta_alta')
  const zonePB = capacity.find((b) => b.bucket === 'zone:planta_baja')

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <CapacityBar title="Planta Alta" bucket={zonePA} color="#16a34a" />
      <CapacityBar title="Planta Baja" bucket={zonePB} color="#0ea5e9" />
      {events.map((e) => {
        const b = capacity.find((x) => x.bucket === `event:${e.id}`)
        return (
          <CapacityBar
            key={e.id}
            title={e.name_override ?? e.template?.name ?? 'Evento'}
            subtitle={`${e.starts_at_local.slice(0, 5)}`}
            bucket={b}
            color={e.template?.color_hex ?? '#7c3aed'}
            isEvent
          />
        )
      })}
    </div>
  )
}

function CapacityBar({
  title,
  subtitle,
  bucket,
  color,
  isEvent,
}: {
  title: string
  subtitle?: string
  bucket?: DayCapacityBucket
  color: string
  isEvent?: boolean
}) {
  if (!bucket) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border/60 bg-card/30 p-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-[10px] text-muted-foreground">sin capacidad</span>
        </div>
      </div>
    )
  }
  const pct = bucket.capacity > 0 ? Math.min(100, (bucket.used / bucket.capacity) * 100) : 0
  const isOver = bucket.used > bucket.capacity
  const isFull = !isOver && bucket.used >= bucket.capacity * 0.9

  return (
    <motion.div
      layout
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card/70 p-3 transition-shadow',
        isFull ? 'border-amber-300/60 shadow-[0_0_0_3px_rgba(245,158,11,0.1)]' : 'border-border/60',
        isOver && 'border-rose-400/60 shadow-[0_0_0_3px_rgba(244,63,94,0.15)]',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              isEvent && 'ring-2 ring-offset-1 ring-offset-card',
            )}
            style={{
              backgroundColor: color,
              boxShadow: isEvent ? `0 0 0 2px ${color}33` : undefined,
            }}
            aria-hidden
          />
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {subtitle ? <span className="text-[11px] text-muted-foreground">{subtitle}</span> : null}
        </div>
        <span
          className={cn(
            'font-mono text-base font-semibold tabular-nums',
            isOver ? 'text-rose-600 dark:text-rose-400' : 'text-foreground',
          )}
        >
          {bucket.used}
          <span className="text-xs font-normal text-muted-foreground">/{bucket.capacity}</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: isOver ? '#ef4444' : isFull ? '#f59e0b' : color,
          }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        {isOver ? (
          <span className="text-rose-600 dark:text-rose-400">
            Overbooking +{bucket.used - bucket.capacity}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {bucket.available} {bucket.available === 1 ? 'lugar libre' : 'lugares libres'}
          </span>
        )}
        {isFull && !isOver ? (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="text-amber-600 dark:text-amber-400 font-medium"
          >
            ¡Casi lleno!
          </motion.span>
        ) : null}
      </div>
    </motion.div>
  )
}
