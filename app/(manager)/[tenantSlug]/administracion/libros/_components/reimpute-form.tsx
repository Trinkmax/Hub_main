'use client'

import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { reimputeLine } from '@/lib/accounting/actions/reimpute'
import type { LineReimputation } from '@/lib/accounting/queries/books'
import {
  imputationFlagText,
  REIMPUTE_REASON_MAX,
  type ReimputeTarget,
} from '@/lib/accounting/reimpute'
import { formatDate } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

const OFFLINE = 'Sin conexión: no se reimputó. Probá de nuevo.'

const LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Cambiar la cuenta de un renglón. Se elige la cuenta (por código o por nombre), con la habitual ya
 * puesta si la base marcó el renglón como raro, y un motivo si hace falta. Cambia la cuenta, nada más.
 * Es lo único de carga que hace la contadora además de los asientos: la acción la autoriza con el
 * acceso de lectura y la base lo vuelve a mirar.
 */
export function ReimputeForm({
  tenantSlug,
  targets,
  accounts,
  onDone,
  autoFocus = false,
  className,
}: {
  tenantSlug: string
  /** Los renglones que se pueden cambiar; los marcados, primero. */
  targets: readonly ReimputeTarget[]
  accounts: readonly AccountOption[]
  onDone?: () => void
  /** Se abrió recién: el foco va a la cuenta, que es lo que se viene a cambiar. */
  autoFocus?: boolean
  className?: string
}) {
  const router = useRouter()
  const ids = useId()
  const [lineId, setLineId] = useState(targets[0]?.lineId ?? null)
  const target = targets.find((t) => t.lineId === lineId) ?? targets[0] ?? null
  const [accountId, setAccountId] = useState(targets[0]?.usual?.accountId ?? null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (autoFocus) document.getElementById(`${ids}-cuenta`)?.focus()
  }, [autoFocus, ids])

  if (!target) return null

  function chooseLine(next: ReimputeTarget) {
    setLineId(next.lineId)
    setAccountId(next.usual?.accountId ?? null)
    setError(null)
  }

  function run() {
    if (!target || !accountId) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await reimputeLine(tenantSlug, {
          lineId: target.lineId,
          accountId,
          reason: reason.trim() === '' ? null : reason.trim(),
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        toast.success(result.message)
        // Si el formulario sigue a la vista, no puede seguir proponiendo la cuenta que ya tiene.
        setAccountId(null)
        setReason('')
        onDone?.()
        router.refresh()
      } catch {
        setError(OFFLINE)
      }
    })
  }

  return (
    <form
      noValidate
      className={cn('grid gap-3', className)}
      onSubmit={(event) => {
        event.preventDefault()
        run()
      }}
    >
      {targets.length > 1 ? (
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm font-medium">Qué renglón</legend>
          {targets.map((t) => (
            <label
              key={t.lineId}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-border/70 px-2.5 py-1.5 text-sm has-checked:border-primary has-checked:bg-primary/[0.04] md:pointer-fine:min-h-8"
            >
              <input
                type="radio"
                name={`${ids}-renglon`}
                checked={t.lineId === target.lineId}
                disabled={pending}
                onChange={() => chooseLine(t)}
                className="accent-primary"
              />
              <span className="min-w-0 flex-1 truncate">{t.accountName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCents(t.amountCents)}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-cuenta`}>
          Reimputar{targets.length === 1 ? ` ${target.accountName}` : ''} a
        </Label>
        <AccountCombobox
          id={`${ids}-cuenta`}
          accounts={accounts}
          value={accountId}
          disabled={pending}
          filter={(account) => account.id !== target.accountId}
          onValueChange={(id) => {
            setAccountId(id)
            setError(null)
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-motivo`}>
          Motivo <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={`${ids}-motivo`}
          value={reason}
          maxLength={REIMPUTE_REASON_MAX}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
          className="h-11 text-base md:h-9 md:text-sm"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive text-pretty">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" disabled={pending || !accountId} className="h-11 gap-2 md:h-9">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? 'Reimputando…' : 'Reimputar'}
        </Button>
        <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground text-pretty">
          Cambia la cuenta, no el importe ni el proveedor. Queda quién lo cambió y cuándo.
        </p>
      </div>
    </form>
  )
}

/** «Este mes está cerrado. Reabrilo o hacé un asiento de ajuste», con los links. */
export function ReimputeClosedNotice({
  base,
  month,
  documentId,
  canWrite,
}: {
  /** `/<bar>/administracion`. */
  base: string
  /** `yyyy-MM`. */
  month: string
  documentId: string
  /** Reabrir un mes es de los dueños: la contadora lo pide y hace el ajuste. */
  canWrite: boolean
}) {
  const adjust = (
    <Link href={`${base}/libros/asiento-manual?corrige=${documentId}`} className={LINK}>
      asiento de ajuste
    </Link>
  )
  return (
    <p className="text-sm text-muted-foreground text-pretty">
      Este mes está cerrado.{' '}
      {canWrite ? (
        <>
          <Link href={`${base}/libros/cierres?mes=${month}`} className={LINK}>
            Reabrilo
          </Link>{' '}
          o hacé un {adjust}.
        </>
      ) : (
        <>Pedí que lo reabran o hacé un {adjust}.</>
      )}
    </p>
  )
}

/** La historia de un comprobante: de qué cuenta a qué cuenta pasó cada renglón. */
export function ReimputationList({
  items,
  className,
}: {
  items: readonly LineReimputation[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <section aria-label="Reimputaciones" className={cn('grid gap-1 text-sm', className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Reimputaciones
      </h3>
      <ul className="grid gap-1">
        {items.map((item) => (
          <li key={item.id} className="text-pretty">
            <span className="tabular-nums text-muted-foreground">{formatDate(item.createdAt)}</span>{' '}
            · {item.createdByName || 'Alguien del equipo'} la pasó de{' '}
            <span className="font-medium">{item.fromName || item.fromCode}</span> a{' '}
            <span className="font-medium">{item.toName || item.toCode}</span>
            {item.reason ? <span className="text-muted-foreground">: «{item.reason}»</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Reimputar en la pantalla del asiento y en la del comprobante: el mismo formulario, con la oración
 * de la marca si la hay. Con el mes cerrado, por dónde se corrige. Sin renglones que se puedan cambiar
 * no se dibuja.
 */
export function ReimputeBlock({
  tenantSlug,
  base,
  targets,
  accounts,
  periodOpen,
  month,
  documentId,
  canWrite,
}: {
  tenantSlug: string
  base: string
  targets: readonly ReimputeTarget[]
  accounts: readonly AccountOption[]
  periodOpen: boolean
  month: string
  documentId: string
  canWrite: boolean
}) {
  const [open, setOpen] = useState(false)
  if (targets.length === 0) return null
  // Con la marca, el formulario ya está: al entrar a la pantalla no se le roba el foco a nadie.
  const flagged = targets.find((t) => t.usual)?.usual ?? null
  const showForm = open || flagged !== null
  return (
    <section
      aria-label="Reimputar"
      className="grid gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-xs sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Reimputar</h2>
        {periodOpen && !showForm ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 md:pointer-fine:h-8"
            onClick={() => setOpen(true)}
          >
            Cambiar la cuenta
          </Button>
        ) : null}
      </div>
      {flagged ? (
        <p className="text-sm font-medium text-destructive text-pretty">
          {imputationFlagText(
            { partyName: flagged.partyName, usualAccountName: flagged.accountName },
            { open: periodOpen },
          )}
        </p>
      ) : null}
      {!periodOpen ? (
        <ReimputeClosedNotice
          base={base}
          month={month}
          documentId={documentId}
          canWrite={canWrite}
        />
      ) : showForm ? (
        <ReimputeForm
          tenantSlug={tenantSlug}
          targets={targets}
          accounts={accounts}
          autoFocus={open}
          onDone={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}
