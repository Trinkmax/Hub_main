'use client'

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ClipboardCheck,
  LayoutGrid,
  Lightbulb,
  type LucideIcon,
  PartyPopper,
  Star,
  UserPlus,
  UtensilsCrossed,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type * as React from 'react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/ui/page-header'
import { Steps, type StepsStep } from '@/components/ui/steps'
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

/** Los cuatro pasos reales (sin bienvenida ni cierre), para `Steps` y el resumen de la bienvenida. */
const REAL_STEPS: ReadonlyArray<StepsStep & { icon: LucideIcon; summary: string }> = [
  { label: 'Mesas', icon: LayoutGrid, summary: 'Creás tus mesas y generás los QRs.' },
  { label: 'Carta', icon: UtensilsCrossed, summary: 'Cargás categorías e ítems.' },
  { label: 'Puntos', icon: Star, summary: 'Configurás cómo suman tus clientes.' },
  { label: 'Equipo', icon: UserPlus, summary: 'Invitás a tus mozos y cocineros.' },
]

const COMPLETE_ERROR = 'No se pudo completar. Probá de nuevo.'

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
  const [skipOpen, setSkipOpen] = useState(false)
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

  /** Marca el onboarding como hecho y lleva al panel. `false` si no se pudo. */
  const complete = async (): Promise<boolean> => {
    const r = await markOnboardingCompleted(tenantSlug)
    if (!r.ok) return false
    toast.success('¡Listo, tu bar está configurado!')
    router.push(`/${tenantSlug}`)
    return true
  }

  const finish = () => {
    startTransition(async () => {
      if (!(await complete())) toast.error(COMPLETE_ERROR)
    })
  }

  // El diálogo espera la acción abierto (con spinner) y, si falla, muestra el
  // error adentro en lugar de cerrarse.
  const confirmSkip = async (): Promise<ConfirmResult> => {
    if (await complete()) return
    return { ok: false, error: COMPLETE_ERROR }
  }
  const askSkip = () => setSkipOpen(true)

  const stepIdx = STEP_ORDER.indexOf(current)
  const realIdx = Math.max(0, stepIdx - 1)
  const isRealStep = current !== 'welcome' && current !== 'done'

  return (
    <>
      <PageHeader
        title={`Configurá ${tenantName}`}
        description="Te guío en 4 pasos para dejar tu bar listo. Tarda unos 5 minutos."
        actions={
          isRealStep ? (
            <Button type="button" variant="ghost" onClick={askSkip}>
              Saltear tutorial
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6">
        {isRealStep ? (
          <Steps steps={REAL_STEPS} current={realIdx} aria-label="Pasos de la configuración" />
        ) : null}

        <Card padding="lg">
          {current === 'welcome' && <WelcomeStep onNext={next} onSkip={askSkip} />}
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
        </Card>
      </div>

      <ConfirmDialog
        open={skipOpen}
        onOpenChange={setSkipOpen}
        title="¿Saltear la configuración inicial?"
        description="Vas a poder configurar todo después desde el menú lateral."
        confirmLabel="Saltear"
        pendingLabel="Guardando…"
        cancelLabel="Seguir configurando"
        onConfirm={confirmSkip}
      />
    </>
  )
}

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading icon={PartyPopper} title="Bienvenido a HUB">
        Arrancamos por lo básico para que tu bar empiece a recibir pedidos por QR. Podés saltearlo y
        configurar todo después desde el menú lateral.
      </StepHeading>
      <ol aria-label="Lo que vas a configurar" className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {REAL_STEPS.map(({ label, summary, icon: Icon }) => (
          <li key={label} className="flex items-start gap-3">
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
              strokeWidth={1.75}
            />
            <div className="min-w-0">
              <p className="type-label text-foreground">{label}</p>
              <p className="type-small text-pretty text-muted-foreground">{summary}</p>
            </div>
          </li>
        ))}
      </ol>
      <StepActions>
        <Button type="button" variant="ghost" onClick={onSkip}>
          Saltear por ahora
        </Button>
        <Button type="button" onClick={onNext}>
          Empezar
          <ArrowRight aria-hidden="true" />
        </Button>
      </StepActions>
    </div>
  )
}

type StepProps = {
  tenantSlug: string
  done: boolean
  onNext: () => void
  onPrev: () => void
}

function MesaStep({ tenantSlug, done, onNext, onPrev }: StepProps) {
  return (
    <StepShell
      icon={LayoutGrid}
      title="Crear tus primeras mesas"
      done={done}
      doneLabel="Ya tenés mesas: listo para seguir."
      description="Cada mesa física tiene un QR único. Lo imprimís y lo pegás en la mesa. Cuando un comensal lo escanea, ve la carta en su celular y puede pedir directo. Si la mesa se desarma, más adelante podés mover, dividir o unir sesiones desde el panel del mozo."
      tip="Empezá con 3 a 5 mesas para probar. Después podés sumar más."
      ctaLabel="Ir a Mesas"
      ctaHref={`/${tenantSlug}/local/mesas`}
      onNext={onNext}
      onPrev={onPrev}
    />
  )
}

function MenuStep({ tenantSlug, done, onNext, onPrev }: StepProps) {
  return (
    <StepShell
      icon={UtensilsCrossed}
      title="Cargar tu menú"
      done={done}
      doneLabel="Ya tenés ítems en la carta."
      description="Tu menú se organiza en categorías (cervezas, tragos, picadas, postres) con ítems adentro. Cada ítem tiene nombre, precio, descripción opcional, imagen y, si querés, una regla de puntos individual. El menú es lo que el comensal ve cuando escanea el QR."
      tip="Si recién arrancás, empezá con la categoría más común y un par de ítems. Lo extendés después."
      ctaLabel="Ir al Menú"
      ctaHref={`/${tenantSlug}/menu`}
      onNext={onNext}
      onPrev={onPrev}
    />
  )
}

function PuntosStep({ tenantSlug, done, onNext, onPrev }: StepProps) {
  return (
    <StepShell
      icon={Star}
      title="Configurar puntos"
      done={done}
      doneLabel="Ya tenés reglas activas."
      description={
        // Espacio duro después del «$» (formato de plata del kit): el monto no se corta.
        'Cuando un comensal registrado paga su mesa, suma puntos según las reglas que definas. Lo más común: 10 puntos por cada $ 1.000 gastados. Después podés crear premios canjeables o punch cards (5 cafés = 1 gratis).'
      }
      tip="Si todavía no estás seguro, salteá este paso. Lo configurás después y los comensales pueden seguir registrándose mientras tanto."
      ctaLabel="Configurar puntos"
      ctaHref={`/${tenantSlug}/club?tab=programa`}
      onNext={onNext}
      onPrev={onPrev}
      optional
    />
  )
}

function EquipoStep({ tenantSlug, done, onNext, onPrev }: StepProps) {
  return (
    <StepShell
      icon={UserPlus}
      title="Invitar a tu equipo"
      done={done}
      doneLabel="Ya invitaste a alguien."
      description="Creás cuentas para tus mozos, cocineros y cajeros. Cada uno con un rol: el Mozo ve el panel de mesas, el Cocinero ve la pantalla de cocina y el Cajero cobra mesas. Cuando creás una cuenta, le llega un email con sus datos de acceso (si tenés Resend configurado) o los copiás a mano."
      tip="Podés hacerlo más tarde. Mientras tanto, vos como dueño ves todo."
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
    <div className="flex flex-col gap-6">
      <StepHeading icon={ClipboardCheck} tone="success" title="¡Listo para arrancar!">
        Tu bar ya tiene lo básico. A partir de ahora podés:
      </StepHeading>
      <ul className="flex flex-col gap-3 type-body text-foreground">
        <Bullet>
          <strong className="font-semibold">Recibir pedidos por QR:</strong> los comensales escanean
          y piden desde sus celulares.
        </Bullet>
        <Bullet>
          <strong className="font-semibold">Operar desde el panel del mozo:</strong> ver las mesas
          abiertas, confirmar comandas y cobrar.
        </Bullet>
        <Bullet>
          <strong className="font-semibold">Consultar la documentación:</strong> está en el menú
          lateral, dentro de Configuración, con la guía completa.
        </Bullet>
      </ul>
      <StepActions>
        <Button variant="secondary" asChild>
          <Link href={`/${tenantSlug}/docs`}>
            <BookOpen aria-hidden="true" />
            Ver documentación
          </Link>
        </Button>
        <Button type="button" onClick={onFinish} loading={pending} loadingText="Guardando…">
          <Check aria-hidden="true" />
          Ir al panel
        </Button>
      </StepActions>
    </div>
  )
}

function StepShell({
  icon,
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
  icon: LucideIcon
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
    <div className="flex flex-col gap-6">
      <StepHeading icon={icon} title={title} badge={optional ? <Badge>Opcional</Badge> : null}>
        {description}
      </StepHeading>
      {done ? <Callout tone="success">{doneLabel}</Callout> : null}
      {tip ? (
        <Callout tone="neutral" icon={Lightbulb} title="Tip">
          {tip}
        </Callout>
      ) : null}
      <StepActions>
        <Button type="button" variant="ghost" onClick={onPrev} className="sm:mr-auto">
          <ArrowLeft aria-hidden="true" />
          Atrás
        </Button>
        <Button variant="secondary" asChild>
          <Link href={ctaHref} target="_blank">
            {ctaLabel}
            <ArrowUpRight aria-hidden="true" />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </Link>
        </Button>
        <Button type="button" onClick={onNext}>
          {done ? 'Siguiente' : optional ? 'Saltear' : 'Ya lo hice'}
          <ArrowRight aria-hidden="true" />
        </Button>
      </StepActions>
    </div>
  )
}

/** Ícono en disco + título de la tarjeta (`h2`: el `h1` es el del encabezado de la página). */
function StepHeading({
  icon: Icon,
  title,
  badge,
  tone = 'brand',
  children,
}: {
  icon: LucideIcon
  title: string
  badge?: React.ReactNode
  tone?: 'brand' | 'success'
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          tone === 'success' ? 'bg-success-soft text-success-text' : 'bg-secondary text-primary',
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="type-section text-balance text-foreground">{title}</h2>
          {badge}
        </div>
        {children ? (
          <p className="max-w-prose type-body text-pretty text-muted-foreground">{children}</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Las acciones de cada paso, con el reparto de `FormActions` en el celular:
 * botones del mismo ancho de a dos por fila (con tres, el principal queda solo
 * abajo). En escritorio, en línea a la derecha; el principal siempre último.
 */
function StepActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 max-sm:[&>*]:grow max-sm:[&>*]:basis-[calc(50%-1rem)]">
      {children}
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-text" />
      <span>{children}</span>
    </li>
  )
}
