'use client'

import { Crown, KeyRound, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { removeMember, setMemberPassword, updateMemberRole } from './actions'

const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Owner',
  cashier: 'Cajero',
  waiter: 'Mozo',
  kitchen: 'Cocina',
}

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

export function MemberRow({
  member,
  tenantSlug,
  isCurrentUser,
}: {
  member: Member
  tenantSlug: string
  isCurrentUser: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [role, setRole] = useState<TenantRole>(member.role)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const handleRoleChange = (next: string) => {
    const nextRole = next as TenantRole
    setRole(nextRole)
    startTransition(async () => {
      const r = await updateMemberRole(tenantSlug, member.id, nextRole)
      if (!r.ok) {
        toast.error(r.message)
        setRole(member.role)
      } else {
        toast.success('Rol actualizado.')
      }
    })
  }

  const handleRemove = () => {
    startTransition(async () => {
      const r = await removeMember(tenantSlug, member.id)
      if (!r.ok) toast.error(r.message)
      else {
        toast.success('Miembro removido.')
        setRemoveOpen(false)
      }
    })
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
      <Avatar className="size-9 ring-1 ring-border/60">
        <AvatarFallback
          className={cn(
            'text-xs font-semibold',
            member.role === 'owner'
              ? 'bg-primary/15 text-primary'
              : 'bg-secondary text-foreground/80',
          )}
        >
          {initials(member)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">
            {member.full_name?.trim() || member.email.split('@')[0]}
          </p>
          {isCurrentUser ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              vos
            </Badge>
          ) : null}
          {member.role === 'owner' ? <Crown aria-hidden className="size-3 text-primary" /> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground font-mono">{member.email}</p>
      </div>
      <Select value={role} onValueChange={handleRoleChange} disabled={isPending}>
        <SelectTrigger
          className="h-8 w-[120px] text-sm transition-shadow data-[state=open]:ring-2 data-[state=open]:ring-ring/40"
          aria-label={`Rol de ${member.email}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="owner">Owner</SelectItem>
          <SelectItem value="cashier">Cajero</SelectItem>
          <SelectItem value="waiter">Mozo</SelectItem>
          <SelectItem value="kitchen">Cocina</SelectItem>
        </SelectContent>
      </Select>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            className="size-8 p-0"
            aria-label="Más acciones"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setResetOpen(true)
            }}
            className="gap-2"
          >
            <KeyRound className="size-3.5" />
            Resetear contraseña
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isCurrentUser}
            onSelect={(e) => {
              e.preventDefault()
              if (!isCurrentUser) setRemoveOpen(true)
            }}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Remover del bar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ResetPasswordDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        member={member}
        tenantSlug={tenantSlug}
        roleLabel={ROLE_LABELS[member.role]}
      />

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogTrigger className="hidden" />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a {member.email}</AlertDialogTitle>
            <AlertDialogDescription>
              Pierde el acceso al bar. Su cuenta de email queda intacta — podés volver a invitarlo
              después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ResetPasswordDialog({
  open,
  onOpenChange,
  member,
  tenantSlug,
  roleLabel,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  member: Member
  tenantSlug: string
  roleLabel: string
}) {
  const [password, setPassword] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await setMemberPassword(tenantSlug, member.id, password)
      if (!r.ok) {
        toast.error(r.message)
      } else {
        toast.success('Contraseña actualizada.', {
          description: `Compartile la nueva contraseña a ${member.email} en privado.`,
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
        onOpenChange(v)
        if (!v) setPassword('')
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Resetear contraseña</DialogTitle>
          <DialogDescription>
            Para <span className="font-mono">{member.email}</span> ({roleLabel}). El miembro puede
            cambiarla después desde su perfil.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-pwd" className="text-xs text-muted-foreground">
              Nueva contraseña
            </Label>
            <Input
              id="reset-pwd"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={72}
              required
              autoFocus
              autoComplete="off"
              className="font-mono text-sm"
              placeholder="Mínimo 8 caracteres + número"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || password.length < 8}>
              {isPending ? 'Guardando…' : 'Cambiar contraseña'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
