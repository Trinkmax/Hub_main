import { ArrowRight, Check, Lock } from 'lucide-react'
import { HeroPanel } from '@/components/administracion/kit/hero'
import { Button } from '@/components/ui/button'

/**
 * La bienvenida de la puesta en marcha: qué se va a armar, en una oración, y
 * qué conviene tener a mano antes de empezar. Un solo botón.
 *
 * Los renglones de «Tené a mano» llegan de la guía «Cómo arrancar» (una sola
 * redacción); acá no se guarda nada.
 */
export function WizardWelcome({
  haveAtHand,
  onStart,
}: {
  haveAtHand: readonly string[]
  onStart: () => void
}) {
  return (
    <HeroPanel
      tone="crema"
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center lg:gap-10"
    >
      <div className="min-w-0">
        <h2 className="font-serif text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
          Armemos Administración
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          Vas a decir cómo figura el bar en los papeles, dónde está la plata, cómo te pagan y con
          qué número facturás. Lo podés dejar por la mitad: queda guardado en este dispositivo.
        </p>
        <p className="mt-4 flex items-start gap-2 text-sm text-pretty">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          Solo vos y quienes habilites van a ver Administración.
        </p>
        <Button
          type="button"
          className="mt-5 h-12 w-full gap-2 px-6 text-base sm:w-auto"
          onClick={onStart}
        >
          Empezar
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
      {haveAtHand.length > 0 ? (
        <div className="rounded-xl bg-secondary/50 p-4">
          <h3 className="text-sm font-semibold">Tené a mano</h3>
          <ul className="mt-2.5 grid gap-2.5 text-sm text-muted-foreground">
            {haveAtHand.map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
                <span className="min-w-0 text-pretty">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </HeroPanel>
  )
}
