'use client'

type HeatmapPoint = { dow: number; hour: number; visit_count: number }

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export function Heatmap({ data }: { data: HeatmapPoint[] }) {
  const max = data.reduce((m, p) => Math.max(m, p.visit_count), 0)
  const map = new Map<string, number>()
  for (const p of data) map.set(`${p.dow}-${p.hour}`, p.visit_count)

  return (
    <div className="card-hairline rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">
            Mapa de calor de visitas
          </h2>
          <p className="text-xs text-muted-foreground">Cuándo viene tu gente, día por hora.</p>
        </div>
        {max > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Menos</span>
            <div className="flex gap-0.5">
              {[0.2, 0.4, 0.6, 0.8, 1].map((step) => (
                <span
                  key={step}
                  className="size-3 rounded-sm border border-border/40"
                  style={{
                    backgroundColor: `color-mix(in oklch, var(--chart-1) ${step * 100}%, transparent)`,
                  }}
                />
              ))}
            </div>
            <span>Más</span>
          </div>
        ) : null}
      </header>
      <div className="overflow-x-auto p-4">
        <div className="inline-block min-w-full">
          <div className="grid grid-cols-[2.5rem_repeat(24,minmax(1.1rem,1fr))] gap-px text-[10px]">
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: el índice ES la hora (0-23), orden estable y semántico
              <div key={`h-${h}`} className="text-center text-muted-foreground tabular-nums">
                {h}
              </div>
            ))}
            {DOW_LABELS.map((label, dow) => (
              <DayRow
                key={label}
                label={label}
                dow={dow}
                max={max}
                get={(h) => map.get(`${dow}-${h}`) ?? 0}
              />
            ))}
          </div>
          {max === 0 ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Sin visitas registradas todavía.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DayRow({
  label,
  dow,
  max,
  get,
}: {
  label: string
  dow: number
  max: number
  get: (hour: number) => number
}) {
  return (
    <>
      <div className="self-center pr-1 text-right text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      {Array.from({ length: 24 }).map((_, h) => {
        const v = get(h)
        const intensity = max > 0 ? v / max : 0
        const bg =
          v === 0
            ? 'transparent'
            : `color-mix(in oklch, var(--chart-1) ${(0.15 + intensity * 0.85) * 100}%, transparent)`
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: el índice ES la hora (0-23), orden estable y semántico
            key={`${dow}-${h}`}
            className="aspect-square rounded-sm border border-border/30 transition-colors hover:border-border"
            style={{ backgroundColor: bg }}
            title={`${label} ${h}:00 — ${v} visitas`}
          />
        )
      })}
    </>
  )
}
