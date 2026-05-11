import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar, Gift, Sparkles, Star } from 'lucide-react'
import Image from 'next/image'

type LunchCard = {
  template_id: string
  template_name: string
  current_stamps: number
  threshold: number
  reward_name: string | null
  hours_from: string | null
  hours_to: string | null
}

type Event = {
  id: string
  title: string
  starts_at: string
}

export function CustomerPanelLayout({
  tenantName,
  firstName,
  lastName,
  pointsBalance,
  lunchCard,
  upcomingEvents,
  qrDataUrl,
  qrToken,
}: {
  tenantName: string
  firstName: string
  lastName: string
  pointsBalance: number
  lunchCard: LunchCard | null
  upcomingEvents: Event[]
  qrDataUrl: string
  qrToken: string
}) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background to-secondary/30">
      <div className="mx-auto max-w-md space-y-5 px-4 py-8 sm:py-12">
        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {tenantName}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Hola, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">{lastName}</p>
        </header>

        <section
          aria-label="QR personal"
          className="card-hairline rounded-2xl border bg-card p-5 text-center"
        >
          <div className="mx-auto inline-flex flex-col items-center gap-3">
            <div className="relative size-56 overflow-hidden rounded-xl bg-white p-3 shadow-sm">
              <Image
                src={qrDataUrl}
                alt="Tu QR personal"
                width={224}
                height={224}
                className="size-full"
                unoptimized
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Mostralo en la caja para acreditar tus puntos.
            </p>
            <code className="select-all rounded bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {qrToken.slice(0, 8)}…{qrToken.slice(-4)}
            </code>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="card-hairline rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Star className="size-3.5 text-primary" />
              Puntos
            </div>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
              {pointsBalance.toLocaleString('es-AR')}
            </p>
            <p className="text-xs text-muted-foreground">
              Acumulás 1 punto por cada peso que gastés.
            </p>
          </div>

          {lunchCard ? (
            <LunchCardWidget card={lunchCard} />
          ) : (
            <div className="card-hairline rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                Beneficios
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Pronto vas a tener tu tarjeta de almuerzos acá.
              </p>
            </div>
          )}
        </section>

        <section className="card-hairline space-y-3 rounded-xl border bg-card p-5">
          <header className="flex items-center gap-2">
            <Calendar className="size-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">
              Próximos eventos
            </h2>
          </header>
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay eventos publicados todavía. Avisamos cuando haya novedades.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {upcomingEvents.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm font-medium">{ev.title}</span>
                  <time
                    dateTime={ev.starts_at}
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  >
                    {format(new Date(ev.starts_at), "EEE d 'de' MMM · HH:mm", { locale: es })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="pt-4 text-center text-[11px] text-muted-foreground">
          <p>
            Esta pantalla es personal y se actualiza sola. Mostrala en la caja para sumar tus
            beneficios.
          </p>
        </footer>
      </div>
    </main>
  )
}

function LunchCardWidget({ card }: { card: LunchCard }) {
  const stamps = Array.from({ length: card.threshold }, (_, i) => i < card.current_stamps)
  const progress = card.current_stamps / card.threshold

  return (
    <div className="card-hairline rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Gift className="size-3.5 text-primary" />
        {card.template_name}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {stamps.map((filled, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stamps are a fixed-size visual progress; index is stable
            key={i}
            role="img"
            aria-label={filled ? 'Almuerzo registrado' : 'Pendiente'}
            className={
              filled
                ? 'size-5 rounded-full bg-primary shadow-sm'
                : 'size-5 rounded-full border border-dashed border-border bg-secondary/40'
            }
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {card.current_stamps} de {card.threshold} almuerzos
        {progress < 1 && card.reward_name
          ? ` · al ${card.threshold}° te llevás ${card.reward_name}`
          : ''}
        {progress >= 1 ? ' · ¡Premio listo! Pedilo en la caja.' : ''}
      </p>
      {card.hours_from && card.hours_to ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Válido de {card.hours_from.slice(0, 5)} a {card.hours_to.slice(0, 5)} hs.
        </p>
      ) : null}
    </div>
  )
}
