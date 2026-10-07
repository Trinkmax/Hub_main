'use client'

import { Eye, EyeOff, Lock, Mail, Sparkles, UserPlus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { CopyButton } from '@/components/ui/copy-button'
import { Field, FieldRow, FormError } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { assignableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { type CreateMemberState, createMemberWithPassword } from './actions'

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

const initial: CreateMemberState | null = null

type SavedCreds = { email: string; password: string; emailSent: boolean }

export function CreateMemberForm({
  tenantSlug,
  canManageAccountant,
}: {
  tenantSlug: string
  /** «Contabilidad» solo se ofrece a quien administra los accesos de Administración. */
  canManageAccountant: boolean
}) {
  const action = createMemberWithPassword.bind(null, tenantSlug)
  const roleOptions = assignableRoles(canManageAccountant)
  const [state, formAction] = useActionState(action, initial)
  const [showPassword, setShowPassword] = useState(true)
  const [password, setPassword] = useState(() => generatePassword())
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TenantRole>('cashier')
  const [fullName, setFullName] = useState('')
  const [savedCreds, setSavedCreds] = useState<SavedCreds | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  // Snapshot de credenciales submitteadas; lo leemos al recibir el resultado.
  const lastSubmittedRef = useRef<{ email: string; password: string } | null>(null)

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
          : `Ya tenía cuenta: le dimos acceso como ${ROLE_LABELS[state.role]}.`,
        {
          description:
            state.created === 'new'
              ? state.emailSent
                ? 'También le mandamos las credenciales por email.'
                : 'Compartile las credenciales en privado.'
              : 'Entra con la contraseña que ya tenía.',
        },
      )
      if (state.created === 'new' && lastSubmittedRef.current) {
        setSavedCreds({ ...lastSubmittedRef.current, emailSent: state.emailSent === true })
      } else if (state.created === 'existing') {
        setSavedCreds(null)
      }
      formRef.current?.reset()
      setEmail('')
      setFullName('')
      setRole('cashier')
      setPassword(generatePassword())
    } else if (state.field === 'email') {
      emailRef.current?.focus()
    }
  }, [state])

  const fieldErr = (k: 'email' | 'password' | 'role' | 'full_name') =>
    state && !state.ok && state.field === k ? state.message : undefined
  // Lo que no es de un campo (permiso, servidor) va arriba del formulario.
  const formErr = state && !state.ok && !state.field ? state.message : null

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} action={submitWithSnapshot} className="flex flex-col gap-4" noValidate>
        <FormError message={formErr} />

        <FieldRow>
          <Field label="Email" name="email" error={fieldErr('email')} required>
            <InputGroup>
              <InputAddon>
                <Mail aria-hidden />
              </InputAddon>
              <Input
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@bar.com"
              />
            </InputGroup>
          </Field>

          <Field label="Nombre" name="full_name" error={fieldErr('full_name')} optional>
            <Input
              type="text"
              maxLength={80}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Lucía Pereyra"
              autoComplete="off"
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field
            label="Contraseña"
            name="password"
            error={fieldErr('password')}
            hint="Generamos una segura. Podés cambiarla antes de crear el miembro."
            required
          >
            <InputGroup>
              <InputAddon>
                <Lock aria-hidden />
              </InputAddon>
              <Input
                type={showPassword ? 'text' : 'password'}
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="font-mono"
              />
              <InputAddon side="end" className="-me-2 gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setPassword(generatePassword())
                    toast.message('Generamos otra contraseña.')
                  }}
                  aria-label="Generar otra contraseña"
                >
                  <Sparkles aria-hidden />
                </Button>
              </InputAddon>
            </InputGroup>
          </Field>

          <Field label="Rol" name="role" error={fieldErr('role')} hint={ROLE_DESCRIPTIONS[role]}>
            <Select value={role} onValueChange={(v) => setRole(v as TenantRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((option) => (
                  <SelectItem key={option} value={option} description={ROLE_DESCRIPTIONS[option]}>
                    {ROLE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldRow>

        <FormActions sticky={false}>
          <SubmitButton pendingText="Creando…">
            <UserPlus aria-hidden />
            Crear miembro
          </SubmitButton>
        </FormActions>
      </form>

      {savedCreds ? (
        <CredentialsCallout creds={savedCreds} onClose={() => setSavedCreds(null)} />
      ) : null}
    </div>
  )
}

/** Las credenciales recién creadas, para copiarlas y pasarlas en privado. */
function CredentialsCallout({ creds, onClose }: { creds: SavedCreds; onClose: () => void }) {
  const both = `Email: ${creds.email}\nContraseña: ${creds.password}`

  return (
    <Callout
      tone="success"
      announce="polite"
      title="Cuenta creada"
      action={
        <>
          <CopyButton value={both} label="Copiar los dos" copiedLabel="Copiados" />
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <p>
        {creds.emailSent
          ? 'Ya le mandamos estos datos por email. Si hace falta, pasáselos también en privado: la contraseña la puede cambiar desde su perfil.'
          : 'Pasale estos datos en privado: la contraseña la puede cambiar desde su perfil.'}
      </p>
      <dl className="mt-2 grid gap-2">
        <CredentialRow
          icon={Mail}
          label="Email"
          value={creds.email}
          copyLabel="Copiar email"
          copiedLabel="Email copiado"
        />
        <CredentialRow
          icon={Lock}
          label="Contraseña"
          value={creds.password}
          copyLabel="Copiar contraseña"
          copiedLabel="Contraseña copiada"
        />
      </dl>
    </Callout>
  )
}

function CredentialRow({
  icon: Icon,
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  icon: typeof Mail
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card py-1 ps-3 pe-1">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">{value}</span>
        <CopyButton
          value={value}
          iconOnly
          variant="ghost"
          size="icon-sm"
          label={copyLabel}
          copiedLabel={copiedLabel}
        />
      </dd>
    </div>
  )
}
