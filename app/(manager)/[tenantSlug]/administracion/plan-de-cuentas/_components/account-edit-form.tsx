'use client'

import { BookOpen, FolderInput } from 'lucide-react'
import Link from 'next/link'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Amount } from '@/components/administracion/amount'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SheetFooter } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { type SavedAccount, saveAccount } from '@/lib/accounting/actions/master'
import type { AccountType } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import { INPUT_CLASS, SwitchRow } from '../../ajustes/_components/inputs'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { formFeedback } from '../_lib/feedback'
import { systemUse } from '../_lib/system-uses'
import {
  type ChartAccount,
  type ChartIndex,
  deactivationBlock,
  editTypeChoice,
  parentOf,
  pathLabel,
} from '../_lib/tree'
import { TypeField } from './account-bits'

const SHOWN_FIELDS = [
  'code',
  'name',
  'description',
  'requiresParty',
  'purchaseSelectable',
  'manualSelectable',
] as const

/** «¿En qué?» solo tiene sentido en imputables de activo o egreso sin proveedor (C.3.4). */
function purchaseApplies(type: AccountType, requiresParty: boolean): boolean {
  return (type === 'asset' || type === 'expense') && !requiresParty
}

/**
 * Editar una cuenta (H.16 + #16): código (una etiqueta: cambiarlo no toca los asientos), nombre,
 * tipo cuando se puede elegir, «Para qué se usa» y, si es imputable, si lleva proveedor o cliente,
 * si aparece en «¿En qué?» y en asientos manuales. Mover y desactivar van con su confirmación.
 * Viajan solo los campos que cambiaron.
 */
export function AccountEditForm({
  tenantSlug,
  index,
  account,
  balancesAvailable,
  onDone,
  onMove,
  onChangeActive,
  onBusyChange,
}: {
  tenantSlug: string
  index: ChartIndex
  account: ChartAccount
  balancesAvailable: boolean
  /** Guardó (`saved`) o no había nada que guardar (`null`): se cierra la hoja. */
  onDone: (saved: SavedAccount | null) => void
  onMove: () => void
  onChangeActive: (active: boolean) => void
  onBusyChange: (busy: boolean) => void
}) {
  const { pending, run } = useMasterAction()
  const [code, setCode] = useState(account.code)
  const [name, setName] = useState(account.name)
  const [description, setDescription] = useState(account.description ?? '')
  const [type, setType] = useState<AccountType>(account.type)
  const [requiresParty, setRequiresParty] = useState(account.requiresParty)
  const [purchase, setPurchase] = useState(account.purchaseSelectable)
  const [manual, setManual] = useState(account.manualSelectable)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const reloadRef = useRef(false)

  useEffect(() => onBusyChange(pending), [pending, onBusyChange])

  // Si otra persona la cambió (`stale`), la página se recarga: el formulario toma la versión nueva.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando llega otra versión
  useEffect(() => {
    if (!reloadRef.current) return
    reloadRef.current = false
    setCode(account.code)
    setName(account.name)
    setDescription(account.description ?? '')
    setType(account.type)
    setRequiresParty(account.requiresParty)
    setPurchase(account.purchaseSelectable)
    setManual(account.manualSelectable)
  }, [account.updatedAt])

  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])

  const typeChoice = editTypeChoice(index, account)
  const parent = parentOf(index, account)
  const use = systemUse(account.systemKey)
  const showParty = account.postable && !account.isTreasury
  const showPurchase = account.postable && purchaseApplies(type, requiresParty)
  const block = account.active ? deactivationBlock(index, account, balancesAvailable) : null
  const err = (k: string) => errors[k] ?? null
  const base = `/${tenantSlug}/administracion`

  const onFailure = (state: AccFailureState) => {
    if (state.code === 'stale') reloadRef.current = true
    const feedback = formFeedback(
      state,
      typeChoice.kind === 'choose' ? [...SHOWN_FIELDS, 'type'] : SHOWN_FIELDS,
    )
    setErrors(feedback.fields)
    setMessage(feedback.message)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setErrors({})
    setMessage(null)
    const changes: Record<string, unknown> = {}
    if (code.trim() !== account.code) changes.code = code
    if (name.trim() !== account.name) changes.name = name
    if ((description.trim() || null) !== (account.description ?? null)) {
      changes.description = description.trim() || null
    }
    if (typeChoice.kind === 'choose' && type !== account.type) changes.type = type
    if (account.postable) {
      if (showParty && requiresParty !== account.requiresParty) {
        changes.requiresParty = requiresParty
      }
      if (showPurchase && purchase !== account.purchaseSelectable) {
        changes.purchaseSelectable = purchase
      }
      if (manual !== account.manualSelectable) changes.manualSelectable = manual
    }
    if (Object.keys(changes).length === 0) {
      onDone(null)
      return
    }
    run(
      () =>
        saveAccount(tenantSlug, {
          mode: 'update',
          id: account.id,
          expectedUpdatedAt: account.updatedAt,
          ...changes,
        }),
      { onSuccess: (saved) => onDone(saved), onFailure },
    )
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-5">
        {account.systemKey ? (
          <Callout
            tone="info"
            title={use ? `La usa el sistema: ${use.label}` : 'La usa el sistema'}
          >
            <p>{use?.use ?? 'El sistema arma asientos con esta cuenta.'}</p>
            <p className="mt-1">
              Podés renombrarla, cambiarle el código o moverla. Para que el sistema use otra cuenta,
              andá a{' '}
              <Link
                href={`${base}/plan-de-cuentas?tab=sistema`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Cuentas del sistema
              </Link>
              .
            </p>
          </Callout>
        ) : null}

        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Grupo</span>
          <div className="flex items-start justify-between gap-3 rounded-lg border bg-background/50 p-3">
            <p className="min-w-0 text-sm text-pretty">
              {parent ? (
                <>
                  <span className="font-mono text-xs text-muted-foreground">{parent.code}</span>{' '}
                  {parent.name}
                  {pathLabel(index, parent.id) ? (
                    <span className="block text-xs text-muted-foreground">
                      {pathLabel(index, parent.id)}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">Es una cuenta principal.</span>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 shrink-0 gap-2 md:h-8"
              disabled={pending}
              onClick={onMove}
            >
              <FolderInput className="size-4" aria-hidden />
              Mover
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <Field
            id="ae-code"
            label="Código"
            required
            hint="Es una etiqueta: cambiarlo no toca lo cargado."
            error={err('code')}
          >
            <Input
              id="ae-code"
              value={code}
              maxLength={24}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={err('code') ? true : undefined}
              aria-describedby={describedBy('ae-code', true, err('code'))}
              onChange={(e) => setCode(e.target.value.replace(/[^\d.]/g, ''))}
              className={cn(INPUT_CLASS, 'font-mono tabular-nums')}
            />
          </Field>
          <Field id="ae-name" label="Nombre" required error={err('name')}>
            <Input
              id="ae-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              aria-invalid={err('name') ? true : undefined}
              aria-describedby={describedBy('ae-name', null, err('name'))}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <TypeField
          id="ae-type"
          choice={typeChoice}
          value={type}
          onChange={setType}
          error={err('type')}
        />

        <Field
          id="ae-description"
          label="Para qué se usa"
          optional
          hint="Lo ve quien elige la cuenta al cargar algo."
          error={err('description')}
        >
          <Textarea
            id="ae-description"
            value={description}
            maxLength={280}
            rows={3}
            aria-invalid={err('description') ? true : undefined}
            aria-describedby={describedBy('ae-description', true, err('description'))}
            onChange={(e) => setDescription(e.target.value)}
            className="text-base md:text-sm"
          />
        </Field>

        {account.postable ? (
          <>
            {showParty ? (
              <SwitchRow
                id="ae-party"
                label="Lleva proveedor o cliente"
                description={
                  account.systemKey
                    ? 'La usa el sistema: esto no se cambia.'
                    : 'Cuenta de control: cada movimiento dice con qué proveedor, cliente u organismo es.'
                }
                checked={requiresParty}
                disabled={Boolean(account.systemKey) || pending}
                onCheckedChange={setRequiresParty}
              />
            ) : null}
            {showPurchase ? (
              <SwitchRow
                id="ae-purchase"
                label="Aparece en «¿En qué?»"
                description="Se puede elegir al cargar un gasto o una factura de compra."
                checked={purchase}
                disabled={pending}
                onCheckedChange={setPurchase}
              />
            ) : null}
            <SwitchRow
              id="ae-manual"
              label="Se usa en asientos manuales"
              description="Aparece en el asiento manual y en los ajustes de la contadora."
              checked={manual}
              disabled={pending}
              onCheckedChange={setManual}
            />
            {balancesAvailable ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Saldo hoy: </span>
                <Amount cents={account.balanceCents} side />
              </p>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-col gap-3 rounded-lg border bg-background/50 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">
              {account.active ? 'Desactivar la cuenta' : 'La cuenta está desactivada'}
            </p>
            <p className="text-xs text-muted-foreground text-pretty">
              {account.active
                ? (block ??
                  'Deja de aparecer al cargar. Lo que ya está cargado queda igual y la podés reactivar cuando quieras.')
                : 'No aparece al cargar. Reactivala para volver a usarla.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 md:h-8"
            disabled={pending || (account.active && block !== null)}
            onClick={() => onChangeActive(!account.active)}
          >
            {account.active ? 'Desactivar' : 'Reactivar'}
          </Button>
        </div>

        {message ? <Callout tone="error">{message}</Callout> : null}
      </div>
      <SheetFooter className="flex-col-reverse gap-2 border-t border-border/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:justify-between">
        {account.postable ? (
          <Button asChild variant="ghost" className="h-11 gap-2 md:h-9">
            <Link href={`${base}/libros/mayor?cuenta=${account.id}`}>
              <BookOpen className="size-4" aria-hidden />
              Ver mayor
            </Link>
          </Button>
        ) : (
          <span aria-hidden="true" />
        )}
        <Button type="submit" className="h-11 min-w-[160px] md:h-9" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </SheetFooter>
    </form>
  )
}
