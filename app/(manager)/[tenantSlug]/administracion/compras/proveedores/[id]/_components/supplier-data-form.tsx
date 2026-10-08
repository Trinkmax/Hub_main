'use client'

import { Pencil, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import {
  ArcaLookupPanel,
  ArcaLookupTrigger,
  useArcaLookup,
} from '@/components/administracion/arca-lookup'
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
import type { IvaCondition, PartyKind, TaxIdType } from '@/lib/accounting/types'
import type { ArcaLookupStatus } from '@/lib/arca/views'
import { formatCuit } from '@/lib/fiscal'

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

const NO_VOUCHER = '__ninguno__'

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
 * «Editar datos» de un proveedor (pestaña Datos, H.7): razón social, nombre
 * de fantasía, documento, condición frente al IVA, plazo, cuenta y
 * comprobante habituales, contacto y notas. Guarda con `saveParty`
 * (concurrencia optimista: si alguien lo cambió recién, pide recargar).
 *
 * Con CUIT o CUIL, «Completar con ARCA» trae la razón social, la condición y la
 * dirección; lo que ya estaba cargado y ARCA dice distinto se pregunta antes
 * (diseño §3.1).
 */
export function SupplierDataForm({
  tenantSlug,
  values,
  accounts,
  voucherOptions,
  arcaLookup,
}: {
  tenantSlug: string
  values: SupplierFormValues
  /** Las cuentas que se pueden elegir como imputación habitual (ya filtradas). */
  accounts: readonly AccountOption[]
  voucherOptions: ReadonlyArray<{ value: string; label: string }>
  /** Si hay ARCA para «Completar con ARCA» (`null`: no se pudo saber; no se muestra). */
  arcaLookup: ArcaLookupStatus | null
}) {
  const router = useRouter()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [form, setForm] = useState(values)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)

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

  const reset = () => {
    setForm(values)
    setErrors({})
    setBanner(null)
    arca.reset()
  }

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

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 gap-2 md:h-8"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Pencil className="size-3.5" aria-hidden />
        Editar datos
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Datos de {values.name}</DialogTitle>
            <DialogDescription>
              Lo que cambies acá se usa en las próximas cargas. Lo que ya cargaste no cambia.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-5" noValidate>
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
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <Field id={id('taxIdType')} label="Documento" error={errors.taxIdType}>
                <Select
                  value={form.taxIdType}
                  onValueChange={(v) => set('taxIdType', v as TaxIdType)}
                >
                  <SelectTrigger
                    id={id('taxIdType')}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_ID_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="min-h-11 md:min-h-8">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id={id('taxId')}
                label={form.taxIdType === 'dni' ? 'Número de DNI' : 'Número'}
                error={errors.taxId}
              >
                <ArcaLookupTrigger lookup={arca}>
                  <Input
                    id={id('taxId')}
                    value={form.taxIdType === 'none' ? '' : (form.taxId ?? '')}
                    disabled={form.taxIdType === 'none'}
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
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                  />
                </ArcaLookupTrigger>
              </Field>
            </div>
            <ArcaLookupPanel lookup={arca} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id={id('ivaCondition')}
                label="Condición frente al IVA"
                error={errors.ivaCondition}
              >
                <Select
                  value={form.ivaCondition}
                  onValueChange={(v) => set('ivaCondition', v as IvaCondition)}
                >
                  <SelectTrigger
                    id={id('ivaCondition')}
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IVA_CONDITION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="min-h-11 md:min-h-8">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id={id('paymentTermDays')}
                label="Plazo de pago"
                hint="Días desde la factura hasta el vencimiento. 0 = de contado."
                error={errors.paymentTermDays}
              >
                <div className="relative">
                  <Input
                    id={id('paymentTermDays')}
                    value={String(form.paymentTermDays)}
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
              </Field>
            </div>
            <Field
              id={id('defaultAccountId')}
              label={
                <>
                  ¿En qué se le compra? <Optional />
                </>
              }
              hint="La cuenta que se propone al cargarle una factura o un gasto."
              error={errors.defaultAccountId}
            >
              <AccountCombobox
                id={id('defaultAccountId')}
                value={form.defaultAccountId}
                onValueChange={(next) => set('defaultAccountId', next)}
                accounts={accounts}
                placeholder="Elegí una cuenta"
                invalid={Boolean(errors.defaultAccountId)}
                aria-describedby={described('defaultAccountId', true)}
              />
              {form.defaultAccountId ? (
                <button
                  type="button"
                  className="justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => set('defaultAccountId', null)}
                >
                  Quitar la cuenta habitual
                </button>
              ) : null}
            </Field>
            <Field
              id={id('defaultVoucherType')}
              label={
                <>
                  Comprobante habitual <Optional />
                </>
              }
              error={errors.defaultVoucherType}
            >
              <Select
                value={form.defaultVoucherType ?? NO_VOUCHER}
                onValueChange={(v) => set('defaultVoucherType', v === NO_VOUCHER ? null : v)}
              >
                <SelectTrigger
                  id={id('defaultVoucherType')}
                  className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VOUCHER} className="min-h-11 md:min-h-8">
                    Lo decide el último que cargaste
                  </SelectItem>
                  {voucherOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="min-h-11 md:min-h-8">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
                  Notas <Optional />
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
    </>
  )
}
