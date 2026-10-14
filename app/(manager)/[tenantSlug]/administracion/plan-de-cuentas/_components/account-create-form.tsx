'use client'

import { ChevronDown } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
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
import { categoryListGroups } from '../_lib/categories'
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

/** Lo que el formulario tiene cargado al momento de guardar. */
export type CreateAccountDraft = {
  /** Va como cuenta principal (sin grupo). */
  isRoot: boolean
  /** El id del grupo elegido (o la marca de «ninguno»). */
  parentChoice: string | null
  /** El tipo lo fija el grupo (`fixed`) o lo elige la persona (`choose`). */
  typeChoice: 'fixed' | 'choose'
  type: AccountType | null
  /** El código que se ve: el propuesto, o el que escribió la persona. */
  shownCode: string
  codeTouched: boolean
  code: string
  name: string
  description: string
  /** Lleva movimientos (no es un grupo). */
  postable: boolean
  requiresParty: boolean
  /** El tilde de «¿En qué se gastó?» se ofrece (imputable de activo o egreso, sin proveedor). */
  showPurchase: boolean
  purchase: boolean
  contra: boolean
  manual: boolean
}

/**
 * Lo que se le manda a `saveAccount` al crear una cuenta. Puro: lo usa el formulario (el completo
 * y el alta corta de «Tus categorías», que es el MISMO formulario con casi todo plegado) y lo fijan
 * los tests, para que las dos caras manden lo mismo.
 */
export function createAccountInput(draft: CreateAccountDraft) {
  return {
    mode: 'create' as const,
    parentId: draft.isRoot ? null : draft.parentChoice,
    type: draft.typeChoice === 'choose' ? draft.type : null,
    // Sin tocar (o vacío), el código lo elige la base al guardar: el siguiente libre del grupo,
    // aunque otra persona haya usado el propuesto. Una principal siempre lleva el suyo.
    code: draft.isRoot
      ? draft.shownCode.trim()
      : draft.codeTouched
        ? draft.code.trim() || null
        : null,
    name: draft.name,
    postable: draft.postable,
    contra: draft.postable ? draft.contra : false,
    requiresParty: draft.postable ? draft.requiresParty : false,
    purchaseSelectable: draft.showPurchase ? draft.purchase : false,
    manualSelectable: draft.postable ? draft.manual : true,
    description: draft.description.trim() || null,
  }
}

/** Con qué arranca cada tilde de una cuenta nueva, según el tipo del grupo donde va. */
export function createAccountDefaults(parentType: AccountType | null | undefined) {
  return {
    kind: 'postable' as Kind,
    requiresParty: false,
    // En un grupo de gastos, la cuenta nueva ya aparece en «¿En qué se gastó?».
    purchase: parentType === 'expense',
    contra: false,
    manual: true,
  }
}

/** Los campos que el alta corta deja adentro de «Más opciones»: si uno falla, se abre. */
const MORE_FIELDS = [
  'parentId',
  'postable',
  'type',
  'code',
  'requiresParty',
  'purchaseSelectable',
  'contra',
  'manualSelectable',
] as const

/**
 * Cuenta nueva (H.16 + #16), en cualquier lugar del plan: adentro de un grupo o como cuenta
 * principal (con su tipo). El código se propone con el estilo del grupo (`1.1.01.01.008`) y se puede
 * cambiar; si queda el propuesto, lo confirma la base al guardar. Imputable o grupo se decide acá
 * (después no cambia).
 *
 * Con `simple` (el alta de «Tus categorías») muestra solo «Nombre» y «Para qué se usa»: lo que un
 * socio sabe contestar. «Adentro de», «Qué es», el código y los tildes quedan en «Más opciones (las
 * usa la contadora)», plegados y con sus valores de siempre. Es el mismo formulario y manda lo mismo.
 */
export function AccountCreateForm({
  tenantSlug,
  index,
  initialParent,
  simple = false,
  onDone,
  onBusyChange,
}: {
  tenantSlug: string
  index: ChartIndex
  /** `undefined` = que la persona elija; `null` = cuenta principal; un id = ese grupo. */
  initialParent: string | null | undefined
  /** El alta corta: nombre y «para qué se usa»; lo demás, plegado. */
  simple?: boolean
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

  const defaults = createAccountDefaults(parent?.type)
  const [kind, setKind] = useState<Kind>(defaults.kind)
  const [type, setType] = useState<AccountType | null>(null)
  const [code, setCode] = useState('')
  // Mientras no lo toquen, el campo muestra el propuesto (y la base lo confirma al guardar).
  const [codeTouched, setCodeTouched] = useState(false)
  const shownCode = codeTouched ? code : proposal
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [requiresParty, setRequiresParty] = useState(defaults.requiresParty)
  const [purchase, setPurchase] = useState(defaults.purchase)
  const [contra, setContra] = useState(defaults.contra)
  const [manual, setManual] = useState(defaults.manual)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // El alta corta llegó con su grupo («Agregar en Gastos del local»): no hace falta preguntarlo.
  const groupGiven = typeof initialParent === 'string' && index.byId.has(initialParent)
  // «Nueva categoría» (el alta corta sin grupo) ofrece solo los grupos de gastos: ahí la cuenta
  // nueva nace con «Aparece en «¿En qué se gastó?»» prendido, que es lo que promete la hoja. En
  // otro grupo ese tilde arranca apagado y acá está plegado: quedaba una «categoría» que no
  // aparecía en ningún lado. Lo demás (un activo, una principal) se crea desde «Plan completo».
  const expenseOnly = simple && !groupGiven
  const offeredGroups = useMemo(
    () => (expenseOnly ? groups.filter((a) => a.type === 'expense') : groups),
    [expenseOnly, groups],
  )
  // En «Nueva categoría» el grupo se elige entre los MISMOS de la lista «Tus categorías», con sus
  // nombres y sin código ni ruta del plan («Personal», «Gastos del local»…). Si todavía no hay
  // ninguna categoría (la lista está vacía), queda el buscador de grupos de gastos de siempre.
  const listGroups = useMemo(() => {
    if (!expenseOnly) return []
    const offered = new Set(offeredGroups.map((a) => a.id))
    return categoryListGroups(index.ordered).flatMap((group) =>
      group.parentId && offered.has(group.parentId)
        ? [{ value: group.parentId, label: group.name }]
        : [],
    )
  }, [expenseOnly, offeredGroups, index])
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
    // Un error en algo que el alta corta tiene plegado: se abre para que se vea.
    if (MORE_FIELDS.some((field) => field in errors && (field !== 'parentId' || groupGiven))) {
      setMoreOpen(true)
    }
    const frame = requestAnimationFrame(() => {
      // Un campo marcado, o (si lo que falta es el grupo) la opción donde cae el foco del grupo.
      formRef.current
        ?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-invalid="true"] [role="radio"][tabindex="0"]',
        )
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors, groupGiven])

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
    if (!parentChoice) {
      local.parentId = expenseOnly
        ? 'Elegí el grupo de gastos donde va.'
        : 'Elegí el grupo donde va (o «Ninguno» para una principal).'
    }
    if (typeChoice.kind === 'choose' && !type) local.type = 'Elegí el tipo de la cuenta.'
    if (tooDeep) local.parentId = 'Ese grupo ya está en el último nivel (8): elegí uno más arriba.'
    if (Object.keys(local).length > 0) {
      setErrors(local)
      return
    }
    setErrors({})
    run(
      () =>
        saveAccount(
          tenantSlug,
          createAccountInput({
            isRoot,
            parentChoice,
            typeChoice: typeChoice.kind,
            type,
            shownCode,
            codeTouched,
            code,
            name,
            description,
            postable,
            requiresParty,
            showPurchase,
            purchase,
            contra,
            manual,
          }),
        ),
      { onSuccess: (saved) => onDone(saved), onFailure },
    )
  }

  const chooseGroup = (v: string) => {
    setParentChoice(v)
    setErrors((prev) => {
      const { parentId: _drop, ...rest } = prev
      return rest
    })
  }

  // «Nueva categoría»: los grupos de la lista, a la vista, para tocar. Manda el mismo id de grupo.
  const groupChips = (
    <div className="grid content-start gap-1.5">
      <span id="ac-parent-label" className="text-sm font-medium">
        ¿En qué grupo va?
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
      </span>
      <div data-invalid={err('parentId') ? 'true' : undefined}>
        <ChoiceChips
          labelledBy="ac-parent-label"
          // En el celular los nombres largos («Impuestos, tasas y contribuciones») dejaban una
          // píldora por renglón: nueve renglones antes del nombre. Ahí van en dos columnas
          // parejas, con el nombre en dos líneas si hace falta (siguen midiendo 44 px o más).
          className="max-sm:grid max-sm:grid-cols-2 max-sm:[&>button]:h-auto max-sm:[&>button]:min-h-11 max-sm:[&>button]:rounded-xl max-sm:[&>button]:px-3 max-sm:[&>button]:py-2 max-sm:[&>button]:text-left max-sm:[&>button]:leading-snug"
          options={listGroups}
          value={parentChoice}
          onChange={chooseGroup}
        />
      </div>
      {err('parentId') ? (
        <p role="alert" className="text-xs text-destructive">
          {err('parentId')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground text-pretty">
          Son los grupos de «Tus categorías». Para otro lugar del plan, usá «Plan completo».
        </p>
      )}
    </div>
  )

  const parentField = (
    <Field
      id="ac-parent"
      label="Adentro de"
      required
      hint={
        isRoot
          ? 'Va al mismo nivel que ACTIVO o PASIVO: es siempre un grupo.'
          : expenseOnly
            ? 'El grupo de gastos donde va: «Gastos del local», «Personal»…'
            : 'El grupo donde va la cuenta.'
      }
      error={err('parentId')}
    >
      <GroupCombobox
        id="ac-parent"
        index={index}
        groups={offeredGroups}
        value={parentChoice}
        onValueChange={chooseGroup}
        allowRoot={!expenseOnly}
        invalid={Boolean(err('parentId'))}
        describedBy={describedBy('ac-parent', true, err('parentId'))}
      />
    </Field>
  )

  const kindField = (
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
  )

  const typeField = (
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
  )

  const codeField = (
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
  )

  const nameField = (
    <Field
      id="ac-name"
      label="Nombre"
      required
      hint={simple ? 'Como lo vas a buscar al cargar: «Hielo», «Service del aire».' : undefined}
      error={err('name')}
    >
      <Input
        id="ac-name"
        value={name}
        maxLength={80}
        autoComplete="off"
        aria-invalid={err('name') ? true : undefined}
        aria-describedby={describedBy('ac-name', simple ? true : null, err('name'))}
        onChange={(e) => setName(e.target.value)}
        className={INPUT_CLASS}
      />
    </Field>
  )

  const descriptionField = (
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
  )

  const switches = postable ? (
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
          label="Aparece en «¿En qué se gastó?»"
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
  ) : null

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-1 content-start gap-4 overflow-y-auto px-5 py-5">
        {simple ? (
          <>
            {/* Desde «Agregar en …» el grupo ya está elegido; desde «Nueva categoría» se elige acá. */}
            {groupGiven && parent ? (
              <p className="rounded-xl bg-secondary/50 px-3 py-2.5 text-sm text-pretty">
                Va adentro de <span className="font-medium">{parent.name}</span>.
              </p>
            ) : listGroups.length > 0 ? (
              groupChips
            ) : (
              parentField
            )}
            {nameField}
            {descriptionField}
            <details
              open={moreOpen}
              onToggle={(e) => setMoreOpen(e.currentTarget.open)}
              className="group/more rounded-xl border border-border/70"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  aria-hidden
                  className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-(--duration-fast) group-open/more:rotate-0 motion-reduce:transition-none"
                />
                Más opciones
                <span className="font-normal text-muted-foreground">(las usa la contadora)</span>
              </summary>
              <div className="grid gap-4 border-t border-border/60 px-3 py-4">
                {groupGiven && parent ? parentField : null}
                {parentChoice ? (
                  <>
                    {kindField}
                    {typeField}
                    {codeField}
                    {switches}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Primero elegí el grupo donde va.</p>
                )}
              </div>
            </details>
          </>
        ) : (
          <>
            {parentField}
            {parentChoice ? (
              <>
                {kindField}
                {typeField}
                <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
                  {codeField}
                  {nameField}
                </div>
                {descriptionField}
                {switches}
              </>
            ) : null}
          </>
        )}

        {message ? <Callout tone="error">{message}</Callout> : null}
      </div>
      <SheetFooter className="border-t border-border/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:justify-end">
        <Button type="submit" className="h-11 min-w-[160px] md:h-9" disabled={pending}>
          {pending
            ? 'Creando…'
            : isRoot || kind === 'group'
              ? 'Crear grupo'
              : simple
                ? 'Crear categoría'
                : 'Crear cuenta'}
        </Button>
      </SheetFooter>
    </form>
  )
}
