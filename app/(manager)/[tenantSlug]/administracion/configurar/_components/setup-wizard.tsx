'use client'

import {
  Banknote,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Landmark,
  type LucideIcon,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { DateField } from '@/components/administracion/date-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { bootstrapAccounting } from '@/lib/accounting/actions/setup'
import { BOOKS_START_MAX_DAYS_BACK } from '@/lib/accounting/schemas'
import type { Channel, SasIvaCondition, TreasuryKind } from '@/lib/accounting/types'
import {
  addDays,
  fiscalYearEndOnOrAfter,
  formatIsoDay,
  isRealIsoDay,
  monthName,
  startOfMonth,
} from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Callout, describedBy, Field } from '../../ajustes/_components/form-bits'
import {
  CuitInput,
  cuitIssue,
  INPUT_CLASS,
  PercentInput,
  SwitchRow,
} from '../../ajustes/_components/inputs'
import { FISCAL_END_MONTH_OPTIONS } from '../../ajustes/_lib/labels'
import {
  checkWizard,
  effectiveMethods,
  effectiveTransferDestination,
  hasWallet,
  initialWizardState,
  isStepOneField,
  PLATFORMS,
  type PlatformKey,
  SERVER_KEY_FIELDS,
  suggestedBooksStart,
  TREASURY_KIND_OPTIONS,
  transferTargets,
  usesWallet,
  type WizardMethod,
  type WizardSalesPoint,
  type WizardState,
  type WizardTreasury,
  wizardFieldKey,
  wizardPayload,
  wizardStateFromDraft,
} from '../_lib/wizard'
import { WizardProgress } from './wizard-progress'

type Step = 0 | 1 | 2 | 'saved'

type Banner = {
  tone: 'error' | 'info'
  message: string
  action?: { label: string; href: string }
}

const DRAFT_VERSION = 1

function draftKey(slug: string): string {
  return `hub:acc:draft:configurar:${slug}`
}

const IVA_OPTIONS: readonly ChoiceChip<SasIvaCondition>[] = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
]

const IIBB_OPTIONS: readonly ChoiceChip<WizardState['iibbRegime']>[] = [
  { value: 'local', label: 'Local (Córdoba)' },
  { value: 'convenio_multilateral', label: 'Convenio Multilateral' },
  { value: 'exento', label: 'Exento' },
]

const YES_NO: readonly ChoiceChip<'si' | 'no'>[] = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
]

const CHANNEL_OPTIONS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: 'salon', label: 'Salón' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'events', label: 'Eventos' },
]

const KIND_ICON: Readonly<Record<TreasuryKind, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  wallet: Wallet,
  credit_card: CreditCard,
  other: CircleDollarSign,
}

/**
 * La puesta en marcha (H.3), pasos 0 a 2: bienvenida, datos de la SAS y
 * cajas/cobros/puntos de venta → `bootstrapAccounting`. Cada paso queda como
 * borrador en este navegador (`localStorage`) hasta guardar.
 */
export function SetupWizard({
  tenantSlug,
  today,
  tenantName,
  defaultDisplayName,
}: {
  tenantSlug: string
  today: string
  tenantName: string
  defaultDisplayName: string
}) {
  const router = useRouter()
  const base = `/${tenantSlug}/administracion`
  const initial = useMemo(
    () => initialWizardState({ tenantName, displayName: defaultDisplayName, today }),
    [tenantName, defaultDisplayName, today],
  )
  const [step, setStep] = useState<Step>(0)
  const [state, setState] = useState<WizardState>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<Banner | null>(null)
  const [ratesOpen, setRatesOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  const [pending, startTransition] = useTransition()
  const draftReady = useRef(false)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  // ─── Borrador ──────────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: se lee una sola vez al abrir
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey(tenantSlug))
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        const draft = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as {
          v?: unknown
          step?: unknown
          state?: unknown
        }
        const restoredState =
          draft.v === DRAFT_VERSION ? wizardStateFromDraft(draft.state, initial) : null
        if (restoredState) {
          setState(restoredState)
          setStep(draft.step === 2 ? 2 : 1)
          setRestored(true)
        }
      }
    } catch {
      // Sin localStorage o un borrador roto: se arranca de cero.
    }
    draftReady.current = true
  }, [])

  useEffect(() => {
    if (!draftReady.current || step === 'saved' || step === 0) return
    try {
      window.localStorage.setItem(
        draftKey(tenantSlug),
        JSON.stringify({ v: DRAFT_VERSION, step, state }),
      )
    } catch {
      // Sin espacio o sin permiso: el asistente sigue andando igual.
    }
  }, [state, step, tenantSlug])

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey(tenantSlug))
    } catch {
      // nada que limpiar
    }
  }

  // ─── Foco ──────────────────────────────────────────────────────────────────
  // Al cambiar de paso, el foco va al título (lectores de pantalla) y arriba de todo.
  useEffect(() => {
    if (step === 0) return
    headingRef.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  // Con errores, el foco va al primer campo marcado.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])

  // ─── Cambios ───────────────────────────────────────────────────────────────
  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }))
  const clearError = (...fields: string[]) =>
    setErrors((prev) => {
      if (!fields.some((f) => f in prev)) return prev
      const next = { ...prev }
      for (const f of fields) delete next[f]
      return next
    })
  const updateTreasury = (key: string, patch: Partial<WizardTreasury>) =>
    setState((s) => ({
      ...s,
      treasuries: s.treasuries.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }))
  const updatePoint = (id: string, patch: Partial<WizardSalesPoint>) =>
    setState((s) => ({
      ...s,
      salesPoints: s.salesPoints.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))

  const addTreasury = () =>
    setState((s) => {
      const used = s.treasuries
        .map((t) => /^extra_(\d+)$/.exec(t.key)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number)
      const n = (used.length > 0 ? Math.max(...used) : 0) + 1
      return {
        ...s,
        treasuries: [
          ...s.treasuries,
          {
            key: `extra_${n}`,
            preset: null,
            enabled: true,
            name: '',
            kind: 'bank',
            alias: '',
            bankName: '',
            cbuCvu: '',
          },
        ],
      }
    })

  const addPoint = () =>
    setState((s) => {
      const used = s.salesPoints.map((p) => Number(/^sp_(\d+)$/.exec(p.id)?.[1] ?? 0))
      const n = (used.length > 0 ? Math.max(...used) : 0) + 1
      return {
        ...s,
        salesPoints: [...s.salesPoints, { id: `sp_${n}`, number: '', label: '', channel: 'salon' }],
      }
    })

  // ─── Pasos ─────────────────────────────────────────────────────────────────
  const goNext = (event: FormEvent) => {
    event.preventDefault()
    setBanner(null)
    const check = checkWizard(state, today, 1)
    if (!check.ok) {
      setErrors(check.errors)
      return
    }
    setErrors({})
    setStep(2)
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setBanner(null)
    const check = checkWizard(state, today, 2)
    if (!check.ok) {
      setErrors(check.errors)
      if (Object.keys(check.errors).some((f) => f.startsWith('rates.'))) setRatesOpen(true)
      if (check.step === 1) setStep(1)
      return
    }
    setErrors({})
    const payload = wizardPayload(state)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof bootstrapAccounting>>
      try {
        result = await bootstrapAccounting(tenantSlug, payload.raw)
      } catch {
        setBanner({ tone: 'error', message: ACC_UNREACHABLE.offline })
        return
      }
      if (result.ok) {
        clearDraft()
        toast.success(result.message)
        setStep('saved')
        router.refresh()
        return
      }
      const mapped: Record<string, string> = {}
      for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
        const field = wizardFieldKey(path, payload)
        if (!(field in mapped)) mapped[field] = message
      }
      const key = typeof result.detail?.key === 'string' ? result.detail.key : null
      if (Object.keys(mapped).length === 0 && key && SERVER_KEY_FIELDS[key]) {
        mapped[SERVER_KEY_FIELDS[key]] = result.message
      }
      if (key === 'already_set_up') {
        clearDraft()
        setBanner({
          tone: 'info',
          message: 'Otro dueño terminó de configurarla recién.',
          action: { label: 'Ir a Administración', href: base },
        })
        return
      }
      if (Object.keys(mapped).length > 0) {
        setErrors(mapped)
        const stepOne = Object.keys(mapped).some(isStepOneField)
        if (stepOne) setStep(1)
        // En el paso 2 el aviso queda arriba de los botones; en el 1, cada error en su campo.
        else setBanner({ tone: 'error', message: result.message })
        return
      }
      setBanner({ tone: 'error', message: result.message })
    })
  }

  const discardDraft = () => {
    clearDraft()
    setState(initial)
    setErrors({})
    setRestored(false)
    setStep(1)
  }

  // ─── Paso 0: bienvenida ────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className="card-hairline space-y-5 rounded-xl border bg-card p-6">
        <div className="space-y-3 text-sm text-pretty">
          <p className="text-base text-foreground">
            Acá vas a llevar la plata de la SAS al día: gastos, pagos a proveedores, ventas del día,
            cajas y bancos, IVA y los libros para la contadora.
          </p>
          <p className="text-muted-foreground">
            Lo configurás una vez y quedás como administrador: después decidís qué otros dueños
            entran.
          </p>
        </div>
        <ol className="space-y-2 text-sm">
          {[
            ['Datos de la SAS', 'Razón social, CUIT, IVA y desde cuándo llevás las cuentas.'],
            ['Cajas y cobros', 'Dónde está la plata y cómo te pagan los clientes.'],
            ['Saldos iniciales', 'Lo que había el primer día (o arrancás en cero).'],
          ].map(([title, text], index) => (
            <li
              key={title}
              className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/40 text-xs font-semibold tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{title}</span>
                <span className="block text-xs text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <Callout tone="info">Solo vos y quienes habilites van a ver Administración.</Callout>
        <div className="flex justify-end">
          <Button type="button" size="lg" className="h-11 min-w-[140px]" onClick={() => setStep(1)}>
            Empezar
          </Button>
        </div>
      </div>
    )
  }

  // ─── Guardado: esperando la pantalla de saldos ─────────────────────────────
  if (step === 'saved') {
    return (
      <div className="space-y-6">
        <WizardProgress current={2} />
        <div className="card-hairline space-y-4 rounded-xl border bg-card p-6" role="status">
          <p className="font-serif text-lg font-semibold tracking-tight">
            Listo: Administración quedó configurada.
          </p>
          <p className="text-sm text-muted-foreground">
            Ahora cargá los saldos con los que arrancan los libros.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => router.refresh()}
          >
            Seguir con los saldos iniciales
          </Button>
        </div>
      </div>
    )
  }

  const err = (field: string) => errors[field] ?? null
  const methods = effectiveMethods(state)
  const targets = transferTargets(state)
  const destination = effectiveTransferDestination(state)
  const destinationKind = state.treasuries.find((t) => t.key === destination)?.kind
  const walletOn = hasWallet(state)
  const cash = state.treasuries.find((t) => t.kind === 'cash' && t.enabled)
  const wallet = state.treasuries.find((t) => t.kind === 'wallet' && t.enabled)
  const earliest = addDays(today, -BOOKS_START_MAX_DAYS_BACK)
  const firstOfMonth = startOfMonth(today)
  const booksStart = state.booksStartDate
  const fyEnd =
    booksStart && isRealIsoDay(booksStart)
      ? fiscalYearEndOnOrAfter(booksStart, state.fiscalYearEndMonth)
      : null

  // ─── Paso 1: datos de la SAS ───────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-6">
        <WizardProgress current={0} />
        {restored ? (
          <Callout
            tone="info"
            action={
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={discardDraft}
              >
                Descartar
              </Button>
            }
          >
            Recuperamos lo que estabas cargando.
          </Callout>
        ) : null}
        <form
          ref={formRef}
          onSubmit={goNext}
          noValidate
          className="card-hairline space-y-6 rounded-xl border bg-card p-6"
        >
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-serif text-xl font-semibold tracking-tight outline-none"
          >
            Datos de la SAS
          </h2>

          <div className="grid gap-5">
            <Field id="wz-legal-name" label="Razón social" required error={err('legalName')}>
              <Input
                id="wz-legal-name"
                value={state.legalName}
                maxLength={160}
                autoComplete="organization"
                aria-invalid={err('legalName') ? true : undefined}
                aria-describedby={describedBy('wz-legal-name', null, err('legalName'))}
                onChange={(e) => {
                  update({ legalName: e.target.value })
                  clearError('legalName')
                }}
                className={INPUT_CLASS}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="wz-cuit"
                label="CUIT"
                optional
                hint="Si todavía no lo tienen, dejalo vacío: lo van a pedir los libros de IVA."
                error={err('cuit')}
              >
                <CuitInput
                  id="wz-cuit"
                  value={state.cuit}
                  invalid={Boolean(err('cuit'))}
                  describedBy={describedBy('wz-cuit', true, err('cuit'))}
                  onChange={(text) => {
                    update({ cuit: text })
                    if (!cuitIssue(text)) clearError('cuit')
                  }}
                  onBlurCheck={(issue) =>
                    setErrors((prev) => {
                      if (issue) return { ...prev, cuit: issue }
                      if (!('cuit' in prev)) return prev
                      const { cuit: _cuit, ...rest } = prev
                      return rest
                    })
                  }
                />
              </Field>
              <Field id="wz-address" label="Domicilio fiscal" optional error={err('fiscalAddress')}>
                <Input
                  id="wz-address"
                  value={state.fiscalAddress}
                  maxLength={200}
                  autoComplete="street-address"
                  aria-invalid={err('fiscalAddress') ? true : undefined}
                  onChange={(e) => update({ fiscalAddress: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

            <div className="grid gap-1.5">
              <Label id="wz-iva-label">Condición frente al IVA</Label>
              <ChoiceChips
                options={IVA_OPTIONS}
                value={state.ivaCondition}
                labelledBy="wz-iva-label"
                onChange={(value) => update({ ivaCondition: value })}
              />
              <p className="text-xs text-muted-foreground">
                Una SAS es responsable inscripta: si no sabés, dejalo así.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
              <div className="grid gap-1.5">
                <Label id="wz-iibb-label">Ingresos Brutos</Label>
                <ChoiceChips
                  options={IIBB_OPTIONS}
                  value={state.iibbRegime}
                  labelledBy="wz-iibb-label"
                  onChange={(value) => update({ iibbRegime: value })}
                />
              </div>
              <Field
                id="wz-iibb-number"
                label="N° de inscripción"
                optional
                error={err('iibbNumber')}
              >
                <Input
                  id="wz-iibb-number"
                  value={state.iibbNumber}
                  maxLength={30}
                  inputMode="numeric"
                  aria-invalid={err('iibbNumber') ? true : undefined}
                  onChange={(e) => update({ iibbNumber: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DateField
                id="wz-activity-start"
                label="Inicio de actividades"
                optional
                value={state.activityStartDate}
                max={today}
                shortcuts={false}
                error={err('activityStartDate')}
                onValueChange={(iso) => {
                  setState((s) => ({
                    ...s,
                    activityStartDate: iso,
                    booksStartDate: s.booksStartTouched
                      ? s.booksStartDate
                      : suggestedBooksStart(iso, today),
                  }))
                  clearError('activityStartDate', 'booksStartDate')
                }}
              />
              <DateField
                id="wz-books-start"
                label="¿Desde qué fecha llevás las cuentas acá?"
                required
                value={state.booksStartDate}
                min={earliest}
                max={today}
                today={today}
                shortcuts={[
                  {
                    label: `1 de ${monthName(Number(firstOfMonth.slice(5, 7)))}`,
                    value: firstOfMonth,
                  },
                  { label: 'Hoy', value: today },
                ]}
                hint="Es el día del asiento de apertura. Lo de antes entra como saldo inicial."
                error={err('booksStartDate')}
                onValueChange={(iso) => {
                  update({ booksStartDate: iso, booksStartTouched: true })
                  clearError('booksStartDate')
                }}
              />
            </div>

            <Field
              id="wz-fy-end"
              label="Cierre del ejercicio"
              hint={
                <>
                  Lo dice el estatuto de la SAS. Si no sabés, dejá diciembre y la contadora lo
                  confirma.
                  {booksStart && fyEnd ? (
                    <span className="mt-1 block text-foreground">
                      Primer ejercicio: del {formatIsoDay(booksStart)} al {formatIsoDay(fyEnd)}.
                    </span>
                  ) : null}
                </>
              }
              error={err('fiscalYearEndMonth')}
            >
              <Select
                value={String(state.fiscalYearEndMonth)}
                onValueChange={(value) => update({ fiscalYearEndMonth: Number(value) })}
              >
                <SelectTrigger
                  id="wz-fy-end"
                  className="w-full sm:max-w-xs data-[size=default]:h-11 md:data-[size=default]:h-10"
                  aria-describedby="wz-fy-end-hint"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FISCAL_END_MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <SwitchRow
              id="wz-iva-close"
              label="Liquidar el IVA al cerrar cada mes"
              description="Arma el asiento que deja el IVA del mes listo para pagar. Si la contadora prefiere hacerlo ella, apagalo."
              checked={state.ivaOnClose}
              onCheckedChange={(checked) => update({ ivaOnClose: checked })}
            />

            <Field
              id="wz-display-name"
              label="Tu nombre en Administración"
              required
              hint="Así aparece en «Cargado por»."
              error={err('displayName')}
            >
              <Input
                id="wz-display-name"
                value={state.displayName}
                maxLength={80}
                autoComplete="name"
                aria-invalid={err('displayName') ? true : undefined}
                aria-describedby={describedBy('wz-display-name', true, err('displayName'))}
                onChange={(e) => {
                  update({ displayName: e.target.value })
                  clearError('displayName')
                }}
                className={cn(INPUT_CLASS, 'sm:max-w-xs')}
              />
            </Field>
          </div>

          {err('form') ? <Callout tone="error">{err('form')}</Callout> : null}

          <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-5 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="h-11 md:h-9"
              onClick={() => setStep(0)}
            >
              Volver
            </Button>
            <Button type="submit" className="h-11 min-w-[140px] md:h-9">
              Seguir
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // ─── Paso 2: cajas, cobros y puntos de venta ───────────────────────────────
  const methodRows: Array<{
    key: WizardMethod
    label: string
    detail: string
    disabledReason: string | null
  }> = [
    {
      key: 'cash',
      label: 'Efectivo',
      detail: cash ? `Entra a ${cash.name || 'la caja'}` : 'Entra a la caja de efectivo',
      disabledReason: null,
    },
    {
      key: 'transfer',
      label: 'Transferencia',
      detail: 'Entra a la cuenta que elijas abajo',
      disabledReason: targets.length === 0 ? 'Sumá Mercado Pago o un banco para recibirlas.' : null,
    },
    {
      key: 'qr_mp',
      label: 'QR de Mercado Pago',
      detail: wallet ? `Entra a ${wallet.name || 'Mercado Pago'} con descuentos` : '',
      disabledReason: walletOn ? null : 'Sumá la cuenta de Mercado Pago (billetera).',
    },
    {
      key: 'debit',
      label: 'Débito',
      detail: 'Posnet · se acredita en 1 día',
      disabledReason: null,
    },
    {
      key: 'credit',
      label: 'Crédito',
      detail: 'Posnet · se acredita en 10 días',
      disabledReason: null,
    },
    {
      key: 'customer_account',
      label: 'Cuenta corriente',
      detail: 'Clientes que pagan después (por ejemplo, eventos)',
      disabledReason: null,
    },
  ]

  return (
    <div className="space-y-6">
      <WizardProgress current={1} />
      {restored ? (
        <Callout
          tone="info"
          action={
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={discardDraft}>
              Descartar
            </Button>
          }
        >
          Recuperamos lo que estabas cargando.
        </Callout>
      ) : null}
      <form ref={formRef} onSubmit={save} noValidate className="space-y-6">
        <h2 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
          Cajas, cuentas y cómo te pagan
        </h2>

        {/* Cajas y cuentas */}
        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          <header className="space-y-1">
            <h3 className="font-serif text-lg font-semibold tracking-tight">Cajas y cuentas</h3>
            <p className="text-xs text-muted-foreground">
              Dónde está la plata de la SAS. Tiene que quedar al menos una de efectivo.
            </p>
          </header>
          <ul className="space-y-3">
            {state.treasuries.map((t) => {
              const Icon = KIND_ICON[t.kind]
              const id = `wz-t-${t.key}`
              const nameError = err(`treasury.${t.key}.name`)
              const switchable = t.preset === 'wallet' || t.preset === 'bank'
              return (
                <li
                  key={t.key}
                  className={cn(
                    'space-y-3 rounded-lg border border-border/60 bg-background/40 p-4',
                    !t.enabled && 'bg-secondary/30',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      {t.enabled ? (
                        <Field id={`${id}-name`} label="Nombre" error={nameError}>
                          <Input
                            id={`${id}-name`}
                            value={t.name}
                            maxLength={60}
                            aria-invalid={nameError ? true : undefined}
                            aria-describedby={describedBy(`${id}-name`, null, nameError)}
                            onChange={(e) => {
                              updateTreasury(t.key, { name: e.target.value })
                              clearError(`treasury.${t.key}.name`, 'treasuries')
                            }}
                            className={INPUT_CLASS}
                          />
                        </Field>
                      ) : (
                        <div className="space-y-0.5 pt-1">
                          <p className="text-sm font-medium text-muted-foreground">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            No la sumamos: la podés agregar después en Ajustes › Cajas y cuentas.
                          </p>
                        </div>
                      )}
                    </div>
                    {switchable ? (
                      <div className="flex shrink-0 items-center gap-2 pt-7">
                        <Label htmlFor={`${id}-on`} className="text-xs text-muted-foreground">
                          {t.enabled ? 'La usamos' : 'No la usamos'}
                        </Label>
                        <Switch
                          id={`${id}-on`}
                          checked={t.enabled}
                          onCheckedChange={(checked) => {
                            updateTreasury(t.key, { enabled: checked })
                            clearError('methods', 'transferDestination')
                          }}
                          aria-label={`Usar ${t.name || 'esta cuenta'}`}
                        />
                      </div>
                    ) : t.preset === null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-6 size-11 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Quitar ${t.name || 'esta caja'}`}
                        onClick={() =>
                          setState((s) => ({
                            ...s,
                            treasuries: s.treasuries.filter((x) => x.key !== t.key),
                          }))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  {t.enabled ? (
                    <div className="grid gap-3 sm:grid-cols-2 sm:pl-12">
                      {t.preset === null ? (
                        <Field id={`${id}-kind`} label="Tipo">
                          <Select
                            value={t.kind}
                            onValueChange={(value) =>
                              updateTreasury(t.key, { kind: value as TreasuryKind })
                            }
                          >
                            <SelectTrigger
                              id={`${id}-kind`}
                              className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TREASURY_KIND_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      ) : null}
                      {t.kind === 'bank' || t.kind === 'credit_card' ? (
                        <Field
                          id={`${id}-bank`}
                          label={t.kind === 'bank' ? 'Banco' : 'Banco que la emite'}
                          optional
                          hint={
                            t.kind === 'bank'
                              ? 'Queda también como proveedor: sus gastos van al Libro IVA.'
                              : undefined
                          }
                          error={err(`treasury.${t.key}.bankName`)}
                        >
                          <Input
                            id={`${id}-bank`}
                            value={t.bankName}
                            maxLength={80}
                            placeholder="Banco de la Nación Argentina"
                            aria-invalid={err(`treasury.${t.key}.bankName`) ? true : undefined}
                            onChange={(e) => updateTreasury(t.key, { bankName: e.target.value })}
                            className={INPUT_CLASS}
                          />
                        </Field>
                      ) : null}
                      {t.kind === 'wallet' || t.kind === 'bank' ? (
                        <Field
                          id={`${id}-alias`}
                          label="Alias"
                          optional
                          error={err(`treasury.${t.key}.alias`)}
                        >
                          <Input
                            id={`${id}-alias`}
                            value={t.alias}
                            maxLength={20}
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="hub.sas.mp"
                            aria-invalid={err(`treasury.${t.key}.alias`) ? true : undefined}
                            aria-describedby={describedBy(
                              `${id}-alias`,
                              null,
                              err(`treasury.${t.key}.alias`),
                            )}
                            onChange={(e) => {
                              updateTreasury(t.key, { alias: e.target.value })
                              clearError(`treasury.${t.key}.alias`)
                            }}
                            className={INPUT_CLASS}
                          />
                        </Field>
                      ) : null}
                      {t.kind === 'bank' || t.kind === 'wallet' ? (
                        <Field
                          id={`${id}-cbu`}
                          label={t.kind === 'bank' ? 'CBU' : 'CVU'}
                          optional
                          error={err(`treasury.${t.key}.cbuCvu`)}
                        >
                          <Input
                            id={`${id}-cbu`}
                            value={t.cbuCvu}
                            maxLength={26}
                            inputMode="numeric"
                            spellCheck={false}
                            aria-invalid={err(`treasury.${t.key}.cbuCvu`) ? true : undefined}
                            aria-describedby={describedBy(
                              `${id}-cbu`,
                              null,
                              err(`treasury.${t.key}.cbuCvu`),
                            )}
                            onChange={(e) => {
                              updateTreasury(t.key, { cbuCvu: e.target.value })
                              clearError(`treasury.${t.key}.cbuCvu`)
                            }}
                            className={cn(INPUT_CLASS, 'tabular-nums')}
                          />
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {err('treasuries') ? (
            <p role="alert" className="text-xs text-destructive">
              {err('treasuries')}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 md:h-9"
            onClick={addTreasury}
            disabled={state.treasuries.length >= 20}
          >
            <Plus className="size-4" aria-hidden />
            Agregar otra
          </Button>
        </section>

        {/* Cómo te pagan */}
        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          <header className="space-y-1">
            <h3 className="font-serif text-lg font-semibold tracking-tight">¿Cómo te pagan?</h3>
            <p className="text-xs text-muted-foreground">
              Los medios del cierre del día, en el orden de Thinkeon. El orden y los días los
              cambiás después en Ajustes › Medios de cobro.
            </p>
          </header>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {methodRows.map((row) => {
              const id = `wz-m-${row.key}`
              const checked = methods[row.key]
              return (
                <li key={row.key} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={id} className="text-sm font-medium">
                      {row.label}
                    </Label>
                    <p id={`${id}-desc`} className="text-xs text-muted-foreground">
                      {row.disabledReason ?? row.detail}
                    </p>
                  </div>
                  <Switch
                    id={id}
                    checked={checked}
                    disabled={row.disabledReason !== null}
                    aria-describedby={`${id}-desc`}
                    onCheckedChange={(value) => {
                      setState((s) => ({ ...s, methods: { ...s.methods, [row.key]: value } }))
                      clearError('methods', 'transferDestination')
                    }}
                    className="mt-0.5"
                  />
                </li>
              )
            })}
            {PLATFORMS.map((p) => {
              const id = `wz-p-${p.key}`
              return (
                <li key={p.key} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={id} className="text-sm font-medium">
                      {p.label}
                    </Label>
                    <p id={`${id}-desc`} className="text-xs text-muted-foreground">
                      Te paga después (14 días)
                    </p>
                  </div>
                  <Switch
                    id={id}
                    checked={state.platforms[p.key]}
                    aria-describedby={`${id}-desc`}
                    onCheckedChange={(value) =>
                      setState((s) => ({ ...s, platforms: { ...s.platforms, [p.key]: value } }))
                    }
                    className="mt-0.5"
                  />
                </li>
              )
            })}
          </ul>
          {err('methods') ? (
            <p role="alert" className="text-xs text-destructive">
              {err('methods')}
            </p>
          ) : null}

          {methods.transfer && targets.length > 1 ? (
            <Field
              id="wz-transfer-dest"
              label="¿Adónde entran las transferencias?"
              error={err('transferDestination')}
            >
              <Select
                value={destination ?? undefined}
                onValueChange={(value) => {
                  update({ transferDestination: value })
                  clearError('transferDestination')
                }}
              >
                <SelectTrigger
                  id="wz-transfer-dest"
                  className="w-full sm:max-w-sm data-[size=default]:h-11 md:data-[size=default]:h-10"
                >
                  <SelectValue placeholder="Elegí la cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name || 'Sin nombre'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {methods.transfer && destinationKind === 'wallet' ? (
            <div className="grid gap-1.5">
              <Label id="wz-mp-iibb-label">
                ¿Mercado Pago te descuenta Ingresos Brutos en las transferencias?
              </Label>
              <ChoiceChips
                options={YES_NO}
                value={state.transferDeductsIibb ? 'si' : 'no'}
                labelledBy="wz-mp-iibb-label"
                onChange={(value) => update({ transferDeductsIibb: value === 'si' })}
              />
            </div>
          ) : null}

          <div className="rounded-lg border border-border/60">
            <button
              type="button"
              aria-expanded={ratesOpen}
              aria-controls="wz-rates"
              onClick={() => setRatesOpen((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Descuentos habituales
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  ratesOpen && 'rotate-180',
                )}
              />
            </button>
            <div
              id="wz-rates"
              hidden={!ratesOpen}
              className="space-y-4 border-t border-border/60 p-4"
            >
              <p className="text-xs text-muted-foreground">
                Sirven para precargar las acreditaciones. Nunca se registran solos.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {methods.qr_mp ? (
                  <RateField
                    id="wz-r-mpqr"
                    label="Comisión del QR de Mercado Pago"
                    value={state.rates.mpQr}
                    error={err('rates.mpQr')}
                    onChange={(text) => {
                      setState((s) => ({ ...s, rates: { ...s.rates, mpQr: text } }))
                      clearError('rates.mpQr')
                    }}
                  />
                ) : null}
                {usesWallet(state) ? (
                  <RateField
                    id="wz-r-mpiibb"
                    label="Retención de IIBB de Mercado Pago"
                    hint="Se descuenta de los QR y de las transferencias."
                    value={state.rates.mpIibb}
                    error={err('rates.mpIibb')}
                    onChange={(text) => {
                      setState((s) => ({ ...s, rates: { ...s.rates, mpIibb: text } }))
                      clearError('rates.mpIibb')
                    }}
                  />
                ) : null}
                {methods.debit ? (
                  <RateField
                    id="wz-r-debit"
                    label="Comisión de Posnet · débito"
                    value={state.rates.debit}
                    error={err('rates.debit')}
                    onChange={(text) => {
                      setState((s) => ({ ...s, rates: { ...s.rates, debit: text } }))
                      clearError('rates.debit')
                    }}
                  />
                ) : null}
                {methods.credit ? (
                  <RateField
                    id="wz-r-credit"
                    label="Comisión de Posnet · crédito"
                    hint="Más el IVA de la comisión."
                    value={state.rates.credit}
                    error={err('rates.credit')}
                    onChange={(text) => {
                      setState((s) => ({ ...s, rates: { ...s.rates, credit: text } }))
                      clearError('rates.credit')
                    }}
                  />
                ) : null}
                {PLATFORMS.filter((p) => state.platforms[p.key]).map((p) => (
                  <RateField
                    key={p.key}
                    id={`wz-r-${p.key}`}
                    label={`Comisión de ${p.label}`}
                    value={state.rates.platforms[p.key]}
                    error={err(`rates.${p.key}`)}
                    onChange={(text) => {
                      setState((s) => ({
                        ...s,
                        rates: {
                          ...s.rates,
                          platforms: { ...s.rates.platforms, [p.key as PlatformKey]: text },
                        },
                      }))
                      clearError(`rates.${p.key}`)
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Puntos de venta */}
        <section className="card-hairline space-y-4 rounded-xl border bg-card p-6">
          <header className="space-y-1">
            <h3 className="font-serif text-lg font-semibold tracking-tight">
              ¿Con qué puntos de venta factura la SAS?
            </h3>
            <p className="text-xs text-muted-foreground text-pretty">
              Lo ves en tus facturas: «0003-00001234» es el punto de venta 3. Si todavía no
              facturan, dejalo vacío.
            </p>
          </header>
          <ul className="space-y-3">
            {state.salesPoints.map((p) => {
              const id = `wz-sp-${p.id}`
              const numberError = err(`salesPoint.${p.id}.number`)
              const labelError = err(`salesPoint.${p.id}.label`)
              return (
                <li
                  key={p.id}
                  className="grid gap-3 rounded-lg border border-border/60 bg-background/40 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_10rem_auto] sm:items-start"
                >
                  <Field id={`${id}-number`} label="Número" error={numberError}>
                    <Input
                      id={`${id}-number`}
                      value={p.number}
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="3"
                      aria-invalid={numberError ? true : undefined}
                      aria-describedby={describedBy(`${id}-number`, null, numberError)}
                      onChange={(e) => {
                        updatePoint(p.id, { number: e.target.value.replace(/\D/g, '') })
                        clearError(`salesPoint.${p.id}.number`, 'salesPoints')
                      }}
                      className={cn(INPUT_CLASS, 'tabular-nums')}
                    />
                  </Field>
                  <Field id={`${id}-label`} label="Nombre" error={labelError}>
                    <Input
                      id={`${id}-label`}
                      value={p.label}
                      maxLength={60}
                      placeholder="Salón"
                      aria-invalid={labelError ? true : undefined}
                      onChange={(e) => {
                        updatePoint(p.id, { label: e.target.value })
                        clearError(`salesPoint.${p.id}.label`)
                      }}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Field id={`${id}-channel`} label="Canal">
                    <Select
                      value={p.channel}
                      onValueChange={(value) => updatePoint(p.id, { channel: value as Channel })}
                    >
                      <SelectTrigger
                        id={`${id}-channel`}
                        className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANNEL_OPTIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 justify-self-end text-muted-foreground hover:text-destructive sm:mt-6"
                    aria-label={
                      p.number
                        ? `Quitar el punto de venta ${p.number}`
                        : 'Quitar este punto de venta'
                    }
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        salesPoints: s.salesPoints.filter((x) => x.id !== p.id),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
          {err('salesPoints') ? (
            <p role="alert" className="text-xs text-destructive">
              {err('salesPoints')}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 md:h-9"
            onClick={addPoint}
            disabled={state.salesPoints.length >= 20}
          >
            <Plus className="size-4" aria-hidden />
            Agregar punto de venta
          </Button>
        </section>

        {banner ? (
          <Callout
            tone={banner.tone}
            action={
              banner.action ? (
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link href={banner.action.href}>{banner.action.label}</Link>
                </Button>
              ) : undefined
            }
          >
            {banner.message}
          </Callout>
        ) : null}
        {err('form') ? <Callout tone="error">{err('form')}</Callout> : null}

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-border/60 bg-background/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button
            type="button"
            variant="ghost"
            className="h-11 md:h-9"
            disabled={pending}
            onClick={() => {
              setBanner(null)
              setStep(1)
            }}
          >
            Volver
          </Button>
          <Button type="submit" className="h-11 min-w-[160px] md:h-9" disabled={pending}>
            {pending ? 'Configurando…' : 'Guardar y seguir'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function RateField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: string
  error: string | null
  onChange: (text: string) => void
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <PercentInput
        id={id}
        value={value}
        onChange={onChange}
        invalid={Boolean(error)}
        describedBy={describedBy(id, hint, error)}
        className="sm:max-w-[10rem]"
      />
    </Field>
  )
}
