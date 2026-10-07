'use client'

import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Amount } from '@/components/administracion/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveAccount } from '@/lib/accounting/actions/master'
import { cn } from '@/lib/utils'
import { Callout, describedBy, Field, ReadOnlyItem } from '../../ajustes/_components/form-bits'
import { INPUT_CLASS, SwitchRow } from '../../ajustes/_components/inputs'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { ACCOUNT_TYPE_LABELS } from '../../ajustes/_lib/labels'
import { type ChartAccount, suggestedChildCode } from '../_lib/tree'

export type AccountSheetState =
  | { mode: 'edit'; account: ChartAccount }
  | { mode: 'create'; parent: ChartAccount }
  | null

const SYSTEM_NOTE =
  'La usa el sistema para armar asientos. Podés renombrarla; no se puede desactivar.'

/** Insignias suaves de una cuenta (H.16): Sistema · De control · En compras · Inactiva. */
export function AccountBadges({ account }: { account: ChartAccount }) {
  return (
    <>
      {account.systemKey ? (
        <Badge variant="outline" className="font-normal">
          Sistema
        </Badge>
      ) : null}
      {account.requiresParty ? (
        <Badge variant="outline" className="font-normal">
          De control
        </Badge>
      ) : null}
      {account.purchaseSelectable && account.postable ? (
        <Badge variant="outline" className="font-normal">
          En compras
        </Badge>
      ) : null}
      {account.active ? null : <Badge variant="muted">Inactiva</Badge>}
    </>
  )
}

function failure(state: AccFailureState): {
  fields: Record<string, string>
  message: string | null
} {
  const fields = { ...(state.fieldErrors ?? {}) }
  const key = typeof state.detail?.key === 'string' ? state.detail.key : null
  if (
    (key === 'code_taken' || key === 'code_invalid' || key === 'code_parent_mismatch') &&
    !fields.code
  ) {
    fields.code = state.message
  }
  return { fields, message: Object.keys(fields).length > 0 ? null : state.message }
}

/**
 * La hoja lateral del plan de cuentas (H.16): ver una cuenta, editarla
 * (nombre, «Para qué se usa», en compras, activa) o agregar una cuenta adentro
 * de un grupo. La contadora la ve en modo lectura.
 */
export function AccountSheet({
  tenantSlug,
  state,
  accounts,
  readOnly,
  balancesAvailable,
  onClose,
  onCreated,
}: {
  tenantSlug: string
  state: AccountSheetState
  accounts: readonly ChartAccount[]
  readOnly: boolean
  balancesAvailable: boolean
  onClose: () => void
  /** Después de crear: para desplegar el grupo donde quedó. */
  onCreated: (parentId: string) => void
}) {
  const { pending, run } = useMasterAction()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [purchase, setPurchase] = useState(false)
  const [manual, setManual] = useState(true)
  const [active, setActive] = useState(true)
  const [contra, setContra] = useState(false)
  const [requiresParty, setRequiresParty] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  const key = state
    ? state.mode === 'edit'
      ? `e:${state.account.id}`
      : `c:${state.parent.id}`
    : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: se carga al abrir otra cuenta
  useEffect(() => {
    setErrors({})
    setMessage(null)
    if (!state) return
    if (state.mode === 'edit') {
      const a = state.account
      setName(a.name)
      setDescription(a.description ?? '')
      setPurchase(a.purchaseSelectable)
      setManual(a.manualSelectable)
      setActive(a.active)
    } else {
      setName('')
      setCode('')
      setDescription('')
      setContra(false)
      setRequiresParty(false)
      setPurchase(state.parent.type === 'expense')
    }
  }, [key])

  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])

  const onFailure = (s: AccFailureState) => {
    const f = failure(s)
    setErrors(f.fields)
    setMessage(f.message)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!state || pending) return
    setErrors({})
    setMessage(null)
    if (state.mode === 'edit') {
      const a = state.account
      run(
        () =>
          saveAccount(tenantSlug, {
            mode: 'update',
            id: a.id,
            expectedUpdatedAt: a.updatedAt,
            name,
            description: description.trim() || null,
            ...(a.postable
              ? {
                  purchaseSelectable: purchase,
                  manualSelectable: manual,
                  ...(a.systemKey ? {} : { active }),
                }
              : {}),
          }),
        { onSuccess: onClose, onFailure },
      )
      return
    }
    const parent = state.parent
    run(
      () =>
        saveAccount(tenantSlug, {
          mode: 'create',
          parentId: parent.id,
          code: code.trim() || null,
          name,
          postable: true,
          contra,
          requiresParty,
          purchaseSelectable: purchase,
          manualSelectable: true,
          description: description.trim() || null,
        }),
      {
        onSuccess: () => {
          onCreated(parent.id)
          onClose()
        },
        onFailure,
      },
    )
  }

  const err = (k: string) => errors[k] ?? null
  const account = state?.mode === 'edit' ? state.account : null
  const parent = state?.mode === 'create' ? state.parent : null
  const base = `/${tenantSlug}/administracion`

  return (
    <Sheet
      open={state !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 px-5 py-4 pr-12">
          <SheetTitle className="font-serif text-lg">
            {account ? (
              <>
                <span className="mr-2 font-mono text-sm font-normal text-muted-foreground">
                  {account.code}
                </span>
                {account.name}
              </>
            ) : parent ? (
              'Nueva cuenta'
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-pretty">
            {account
              ? `${ACCOUNT_TYPE_LABELS[account.type]}${account.postable ? '' : ' · grupo'}`
              : parent
                ? `Adentro de ${parent.code} ${parent.name}.`
                : null}
          </SheetDescription>
          {account ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <AccountBadges account={account} />
            </div>
          ) : null}
        </SheetHeader>

        {readOnly && account ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <dl className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-5">
              <ReadOnlyItem label="Para qué se usa">
                {account.description ?? (
                  <span className="text-muted-foreground">Sin descripción.</span>
                )}
              </ReadOnlyItem>
              {account.postable ? (
                <ReadOnlyItem label="Saldo hoy">
                  {balancesAvailable ? (
                    <Amount cents={account.balanceCents} side />
                  ) : (
                    <span className="text-muted-foreground">Todavía no disponible.</span>
                  )}
                </ReadOnlyItem>
              ) : null}
              {account.systemKey ? (
                <ReadOnlyItem label="Sistema">{SYSTEM_NOTE}</ReadOnlyItem>
              ) : null}
            </dl>
            {account.postable ? (
              <SheetFooter className="border-t border-border/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                  <Link href={`${base}/libros/mayor?cuenta=${account.id}`}>
                    <BookOpen className="size-4" aria-hidden />
                    Ver mayor
                  </Link>
                </Button>
              </SheetFooter>
            ) : null}
          </div>
        ) : state ? (
          <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-5">
              {parent ? (
                <Field
                  id="ac-code"
                  label="Código"
                  optional
                  hint={`Si lo dejás vacío, va el siguiente libre: ${suggestedChildCode(parent, accounts)}.`}
                  error={err('code')}
                >
                  <Input
                    id="ac-code"
                    value={code}
                    maxLength={24}
                    inputMode="decimal"
                    placeholder={suggestedChildCode(parent, accounts)}
                    aria-invalid={err('code') ? true : undefined}
                    aria-describedby={describedBy('ac-code', true, err('code'))}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d.]/g, ''))}
                    className={cn(INPUT_CLASS, 'font-mono tabular-nums')}
                  />
                </Field>
              ) : null}
              <Field id="ac-name" label="Nombre" required error={err('name')}>
                <Input
                  id="ac-name"
                  value={name}
                  maxLength={80}
                  aria-invalid={err('name') ? true : undefined}
                  aria-describedby={describedBy('ac-name', null, err('name'))}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field
                id="ac-description"
                label="Para qué se usa"
                optional
                hint="Lo ve quien elige la cuenta al cargar algo."
                error={err('description')}
              >
                <Textarea
                  id="ac-description"
                  value={description}
                  maxLength={280}
                  rows={3}
                  aria-invalid={err('description') ? true : undefined}
                  onChange={(e) => setDescription(e.target.value)}
                  className="text-base md:text-sm"
                />
              </Field>

              {parent ? (
                <>
                  <SwitchRow
                    id="ac-requires-party"
                    label="Lleva proveedor o cliente"
                    description="Para deudas o créditos con alguien: cada movimiento dice con quién."
                    checked={requiresParty}
                    onCheckedChange={setRequiresParty}
                  />
                  <SwitchRow
                    id="ac-purchase"
                    label="Aparece en compras"
                    description="Se puede elegir al cargar un gasto o una factura."
                    checked={purchase}
                    onCheckedChange={setPurchase}
                  />
                  <SwitchRow
                    id="ac-contra"
                    label="Regularizadora"
                    description="Resta de su rubro, como las amortizaciones acumuladas."
                    checked={contra}
                    onCheckedChange={setContra}
                  />
                </>
              ) : account?.postable ? (
                <>
                  <SwitchRow
                    id="ac-purchase"
                    label="Aparece en compras"
                    description="Se puede elegir al cargar un gasto o una factura."
                    checked={purchase}
                    onCheckedChange={setPurchase}
                  />
                  <SwitchRow
                    id="ac-manual"
                    label="Se usa en asientos manuales"
                    description="Aparece en el asiento manual y en los ajustes de la contadora."
                    checked={manual}
                    onCheckedChange={setManual}
                  />
                  <SwitchRow
                    id="ac-active"
                    label="Activa"
                    description={
                      account.systemKey
                        ? SYSTEM_NOTE
                        : 'Para desactivarla tiene que estar en cero y sin cajas, medios ni gastos fijos que la usen.'
                    }
                    checked={account.systemKey ? true : active}
                    disabled={Boolean(account.systemKey)}
                    onCheckedChange={setActive}
                  />
                  {balancesAvailable ? (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Saldo hoy: </span>
                      <Amount cents={account.balanceCents} side />
                    </p>
                  ) : null}
                </>
              ) : account?.systemKey ? (
                <p className="text-xs text-muted-foreground">{SYSTEM_NOTE}</p>
              ) : null}

              {message ? <Callout tone="error">{message}</Callout> : null}
            </div>
            <SheetFooter className="flex-col-reverse gap-2 border-t border-border/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:justify-between">
              {account?.postable ? (
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
                {pending ? 'Guardando…' : parent ? 'Crear cuenta' : 'Guardar cambios'}
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
