'use client'

import { Calendar, Gift, User } from 'lucide-react'
import Image from 'next/image'
import { useActionState, useEffect, useState } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type RegisterCustomerResult, registerCustomer } from '@/lib/m-session/actions'

const initial: RegisterCustomerResult = { ok: false, message: '' }

export type WelcomeRewardHero = {
  name: string
  description: string | null
  imageUrl: string | null
  headline: string
  subtext: string
} | null

export function RegisterDialog({
  qrToken,
  browserToken,
  tenantName,
  welcomeReward,
  onClose,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  welcomeReward: WelcomeRewardHero
  onClose: () => void
  onRegistered: (result: Extract<RegisterCustomerResult, { ok: true }>) => void
}) {
  const [state, action, pending] = useActionState(
    (_prev: RegisterCustomerResult, fd: FormData) => registerCustomer(fd),
    initial,
  )
  const [phone, setPhone] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (state.ok) onRegistered(state)
  }, [state, onRegistered])

  // Headline/subtext: el del tenant si está configurado, sino defaults sobrios
  const heroHeadline = welcomeReward?.headline ?? `Sumá puntos en ${tenantName}`
  const heroSubtext =
    welcomeReward?.subtext ?? 'Tres datos · 20 segundos · acumulás en cada consumo.'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-md">
        {/* HERO: si hay imagen del reward → image-led; sino → forest gradient con icono Gift */}
        {welcomeReward?.imageUrl ? (
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-lg bg-secondary/40">
            <Image
              src={welcomeReward.imageUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 480px"
              className="object-cover"
              unoptimized
              priority
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/85 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 px-6 pb-5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Gift className="size-3" aria-hidden />
                Regalo de bienvenida
              </span>
              <DialogHeader className="mt-2 text-left">
                <DialogTitle className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
                  {heroHeadline}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground text-pretty">
                  {heroSubtext}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-t-lg bg-app-gradient px-6 pt-6 pb-5">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[--forest-glow] blur-2xl"
            />
            <div className="relative">
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                <Gift className="size-6" />
              </div>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
                  {heroHeadline}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground text-pretty">
                  {heroSubtext}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
        )}

        {/* FORM */}
        <form action={action} className="space-y-4 px-6 pt-5 pb-6">
          <input type="hidden" name="qr_token" value={qrToken} />
          <input type="hidden" name="browser_token" value={browserToken} />
          {/* honeypot anti-bot */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />

          <div className="space-y-1.5">
            <Label
              htmlFor="first_name"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Nombre
            </Label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="first_name"
                name="first_name"
                required
                maxLength={60}
                autoComplete="given-name"
                className="h-12 rounded-xl pl-9 text-base"
                placeholder="Juan"
              />
            </div>
            {!state.ok && state.fieldErrors?.first_name && (
              <p className="text-xs text-destructive">{state.fieldErrors.first_name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="last_name"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Apellido
            </Label>
            <Input
              id="last_name"
              name="last_name"
              required
              maxLength={60}
              autoComplete="family-name"
              className="h-12 rounded-xl text-base"
              placeholder="Pérez"
            />
            {!state.ok && state.fieldErrors?.last_name && (
              <p className="text-xs text-destructive">{state.fieldErrors.last_name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="phone-input"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Teléfono
            </Label>
            <PhoneInput
              id="phone-input"
              name="phone"
              international
              defaultCountry="AR"
              value={phone}
              onChange={setPhone}
              placeholder="11 4567 8901"
              className="hub-phone-input"
              aria-required="true"
            />
            <p className="text-[11px] text-muted-foreground">
              Tocá la bandera si sos de otro país.
            </p>
            {!state.ok && state.fieldErrors?.phone && (
              <p className="text-xs text-destructive">{state.fieldErrors.phone}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="birthdate"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Cumpleaños{' '}
              <span className="font-normal normal-case text-muted-foreground/60">(opcional)</span>
            </Label>
            <div className="relative">
              <Calendar
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="birthdate"
                name="birthdate"
                type="date"
                className="h-12 rounded-xl pl-9 text-base"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">Para mandarte un regalo en tu día.</p>
          </div>

          <label
            htmlFor="opt_in_marketing"
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 p-3"
          >
            <Checkbox
              id="opt_in_marketing"
              name="opt_in_marketing"
              defaultChecked
              className="mt-0.5"
            />
            <span className="text-xs leading-snug text-muted-foreground">
              Quiero recibir novedades y promos por WhatsApp.
              <br />
              <span className="text-[10px] opacity-70">
                Podés darte de baja en cualquier momento.
              </span>
            </span>
          </label>

          {!state.ok && state.message && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {state.message}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} className="sm:flex-none">
              Ahora no
            </Button>
            <Button
              type="submit"
              disabled={pending}
              size="xl"
              className="rounded-xl font-semibold sm:flex-1"
            >
              {pending ? 'Guardando…' : welcomeReward ? 'Lo quiero' : 'Empezar a sumar puntos'}
            </Button>
          </div>

          <p className="text-center text-[10px] text-muted-foreground">
            Tus datos quedan únicamente con {tenantName}. No se comparten.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
