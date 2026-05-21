'use client'

import { Calendar, Gift, MessageCircleHeart, Phone, Sparkles, User } from 'lucide-react'
import { useActionState, useEffect } from 'react'
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

export function RegisterDialog({
  qrToken,
  browserToken,
  tenantName,
  onClose,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  onClose: () => void
  onRegistered: () => void
}) {
  const [state, action, pending] = useActionState(
    (_prev: RegisterCustomerResult, fd: FormData) => registerCustomer(fd),
    initial,
  )

  useEffect(() => {
    if (state.ok) onRegistered()
  }, [state.ok, onRegistered])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto p-0 sm:max-w-md">
        {/* Hero header con gradient */}
        <div className="relative overflow-hidden rounded-t-lg bg-gradient-to-br from-amber-100 via-amber-50 to-orange-100 px-6 pb-5 pt-6 dark:from-amber-950/40 dark:via-amber-950/30 dark:to-orange-950/40">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-amber-300/30 blur-2xl dark:bg-amber-600/20"
          />
          <div className="relative">
            <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md ring-4 ring-white/50 dark:ring-amber-900/40">
              <Sparkles className="size-6 fill-white/30" />
            </div>
            <DialogHeader className="text-left">
              <DialogTitle className="font-serif text-2xl leading-tight tracking-tight text-amber-950 dark:text-amber-50">
                Sumá puntos en {tenantName}
              </DialogTitle>
              <DialogDescription className="text-amber-800/80 dark:text-amber-200/80">
                Tres datos · 20 segundos · acumulás en cada consumo.
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        {/* Beneficios chiquitos */}
        <ul className="grid grid-cols-3 gap-2 px-6 pt-5 text-center">
          {[
            { icon: Gift, label: 'Recompensas' },
            { icon: Sparkles, label: 'Beneficios' },
            { icon: MessageCircleHeart, label: 'Novedades' },
          ].map(({ icon: Icon, label }) => (
            <li key={label} className="flex flex-col items-center gap-1">
              <span className="flex size-9 items-center justify-center rounded-full bg-secondary/60 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
            </li>
          ))}
        </ul>

        {/* FORM */}
        <form action={action} className="space-y-4 px-6 pb-6 pt-5">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="first_name"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Nombre
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="first_name"
                  name="first_name"
                  autoFocus
                  required
                  maxLength={60}
                  className="h-11 pl-9 text-base"
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
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Apellido
              </Label>
              <Input
                id="last_name"
                name="last_name"
                required
                maxLength={60}
                className="h-11 text-base"
                placeholder="Pérez"
              />
              {!state.ok && state.fieldErrors?.last_name && (
                <p className="text-xs text-destructive">{state.fieldErrors.last_name}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="phone"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Teléfono
            </Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                required
                placeholder="11 4567 8901"
                autoComplete="tel"
                className="h-11 pl-9 text-base"
              />
            </div>
            {!state.ok && state.fieldErrors?.phone && (
              <p className="text-xs text-destructive">{state.fieldErrors.phone}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="birthdate"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Cumpleaños{' '}
              <span className="font-normal lowercase text-muted-foreground/60">(opcional)</span>
            </Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="birthdate" name="birthdate" type="date" className="h-11 pl-9 text-base" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Para mandarte un regalo en tu día 🎂
            </p>
          </div>

          <label
            htmlFor="opt_in_marketing"
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 p-3"
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
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
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
              className="h-12 gap-2 bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md hover:from-amber-600 hover:to-orange-600 sm:flex-1"
            >
              <Sparkles className="size-4" />
              {pending ? 'Guardando…' : 'Empezar a sumar puntos'}
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
