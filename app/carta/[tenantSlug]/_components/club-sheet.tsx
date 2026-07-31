'use client'

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  LogIn,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
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
import {
  type ClubLoginState,
  type ClubResetRequestState,
  type ClubSetPasswordState,
  type ClubVerifyCodeState,
  clubLogin,
  requestClubPasswordReset,
  setClubPasswordWithTicket,
  verifyClubResetCode,
} from '@/lib/club-auth/actions'
import { useDismissOnBack } from './use-dismiss-on-back'

/**
 * Sheet del club embebido en la carta.
 *
 * Antes era UN solo formulario de alta, y por eso al socio que perdió la cookie
 * el labio le prometía "Sumate al club" y el form le pedía datos que ya había
 * dado. Ahora hay dos caminos explícitos (alta y login) más el rescate por
 * WhatsApp para el que se olvidó la contraseña. Los tres terminan en el MISMO
 * bloque de éxito → billetera.
 */

type Mode = 'choose' | 'signup' | 'login' | 'forgot-phone' | 'forgot-code' | 'forgot-password'

/** Lo que hay que celebrar al final: alta nueva o sesión recuperada. */
type Outcome =
  | { kind: 'joined'; wasNew: boolean; bonus: number }
  | { kind: 'session'; firstTime: boolean }

/** ms de la animación de salida del Sheet: reseteamos recién cuando terminó. */
const EXIT_MS = 320

// ── Wrappers para useActionState (las Server Actions toman sólo FormData) ────
const signupAction = async (_prev: CaptureActionState | null, formData: FormData) =>
  submitCapture(formData)
const loginAction = async (_prev: ClubLoginState | null, formData: FormData) => clubLogin(formData)
const resetAction = async (_prev: ClubResetRequestState | null, formData: FormData) =>
  requestClubPasswordReset(formData)
const verifyAction = async (_prev: ClubVerifyCodeState | null, formData: FormData) =>
  verifyClubResetCode(formData)
const passwordAction = async (_prev: ClubSetPasswordState | null, formData: FormData) =>
  setClubPasswordWithTicket(formData)

function SubmitButton({
  label,
  pendingLabel,
  icon,
}: {
  label: string
  pendingLabel: string
  icon?: React.ReactNode
}): React.JSX.Element {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending} className="h-12 w-full gap-2 text-base">
      {pending ? pendingLabel : label}
      {pending ? null : icon}
    </Button>
  )
}

/** Campo de contraseña con ojito. El toggle mide 44px: se toca con el pulgar. */
function PasswordField({
  id,
  label,
  hint,
  autoComplete,
  minLength,
}: {
  id: string
  label: string
  hint?: string
  autoComplete: 'new-password' | 'current-password'
  minLength?: number
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name="password"
          type={visible ? 'text' : 'password'}
          required
          minLength={minLength}
          maxLength={72}
          autoComplete={autoComplete}
          className="h-11 pr-12 text-base"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ErrorNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </p>
  )
}

/** Aviso informativo (no es un error): "ya sos socio", "te mandamos el código". */
function InfoNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg border border-[color:var(--brand-accent,var(--primary))]/25 bg-[color:var(--brand-accent,var(--primary))]/10 px-3 py-2 text-sm text-foreground"
    >
      <ShieldCheck
        className="mt-0.5 size-4 shrink-0 text-[color:var(--brand-accent,var(--primary))]"
        aria-hidden
      />
      <span className="text-pretty">{children}</span>
    </p>
  )
}

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
  const [signupState, submitSignup] = useActionState(signupAction, null)
  const [loginState, submitLogin] = useActionState(loginAction, null)
  const [resetState, submitReset] = useActionState(resetAction, null)
  const [verifyState, submitVerify] = useActionState(verifyAction, null)
  const [passwordState, submitPassword] = useActionState(passwordAction, null)

  const [mode, setMode] = useState<Mode>('choose')
  const [phone, setPhone] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const [ticket, setTicket] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const resetTimer = useRef(0)

  // Máximo del input de fecha = hoy (no se aceptan fechas futuras).
  const today = new Date().toISOString().slice(0, 10)

  // ── Transiciones dirigidas por el resultado de cada acción ────────────────
  useEffect(() => {
    if (!signupState?.ok) return
    if (signupState.kind === 'needs_login') {
      if (signupState.hasPassword) {
        setMode('login')
        setNotice(`Ya sos socio de ${tenantName}. Poné tu contraseña para entrar.`)
      } else {
        // Socio de antes del rediseño: nunca creó contraseña. No lo mandamos al
        // login (donde no tiene nada que tipear) sino a crearla probando que el
        // teléfono es suyo — que es lo único que impide tomarle la cuenta.
        setMode('forgot-phone')
        setNotice(
          `Ya sos socio de ${tenantName}, pero todavía no tenés contraseña. Pedí un código por WhatsApp para crearla.`,
        )
      }
      return
    }
    setOutcome({
      kind: 'joined',
      wasNew: signupState.was_new,
      bonus: signupState.welcome_bonus_points ?? 0,
    })
  }, [signupState, tenantName])

  useEffect(() => {
    if (!loginState) return
    if (loginState.ok) {
      setOutcome({ kind: 'session', firstTime: false })
      return
    }
    // Socio viejo sin contraseña: lo llevamos a pedir el código en vez de
    // retarlo con un error. El envío lo dispara él (un tap) — el server no manda
    // WhatsApps como efecto de un intento de login.
    if (loginState.reason === 'no_password') {
      setNotice(loginState.message)
      setMode('forgot-phone')
    }
  }, [loginState])

  useEffect(() => {
    if (!resetState?.ok) return
    setNotice(resetState.message)
    setMode('forgot-code')
  }, [resetState])

  useEffect(() => {
    if (!verifyState?.ok) return
    setTicket(verifyState.reset_ticket)
    setNotice(null)
    setMode('forgot-password')
  }, [verifyState])

  useEffect(() => {
    if (!passwordState?.ok) return
    setOutcome({ kind: 'session', firstTime: true })
  }, [passwordState])

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const handleClose = () => {
    onClose()
    window.clearTimeout(resetTimer.current)
    // Volvemos al inicio recién cuando terminó la animación de salida: resetear
    // en caliente hace parpadear el primer paso mientras el sheet todavía se va.
    // El `outcome` NO se toca: si ya entró, reabrir tiene que seguir ofreciéndole
    // la billetera y no un alta que ya hizo.
    resetTimer.current = window.setTimeout(() => {
      setMode('choose')
      setNotice(null)
      setTicket(null)
    }, EXIT_MS)
  }

  useDismissOnBack(open, handleClose)

  const goToWallet = () => {
    window.location.assign(`/carta/${tenantSlug}?wallet=1`)
  }
  const stayInMenu = () => {
    // Recarga sin parámetros: toma la cookie y muestra "Mi billetera" en la barra.
    window.location.assign(`/carta/${tenantSlug}`)
  }

  const goTo = (next: Mode) => {
    setNotice(null)
    setMode(next)
  }

  const back: Partial<Record<Mode, Mode>> = {
    signup: 'choose',
    login: 'choose',
    'forgot-phone': 'login',
    'forgot-code': 'login',
  }
  const backTo = back[mode]

  const heading = getHeading(mode, tenantName)
  const hiddenLink = linkSlug ? <input type="hidden" name="link_slug" value={linkSlug} /> : null
  const hiddenPhone = <input type="hidden" name="phone" value={phone ?? ''} />

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent
        side="bottom"
        showClose={!outcome}
        className="force-light max-h-[94dvh] gap-0 overflow-y-auto rounded-t-3xl p-0"
        aria-describedby={undefined}
      >
        <SheetGrabber />

        {outcome ? (
          <div className="flex flex-col items-center gap-4 px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="size-9" />
            </div>
            <div className="space-y-1.5">
              <SheetTitle className="font-serif text-2xl font-semibold tracking-tight">
                {successTitle(outcome)}
              </SheetTitle>
              <SheetDescription className="text-pretty text-sm text-muted-foreground">
                {successDescription(outcome, tenantName)}
              </SheetDescription>
            </div>

            {outcome.kind === 'joined' && outcome.wasNew && outcome.bonus > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm">
                <Gift className="size-4 text-warning" aria-hidden />
                <span className="font-medium text-foreground">
                  Ganaste <span className="font-semibold text-warning">{outcome.bonus} puntos</span>{' '}
                  de bienvenida
                </span>
              </div>
            ) : null}

            <div className="mt-2 flex w-full flex-col gap-2">
              <Button size="lg" onClick={goToWallet} className="h-12 w-full gap-2 text-base">
                <Wallet className="size-4" />
                Ver mi billetera
              </Button>
              <Button variant="ghost" onClick={stayInMenu} className="h-11 w-full">
                Seguir viendo la carta
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-8">
            {backTo ? (
              <button
                type="button"
                onClick={() => goTo(backTo)}
                aria-label="Volver"
                className="absolute left-2 top-6 flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="size-5" aria-hidden />
              </button>
            ) : null}

            <div className="mb-5 flex flex-col items-center gap-2 px-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-[color:var(--brand-accent,var(--primary))]/12 text-[color:var(--brand-accent,var(--primary))]">
                {heading.icon}
              </span>
              <SheetTitle className="font-serif text-2xl font-semibold tracking-tight text-balance">
                {heading.title}
              </SheetTitle>
              <SheetDescription className="max-w-xs text-pretty text-sm text-muted-foreground">
                {heading.description}
              </SheetDescription>
            </div>

            {!linkSlug ? (
              <p className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
                El club todavía no está disponible en este local.
              </p>
            ) : mode === 'choose' ? (
              <div className="grid gap-2.5">
                <Button
                  size="lg"
                  onClick={() => goTo('signup')}
                  className="h-12 w-full gap-2 text-base"
                >
                  <Sparkles className="size-4" aria-hidden />
                  Unirme al club
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => goTo('login')}
                  className="h-12 w-full gap-2 text-base"
                >
                  <LogIn className="size-4" aria-hidden />
                  Ya tengo cuenta
                </Button>
                <p className="mt-1 text-center text-[11px] text-muted-foreground/80">
                  Tus datos quedan solo con {tenantName}. No los compartimos.
                </p>
              </div>
            ) : mode === 'signup' ? (
              <form action={submitSignup} className="grid gap-4">
                {hiddenLink}
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

                <PasswordField
                  id="club-password"
                  label="Contraseña"
                  autoComplete="new-password"
                  minLength={6}
                  hint="Mínimo 6 caracteres. Te sirve para entrar desde cualquier celular."
                />

                {signupState && !signupState.ok ? (
                  <ErrorNote>{signupState.message}</ErrorNote>
                ) : null}

                <SubmitButton
                  label="Unirme al club"
                  pendingLabel="Sumándote…"
                  icon={<ArrowRight className="size-4" />}
                />
                <p className="text-center text-[11px] text-muted-foreground/80">
                  Tus datos quedan solo con {tenantName}. No los compartimos.
                </p>
              </form>
            ) : mode === 'login' ? (
              <form action={submitLogin} className="grid gap-4">
                {hiddenLink}
                {notice ? <InfoNote>{notice}</InfoNote> : null}

                <div className="grid gap-1.5">
                  <Label htmlFor="club-login-phone">Teléfono</Label>
                  <PhoneInput
                    id="club-login-phone"
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

                <PasswordField
                  id="club-login-password"
                  label="Contraseña"
                  autoComplete="current-password"
                />

                {loginState && !loginState.ok && loginState.reason !== 'no_password' ? (
                  <ErrorNote>{loginState.message}</ErrorNote>
                ) : null}

                <SubmitButton
                  label="Entrar"
                  pendingLabel="Entrando…"
                  icon={<ArrowRight className="size-4" />}
                />

                <button
                  type="button"
                  onClick={() => goTo('forgot-phone')}
                  className="mx-auto rounded-md px-3 py-2 text-sm font-medium text-muted-foreground underline underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Olvidé mi contraseña
                </button>
              </form>
            ) : mode === 'forgot-phone' ? (
              <form action={submitReset} className="grid gap-4">
                {hiddenLink}
                <div className="grid gap-1.5">
                  <Label htmlFor="club-forgot-phone">Teléfono</Label>
                  <PhoneInput
                    id="club-forgot-phone"
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

                {resetState && !resetState.ok ? <ErrorNote>{resetState.message}</ErrorNote> : null}

                <SubmitButton
                  label="Mandarme el código"
                  pendingLabel="Mandando…"
                  icon={<MessageCircle className="size-4" />}
                />
              </form>
            ) : mode === 'forgot-code' ? (
              <div className="grid gap-3">
                <form action={submitVerify} className="grid gap-4">
                  {hiddenLink}
                  {hiddenPhone}
                  {notice ? <InfoNote>{notice}</InfoNote> : null}

                  <div className="grid gap-1.5">
                    <Label htmlFor="club-code">Código de 6 números</Label>
                    <Input
                      id="club-code"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={7}
                      placeholder="000000"
                      className="h-12 text-center font-mono text-xl tracking-[0.5em]"
                    />
                  </div>

                  {verifyState && !verifyState.ok ? (
                    <ErrorNote>{verifyState.message}</ErrorNote>
                  ) : null}

                  <SubmitButton
                    label="Verificar código"
                    pendingLabel="Verificando…"
                    icon={<ArrowRight className="size-4" />}
                  />
                </form>

                {/* Reenvío en su propio form: no se pueden anidar. */}
                <form action={submitReset} className="text-center">
                  {hiddenLink}
                  {hiddenPhone}
                  <Button
                    type="submit"
                    variant="ghost"
                    className="h-11 text-sm text-muted-foreground"
                  >
                    No me llegó — reenviar código
                  </Button>
                </form>
              </div>
            ) : (
              <form action={submitPassword} className="grid gap-4">
                <input type="hidden" name="reset_ticket" value={ticket ?? ''} />
                <PasswordField
                  id="club-new-password"
                  label="Nueva contraseña"
                  autoComplete="new-password"
                  minLength={6}
                  hint="Mínimo 6 caracteres. Con esta contraseña entrás desde cualquier celular."
                />

                {passwordState && !passwordState.ok ? (
                  <ErrorNote>{passwordState.message}</ErrorNote>
                ) : null}

                <SubmitButton
                  label="Guardar y entrar"
                  pendingLabel="Guardando…"
                  icon={<ArrowRight className="size-4" />}
                />
              </form>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function getHeading(
  mode: Mode,
  tenantName: string,
): { icon: React.ReactNode; title: string; description: string } {
  switch (mode) {
    case 'signup':
      return {
        icon: <Sparkles className="size-6" aria-hidden />,
        title: `Sumate al club de ${tenantName}`,
        description: 'Puntos en cada visita, beneficios y novedades. Te lleva 30 segundos.',
      }
    case 'login':
      return {
        icon: <LogIn className="size-6" aria-hidden />,
        title: 'Entrá a tu cuenta',
        description: `Con el teléfono y la contraseña con la que te sumaste al club de ${tenantName}.`,
      }
    case 'forgot-phone':
      return {
        icon: <KeyRound className="size-6" aria-hidden />,
        title: 'Recuperá tu acceso',
        description: 'Poné tu teléfono y te mandamos un código por WhatsApp.',
      }
    case 'forgot-code':
      return {
        icon: <MessageCircle className="size-6" aria-hidden />,
        title: 'Mirá tu WhatsApp',
        description: 'Te mandamos un código de 6 números. Vence en 10 minutos.',
      }
    case 'forgot-password':
      return {
        icon: <KeyRound className="size-6" aria-hidden />,
        title: 'Creá tu contraseña',
        description: 'Es la que vas a usar de acá en adelante para entrar a tu billetera.',
      }
    default:
      return {
        icon: <Sparkles className="size-6" aria-hidden />,
        title: `El club de ${tenantName}`,
        description: 'Puntos en cada visita, beneficios y novedades.',
      }
  }
}

function successTitle(outcome: Outcome): string {
  if (outcome.kind === 'session') {
    return outcome.firstTime ? '¡Listo, ya tenés contraseña!' : '¡Bienvenido de vuelta!'
  }
  return outcome.wasNew ? '¡Ya sos parte del club!' : '¡Bienvenido de vuelta!'
}

function successDescription(outcome: Outcome, tenantName: string): string {
  if (outcome.kind === 'session') {
    return 'Tu sesión queda guardada en este celular. Mirá tu billetera.'
  }
  return outcome.wasNew
    ? `Ya estás sumando puntos en cada visita a ${tenantName}.`
    : `Tus datos siguen con ${tenantName}. Mirá tu billetera.`
}
