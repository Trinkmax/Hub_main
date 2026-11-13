'use client'

import {
  type AlertId,
  type AlertLine,
  alertLines,
  alertScale,
  MINUTE_BOUNDS,
  nudgeKitchen,
  READY_STEP,
  readyLateOf,
  readyWarnOf,
} from '@/lib/pos/settings/alerts'
import { settingChange } from '@/lib/pos/settings/change'
import type { PosSettings, SettingChange, SettingKey } from '@/lib/pos/settings/types'
import { MinuteStepper } from './minute-stepper'

const COPY: Readonly<Record<AlertId, { title: string; text: string }>> = {
  order: {
    title: 'Sin pedido',
    text: 'Se sentaron y todavía nadie les tomó el pedido.',
  },
  kitchen: {
    title: 'Esperando la comida',
    text: 'Pidieron y la comida no llegó. Con estos mismos tiempos se pintan las tarjetas de la tele de la cocina.',
  },
  ready: {
    title: 'Comida lista sin llevar',
    text: 'Cocina la marcó lista y sigue en el pase. Avisa desde el primer momento.',
  },
  bill: {
    title: 'Pidieron la cuenta',
    text: 'Están esperando para pagar.',
  },
}

/**
 * La regla de una situación: de 0 al tope, un tramo tranquilo, uno en el que la mesa avisa y
 * uno en el que está roja. Las cuatro reglas comparten la misma escala, así se comparan de un
 * vistazo. El color nunca va solo: debajo dice cada tramo con sus minutos.
 */
function AlertRuler({ line, scale }: { line: AlertLine; scale: number }) {
  const at = (minutes: number) => `${Math.min(100, (minutes / scale) * 100)}%`
  return (
    <div>
      <div
        aria-hidden
        className="relative h-2.5 overflow-hidden rounded-full bg-adm-track"
        data-testid={`alert-ruler-${line.id}`}
      >
        <span
          className="absolute inset-y-0 bg-warning transition-[left,right] duration-(--duration-slow) ease-(--ease-out) motion-reduce:transition-none"
          style={{ left: at(line.warnAt), right: 0 }}
        />
        <span
          className="absolute inset-y-0 right-0 bg-destructive transition-[left] duration-(--duration-slow) ease-(--ease-out) motion-reduce:transition-none"
          style={{ left: at(line.lateAt) }}
        />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-warning" />
          {line.warnAt === 0 ? 'Avisa apenas está lista' : `Avisa a los ${line.warnAt} min`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-destructive" />
          Roja a los {line.lateAt} min
        </span>
        <span aria-hidden className="ml-auto tabular-nums">
          {scale} min
        </span>
      </p>
    </div>
  )
}

/**
 * «Cuándo avisa una mesa»: las cuatro situaciones en las que una mesa pide atención, cada una
 * con sus minutos y su regla. Los minutos se tocan con menos y más y se guardan solos.
 */
export function AlertRows({
  settings,
  saving,
  onChange,
}: {
  settings: PosSettings
  saving: (key: SettingKey) => boolean
  onChange: (changes: SettingChange[]) => void
}) {
  const lines = alertLines(settings)
  const scale = alertScale(lines)
  const lineOf = (id: AlertId) => lines.find((line) => line.id === id)

  const moveKitchen = (which: 'warn' | 'late', minutes: number) => {
    const next = nudgeKitchen(settings, which, minutes)
    const changes: SettingChange[] = []
    if (next.kitchenWarnMinutes !== settings.kitchenWarnMinutes) {
      changes.push(settingChange(settings, 'kitchenWarnMinutes', next.kitchenWarnMinutes))
    }
    if (next.kitchenLateMinutes !== settings.kitchenLateMinutes) {
      changes.push(settingChange(settings, 'kitchenLateMinutes', next.kitchenLateMinutes))
    }
    if (changes.length > 0) onChange(changes)
  }

  const steppers: Readonly<Record<AlertId, React.ReactNode>> = {
    order: (
      <MinuteStepper
        caption="Avisa a los"
        label="Sin pedido: avisa a los"
        testId="minutes-order"
        value={settings.orderWarnMinutes}
        min={MINUTE_BOUNDS.orderWarnMinutes.min}
        max={MINUTE_BOUNDS.orderWarnMinutes.max}
        saving={saving('orderWarnMinutes')}
        onCommit={(minutes) => onChange([settingChange(settings, 'orderWarnMinutes', minutes)])}
      />
    ),
    kitchen: (
      <>
        <MinuteStepper
          caption="Avisa a los"
          label="Esperando la comida: avisa a los"
          testId="minutes-kitchen-warn"
          value={settings.kitchenWarnMinutes}
          min={MINUTE_BOUNDS.kitchenWarnMinutes.min}
          max={MINUTE_BOUNDS.kitchenWarnMinutes.max}
          saving={saving('kitchenWarnMinutes')}
          onCommit={(minutes) => moveKitchen('warn', minutes)}
        />
        <MinuteStepper
          caption="Roja a los"
          label="Esperando la comida: roja a los"
          testId="minutes-kitchen-late"
          value={settings.kitchenLateMinutes}
          min={MINUTE_BOUNDS.kitchenLateMinutes.min}
          max={MINUTE_BOUNDS.kitchenLateMinutes.max}
          saving={saving('kitchenLateMinutes')}
          onCommit={(minutes) => moveKitchen('late', minutes)}
        />
      </>
    ),
    ready: (
      <MinuteStepper
        caption="Roja a los"
        label="Comida lista sin llevar: roja a los"
        testId="minutes-ready"
        value={readyLateOf(settings.readyWarnMinutes)}
        min={readyLateOf(MINUTE_BOUNDS.readyWarnMinutes.min)}
        max={readyLateOf(MINUTE_BOUNDS.readyWarnMinutes.max)}
        step={READY_STEP}
        saving={saving('readyWarnMinutes')}
        onCommit={(minutes) =>
          onChange([settingChange(settings, 'readyWarnMinutes', readyWarnOf(minutes))])
        }
      />
    ),
    bill: (
      <MinuteStepper
        caption="Avisa a los"
        label="Pidieron la cuenta: avisa a los"
        testId="minutes-bill"
        value={settings.billWarnMinutes}
        min={MINUTE_BOUNDS.billWarnMinutes.min}
        max={MINUTE_BOUNDS.billWarnMinutes.max}
        saving={saving('billWarnMinutes')}
        onCommit={(minutes) => onChange([settingChange(settings, 'billWarnMinutes', minutes)])}
      />
    ),
  }

  return (
    <ul className="divide-y divide-border/60">
      {(['order', 'kitchen', 'ready', 'bill'] as const).map((id) => {
        const line = lineOf(id)
        if (!line) return null
        return (
          <li key={id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between @2xl:gap-6">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-snug">{COPY[id].title}</h3>
                <p className="mt-0.5 max-w-prose text-sm text-muted-foreground text-pretty">
                  {COPY[id].text}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
                {steppers[id]}
              </div>
            </div>
            <div className="mt-3">
              <AlertRuler line={line} scale={scale} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
