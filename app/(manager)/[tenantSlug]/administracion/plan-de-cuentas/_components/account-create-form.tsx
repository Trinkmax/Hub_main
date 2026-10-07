'use client'

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  type ChartIndex,
  createTypeChoice,
  MAX_CHART_LEVEL,
  proposeChildCode,
  proposeRootCode,
} from '../_lib/tree'
import { TypeField } from './account-bits'
import { GroupCombobox, ROOT_CHOICE } from './group-combobox'

const SHOWN_FIELDS = [
  'parentId',
  'postable',
  'code',
  'name',
  'description',
  'requiresParty',
  'purchaseSelectable',
  'contra',
  'manualSelectable',
] as const

type Kind = 'postable' | 'group'

/**
 * Cuenta nueva (H.16 + #16), en cualquier lugar del plan: adentro de un grupo o como cuenta
 * principal (con su tipo). El código se propone con el estilo del grupo (`1.1.01.01.008`) y se puede
 * cambiar; si queda el propuesto, lo confirma la base al guardar. Imputable o grupo se decide acá
 * (después no cambia).
 */
export function AccountCreateForm({
  tenantSlug,
  index,
  initialParent,
  onDone,
  onBusyChange,
}: {
  tenantSlug: string
  index: ChartIndex
  /** `undefined` = que la persona elija; `null` = cuenta principal; un id = ese grupo. */
  initialParent: string | null | undefined
  onDone: (saved: SavedAccount) => void
  onBusyChange: (busy: boolean) => void
}) {
  const { pending, run } = useMasterAction()
  // Los grupos activos que todavía admiten un nivel más (hasta 8).
  const groups = useMemo(
    () =>
      index.ordered.filter(
        (a) => !a.postable && a.active && (index.depth.get(a.id) ?? 0) + 1 < MAX_CHART_LEVEL,
      ),
    [index],
  )
  const [parentChoice, setParentChoice] = useState<string | null>(() =>
    initialParent === undefined
      ? null
      : initialParent === null
        ? ROOT_CHOICE
        : index.byId.has(initialParent)
          ? initialParent
          : null,
  )
  const isRoot = parentChoice === ROOT_CHOICE
  const parent = parentChoice && !isRoot ? (index.byId.get(parentChoice) ?? null) : null
  const typeChoice = createTypeChoice(parent)
  const proposal = isRoot ? proposeRootCode(index) : parent ? proposeChildCode(index, parent) : ''
  const tooDeep = parent ? (index.depth.get(parent.id) ?? 0) + 1 >= MAX_CHART_LEVEL : false

  const [kind, setKind] = useState<Kind>('postable')
  const [type, setType] = useState<AccountType | null>(null)
  const [code, setCode] = useState('')
  // Mientras no lo toquen, el campo muestra el propuesto (y la base lo confirma al guardar).
  const [codeTouched, setCodeTouched] = useState(false)
  const shownCode = codeTouched ? code : proposal
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [requiresParty, setRequiresParty] = useState(false)
  const [purchase, setPurchase] = useState(parent?.type === 'expense')
  const [contra, setContra] = useState(false)
  const [manual, setManual] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => onBusyChange(pending), [pending, onBusyChange])

  // Otro grupo: vuelve el código propuesto de ese grupo, su tipo y sus tildes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando cambia el grupo elegido
  useEffect(() => {
    setCodeTouched(false)
    setCode('')
    setType(typeChoice.kind === 'choose' ? typeChoice.fallback : null)
    setPurchase(parent?.type === 'expense')
    if (isRoot) setKind('group')
  }, [parentChoice])

  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])

  const postable = !isRoot && kind === 'postable'
  const finalType = typeChoice.kind === 'fixed' ? typeChoice.type : type
  const showPurchase =
    postable && !requiresParty && (finalType === 'asset' || finalType === 'expense')
  const err = (k: string) => errors[k] ?? null

  const onFailure = (state: AccFailureState) => {
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
    setMessage(null)
    const local: Record<string, string> = {}
    if (!parentChoice) local.parentId = 'Elegí el grupo donde va (o «Ninguno» para una principal).'
    if (typeChoice.kind === 'choose' && !type) local.type = 'Elegí el tipo de la cuenta.'
    if (tooDeep) local.parentId = 'Ese grupo ya está en el último nivel (8): elegí uno más arriba.'
    if (Object.keys(local).length > 0) {
      setErrors(local)
      return
    }
    setErrors({})
    run(
      () =>
        saveAccount(tenantSlug, {
          mode: 'create',
          parentId: isRoot ? null : parentChoice,
          type: typeChoice.kind === 'choose' ? type : null,
          // Sin tocar (o vacío), el código lo elige la base al guardar: el siguiente libre del grupo,
          // aunque otra persona haya usado el propuesto. Una principal siempre lleva el suyo.
          code: isRoot ? shownCode.trim() : codeTouched ? code.trim() || null : null,
          name,
          postable,
          contra: postable ? contra : false,
          requiresParty: postable ? requiresParty : false,
          purchaseSelectable: showPurchase ? purchase : false,
          manualSelectable: postable ? manual : true,
          description: description.trim() || null,
        }),
      { onSuccess: (saved) => onDone(saved), onFailure },
    )
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-5">
        <Field
          id="ac-parent"
          label="Adentro de"
          required
          hint={
            isRoot
              ? 'Va al mismo nivel que ACTIVO o PASIVO: es siempre un grupo.'
              : 'El grupo donde va la cuenta.'
          }
          error={err('parentId')}
        >
          <GroupCombobox
            id="ac-parent"
            index={index}
            groups={groups}
            value={parentChoice}
            onValueChange={(v) => {
              setParentChoice(v)
              setErrors((prev) => {
                const { parentId: _drop, ...rest } = prev
                return rest
              })
            }}
            allowRoot
            invalid={Boolean(err('parentId'))}
            describedBy={describedBy('ac-parent', true, err('parentId'))}
          />
        </Field>

        {parentChoice ? (
          <>
            <Field
              id="ac-kind"
              label="Qué es"
              hint={
                isRoot
                  ? 'Una cuenta principal ordena otras cuentas.'
                  : kind === 'postable'
                    ? 'Lleva movimientos: es la que se elige al cargar.'
                    : 'Ordena otras cuentas: no lleva movimientos. Esto no se cambia después.'
              }
              error={err('postable')}
            >
              <Select
                value={isRoot ? 'group' : kind}
                onValueChange={(v) => setKind(v === 'group' ? 'group' : 'postable')}
                disabled={isRoot}
              >
                <SelectTrigger
                  id="ac-kind"
                  className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  aria-invalid={err('postable') ? true : undefined}
                  aria-describedby={describedBy('ac-kind', true, err('postable'))}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postable">Cuenta para imputar</SelectItem>
                  <SelectItem value="group">Grupo (ordena otras cuentas)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <TypeField
              id="ac-type"
              choice={typeChoice}
              value={type}
              onChange={(t) => {
                setType(t)
                setPurchase(t === 'expense')
              }}
              error={err('type')}
            />

            <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
              <Field
                id="ac-code"
                label="Código"
                required={isRoot}
                hint={
                  codeTouched && code.trim() !== proposal
                    ? code.trim() === '' && !isRoot
                      ? `Vacío va el siguiente libre: ${proposal}.`
                      : `El que seguía era ${proposal}.`
                    : isRoot
                      ? 'La siguiente cuenta principal libre. Podés cambiarlo.'
                      : 'El siguiente libre del grupo. Podés cambiarlo.'
                }
                error={err('code')}
              >
                <Input
                  id="ac-code"
                  value={shownCode}
                  maxLength={24}
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={proposal}
                  aria-invalid={err('code') ? true : undefined}
                  aria-describedby={describedBy('ac-code', true, err('code'))}
                  onChange={(e) => {
                    setCodeTouched(true)
                    setCode(e.target.value.replace(/[^\d.]/g, ''))
                  }}
                  className={cn(INPUT_CLASS, 'font-mono tabular-nums')}
                />
              </Field>
              <Field id="ac-name" label="Nombre" required error={err('name')}>
                <Input
                  id="ac-name"
                  value={name}
                  maxLength={80}
                  autoComplete="off"
                  aria-invalid={err('name') ? true : undefined}
                  aria-describedby={describedBy('ac-name', null, err('name'))}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

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
                aria-describedby={describedBy('ac-description', true, err('description'))}
                onChange={(e) => setDescription(e.target.value)}
                className="text-base md:text-sm"
              />
            </Field>

            {postable ? (
              <>
                <SwitchRow
                  id="ac-party"
                  label="Lleva proveedor o cliente"
                  description="Cuenta de control: cada movimiento dice con qué proveedor, cliente u organismo es."
                  checked={requiresParty}
                  disabled={pending}
                  onCheckedChange={setRequiresParty}
                />
                {showPurchase ? (
                  <SwitchRow
                    id="ac-purchase"
                    label="Aparece en «¿En qué?»"
                    description="Se puede elegir al cargar un gasto o una factura de compra."
                    checked={purchase}
                    disabled={pending}
                    onCheckedChange={setPurchase}
                  />
                ) : null}
                <SwitchRow
                  id="ac-contra"
                  label="Regularizadora"
                  description="Resta de su grupo, como las amortizaciones acumuladas: su saldo va del otro lado."
                  checked={contra}
                  disabled={pending}
                  onCheckedChange={setContra}
                />
                <SwitchRow
                  id="ac-manual"
                  label="Se usa en asientos manuales"
                  description="Aparece en el asiento manual y en los ajustes de la contadora."
                  checked={manual}
                  disabled={pending}
                  onCheckedChange={setManual}
                />
              </>
            ) : null}
          </>
        ) : null}

        {message ? <Callout tone="error">{message}</Callout> : null}
      </div>
      <SheetFooter className="border-t border-border/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:justify-end">
        <Button type="submit" className="h-11 min-w-[160px] md:h-9" disabled={pending}>
          {pending ? 'Creando…' : isRoot || kind === 'group' ? 'Crear grupo' : 'Crear cuenta'}
        </Button>
      </SheetFooter>
    </form>
  )
}
