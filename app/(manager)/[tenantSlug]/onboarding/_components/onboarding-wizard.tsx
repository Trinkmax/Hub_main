'use client'

import {
  ArrowRight,
  Check,
  ChefHat,
  ClipboardCheck,
  LayoutGrid,
  PartyPopper,
  Star,
  UserPlus,
  UtensilsCrossed,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { markOnboardingCompleted } from '@/lib/onboarding/actions'
import { cn } from '@/lib/utils'

type StepKey = 'welcome' | 'mesa' | 'menu' | 'puntos' | 'equipo' | 'done'

type StepStatus = {
  table_created: boolean
  menu_seeded: boolean
  points_configured: boolean
  team_invited: boolean
}

const STEP_ORDER: StepKey[] = ['welcome', 'mesa', 'menu', 'puntos', 'equipo', 'done']

export function OnboardingWizard({
  tenantSlug,
  tenantName,
  initialSteps,
}: {
  tenantSlug: string
  tenantName: string
  initialSteps: StepStatus
}) {
  const router = useRouter()
  const [current, setCurrent] = useState<StepKey>('welcome')
  const [pending, startTransition] = useTransition()

  const next = () => {
    const idx = STEP_ORDER.indexOf(current)
    if (idx < STEP_ORDER.length - 1) {
      const nextStep = STEP_ORDER[idx + 1]
      if (nextStep) setCurrent(nextStep)
    }
  }
  const prev = () => {
    const idx = STEP_ORDER.indexOf(current)
    if (idx > 0) {
      const prevStep = STEP_ORDER[idx - 1]
      if (prevStep) setCurrent(prevStep)
    }
  }

  const finish = () => {
    startTransition(async () => {
      const r = await markOnboardingCompleted(tenantSlug)
      if (r.ok) {
        toast.success('¡Listo, tu bar está configurado!')
        router.push(`/${tenantSlug}`)
      } else {
        toast.error('No se pudo completar. Probá de nuevo.')
      }
    })
  }

  const skip = () => {
    if (
      window.confirm(
        '¿Saltear el tutorial? Vas a poder configurar todo después desde el menú lateral.',
      )
    ) {
      finish()
    }
  }

  const stepIdx = STEP_ORDER.indexOf(current)
  const totalRealSteps = STEP_ORDER.length - 2 // excluye welcome y done
  const realIdx = Math.max(0, stepIdx - 1)

  return (
    <div className="space-y-6">
      {current !== 'welcome' && current !== 'done' && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Paso {realIdx + 1} de {totalRealSteps}
          </p>
          <button
            type="button"
            onClick={skip}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Saltear tutorial
          </button>
        </div>
      )}

      <div className="card-hairline card-hairline rounded-2xl border border-border/70 bg-card/90 p-6 shadow-lg sm:p-8">
        {current === 'welcome' && (
          <WelcomeStep tenantName={tenantName} onNext={next} onSkip={skip} />
        )}
        {current === 'mesa' && (
          <MesaStep
            tenantSlug={tenantSlug}
            done={initialSteps.table_created}
            onNext={next}
            onPrev={prev}
          />
        )}
        {current === 'menu' && (
          <MenuStep
            tenantSlug={tenantSlug}
            done={initialSteps.menu_seeded}
            onNext={next}
            onPrev={prev}
          />
        )}
        {current === 'puntos' && (
          <PuntosStep
            tenantSlug={tenantSlug}
            done={initialSteps.points_configured}
            onNext={next}
            onPrev={prev}
          />
        )}
        {current === 'equipo' && (
          <EquipoStep
            tenantSlug={tenantSlug}
            done={initialSteps.team_invited}
            onNext={next}
            onPrev={prev}
          />
        )}
        {current === 'done' && (
          <DoneStep tenantSlug={tenantSlug} onFinish={finish} pending={pending} />
        )}
      </div>

      {current !== 'welcome' && current !== 'done' && (
        <div className="flex items-center justify-center gap-1.5">
          {STEP_ORDER.slice(1, -1).map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === realIdx
                  ? 'w-8 bg-primary'
                  : i < realIdx
                    ? 'w-3 bg-primary/60'
                    : 'w-3 bg-muted',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function WelcomeStep({
  tenantName,
  onNext,
  onSkip,
}: {
  tenantName: string
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-[--cream-tint] text-primary">
        <PartyPopper className="size-7" />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Bienvenido a HUB
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
          Configurá {tenantName}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Te guío en 4 pasos para que tu bar empiece a recibir pedidos por QR. Tarda unos 5 minutos.
          Podés saltearlo y configurar manualmente desde el menú lateral.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2 text-left text-xs">
        <Card icon={LayoutGrid} title="Mesas" desc="Creás tus mesas y generás los QRs." />
        <Card icon={UtensilsCrossed} title="Menú" desc="Cargás categorías e ítems." />
        <Card icon={Star} title="Puntos" desc="Configurás cómo suman tus clientes." />
        <Card icon={UserPlus} title="Equipo" desc="Invitás a tus mozos y cocineros." />
      </div>
      <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:justify-center">
        <Button type="button" onClick={onNext} className="gap-1.5">
          Empezar <ArrowRight className="size-4" />
        </Button>
        <Button type="button" variant="ghost" onClick={onSkip}>
          Saltear por ahora
        </Button>
      </div>
    </div>
  )
}

function MesaStep({
  tenantSlug,
  done,
  onNext,
  onPrev,
}: {
  tenantSlug: string
  done: boolean
  onNext: () => void
  onPrev: () => void
}) {
  return (
    <StepShell
      icon={LayoutGrid}
      title="Crear tus primeras mesas"
      done={done}
      doneLabel="Ya tenés mesas — listo para seguir"
      description="Cada mesa física tiene un QR único. Lo imprimís y lo pegás en la mesa. Cuando un comensal lo escanea, ve la carta en su celular y puede pedir directo. Si la mesa se desarma, podés mover, splitear o mergear sesiones desde el panel del mozo más adelante."
      tip="Empezá con 3-5 mesas para probar. Después podés sumar más."
      ctaLabel="Ir a Mesas"
      ctaHref={`/${tenantSlug}/local/mesas`}
      onNext={onNext}
      onPrev={onPrev}
    />
  )
}

function MenuStep({
  tenantSlug,
  done,
  onNext,
  onPrev,
}: {
  tenantSlug: string
  done: boolean
  onNext: () => void
  onPrev: () => void
}) {
  return (
    <StepShell
      icon={UtensilsCrossed}
      title="Cargar tu menú"
      done={done}
      doneLabel="Ya tenés ítems en la carta"
      description="Tu menú se organiza en categorías (cervezas, tragos, picadas, postres) con ítems adentro. Cada ítem tiene nombre, precio, descripción opcional, imagen y, si querés, una regla de puntos individual. El menú es lo que el comensal ve cuando escanea el QR."
      tip="Si recién arrancás, empezá con la categoría más común y un par de ítems. Lo extendés después."
      ctaLabel="Ir al Menú"
      ctaHref={`/${tenantSlug}/menu`}
      onNext={onNext}
      onPrev={onPrev}
    />
  )
}

function PuntosStep({
  tenantSlug,
  done,
  onNext,
  onPrev,
}: {
  tenantSlug: string
  done: boolean
  onNext: () => void
  onPrev: () => void
}) {
  return (
    <StepShell
      icon={Star}
      title="Configurar puntos (opcional)"
      done={done}
      doneLabel="Ya tenés reglas activas"
      description="Cuando un comensal registrado paga su mesa, suma puntos según las reglas que definas. Lo más común: cada $1.000 gastados → 10 puntos. Después podés crear premios canjeables o punch cards (5 cafés = 1 gratis)."
      tip="Si todavía no estás seguro, salteá este paso. Lo configurás después y los comensales pueden seguir registrándose mientras tanto."
      ctaLabel="Configurar puntos"
      ctaHref={`/${tenantSlug}/club?tab=programa`}
      onNext={onNext}
      onPrev={onPrev}
      optional
    />
  )
}

function EquipoStep({
  tenantSlug,
  done,
  onNext,
  onPrev,
}: {
  tenantSlug: string
  done: boolean
  onNext: () => void
  onPrev: () => void
}) {
  return (
    <StepShell
      icon={UserPlus}
      title="Invitar a tu equipo (opcional)"
      done={done}
      doneLabel="Ya invitaste a alguien"
      description="Creás cuentas para tus mozos, cocineros y cajeros. Cada uno con un rol: el Mozo ve el panel de sesiones, el Cocinero ve el KDS de la cocina, el Cajero cobra mesas. Cuando creás una cuenta, le llega un email con sus credenciales (si tenés Resend configurado) o las copiás manualmente."
      tip="Podés hacerlo más tarde. Mientras tanto, vos como owner ves todo."
      ctaLabel="Ir a Equipo"
      ctaHref={`/${tenantSlug}/configuracion/equipo`}
      onNext={onNext}
      onPrev={onPrev}
      optional
    />
  )
}

function DoneStep({
  tenantSlug,
  onFinish,
  pending,
}: {
  tenantSlug: string
  onFinish: () => void
  pending: boolean
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-success/30 bg-success/15 text-success">
        <ClipboardCheck className="size-7" />
      </div>
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">¡Listo para arrancar!</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Tu bar ya tiene lo básico. A partir de ahora podés:
        </p>
      </div>
      <ul className="mx-auto max-w-md space-y-2 text-left text-sm">
        <Bullet>
          <strong>Recibir pedidos QR:</strong> los comensales escanean y piden desde sus celulares.
        </Bullet>
        <Bullet>
          <strong>Operar desde el panel del mozo:</strong> ver sesiones abiertas, confirmar
          comandas, cobrar.
        </Bullet>
        <Bullet>
          <strong>Consultar la documentación:</strong> en el menú lateral &rarr; Documentación,
          tenés la guía completa.
        </Bullet>
      </ul>
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
        <Button type="button" onClick={onFinish} disabled={pending} className="gap-1.5">
          <Check className="size-4" />
          {pending ? 'Guardando…' : 'Ir al panel'}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={`/${tenantSlug}/docs`}>
            <ChefHat className="mr-1.5 size-4" />
            Ver documentación
          </Link>
        </Button>
      </div>
    </div>
  )
}

function StepShell({
  icon: Icon,
  title,
  description,
  tip,
  done,
  doneLabel,
  ctaLabel,
  ctaHref,
  onNext,
  onPrev,
  optional,
}: {
  icon: typeof LayoutGrid
  title: string
  description: string
  tip?: string
  done: boolean
  doneLabel: string
  ctaLabel: string
  ctaHref: string
  onNext: () => void
  onPrev: () => void
  optional?: boolean
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-[--cream-tint] text-primary">
          <Icon className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-xl font-semibold tracking-tight">{title}</h2>
          {optional && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Opcional
            </p>
          )}
        </div>
      </div>
      <p className="text-sm leading-relaxed text-foreground/80">{description}</p>
      {tip && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <strong>Tip:</strong> {tip}
        </div>
      )}
      {done && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          <Check className="size-4" />
          {doneLabel}
        </div>
      )}
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onPrev}>
          Atrás
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" asChild>
            <Link href={ctaHref} target="_blank">
              {ctaLabel} ↗
            </Link>
          </Button>
          <Button type="button" onClick={onNext} className="gap-1.5">
            {done ? 'Siguiente' : optional ? 'Saltear' : 'Ya lo hice'}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function Card({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof LayoutGrid
  title: string
  desc: string
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-primary" />
        <p className="text-xs font-medium">{title}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{desc}</p>
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-success" />
      <span>{children}</span>
    </li>
  )
}
