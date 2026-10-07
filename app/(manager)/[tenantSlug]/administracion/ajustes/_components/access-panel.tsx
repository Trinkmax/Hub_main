'use client'

import { ChevronDown, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  claimAccountingAdmin,
  grantAccountingAccess,
  revokeAccountingAccess,
} from '@/lib/accounting/actions/access'
import type { AccessOverview, AccessPersonRow } from '@/lib/accounting/queries/access'
import { cn } from '@/lib/utils'
import { grantLine, revokedLine } from '../_lib/access-copy'
import { Callout } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { useMasterAction } from './use-master-action'

type OwnerRow =
  | { type: 'access'; userId: string; name: string; row: AccessPersonRow }
  | { type: 'none'; userId: string; name: string }

/**
 * Ajustes › Accesos (H.17): quién ve Administración y quién da accesos. Solo
 * quien da accesos cambia algo; los demás (y la contadora) lo ven en
 * palabras. Sacar un acceso pide confirmación; darlo, no.
 */
export function AccessPanel({
  tenantSlug,
  overview,
  currentUserId,
  isAdmin,
  canWrite,
  showMembers,
}: {
  tenantSlug: string
  overview: AccessOverview
  currentUserId: string
  /** Quien mira da accesos (y puede cargar). */
  isAdmin: boolean
  canWrite: boolean
  /** Hay datos del equipo (dueños sin acceso, contadoras): solo para dueños. */
  showMembers: boolean
}) {
  const { pending, run } = useMasterAction()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revoking, setRevoking] = useState<AccessPersonRow | null>(null)
  const [reason, setReason] = useState('')

  const rows: OwnerRow[] = [
    ...overview.active.map((row) => ({
      type: 'access' as const,
      userId: row.userId,
      name: row.displayName,
      row,
    })),
    ...overview.ownersWithoutAccess.map((m) => ({
      type: 'none' as const,
      userId: m.userId,
      name: m.name,
    })),
  ]
  const lastAdmin = overview.adminCount <= 1

  const grant = (userId: string, isAdminValue: boolean, displayName: string | null) =>
    run(() =>
      grantAccountingAccess(tenantSlug, {
        userId,
        isAdmin: isAdminValue,
        displayName,
      }),
    )

  const confirmRevoke = () => {
    const target = revoking
    if (!target) return
    setRevoking(null)
    run(() =>
      revokeAccountingAccess(tenantSlug, {
        userId: target.userId,
        reason: reason.trim() || null,
      }),
    )
  }

  return (
    <div className="space-y-6">
      <Callout tone="info">
        Administración es privada: solo la ven los dueños que habilites acá y la contadora.
      </Callout>

      {overview.adminCount === 0 && canWrite ? (
        <Callout
          tone="warning"
          title="Nadie está dando los accesos."
          action={
            <Button
              type="button"
              className="h-11 md:h-9"
              disabled={pending}
              onClick={() => run(() => claimAccountingAdmin(tenantSlug))}
            >
              Pasar a darlos yo
            </Button>
          }
        >
          Quien los daba ya no es dueño. Alguien con acceso tiene que tomar ese lugar.
        </Callout>
      ) : null}

      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="border-b border-border/60 px-5 py-4">
          <h3 className="font-serif text-lg font-semibold tracking-tight">Dueños</h3>
          <p className="text-xs text-muted-foreground">
            {isAdmin
              ? '«Ve y carga» le abre Administración; «Da accesos» le deja habilitar a otros.'
              : 'Los cambia quien da los accesos.'}
          </p>
        </header>
        <ul className="divide-y divide-border/60">
          {rows.map((owner) => {
            const hasAccess = owner.type === 'access'
            const row = hasAccess ? owner.row : null
            const self = owner.userId === currentUserId
            const idBase = `acc-${owner.userId}`
            return (
              <li
                key={owner.userId}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {owner.name}
                    {self ? <Badge variant="muted">Vos</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row ? grantLine(row) : 'Sin acceso a Administración'}
                  </p>
                </div>
                {isAdmin ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${idBase}-access`}
                        checked={hasAccess}
                        disabled={pending}
                        onCheckedChange={(checked) => {
                          if (checked) grant(owner.userId, false, null)
                          else if (row) {
                            setReason('')
                            setRevoking(row)
                          }
                        }}
                      />
                      <Label htmlFor={`${idBase}-access`} className="text-sm">
                        Ve y carga
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${idBase}-admin`}
                        checked={row?.isAdmin ?? false}
                        disabled={pending || !row || (row.isAdmin && lastAdmin)}
                        aria-describedby={row?.isAdmin && lastAdmin ? `${idBase}-last` : undefined}
                        onCheckedChange={(checked) => {
                          if (row) grant(row.userId, checked, row.displayName)
                        }}
                      />
                      <Label htmlFor={`${idBase}-admin`} className="text-sm">
                        Da accesos
                      </Label>
                      {row?.isAdmin && lastAdmin ? (
                        <span id={`${idBase}-last`} className="sr-only">
                          Tiene que quedar al menos una persona que dé accesos.
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {hasAccess ? (
                      <Badge
                        variant="outline"
                        className="border-success/30 bg-success/10 text-success"
                      >
                        Ve y carga
                      </Badge>
                    ) : (
                      <Badge variant="muted">Sin acceso</Badge>
                    )}
                    {row?.isAdmin ? <Badge variant="outline">Da accesos</Badge> : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {isAdmin && lastAdmin ? (
          <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
            Tiene que quedar al menos una persona que dé accesos: para dejar de darlos, primero
            habilitá a otro dueño.
          </p>
        ) : null}
      </section>

      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-semibold tracking-tight">
              Contabilidad{' '}
              <span className="font-sans text-sm font-normal text-muted-foreground">
                (solo lectura)
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Ve y exporta los libros, el IVA y las cuentas. No carga ni cambia nada y no ve el
              resto del panel.
            </p>
          </div>
          {isAdmin ? (
            <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
              <Link href={`/${tenantSlug}/configuracion/equipo?rol=accountant`}>
                <UserPlus className="size-4" aria-hidden />
                Sumar a la contadora
              </Link>
            </Button>
          ) : null}
        </header>
        {showMembers ? (
          overview.accountants.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {overview.accountants.map((a) => (
                <li key={a.userId} className="px-5 py-3 text-sm font-medium">
                  {a.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              Todavía no sumaste a la contadora. Se suma desde Configuración › Equipo con el rol
              «Contabilidad».
            </p>
          )
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            La contadora entra con su propio usuario, en modo lectura.
          </p>
        )}
      </section>

      {overview.revoked.length > 0 ? (
        <section className="card-hairline overflow-hidden rounded-xl border bg-card">
          <button
            type="button"
            aria-expanded={historyOpen}
            aria-controls="acc-history"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm font-medium outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Accesos que se sacaron
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                historyOpen && 'rotate-180',
              )}
            />
          </button>
          <ul
            id="acc-history"
            hidden={!historyOpen}
            className="divide-y divide-border/60 border-t border-border/60"
          >
            {overview.revoked.map((row) => (
              <li key={row.id} className="space-y-0.5 px-5 py-3">
                <p className="text-sm font-medium">{row.displayName}</p>
                <p className="text-xs text-muted-foreground text-pretty">{revokedLine(row)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {revoking?.userId === currentUserId
                ? '¿Dejás de ver Administración?'
                : `¿Le sacás el acceso a ${revoking?.displayName ?? 'esta persona'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.userId === currentUserId
                ? 'Vas a dejar de ver Administración al instante. Para volver, te lo tiene que dar otra persona.'
                : 'Deja de ver Administración al instante. Queda en el historial.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="acc-revoke-reason">
              Motivo <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="acc-revoke-reason"
              value={reason}
              maxLength={200}
              placeholder="Lo ve la contadora en el historial"
              onChange={(e) => setReason(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRevoke}
            >
              Sacar acceso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
