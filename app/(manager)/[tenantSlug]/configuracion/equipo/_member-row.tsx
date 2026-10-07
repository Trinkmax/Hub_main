'use client'

import { Crown, KeyRound, MoreHorizontal, UserMinus } from 'lucide-react'
import { type FormEvent, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DataTableCell, DataTableRow } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { assignableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { removeMember, setMemberPassword, updateMemberRole } from './actions'

export type Member = {
  id: string
  user_id: string
  email: string
  full_name: string | null
  role: TenantRole
  created_at: string
}

function initials(member: Member): string {
  const source = (member.full_name || member.email || '?').trim()
  if (!source) return '?'
  const parts = source
    .replace(/[^\w\sÀ-ÿ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

/** El nombre que se muestra: el cargado o, si no hay, lo de antes de la @. */
function displayName(member: Member): string {
  return member.full_name?.trim() || member.email.split('@')[0] || member.email
}

/**
 * Una fila de la tabla de miembros: persona, rol (se cambia ahí mismo) y el
 * menú con «Cambiar contraseña» y «Quitar del equipo». Va adentro del
 * `DataTableBody` que arma la página.
 */
export function MemberRow({
  member,
  tenantSlug,
  isCurrentUser,
  canManageAccountant,
}: {
  member: Member
  tenantSlug: string
  isCurrentUser: boolean
  /** «Contabilidad» solo se ofrece a quien administra los accesos de Administración. */
  canManageAccountant: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [role, setRole] = useState<TenantRole>(member.role)
  // El rol actual siempre está en la lista (si no, el select queda en blanco).
  // A la contadora solo la cambia quien administra los accesos: para el resto
  // el select queda trabado (la action y la base lo frenan igual).
  const roleOptions = assignableRoles(canManageAccountant, member.role)
  const roleLocked = member.role === 'accountant' && !canManageAccountant
  const [resetOpen, setResetOpen] = useState(false)
  const confirm = useConfirm()
  const name = displayName(member)
  const isOwner = member.role === 'owner'

  const handleRoleChange = (next: string) => {
    const nextRole = next as TenantRole
    setRole(nextRole)
    startTransition(async () => {
      const r = await updateMemberRole(tenantSlug, member.id, nextRole)
      if (!r.ok) {
        toast.error(r.message)
        setRole(member.role)
      } else {
        toast.success('Rol actualizado.', { description: `${name}: ${ROLE_LABELS[nextRole]}.` })
      }
    })
  }

  const askRemove = () => {
    void confirm({
      title: `¿Quitar a ${name} del equipo?`,
      description:
        'Pierde el acceso al bar. Su cuenta de HUB queda intacta: la podés volver a sumar cuando quieras.',
      confirmLabel: 'Quitar del equipo',
      pendingLabel: 'Quitando…',
      tone: 'danger',
      icon: UserMinus,
      onConfirm: async () => {
        const r = await removeMember(tenantSlug, member.id)
        if (!r.ok) return r
        toast.success(`Quitamos a ${name} del equipo.`)
      },
    })
  }

  // El mismo selector va en dos lugares: en su columna desde `sm` y debajo del
  // nombre en el celular (a 360 px, la columna dejaba el nombre en tres letras).
  // Los dos leen y escriben el mismo estado; por CSS se ve uno solo.
  const roleSelect = (className: string) => (
    <Select value={role} onValueChange={handleRoleChange} disabled={isPending || roleLocked}>
      <SelectTrigger size="sm" className={className} aria-label={`Rol de ${name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="max-w-80">
        {roleOptions.map((option) => (
          <SelectItem key={option} value={option} description={ROLE_DESCRIPTIONS[option]}>
            {ROLE_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  // «Contabilidad» no entra en el ancho chico: solo se ensancha si está en la lista.
  const roleWidth = roleOptions.includes('accountant') ? 'w-36' : 'w-32'

  return (
    <DataTableRow>
      {/* w-full + max-w-0: la columna se queda con el resto del ancho y el texto se corta con «…» en vez de ensanchar la tabla. */}
      <DataTableCell className="w-full max-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar size="sm" className="mt-0.5">
            <AvatarFallback className={cn(isOwner && 'bg-brand-soft text-brand-text')}>
              {initials(member)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-foreground">{name}</span>
              {isOwner ? (
                <Crown aria-hidden className="size-3.5 shrink-0 text-primary" strokeWidth={1.75} />
              ) : null}
              {isCurrentUser ? (
                <Badge appearance="outline" className="shrink-0">
                  vos
                </Badge>
              ) : null}
            </div>
            <div className="truncate type-small text-muted-foreground">{member.email}</div>
            {/* Con el dedo, 44 px: el `sm` de la fila mide 36 y el selector no
                agranda su área táctil como los botones. */}
            <div className="mt-2 sm:hidden">
              {roleSelect(cn(roleWidth, 'max-w-full pointer-coarse:h-(--control-md)'))}
            </div>
          </div>
        </div>
      </DataTableCell>

      <DataTableCell className="max-sm:hidden">{roleSelect(roleWidth)}</DataTableCell>

      <DataTableCell align="end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              aria-label={`Más acciones para ${name}`}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setResetOpen(true)
              }}
            >
              <KeyRound aria-hidden />
              Cambiar contraseña
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isCurrentUser}
              onSelect={() => {
                if (!isCurrentUser) askRemove()
              }}
            >
              <UserMinus aria-hidden />
              {isCurrentUser ? 'No te podés quitar a vos' : 'Quitar del equipo'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ResetPasswordDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          member={member}
          name={name}
          tenantSlug={tenantSlug}
          roleLabel={ROLE_LABELS[member.role]}
        />
      </DataTableCell>
    </DataTableRow>
  )
}

function ResetPasswordDialog({
  open,
  onOpenChange,
  member,
  name,
  tenantSlug,
  roleLabel,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  member: Member
  name: string
  tenantSlug: string
  roleLabel: string
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await setMemberPassword(tenantSlug, member.id, password)
      if (!r.ok) {
        // El error queda al lado del campo: el diálogo sigue abierto para corregir.
        setError(r.message)
      } else {
        toast.success('Contraseña cambiada.', {
          description: `Pasásela a ${name} en privado.`,
        })
        onOpenChange(false)
        setPassword('')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (isPending) return
        onOpenChange(v)
        if (!v) {
          setPassword('')
          setError(null)
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            De {member.email} ({roleLabel}). Después la puede cambiar desde su perfil.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label="Nueva contraseña"
            hint="Mínimo 8 caracteres, con al menos una letra y un número."
            error={error}
            required
          >
            <Input
              type="text"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
              minLength={8}
              maxLength={72}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={isPending}
              loadingText="Guardando…"
              disabled={!isPending && password.length < 8}
            >
              Cambiar contraseña
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
