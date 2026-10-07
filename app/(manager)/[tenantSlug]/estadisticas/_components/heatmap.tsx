import { Card } from '@/components/ui/card'
import { Section } from '@/components/ui/section'
import { formatNumber } from '@/lib/format/number-kind'

type HeatmapPoint = { dow: number; hour: number; visit_count: number }

/** Índice = `dow` de Postgres: 0 domingo … 6 sábado. */
const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
const DOW_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const LEGEND_STEPS = [0.2, 0.4, 0.6, 0.8, 1] as const

/** El color de una celda: tinta del gráfico, más llena cuanto más gente. */
function cellColor(intensity: number): string {
  return `color-mix(in oklch, var(--chart-1) ${(0.15 + intensity * 0.85) * 100}%, transparent)`
}

/**
 * Cuándo viene la gente: día por hora. Server-safe (sin estado).
 *
 * El dibujo es para el ojo; para el lector de pantalla la grilla es una imagen
 * con su resumen (el pico de la semana), y cada celda conserva su `title` con
 * el número exacto para el mouse.
 */
export function Heatmap({ data }: { data: HeatmapPoint[] }) {
  const max = data.reduce((m, p) => Math.max(m, p.visit_count), 0)
  const map = new Map<string, number>()
  for (const p of data) map.set(`${p.dow}-${p.hour}`, p.visit_count)
  const peak = data.reduce<HeatmapPoint | null>(
    (best, p) => (best === null || p.visit_count > best.visit_count ? p : best),
    null,
  )
  const summary =
    peak && max > 0
      ? `Mapa de calor de visitas por día y hora. El pico es el ${DOW_NAMES[peak.dow] ?? ''} a las ${peak.hour} h, con ${formatNumber(peak.visit_count)} ${peak.visit_count === 1 ? 'visita' : 'visitas'}.`
      : 'Mapa de calor de visitas: todavía no hay visitas registradas.'

  return (
    <Section
      title="Mapa de calor de visitas"
      description="Cuándo viene tu gente, día por hora."
      actions={
        max > 0 ? (
          <div
            aria-hidden="true"
            className="flex items-center gap-1.5 type-caption text-muted-foreground"
          >
            <span>Menos</span>
            <div className="flex gap-0.5">
              {LEGEND_STEPS.map((step) => (
                <span
                  key={step}
                  className="size-3 rounded-sm border border-border"
                  style={{
                    backgroundColor: `color-mix(in oklch, var(--chart-1) ${step * 100}%, transparent)`,
                  }}
                />
              ))}
            </div>
            <span>Más</span>
          </div>
        ) : null
      }
    >
      <Card padding="sm" className="gap-0">
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div
              role="img"
              aria-label={summary}
              className="grid grid-cols-[2.75rem_repeat(24,minmax(1.25rem,1fr))] gap-px type-caption"
            >
              <div aria-hidden="true" />
              {HOURS.map((h) => (
                <div
                  key={`h-${h}`}
                  aria-hidden="true"
                  className="text-center tabular-nums text-muted-foreground"
                >
                  {h}
                </div>
              ))}
              {DOW_LABELS.map((label, dow) => (
                <DayRow
                  key={label}
                  label={label}
                  max={max}
                  values={HOURS.map((h) => map.get(`${dow}-${h}`) ?? 0)}
                />
              ))}
            </div>
            {max === 0 ? (
              <p className="mt-4 text-center type-small text-muted-foreground">
                Todavía no hay visitas registradas. Cuando cierres mesas con clientes, vas a ver acá
                los horarios fuertes.
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </Section>
  )
}

function DayRow({ label, max, values }: { label: string; max: number; values: number[] }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="self-center pr-1.5 text-right font-medium text-muted-foreground"
      >
        {label}
      </div>
      {values.map((v, h) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: el índice ES la hora (0-23), orden estable y semántico
          key={`${label}-${h}`}
          aria-hidden="true"
          className="aspect-square rounded-sm border border-border/40 hover:border-border-strong"
          style={{ backgroundColor: v === 0 || max === 0 ? 'transparent' : cellColor(v / max) }}
          title={`${label} ${h}:00 — ${formatNumber(v)} ${v === 1 ? 'visita' : 'visitas'}`}
        />
      ))}
    </>
  )
}
