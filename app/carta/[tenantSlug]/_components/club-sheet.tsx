'use client'

import { ArrowRight, CheckCircle2, Gift, Sparkles, Wallet } from 'lucide-react'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { type CaptureActionState, submitCapture } from '@/lib/capture/actions'
import { useDismissOnBack } from './use-dismiss-on-back'

const initial: CaptureActionState | null = null

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full gap-2">
      {pending ? 'Sumándote…' : 'Unirme al club'}
      {!pending ? <ArrowRight className="size-4" /> : null}
    </Button>
  )
}

async function action(_prev: CaptureActionState | null, formData: FormData) {
  return await submitCapture(formData)
}

/**
 * Sheet del club embebido en la carta. Reúne el formulario de alta (teléfono,
 * nombre, apellido, opt-in) y, al sumarse, navega a la carta con la wallet
 * abierta (la cookie de identidad ya quedó seteada por la Server Action).
 */
export function ClubSheet({
  open,
  onClose,
  tenantName,
  tenantSlug,
  linkSlug,
}: {
  open: boolean
  onClose: () => void
  tenantName: string
  tenantSlug: string
  linkSlug: string | null
}): React.JSX.Element {
  const [state, formAction] = useActionState(action, initial)
  const [phone, setPhone] = useState<string | undefined>(undefined)
  useDismissOnBack(open, onClose)

  // Máximo del input de fecha = hoy (no se aceptan fechas futuras).
  const today = new Date().toISOString().slice(0, 10)

  const goToWallet = () => {
    window.location.assign(`/carta/${tenantSlug}?wallet=1`)
  }
  const stayInMenu = () => {
    // Recarga sin parámetros: toma la cookie y muestra "Mi billetera" en la barra.
    window.location.assign(`/carta/${tenantSlug}`)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showClose={!state?.ok}
        className="force-light max-h-[94dvh] gap-0 overflow-y-auto rounded-t-3xl p-0"
        aria-describedby={undefined}
      >
        <SheetGrabber />
        {state?.ok ? (
          <div className="flex flex-col items-center gap-4 px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="size-9" />
            </div>
            <div className="space-y-1.5">
              <SheetTitle className="font-serif text-2xl font-semibold tracking-tight">
                {state.was_new ? '¡Ya sos parte del club!' : '¡Bienvenido de vuelta!'}
              </SheetTitle>
              <SheetDescription className="text-pretty text-sm text-muted-foreground">
                {state.was_new
                  ? `Ya estás sumando puntos en cada visita a ${tenantName}.`
                  : `Tus datos siguen con ${tenantName}. Mirá tu billetera.`}
              </SheetDescription>
            </div>

            {state.was_new && (state.welcome_bonus_points ?? 0) > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm">
                <Gift className="size-4 text-warning" aria-hidden />
                <span className="font-medium text-foreground">
                  Ganaste{' '}
                  <span className="font-semibold text-warning">
                    {state.welcome_bonus_points} puntos
                  </span>{' '}
                  de bienvenida
                </span>
              </div>
            ) : null}

            <div className="mt-2 flex w-full flex-col gap-2">
              <Button size="lg" onClick={goToWallet} className="w-full gap-2">
                <Wallet className="size-4" />
                Ver mi billetera
              </Button>
              <Button variant="ghost" onClick={stayInMenu} className="w-full">
                Seguir viendo la carta
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-8">
            <div className="mb-5 flex flex-col items-center gap-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-[color:var(--brand-accent,var(--primary))]/12 text-[color:var(--brand-accent,var(--primary))]">
                <Sparkles className="size-6" aria-hidden />
              </span>
              <SheetTitle className="font-serif text-2xl font-semibold tracking-tight text-balance">
                Sumate al club de {tenantName}
              </SheetTitle>
              <SheetDescription className="max-w-xs text-pretty text-sm text-muted-foreground">
                Puntos en cada visita, beneficios y novedades. Te lleva 30 segundos.
              </SheetDescription>
            </div>

            {linkSlug ? (
              <form action={formAction} className="grid gap-4">
                <input type="hidden" name="link_slug" value={linkSlug} />
                <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                  <Label htmlFor="club-website">Website</Label>
                  <input
                    id="club-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    defaultValue=""
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="club-phone">Teléfono</Label>
                  <PhoneInput
                    id="club-phone"
                    name="phone"
                    international
                    defaultCountry="AR"
                    value={phone}
                    onChange={setPhone}
                    placeholder="351 555 1234"
                    className="hub-phone-input"
                    aria-required="true"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="club-first">Nombre</Label>
                    <Input
                      id="club-first"
                      name="first_name"
                      required
                      maxLength={60}
                      autoComplete="given-name"
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="club-last">Apellido</Label>
                    <Input
                      id="club-last"
                      name="last_name"
                      required
                      maxLength={60}
                      autoComplete="family-name"
                      className="h-11 text-base"
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="club-email">Email</Label>
                  <Input
                    id="club-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    required
                    maxLength={120}
                    autoComplete="email"
                    placeholder="vos@email.com"
                    className="h-11 text-base"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="club-birthdate">Fecha de nacimiento</Label>
                  <Input
                    id="club-birthdate"
                    name="birthdate"
                    type="date"
                    required
                    min="1900-01-01"
                    max={today}
                    autoComplete="bday"
                    className="h-11 text-base"
                  />
                </div>

                {state && !state.ok ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {state.message}
                  </p>
                ) : null}

                <SubmitButton />
                <p className="text-center text-[11px] text-muted-foreground/80">
                  Tus datos quedan solo con {tenantName}. No los compartimos.
                </p>
              </form>
            ) : (
              <p className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
                El club todavía no está disponible en este local.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
