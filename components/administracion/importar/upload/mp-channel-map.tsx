'use client'

import { useState } from 'react'
import { Pill } from '@/components/administracion/kit'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MpCobroChannel } from '@/lib/imports/server/types'
import { MP_CHANNEL_TEXT } from '@/lib/imports/ui/labels'

/** Cuántos medios del cierre se ofrecen como píldora antes de «Otro…». */
const SHOWN = 4

/**
 * «¿Cómo llamás a cada cobro en tu cierre del día?», dibujado: a la izquierda,
 * cómo le dice Mercado Pago (cuatro fichas quietas); una flecha por renglón; a
 * la derecha, cómo lo llamás vos en el cierre (píldoras con tus medios de
 * cobro, la elegida rellena).
 *
 * Reemplaza a cuatro desplegables iguales: era la decisión más difícil del área
 * y no se veía qué se estaba uniendo con qué. En el celular cada renglón se
 * apila: la ficha, la flecha hacia abajo y sus píldoras.
 *
 * Solo dibuja y avisa el cambio: el estado y el guardado son de `MpSettingsCard`.
 */
export function MpChannelMap({
  channels,
  methods,
  value,
  inferred,
  onChange,
}: {
  channels: readonly MpCobroChannel[]
  /** Los medios del cierre del día, los de Mercado Pago primero. */
  methods: ReadonlyArray<{ id: string; name: string }>
  value: Readonly<Partial<Record<MpCobroChannel, string | null>>>
  /** Los canales que se dedujeron por el nombre (todavía sin confirmar). */
  inferred: ReadonlySet<MpCobroChannel>
  onChange: (channel: MpCobroChannel, methodId: string | null) => void
}) {
  const [picking, setPicking] = useState<MpCobroChannel | null>(null)
  const first = methods.slice(0, SHOWN)

  return (
    <div className="space-y-3">
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,14rem)_2.5rem_minmax(0,1fr)] gap-x-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:grid"
      >
        <span>Mercado Pago le dice</span>
        <span />
        <span>Vos, en el cierre, le decís</span>
      </div>
      <ul className="space-y-4 sm:space-y-3">
        {channels.map((channel) => {
          const chosen = value[channel] ?? null
          const extra =
            chosen && !first.some((m) => m.id === chosen)
              ? (methods.find((m) => m.id === chosen) ?? null)
              : null
          const name = MP_CHANNEL_TEXT[channel]
          return (
            <li
              key={channel}
              className="grid gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,14rem)_2.5rem_minmax(0,1fr)] sm:items-start"
            >
              <p className="flex min-h-11 items-center rounded-xl bg-secondary/60 px-3.5 py-2 text-sm font-medium leading-snug">
                <span className="sr-only">Mercado Pago le dice: </span>
                {name}
              </p>
              <Arrow />
              <div className="min-w-0 space-y-1.5">
                <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
                  <legend className="sr-only">Cómo llamás a «{name}» en tu cierre del día</legend>
                  {first.map((m) => (
                    <Pill
                      key={m.id}
                      size="touch"
                      activeTone="brand"
                      active={chosen === m.id}
                      onClick={() => onChange(channel, m.id)}
                    >
                      {m.name}
                    </Pill>
                  ))}
                  {extra ? (
                    <Pill
                      size="touch"
                      activeTone="brand"
                      active
                      onClick={() => setPicking(channel)}
                    >
                      {extra.name}
                    </Pill>
                  ) : null}
                  {methods.length > first.length ? (
                    <Pill
                      size="touch"
                      aria-expanded={picking === channel}
                      onClick={() => setPicking(picking === channel ? null : channel)}
                    >
                      Otro…
                    </Pill>
                  ) : null}
                  <Pill
                    size="touch"
                    activeTone="ink"
                    active={chosen === null}
                    onClick={() => onChange(channel, null)}
                  >
                    No lo uso
                  </Pill>
                </fieldset>
                {picking === channel ? (
                  <Select
                    value={chosen ?? undefined}
                    onValueChange={(id) => {
                      onChange(channel, id)
                      setPicking(null)
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Otro medio del cierre para «${name}»`}
                      className="w-full data-[size=default]:h-11 sm:max-w-xs"
                    >
                      <SelectValue placeholder="Elegí el medio de cobro" />
                    </SelectTrigger>
                    <SelectContent>
                      {methods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {inferred.has(channel) && chosen !== null ? (
                  <p className="text-xs text-muted-foreground">Lo deduje por el nombre: fijate.</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** La flecha que une cada ficha con su respuesta: hacia la derecha con lugar, hacia abajo apilado. */
function Arrow() {
  return (
    <span
      aria-hidden
      className="flex items-center justify-start pl-4 sm:h-11 sm:justify-center sm:pl-0"
    >
      <svg
        viewBox="0 0 40 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="hidden h-4 w-10 text-adm-neutral sm:block"
      >
        <path d="M2 8h34M30 3l6 5-6 5" />
      </svg>
      <svg
        viewBox="0 0 16 20"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-4 text-adm-neutral sm:hidden"
      >
        <path d="M8 2v15M3 12l5 5 5-5" />
      </svg>
    </span>
  )
}
