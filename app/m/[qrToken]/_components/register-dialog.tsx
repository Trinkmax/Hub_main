'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sumá puntos en {tenantName}</DialogTitle>
          <DialogDescription>
            Solo necesitamos tres datos. Tus datos quedan únicamente con {tenantName}.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="qr_token" value={qrToken} />
          <input type="hidden" name="browser_token" value={browserToken} />

          {/* honeypot anti-bot — invisible para humanos */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="first_name">Nombre</Label>
              <Input id="first_name" name="first_name" autoFocus required maxLength={60} />
              {!state.ok && state.fieldErrors?.first_name && (
                <p className="mt-1 text-xs text-destructive">{state.fieldErrors.first_name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="last_name">Apellido</Label>
              <Input id="last_name" name="last_name" required maxLength={60} />
              {!state.ok && state.fieldErrors?.last_name && (
                <p className="mt-1 text-xs text-destructive">{state.fieldErrors.last_name}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="phone">Teléfono</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              required
              placeholder="11 4567 8901"
              autoComplete="tel"
            />
            {!state.ok && state.fieldErrors?.phone && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.phone}</p>
            )}
          </div>

          <div>
            <Label htmlFor="birthdate">Cumpleaños (opcional)</Label>
            <Input id="birthdate" name="birthdate" type="date" />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="opt_in_marketing" name="opt_in_marketing" defaultChecked />
            <Label htmlFor="opt_in_marketing" className="text-xs text-muted-foreground">
              Quiero recibir novedades y promos por WhatsApp
            </Label>
          </div>

          {!state.ok && state.message && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Sumar puntos'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
