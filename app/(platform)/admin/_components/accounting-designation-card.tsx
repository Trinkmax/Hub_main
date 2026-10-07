'use client'

import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type AccountingDesignation,
  type AccountingDesignationOwner,
  designateAccountingAdminAction,
} from '@/lib/platform/accounting-actions'

/** Lo que devuelve `getAccountingDesignation`, tal cual. */
export type AccountingDesignationResult =
  | { ok: true; data: AccountingDesignation }
  | { ok: false; error: string }

type OwnerState = 'can_set_up' | 'access' | 'admin'

const STATE_LABEL: Record<OwnerState, string> = {
  can_set_up: 'Puede configurarla',
  access: 'Ya tiene acceso',
  admin: 'Administra',
}

const STATE_BADGE: Record<OwnerState, { variant: 'secondary' | 'outline'; className?: string }> = {
  can_set_up: { variant: 'secondary' },
  access: { variant: 'outline' },
  admin: { variant: 'outline', className: 'border-success/30 bg-success/10 text-success' },
}

const HEADING_CLASS =
  'px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'

const NETWORK_ERROR = 'No se pudo conectar. Revisá la conexión y probá de nuevo.'

/**
 * La misma regla que `acc_my_access` en la base: sin configurar, la puesta en
 * marcha la ve cualquier dueño mientras no haya nadie designado, y después
 * solo los designados. Ya configurada, cuenta el acceso vigente.
 */
function ownerState(
  owner: AccountingDesignationOwner,
  setUp: boolean,
  anyDesignated: boolean,
): OwnerState | null {
  if (!setUp) return !anyDesignated || owner.hasAccess ? 'can_set_up' : null
  if (owner.isAdmin) return 'admin'
  return owner.hasAccess ? 'access' : null
}

function ownerName(owner: AccountingDesignationOwner): string {
  return owner.name ?? owner.accessName ?? owner.email ?? 'Dueño sin nombre'
}

/** El email abajo del nombre, salvo que el nombre ya sea el email. */
function ownerDetail(owner: AccountingDesignationOwner): string | null {
  return owner.email && owner.email !== ownerName(owner) ? owner.email : null
}

/**
 * «Administración: quién la configura» en `/admin/[tenantId]`: antes de la
 * puesta en marcha, el superadmin elige qué dueño la hace (si no, la ve
 * cualquier dueño); si el bar se queda sin nadie que dé accesos, repite la
 * designación para recuperarlo. Configurada y con administrador, solo informa.
 */
export function AccountingDesignationCard({
  tenantId,
  result,
}: {
  tenantId: string
  result: AccountingDesignationResult
}) {
  const headingId = useId()
  if (result.ok && !result.data.enabled) return null

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className={HEADING_CLASS}>
        Administración: quién la configura
      </h2>
      {result.ok ? (
        <DesignationPanel tenantId={tenantId} data={result.data} />
      ) : (
        <LoadError message={result.error} />
      )}
    </section>
  )
}

function DesignationPanel({ tenantId, data }: { tenantId: string; data: AccountingDesignation }) {
  const router = useRouter()
  const selectId = useId()
  const errorId = useId()
  const selectRef = useRef<HTMLButtonElement>(null)
  // Después de designar, el foco vuelve al select (el botón queda deshabilitado sin nadie elegido).
  const focusSelectOnClose = useRef(false)
  const [selected, setSelected] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const anyDesignated = data.owners.some((o) => o.hasAccess)
  // Designar a quien ya administra no cambia nada: no se ofrece.
  const candidates = data.canDesignate ? data.owners.filter((o) => !o.isAdmin) : []
  // Si la lista se refrescó y la persona elegida ya no está, el select vuelve al placeholder.
  const target = candidates.find((o) => o.userId === selected) ?? null
  const targetDetail = target ? ownerDetail(target) : null
  const recovering = data.setUp && data.canDesignate

  const note = !data.setUp
    ? anyDesignated
      ? 'Solo los dueños con «Puede configurarla» ven la puesta en marcha. Si designás a otro, se suma a los que ya están.'
      : 'Elegí qué dueño hace la puesta en marcha. Hasta que designes a alguien, cualquier dueño del bar la puede empezar.'
    : recovering
      ? 'Ya está configurada, pero ningún dueño da los accesos. Designá a uno para que los recupere desde Administración › Ajustes.'
      : 'Ya está configurada; los accesos los maneja su administrador desde Administración › Ajustes.'

  function designate() {
    if (!target) return
    const userId = target.userId
    setError(null)
    startTransition(async () => {
      // Sin red la action rechaza: sin el catch, la transición tira el error al boundary.
      const res = await designateAccountingAdminAction({ tenantId, userId }).catch(() => null)
      const failure = res === null ? NETWORK_ERROR : res.ok ? null : res.error
      // Dentro de la transición: el diálogo se cierra en el mismo render en que termina el pending.
      startTransition(() => {
        focusSelectOnClose.current = true
        setConfirmOpen(false)
        if (failure === null) {
          setSelected('')
          return
        }
        setError(failure)
        // Si la base dijo que no, puede que el bar haya cambiado mientras tanto (otra
        // designación, un dueño menos): se vuelve a leer para mostrar lo que hay.
        if (res !== null) router.refresh()
      })
      if (res?.ok) toast.success(res.message)
      else if (failure !== null) toast.error(failure)
    })
  }

  return (
    <Card className="divide-y divide-border/50 border-border/70 p-0">
      <p className="p-4 text-sm text-muted-foreground">{note}</p>

      {data.canDesignate && data.owners.length > 0 ? (
        candidates.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Todos los dueños ya pueden configurarla.
          </p>
        ) : (
          <div className="space-y-2 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Label htmlFor={selectId}>Dueño a designar</Label>
                <Select
                  value={target ? target.userId : ''}
                  onValueChange={(value) => {
                    setSelected(value)
                    setError(null)
                  }}
                  disabled={pending}
                >
                  <SelectTrigger
                    ref={selectRef}
                    id={selectId}
                    className="w-full"
                    aria-describedby={error ? errorId : undefined}
                  >
                    <SelectValue placeholder="Elegí un dueño…" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((owner) => {
                      const detail = ownerDetail(owner)
                      return (
                        <SelectItem key={owner.userId} value={owner.userId}>
                          {ownerName(owner)}
                          {detail ? <span className="text-muted-foreground">{detail}</span> : null}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <AlertDialog
                open={confirmOpen}
                onOpenChange={(open) => {
                  if (!pending) setConfirmOpen(open)
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button type="button" disabled={!target || pending}>
                    {pending ? 'Designando…' : 'Designar'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  onCloseAutoFocus={(e) => {
                    if (!focusSelectOnClose.current) return
                    focusSelectOnClose.current = false
                    const trigger = selectRef.current
                    if (!trigger) return
                    e.preventDefault()
                    trigger.focus()
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Designar a {target ? ownerName(target) : 'este dueño'}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {targetDetail ? `Entra con ${targetDetail}. ` : null}
                      {recovering
                        ? 'Va a poder dar y quitar los accesos desde Administración › Ajustes.'
                        : 'Va a ver la puesta en marcha de Administración y, cuando la termine, va a decidir quién más la ve.'}{' '}
                      Desde acá no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={pending || !target}
                      onClick={(e) => {
                        e.preventDefault()
                        designate()
                      }}
                    >
                      {pending ? 'Designando…' : 'Designar'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {error ? (
              <p id={errorId} className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {data.owners.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Este bar todavía no tiene dueños.</p>
      ) : (
        data.owners.map((owner) => {
          const state = ownerState(owner, data.setUp, anyDesignated)
          const detail = ownerDetail(owner)
          return (
            <div key={owner.userId} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{ownerName(owner)}</p>
                {detail ? <p className="truncate text-sm text-muted-foreground">{detail}</p> : null}
              </div>
              {state ? (
                <Badge
                  variant={STATE_BADGE[state].variant}
                  className={STATE_BADGE[state].className}
                >
                  {STATE_LABEL[state]}
                </Badge>
              ) : null}
            </div>
          )
        })
      )}
    </Card>
  )
}

function LoadError({ message }: { message: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Card className="border-border/70 p-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="font-medium">{message}</p>
          <p className="text-sm text-muted-foreground">
            Puede ser un corte momentáneo: probá de nuevo.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? 'Reintentando…' : 'Reintentar'}
        </Button>
      </div>
    </Card>
  )
}
