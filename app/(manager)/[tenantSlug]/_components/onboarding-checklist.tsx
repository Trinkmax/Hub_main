import { ArrowUpRight, CheckCircle2, Circle } from 'lucide-react'
import Link from 'next/link'

type Step = {
  done: boolean
  title: string
  description: string
  href: string
  cta: string
}

export function OnboardingChecklist({
  tenantSlug,
  steps,
}: {
  tenantSlug: string
  steps: {
    menuReady: boolean
    captureLinkReady: boolean
    channelConnected: boolean
    firstVisit: boolean
  }
}) {
  void tenantSlug
  const items: Step[] = [
    {
      done: steps.menuReady,
      title: 'Cargá tu menú',
      description: 'Sin menú no podés cerrar mesas con consumo detallado.',
      href: `/${tenantSlug}/menu`,
      cta: 'Cargar menú',
    },
    {
      done: steps.captureLinkReady,
      title: 'Generá un QR de captura',
      description: 'Imprimí el QR para que los clientes carguen sus datos.',
      href: `/${tenantSlug}/configuracion/captura`,
      cta: 'Crear QR',
    },
    {
      done: steps.channelConnected,
      title: 'Conectá WhatsApp o Instagram',
      description: 'Necesario para difusiones y respuestas a clientes.',
      href: `/${tenantSlug}/configuracion/canales`,
      cta: 'Conectar canal',
    },
    {
      done: steps.firstVisit,
      title: 'Cerrá la primera mesa',
      description: 'Empezá a registrar consumo para alimentar las estadísticas.',
      href: `/${tenantSlug}/visitas/nueva`,
      cta: 'Cerrar mesa',
    },
  ]

  const completed = items.filter((s) => s.done).length

  return (
    <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Empezá por acá
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">
              Configurá tu bar en 4 pasos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {completed} de {items.length} pasos completados
            </p>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border bg-card">
            <span className="font-display text-lg font-semibold tabular-nums">
              {Math.round((completed / items.length) * 100)}%
            </span>
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {items.map((item) => (
            <li key={item.title}>
              <Link
                href={item.href}
                className="group flex items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3 transition-colors hover:border-border hover:bg-background/80"
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <span className="hidden shrink-0 items-center gap-1 self-center text-xs font-medium text-primary group-hover:underline sm:inline-flex">
                  {item.done ? 'Listo' : item.cta}
                  <ArrowUpRight className="size-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
