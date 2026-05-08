'use client'

import { Check, Copy, Eye, EyeOff, Lock, Mail, Sparkles, UserPlus } from 'lucide-react'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { type CreateMemberState, createMemberWithPassword } from './actions'

const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Owner',
  cashier: 'Cajero',
  waiter: 'Mozo',
  kitchen: 'Cocina',
}

function pickFrom(alphabet: string, randomValue: number): string {
  const idx = randomValue % alphabet.length
  // Bajo noUncheckedIndexedAccess esto es string | undefined → garantizamos string.
  return alphabet.charAt(idx)
}

function generatePassword(length = 12): string {
  // Caracteres seguros (sin 0/O/l/I) — fácil de dictar / copiar.
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const all = lower + upper + digits
  const buf = new Uint32Array(length)
  crypto.getRandomValues(buf)

  // Garantizo mayúscula + minúscula + número.
  const chars: string[] = [
    pickFrom(lower, buf[0] ?? 0),
    pickFrom(upper, buf[1] ?? 0),
    pickFrom(digits, buf[2] ?? 0),
  ]
  for (let i = 3; i < length; i++) chars.push(pickFrom(all, buf[i] ?? 0))

  // Shuffle Fisher–Yates con randomness fresca.
  const shuf = new Uint32Array(chars.length)
  crypto.getRandomValues(shuf)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = (shuf[i] ?? 0) % (i + 1)
    const tmp = chars[i] ?? ''
    chars[i] = chars[j] ?? ''
    chars[j] = tmp
  }
  return chars.join('')
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="gap-1.5" size="default">
      <UserPlus className={cn('size-4', pending && 'animate-pulse')} />
      {pending ? 'Creando…' : 'Crear miembro'}
    </Button>
  )
}

const initial: CreateMemberState | null = null

export function CreateMemberForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createMemberWithPassword.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const [showPassword, setShowPassword] = useState(true)
  const [password, setPassword] = useState(() => generatePassword())
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TenantRole>('cashier')
  const [fullName, setFullName] = useState('')
  const [savedCreds, setSavedCreds] = useState<{ email: string; password: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  // Snapshot de credenciales submitteadas; lo leemos al recibir el resultado.
  const lastSubmittedRef = useRef<{ email: string; password: string } | null>(null)

  const emailId = useId()
  const passId = useId()
  const roleId = useId()
  const nameId = useId()

  // Wrapper para capturar la password justo antes de mandar al server.
  // Sin esto, el efecto que reacciona al state no sabe qué pass se envió.
  const submitWithSnapshot = (formData: FormData) => {
    lastSubmittedRef.current = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    }
    formAction(formData)
  }

  useEffect(() => {
    if (!state) return
    if (state.ok) {
      toast.success(
        state.created === 'new'
          ? `Cuenta creada para ${state.email}.`
          : `Ya tenía cuenta — le dimos acceso como ${ROLE_LABELS[state.role]}.`,
        {
          description:
            state.created === 'new'
              ? 'Compartile las credenciales en privado.'
              : 'Usa la contraseña que ya tenía.',
        },
      )
      if (state.created === 'new' && lastSubmittedRef.current) {
        setSavedCreds(lastSubmittedRef.current)
      } else if (state.created === 'existing') {
        setSavedCreds(null)
      }
      formRef.current?.reset()
      setEmail('')
      setFullName('')
      setRole('cashier')
      setPassword(generatePassword())
    } else if (state.message) {
      toast.error(state.message)
      if (state.field === 'email') emailRef.current?.focus()
    }
  }, [state])

  const fieldErr = (k: 'email' | 'password' | 'role' | 'full_name') =>
    state && !state.ok && state.field === k ? state.message : undefined

  return (
    <div className="space-y-3">
      <form
        ref={formRef}
        action={submitWithSnapshot}
        className="grid gap-3 sm:grid-cols-2"
        noValidate
      >
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor={emailId} className="text-xs font-medium text-muted-foreground">
            Email
          </Label>
          <div className="relative">
            <Mail
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
            />
            <Input
              ref={emailRef}
              id={emailId}
              name="email"
              type="email"
              required
              inputMode="email"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@bar.com"
              aria-invalid={Boolean(fieldErr('email')) || undefined}
              className={cn(
                'pl-9 transition-colors',
                fieldErr('email') && 'border-destructive focus-visible:ring-destructive/40',
              )}
            />
          </div>
          {fieldErr('email') ? (
            <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
              {fieldErr('email')}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor={nameId} className="text-xs font-medium text-muted-foreground">
            Nombre <span className="text-muted-foreground/60">(opcional)</span>
          </Label>
          <Input
            id={nameId}
            name="full_name"
            type="text"
            maxLength={80}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ej: Lucía Pereyra"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor={passId} className="text-xs font-medium text-muted-foreground">
            Contraseña
          </Label>
          <div className="relative">
            <Lock
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
            />
            <Input
              id={passId}
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              aria-invalid={Boolean(fieldErr('password')) || undefined}
              className={cn(
                'pl-9 pr-20 font-mono text-sm tracking-tight transition-colors',
                fieldErr('password') && 'border-destructive focus-visible:ring-destructive/40',
              )}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
                aria-pressed={showPassword}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPassword(generatePassword())
                  toast.message('Nueva contraseña generada.', {
                    description: 'Acordate de copiarla antes de crear el miembro.',
                  })
                }}
                aria-label="Generar contraseña"
                title="Generar nueva contraseña"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                tabIndex={-1}
              >
                <Sparkles className="size-3.5" />
              </button>
            </div>
          </div>
          {fieldErr('password') ? (
            <p className="text-xs text-destructive animate-in fade-in-0 slide-in-from-top-1">
              {fieldErr('password')}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Generamos una segura. Podés editarla.
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor={roleId} className="text-xs font-medium text-muted-foreground">
            Rol
          </Label>
          <Select name="role" value={role} onValueChange={(v) => setRole(v as TenantRole)}>
            <SelectTrigger id={roleId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">
                <span className="font-medium">Owner</span> — control total
              </SelectItem>
              <SelectItem value="cashier">
                <span className="font-medium">Cajero</span> — cierra mesas
              </SelectItem>
              <SelectItem value="waiter">
                <span className="font-medium">Mozo</span> — registra clientes
              </SelectItem>
              <SelectItem value="kitchen">
                <span className="font-medium">Cocina</span> — pantalla KDS
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-end sm:col-span-2">
          <SubmitButton />
        </div>
      </form>

      {savedCreds ? (
        <CredentialsBanner creds={savedCreds} onClose={() => setSavedCreds(null)} />
      ) : null}
    </div>
  )
}

function CredentialsBanner({
  creds,
  onClose,
}: {
  creds: { email: string; password: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'email' | 'pass' | 'both' | null>(null)
  const copy = async (text: string, kind: 'email' | 'pass' | 'both') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      toast.error('No pudimos copiar — copiá manualmente.')
    }
  }
  const both = `Email: ${creds.email}\nContraseña: ${creds.password}`

  return (
    <div className="card-hairline relative overflow-hidden rounded-xl border border-success/40 bg-success/5 p-4 animate-in fade-in-0 slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
          <Check className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold">Cuenta creada</p>
            <p className="text-xs text-muted-foreground text-pretty">
              Compartí estas credenciales <strong>en privado</strong> — el miembro va a poder
              cambiar la contraseña desde su perfil.
            </p>
          </div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <Mail className="size-3.5 text-muted-foreground" />
              <code className="flex-1 truncate font-mono text-xs">{creds.email}</code>
              <button
                type="button"
                onClick={() => copy(creds.email, 'email')}
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Copiar email"
              >
                {copied === 'email' ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <Lock className="size-3.5 text-muted-foreground" />
              <code className="flex-1 truncate font-mono text-xs">{creds.password}</code>
              <button
                type="button"
                onClick={() => copy(creds.password, 'pass')}
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Copiar contraseña"
              >
                {copied === 'pass' ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => copy(both, 'both')}
              className="gap-1.5"
            >
              {copied === 'both' ? (
                <Check className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied === 'both' ? '¡Copiado!' : 'Copiar ambos'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="text-muted-foreground"
            >
              Listo
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
