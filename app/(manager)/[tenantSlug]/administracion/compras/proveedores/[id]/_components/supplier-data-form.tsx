'use client'

import { Check, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import {
  ArcaLookupPanel,
  ArcaLookupTrigger,
  useArcaLookup,
} from '@/components/administracion/arca-lookup'
import { CategoryPicker, categoryShortName } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveParty } from '@/lib/accounting/actions/master'
import type { PartyContact } from '@/lib/accounting/party-profile'
import type { IvaCondition, PartyKind, TaxIdType } from '@/lib/accounting/types'
import { isVoucherType, voucherLabel } from '@/lib/accounting/voucher-types'
import type { ArcaLookupStatus } from '@/lib/arca/views'
import { formatCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { RadioChips } from '../../../_components/form-feedback'
import {
  INVOICING_CHOICES,
  otherPaperTypes,
  paperOfVoucher,
  voucherForPaper,
} from '../../../_lib/purchase-paper'
import type { SupplierCategoryChoices } from '../../../_lib/suppliers'
import { ContactsEditor, contactsToSave, DeliveryDaysPicker } from './supplier-profile-fields'

export type SupplierFormValues = {
  id: string
  updatedAt: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  email: string | null
  phone: string | null
  address: string | null
  paymentTermDays: number
  defaultAccountId: string | null
  defaultVoucherType: string | null
  notes: string | null
  contacts: PartyContact[]
  deliveryDays: number[]
  orderLeadDays: number | null
}

const TAX_ID_OPTIONS: ReadonlyArray<{ value: TaxIdType; label: string }> = [
  { value: 'cuit', label: 'CUIT' },
  { value: 'cuil', label: 'CUIL' },
  { value: 'dni', label: 'DNI' },
  { value: 'none', label: 'Sin documento' },
]

export const IVA_CONDITION_OPTIONS: ReadonlyArray<{ value: IvaCondition; label: string }> = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor final' },
  { value: 'no_alcanzado', label: 'No alcanzado' },
  { value: 'sin_datos', label: 'Sin datos' },
]

/**
 * «¿Qué papel te da?» en chips: los cuatro papeles de toda la sección, el que
 * deja que decida la última carga y «Otro papel» (lo que no es ninguno de los
 * cuatro: Factura M, tique factura, recibo…).
 */
const PAPER_CHIPS = [
  { value: 'last', label: 'El último que cargaste' },
  { value: 'a', label: 'Factura A' },
  { value: 'bc', label: 'Factura B o C' },
  { value: 'ticket', label: 'Tique' },
  { value: 'none', label: 'Remito o nada' },
  { value: 'other', label: 'Otro papel' },
] as const
type PaperChip = (typeof PAPER_CHIPS)[number]['value']

/** Los plazos de todos los días: lo que no es ninguno va por «Otro». */
const TERM_CHIPS = [
  { value: '0', label: 'Sin plazo' },
  { value: '7', label: '7 días' },
  { value: '15', label: '15 días' },
  { value: '21', label: '21 días' },
  { value: '30', label: '30 días' },
  { value: 'otro', label: 'Otro' },
] as const
type TermChip = (typeof TERM_CHIPS)[number]['value']
const QUICK_TERMS: ReadonlySet<number> = new Set([0, 7, 15, 21, 30])

/**
 * Un link callado dentro del diálogo («Cambiar», «Quitar»). 44 px en el celular. El relleno
 * (compensado con el margen) separa el anillo de foco de las letras sin correr el texto.
 */
const QUIET_LINK =
  '-mx-1.5 inline-flex min-h-11 items-center rounded-md px-1.5 text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/** La categoría elegida, como el chip relleno del selector (acá no se toca: es lo que hay). */
const CHOSEN_PILL =
  'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-[1.375rem] border border-primary bg-primary px-4 py-1.5 text-sm font-medium leading-tight text-primary-foreground shadow-xs md:min-h-9 md:px-3.5 md:py-1 md:text-[13px]'

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  )
}

function Optional() {
  return <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: ReactNode
  error?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Una pregunta que se contesta tocando (chips, no un desplegable): su rótulo
 * es un `span` con `id` para el `aria-labelledby` del grupo.
 */
function Question({
  id,
  label,
  optional = false,
  error,
  hint,
  children,
}: {
  id: string
  label: ReactNode
  optional?: boolean
  error?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid content-start gap-2">
      <span id={`${id}-label`} className="text-sm font-medium leading-snug">
        {label} {optional ? <Optional /> : null}
      </span>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** El título de cada grupo de campos: los mismos tres de «Sus datos». */
function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4 border-0 border-t border-border/60 p-0 pt-4 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden>
        <p className="font-serif text-base font-semibold leading-snug tracking-tight">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{hint}</p>
      </div>
      {children}
    </fieldset>
  )
}

/**
 * «Editar datos» de un proveedor: la ficha entera (la que pidieron los socios
 * el 09/10/2026), con los campos agrupados bajo los tres títulos de «Sus
 * datos», en el orden en que se consultan: para cargarle (en qué le comprás,
 * qué papel te da, a cuántos días le pagás), para pedirle (contactos, días de
 * entrega, anticipación, dirección) y los datos fiscales.
 *
 * Lo que se elige entre pocas opciones va en chips, con la elegida rellena (ni
 * desplegables ni códigos de cuenta a la vista): la categoría con el mismo
 * selector de «Elegir categoría» (el plan completo queda detrás de su link), el
 * papel con los cuatro de toda la sección, el plazo con los de todos los días.
 *
 * Guarda con `saveParty` lo mismo que guardaba (concurrencia optimista: si
 * alguien lo cambió recién, pide recargar). Con CUIT o CUIL, «Completar con
 * ARCA» trae la razón social, la condición y la dirección; lo que ya estaba
 * cargado y ARCA dice distinto se pregunta antes.
 *
 * Se monta UNA vez en la página y se abre desde la tapa («＋ Cómo te factura»)
 * y desde «Sus datos» ([Editar datos]): lo abre y lo cierra `SupplierEditProvider`.
 */
export function SupplierDataForm({
  tenantSlug,
  values,
  accounts,
  categories = null,
  voucherOptions,
  arcaLookup,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  values: SupplierFormValues
  /** Las cuentas que se pueden elegir como imputación habitual (ya filtradas). */
  accounts: readonly AccountOption[]
  /**
   * Las categorías como botones (`supplierCategoryChoices`). Sin esto (no se
   * pudo armar) queda el buscador de cuentas de siempre.
   */
  categories?: SupplierCategoryChoices | null
  voucherOptions: ReadonlyArray<{ value: string; label: string }>
  /** Si hay ARCA para «Completar con ARCA» (`null`: no se pudo saber; no se muestra). */
  arcaLookup: ArcaLookupStatus | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const uid = useId()
  const setOpen = onOpenChange
  const [pending, start] = useTransition()
  const [form, setForm] = useState(values)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  /** El selector de categorías a la vista (con una ya elegida, arranca plegado). */
  const [categoryOpen, setCategoryOpen] = useState(values.defaultAccountId === null)
  /** «Ver el plan completo»: el buscador con todas las cuentas. */
  const [fullPlan, setFullPlan] = useState(false)
  /** «Otro papel»: el desplegable con lo que no es ninguno de los cuatro. */
  const [otherPaper, setOtherPaper] = useState(false)
  /** «Otro» plazo: el campo para escribir los días. */
  const [otherTerm, setOtherTerm] = useState(!QUICK_TERMS.has(values.paymentTermDays))

  const set = <K extends keyof SupplierFormValues>(key: K, value: SupplierFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const cuitLike = form.taxIdType === 'cuit' || form.taxIdType === 'cuil'
  const arca = useArcaLookup({
    tenantSlug,
    purpose: 'supplier',
    cuit: cuitLike ? (form.taxId ?? '') : '',
    values: { name: form.name, ivaCondition: form.ivaCondition, address: form.address },
    // Lo guardado es de la persona: si ARCA dice otra cosa, se pregunta antes (una
    // condición «Sin datos» no es una elección: esa se completa).
    spec: {
      chosen:
        form.ivaCondition !== 'sin_datos'
          ? ['name', 'address', 'ivaCondition']
          : ['name', 'address'],
    },
    onApply: (patch) => {
      setForm((prev) => ({
        ...prev,
        ...(patch.name !== undefined ? { name: patch.name } : null),
        ...(patch.ivaCondition !== undefined ? { ivaCondition: patch.ivaCondition } : null),
        ...(patch.address !== undefined ? { address: patch.address } : null),
      }))
      setErrors((prev) => {
        const { name: _name, ivaCondition: _iva, address: _address, ...rest } = prev
        return rest
      })
    },
    status: arcaLookup,
    enabled: open && cuitLike,
  })

  // Cada vez que se abre, arranca con lo que está guardado hoy.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrirse
  useEffect(() => {
    if (!open) return
    setForm(values)
    setErrors({})
    setBanner(null)
    setCategoryOpen(values.defaultAccountId === null)
    setFullPlan(false)
    setOtherPaper(false)
    setOtherTerm(!QUICK_TERMS.has(values.paymentTermDays))
    arca.reset()
  }, [open])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBanner(null)
    start(async () => {
      try {
        const result = await saveParty(tenantSlug, {
          id: form.id,
          expectedUpdatedAt: form.updatedAt,
          kind: form.kind,
          name: form.name,
          tradeName: form.tradeName,
          taxIdType: form.taxIdType,
          taxId: form.taxIdType === 'none' ? null : form.taxId,
          ivaCondition: form.ivaCondition,
          email: form.email,
          phone: form.phone,
          address: form.address,
          paymentTermDays: form.paymentTermDays,
          defaultAccountId: form.defaultAccountId,
          defaultVoucherType: form.defaultVoucherType,
          notes: form.notes,
          contacts: contactsToSave(form.contacts),
          deliveryDays: form.deliveryDays,
          orderLeadDays: form.orderLeadDays,
        })
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          setBanner(
            result.code === 'stale'
              ? 'Alguien cambió estos datos recién. Cerrá, recargá la página y probá de nuevo.'
              : result.message,
          )
          return
        }
        toast.success(result.message)
        setOpen(false)
        router.refresh()
      } catch {
        setBanner(ACC_UNREACHABLE.offline)
      }
    })
  }

  const id = (name: string) => `${uid}-${name}`
  const described = (name: string, hint = false) =>
    [hint ? `${id(name)}-hint` : null, errors[name] ? `${id(name)}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined

  // ── La categoría: la elegida a la vista; el selector, a un toque ──
  const chosenOption = categories?.options.find((o) => o.id === form.defaultAccountId) ?? null
  const chosenAccount = form.defaultAccountId
    ? (accounts.find((a) => a.id === form.defaultAccountId) ?? null)
    : null
  const chosenName = chosenOption?.name ?? chosenAccount?.name ?? null
  // La elegida que no es un botón (del plan completo, o una cuenta que ya no se ofrece).
  const outside =
    form.defaultAccountId && !chosenOption
      ? { id: form.defaultAccountId, name: chosenAccount?.name ?? 'Otra cuenta' }
      : null

  // ── El papel: los cuatro de siempre, el de la última carga u otro ──
  const voucherTypes = voucherOptions.map((o) => o.value).filter(isVoucherType)
  const otherTypes = otherPaperTypes(voucherTypes)
  const paper = paperOfVoucher(form.defaultVoucherType)
  const paperChip: PaperChip = otherPaper
    ? 'other'
    : form.defaultVoucherType === null
      ? 'last'
      : (paper ?? 'other')
  const pickPaper = (next: PaperChip) => {
    if (next === 'other') {
      // Sin elegir todavía cuál: el desplegable arranca vacío.
      if (paper !== null) set('defaultVoucherType', null)
      setOtherPaper(true)
      return
    }
    setOtherPaper(false)
    if (next === 'last') {
      set('defaultVoucherType', null)
      return
    }
    // El mismo tipo que escribe cada tarjeta al cargar una compra (B o C según cómo factura).
    set(
      'defaultVoucherType',
      voucherForPaper(next, {
        options: voucherTypes,
        remembered: form.defaultVoucherType,
        condition: form.ivaCondition,
      }),
    )
  }

  // ── El plazo: los de todos los días, u otro ──
  const termChip: TermChip =
    otherTerm || !QUICK_TERMS.has(form.paymentTermDays)
      ? 'otro'
      : (String(form.paymentTermDays) as TermChip)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {/* A la izquierda también en el celular (centrado, un nombre largo quedaba en dos
            renglones pegado a la X), con lugar para la X. */}
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-pretty leading-snug">Datos de {values.name}</DialogTitle>
          <DialogDescription className="text-pretty">
            Lo que cambies acá se usa en las próximas cargas. Lo que ya cargaste no cambia.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <Group title="Para cargarle" hint="Lo que hace que la próxima compra sea de un toque.">
            {categories ? (
              <Question
                id={id('defaultAccountId')}
                label="¿En qué le comprás?"
                optional
                hint={
                  form.defaultAccountId
                    ? undefined
                    : 'La categoría que sale sola cada vez que le cargás algo.'
                }
                error={errors.defaultAccountId}
              >
                {chosenName && !categoryOpen ? (
                  <div className="grid gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className={CHOSEN_PILL}>
                        <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
                        <span className="min-w-0 text-pretty [overflow-wrap:anywhere]">
                          {categoryShortName(chosenName)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className={QUIET_LINK}
                        onClick={() => setCategoryOpen(true)}
                      >
                        Cambiar
                      </button>
                      <button
                        type="button"
                        className={QUIET_LINK}
                        onClick={() => {
                          set('defaultAccountId', null)
                          setCategoryOpen(true)
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground text-pretty">
                      Sale sola cada vez que le cargás algo. En los libros va a «{chosenName}».
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <CategoryPicker
                      id={id('defaultAccountId')}
                      aria-labelledby={`${id('defaultAccountId')}-label`}
                      options={categories.options}
                      featured={categories.featured}
                      pinned={categories.pinned}
                      value={form.defaultAccountId}
                      outside={outside}
                      invalid={Boolean(errors.defaultAccountId)}
                      onChange={(next) => {
                        set('defaultAccountId', next)
                        // Elegida: el selector se pliega y queda la píldora.
                        if (next !== null) {
                          setCategoryOpen(false)
                          setFullPlan(false)
                        }
                      }}
                      onOpenFullPlan={() => setFullPlan(true)}
                    />
                    {fullPlan ? (
                      <div className="grid gap-1.5 rounded-xl bg-secondary/50 p-3">
                        <p className="text-xs text-muted-foreground">
                          El plan completo, para una cuenta que no está entre los botones.
                        </p>
                        <AccountCombobox
                          id={`${id('defaultAccountId')}-plan`}
                          aria-label="Buscar en el plan completo"
                          value={form.defaultAccountId}
                          onValueChange={(next) => {
                            set('defaultAccountId', next)
                            if (next !== null) {
                              setCategoryOpen(false)
                              setFullPlan(false)
                            }
                          }}
                          accounts={accounts}
                          placeholder="Buscar una cuenta"
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </Question>
            ) : (
              <Field
                id={id('defaultAccountId')}
                label={
                  <>
                    ¿En qué le comprás? <Optional />
                  </>
                }
                hint="La categoría que sale sola cada vez que le cargás algo."
                error={errors.defaultAccountId}
              >
                <AccountCombobox
                  id={id('defaultAccountId')}
                  value={form.defaultAccountId}
                  onValueChange={(next) => set('defaultAccountId', next)}
                  accounts={accounts}
                  placeholder="Elegí una categoría"
                  invalid={Boolean(errors.defaultAccountId)}
                  aria-describedby={described('defaultAccountId', true)}
                />
                {form.defaultAccountId ? (
                  <button
                    type="button"
                    className={cn(QUIET_LINK, 'justify-self-start text-xs')}
                    onClick={() => set('defaultAccountId', null)}
                  >
                    Quitar la categoría
                  </button>
                ) : null}
              </Field>
            )}
            <Question
              id={id('defaultVoucherType')}
              label="¿Qué papel te da?"
              optional
              hint="El que viene marcado cuando le cargás algo. En cada compra lo podés cambiar."
              error={errors.defaultVoucherType}
            >
              <RadioChips
                labelledBy={`${id('defaultVoucherType')}-label`}
                value={paperChip}
                invalid={Boolean(errors.defaultVoucherType)}
                options={PAPER_CHIPS.filter(
                  (chip) => chip.value !== 'other' || otherTypes.length > 0,
                )}
                onChange={pickPaper}
              />
              {/* La tarjeta «Factura B o C» escribe una sola letra: acá se ve cuál y se cambia. */}
              {paperChip === 'bc' ? (
                <div className="grid gap-1.5 rounded-xl bg-secondary/50 p-3">
                  <span id={`${id('defaultVoucherType')}-letra`} className="text-sm font-medium">
                    ¿Es B o C?
                  </span>
                  <RadioChips
                    labelledBy={`${id('defaultVoucherType')}-letra`}
                    value={form.defaultVoucherType}
                    options={voucherTypes
                      .filter((t) => t === 'factura_b' || t === 'factura_c')
                      .map((t) => ({ value: t as string, label: voucherLabel(t) }))}
                    onChange={(next) => set('defaultVoucherType', next)}
                  />
                </div>
              ) : null}
              {paperChip === 'other' ? (
                <div className="grid gap-1.5 rounded-xl bg-secondary/50 p-3">
                  <Label
                    htmlFor={id('defaultVoucherType')}
                    className="text-xs text-muted-foreground"
                  >
                    ¿Cuál?
                  </Label>
                  <Select
                    value={
                      form.defaultVoucherType !== null && paper === null
                        ? form.defaultVoucherType
                        : ''
                    }
                    onValueChange={(v) => {
                      if (isVoucherType(v)) set('defaultVoucherType', v)
                    }}
                  >
                    <SelectTrigger
                      id={id('defaultVoucherType')}
                      aria-describedby={described('defaultVoucherType', true)}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue placeholder="Elegí el papel" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherTypes.map((type) => (
                        <SelectItem key={type} value={type} className="min-h-11 md:min-h-8">
                          {voucherLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </Question>
            <Question
              id={id('paymentTermDays')}
              label="¿A cuántos días le pagás?"
              hint="Con eso sale solo el vencimiento de cada compra."
              error={errors.paymentTermDays}
            >
              <RadioChips
                labelledBy={`${id('paymentTermDays')}-label`}
                value={termChip}
                invalid={Boolean(errors.paymentTermDays)}
                options={TERM_CHIPS}
                onChange={(next) => {
                  if (next === 'otro') {
                    setOtherTerm(true)
                    requestAnimationFrame(() =>
                      document.getElementById(id('paymentTermDays'))?.focus(),
                    )
                    return
                  }
                  setOtherTerm(false)
                  set('paymentTermDays', Number(next))
                }}
              />
              {termChip === 'otro' ? (
                <div className="relative max-w-40">
                  <Input
                    id={id('paymentTermDays')}
                    aria-label="Cuántos días"
                    value={form.paymentTermDays === 0 ? '' : String(form.paymentTermDays)}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={errors.paymentTermDays ? true : undefined}
                    aria-describedby={described('paymentTermDays', true)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 3)
                      set('paymentTermDays', digits === '' ? 0 : Math.min(365, Number(digits)))
                    }}
                    className="h-11 pr-12 text-base tabular-nums md:h-10 md:text-sm"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  >
                    días
                  </span>
                </div>
              ) : null}
            </Question>
          </Group>
          <Group title="Para pedirle" hint="A quién llamar, cuándo trae y con cuánto aviso.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id={id('email')}
                label={
                  <>
                    Email <Optional />
                  </>
                }
                error={errors.email}
              >
                <Input
                  id={id('email')}
                  type="email"
                  value={form.email ?? ''}
                  maxLength={160}
                  autoComplete="off"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={described('email')}
                  onChange={(e) => set('email', e.target.value || null)}
                  className="h-11 text-base md:h-10 md:text-sm"
                />
              </Field>
              <Field
                id={id('phone')}
                label={
                  <>
                    Teléfono <Optional />
                  </>
                }
                error={errors.phone}
              >
                <Input
                  id={id('phone')}
                  type="tel"
                  value={form.phone ?? ''}
                  maxLength={30}
                  autoComplete="off"
                  aria-invalid={errors.phone ? true : undefined}
                  onChange={(e) => set('phone', e.target.value || null)}
                  className="h-11 text-base md:h-10 md:text-sm"
                />
              </Field>
            </div>
            <Field
              id={id('contacts')}
              label={
                <>
                  Más contactos <Optional />
                </>
              }
              hint="El vendedor, quien factura, el reparto: cada uno con su teléfono o email."
              error={errors.contacts}
            >
              <ContactsEditor
                idPrefix={id('contacts')}
                value={form.contacts}
                onChange={(next) => set('contacts', next)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field
                id={id('deliveryDays')}
                label={
                  <>
                    Días de entrega <Optional />
                  </>
                }
                hint="Los días en que te trae la mercadería."
                error={errors.deliveryDays}
              >
                <DeliveryDaysPicker
                  id={id('deliveryDays')}
                  value={form.deliveryDays}
                  onChange={(next) => set('deliveryDays', next)}
                  describedBy={described('deliveryDays', true)}
                />
              </Field>
              <Field
                id={id('orderLeadDays')}
                label={
                  <>
                    Anticipación del pedido <Optional />
                  </>
                }
                hint="Cuántos días antes hay que pedirle. 0 = el mismo día."
                error={errors.orderLeadDays}
              >
                <div className="relative">
                  <Input
                    id={id('orderLeadDays')}
                    value={form.orderLeadDays === null ? '' : String(form.orderLeadDays)}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={errors.orderLeadDays ? true : undefined}
                    aria-describedby={described('orderLeadDays', true)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 2)
                      set('orderLeadDays', digits === '' ? null : Math.min(30, Number(digits)))
                    }}
                    className="h-11 pr-12 text-base tabular-nums md:h-10 md:text-sm"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  >
                    días
                  </span>
                </div>
              </Field>
            </div>
            <Field
              id={id('address')}
              label={
                <>
                  Dirección <Optional />
                </>
              }
              error={errors.address}
            >
              <Input
                id={id('address')}
                value={form.address ?? ''}
                maxLength={200}
                autoComplete="off"
                aria-invalid={errors.address ? true : undefined}
                onChange={(e) => set('address', e.target.value || null)}
                className="h-11 text-base md:h-10 md:text-sm"
              />
            </Field>
            <Field
              id={id('notes')}
              label={
                <>
                  Observaciones <Optional />
                </>
              }
              error={errors.notes}
            >
              <Textarea
                id={id('notes')}
                value={form.notes ?? ''}
                maxLength={500}
                rows={3}
                aria-invalid={errors.notes ? true : undefined}
                onChange={(e) => set('notes', e.target.value || null)}
                className="text-base md:text-sm"
              />
            </Field>
          </Group>
          <Group title="Datos fiscales" hint="Como figura en sus papeles y en ARCA.">
            <Field
              id={id('name')}
              label={
                <>
                  Razón social
                  <RequiredMark />
                </>
              }
              error={errors.name}
            >
              <Input
                id={id('name')}
                value={form.name}
                maxLength={120}
                required
                autoComplete="off"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={described('name')}
                onChange={(e) => set('name', e.target.value)}
                className="h-11 text-base md:h-10 md:text-sm"
              />
            </Field>
            <Field
              id={id('tradeName')}
              label={
                <>
                  Nombre de fantasía <Optional />
                </>
              }
              error={errors.tradeName}
            >
              <Input
                id={id('tradeName')}
                value={form.tradeName ?? ''}
                maxLength={120}
                autoComplete="off"
                aria-invalid={errors.tradeName ? true : undefined}
                onChange={(e) => set('tradeName', e.target.value || null)}
                className="h-11 text-base md:h-10 md:text-sm"
              />
            </Field>
            <Question id={id('taxIdType')} label="Documento" error={errors.taxIdType}>
              <RadioChips
                labelledBy={`${id('taxIdType')}-label`}
                value={form.taxIdType}
                invalid={Boolean(errors.taxIdType)}
                options={TAX_ID_OPTIONS}
                onChange={(next) => set('taxIdType', next)}
              />
            </Question>
            {form.taxIdType === 'none' ? null : (
              <Field
                id={id('taxId')}
                label={
                  form.taxIdType === 'dni'
                    ? 'Número de DNI'
                    : `Número de ${form.taxIdType === 'cuil' ? 'CUIL' : 'CUIT'}`
                }
                error={errors.taxId}
              >
                <ArcaLookupTrigger lookup={arca}>
                  <Input
                    id={id('taxId')}
                    value={form.taxId ?? ''}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={form.taxIdType === 'dni' ? '30123456' : '30-71876543-5'}
                    aria-invalid={errors.taxId ? true : undefined}
                    aria-describedby={described('taxId')}
                    onChange={(e) => set('taxId', e.target.value || null)}
                    onBlur={(e) => {
                      if (form.taxIdType === 'cuit' || form.taxIdType === 'cuil') {
                        const digits = e.target.value.replace(/\D/g, '')
                        if (digits.length === 11) set('taxId', formatCuit(digits))
                      }
                    }}
                    className="h-11 text-base tabular-nums placeholder:text-muted-foreground/50 md:h-10 md:text-sm"
                  />
                </ArcaLookupTrigger>
              </Field>
            )}
            <ArcaLookupPanel lookup={arca} />
            <Question
              id={id('ivaCondition')}
              label="¿Cómo te factura?"
              hint={
                INVOICING_CHOICES.find((c) => c.value === form.ivaCondition)?.hint ??
                (form.ivaCondition === 'sin_datos'
                  ? 'Si no sabés, mirá la letra de su factura.'
                  : undefined)
              }
              error={errors.ivaCondition}
            >
              <RadioChips
                labelledBy={`${id('ivaCondition')}-label`}
                value={form.ivaCondition}
                invalid={Boolean(errors.ivaCondition)}
                options={IVA_CONDITION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.value === 'sin_datos' ? 'No sé' : o.label,
                }))}
                onChange={(next) => set('ivaCondition', next)}
              />
            </Question>
          </Group>

          {banner ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p className="text-pretty">{banner}</p>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="h-11 min-w-[140px] md:h-9" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar datos'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
