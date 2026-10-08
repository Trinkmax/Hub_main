'use client'

import { BadgeCheck, Sparkles, UserPlus, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { Amount } from '@/components/administracion/amount'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { IvaCondition } from '@/lib/accounting/types'
import { lookupCuits } from '@/lib/arca/actions'
import { guideStep, isArcaGuideStepId } from '@/lib/arca/guide'
import type { PadronLookupData } from '@/lib/arca/views'
import { formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { createImportSuppliers } from '@/lib/imports/actions'
import { IVA_CONDITION_TEXT, SUPPLIER_IVA_CONDITIONS } from '@/lib/imports/ui/labels'
import { count } from '@/lib/imports/ui/progress'
import { cn } from '@/lib/utils'
import { OFFLINE_TEXT, useReview } from './review-context'

export type NewSupplierView = {
  cuit: string
  name: string
  suggestedCondition: IvaCondition
  suggestedAccountId: string | null
  vouchers: number
  totalCents: number
}

export type LookupView = {
  /** Con qué ambiente se consulta el padrón; `null` = ARCA no está conectado. */
  environment: 'produccion' | 'homologacion' | null
  testData: boolean
} | null

type RowState = {
  include: boolean
  name: string
  nameEdited: boolean
  condition: IvaCondition
  conditionEdited: boolean
  accountId: string | null
  term: string
  /** Lo que dijo ARCA (o por qué no se pudo). */
  arca: { ok: true; data: PadronLookupData } | { ok: false; message: string } | null
  /** Por qué no se pudo crear (después de «Crear»). */
  failed: string | null
}

const SELECT_CLASS = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'
/** Hasta cuántos crea `createImportSuppliers` por vez (y consulta `lookupCuits`). */
const PER_CALL = 200

function initial(rows: readonly NewSupplierView[]): Record<string, RowState> {
  return Object.fromEntries(
    rows.map((r) => [
      r.cuit,
      {
        include: true,
        name: r.name,
        nameEdited: false,
        condition: SUPPLIER_IVA_CONDITIONS.includes(r.suggestedCondition)
          ? r.suggestedCondition
          : 'responsable_inscripto',
        conditionEdited: false,
        accountId: null,
        term: '',
        arca: null,
        failed: null,
      } satisfies RowState,
    ]),
  )
}

/**
 * «Proveedores nuevos (N)» (diseño §4.1 paso 2): los CUIT de las facturas que
 * todavía no son proveedores. Con UN botón se completan todos con ARCA (razón
 * social y condición frente al IVA, del padrón); la persona elige en qué gasta
 * con cada uno (con la sugerencia a un toque, que nunca se aplica sola) y se
 * crean todos juntos. Lo escrito a mano no se pisa.
 */
export function NewSuppliers({
  rows,
  lookup,
  connectHref,
}: {
  rows: NewSupplierView[]
  lookup: LookupView
  /** La guía «Conectar ARCA» (para completar solo). */
  connectHref: string
}) {
  const { slug, batchId, options, editable } = useReview()
  const titleId = useId()
  const [state, setState] = useState<Record<string, RowState>>(() => initial(rows))
  const [arcaError, setArcaError] = useState<{ message: string; step: string | null } | null>(null)
  const [looking, startLooking] = useTransition()
  const [creating, startCreating] = useTransition()

  // Filas nuevas (otra importación o un «Revisar de nuevo») entran con su estado inicial.
  const rowsKey = rows.map((r) => r.cuit).join(',')
  const [seenKey, setSeenKey] = useState(rowsKey)
  if (seenKey !== rowsKey) {
    setSeenKey(rowsKey)
    setState((prev) => {
      const fresh = initial(rows)
      for (const cuit of Object.keys(fresh)) {
        const old = prev[cuit]
        if (old) fresh[cuit] = old
      }
      return fresh
    })
  }

  const accounts = options?.accounts ?? []
  const purchase = useMemo(
    () => new Set(accounts.filter((a) => a.purchase).map((a) => a.id)),
    [accounts],
  )
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null

  const patch = (cuit: string, next: Partial<RowState>) =>
    setState((prev) => {
      const row = prev[cuit]
      return row ? { ...prev, [cuit]: { ...row, ...next } } : prev
    })

  const selected = rows.filter((r) => state[r.cuit]?.include)
  const ready = selected.filter(
    (r) => state[r.cuit]?.accountId && (state[r.cuit]?.name.trim().length ?? 0) >= 2,
  )
  const missingAccount = selected.length - ready.length
  const suggestible = rows.filter(
    (r) => r.suggestedAccountId && !state[r.cuit]?.accountId && purchase.has(r.suggestedAccountId),
  )

  const completeWithArca = () => {
    setArcaError(null)
    startLooking(async () => {
      let found = 0
      try {
        for (let i = 0; i < rows.length; i += PER_CALL) {
          const cuits = rows.slice(i, i + PER_CALL).map((r) => r.cuit)
          const result = await lookupCuits(slug, { cuits, purpose: 'supplier' })
          if (!result.ok) {
            setArcaError({ message: result.message, step: result.step })
            return
          }
          found += result.data.results.filter((x) => x.result.ok).length
          setState((prev) => {
            const next = { ...prev }
            for (const { cuit, result: r } of result.data.results) {
              const row = next[cuit]
              if (!row) continue
              if (!r.ok) {
                next[cuit] = { ...row, arca: { ok: false, message: r.message } }
                continue
              }
              const condition =
                !row.conditionEdited && SUPPLIER_IVA_CONDITIONS.includes(r.data.ivaCondition)
                  ? r.data.ivaCondition
                  : row.condition
              next[cuit] = {
                ...row,
                name: row.nameEdited ? row.name : r.data.name.slice(0, 120),
                condition,
                arca: { ok: true, data: r.data },
              }
            }
            return next
          })
        }
        toast.success(
          found > 0
            ? `Completamos ${count(found, 'proveedor', 'proveedores')} con los datos de ARCA.`
            : 'ARCA no trajo datos de estas CUIT: mirá el motivo en cada una.',
        )
      } catch {
        setArcaError({ message: OFFLINE_TEXT, step: null })
      }
    })
  }

  const applySuggestions = () => {
    setState((prev) => {
      const next = { ...prev }
      for (const r of suggestible) {
        const row = next[r.cuit]
        if (row && r.suggestedAccountId) next[r.cuit] = { ...row, accountId: r.suggestedAccountId }
      }
      return next
    })
  }

  const create = () => {
    if (ready.length === 0) return
    startCreating(async () => {
      try {
        let created = 0
        for (let i = 0; i < ready.length; i += PER_CALL) {
          const suppliers = ready.slice(i, i + PER_CALL).map((r) => {
            const row = state[r.cuit] as RowState
            const term = Number.parseInt(row.term, 10)
            return {
              cuit: r.cuit,
              name: row.name.trim(),
              ivaCondition: row.condition,
              accountId: row.accountId as string,
              paymentTermDays: Number.isFinite(term) && term >= 0 && term <= 365 ? term : 0,
            }
          })
          const result = await createImportSuppliers(slug, { batchId, suppliers })
          if (!result.ok) {
            toast.error(result.message)
            return
          }
          created += result.data.created.length
          for (const f of result.data.failed) patch(f.cuit, { failed: f.message })
        }
        if (created > 0) {
          toast.success(
            `Listo: ${count(created, 'proveedor creado', 'proveedores creados')}. Ya armamos sus comprobantes.`,
          )
        }
      } catch {
        toast.error(OFFLINE_TEXT)
      }
    })
  }

  return (
    <section
      id="proveedores-nuevos"
      aria-labelledby={titleId}
      className="card-hairline scroll-mt-24 rounded-xl border bg-card"
    >
      <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary shadow-2xs">
            <UserPlus className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id={titleId} className="font-serif text-lg font-semibold tracking-tight">
              Proveedores nuevos ({rows.length})
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Están en tus facturas pero todavía no en tus proveedores. Elegí en qué gastás con cada
              uno y los creamos todos juntos.
            </p>
          </div>
        </div>
        {editable ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {lookup?.environment ? (
              <Button
                type="button"
                className="h-11 gap-2 md:h-9"
                disabled={looking}
                onClick={completeWithArca}
              >
                <Wand2 className="size-4" aria-hidden />
                {looking ? 'Consultando ARCA…' : 'Completar todos con ARCA'}
              </Button>
            ) : (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={connectHref}>Conectá ARCA para completarlos solos</Link>
              </Button>
            )}
            {suggestible.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 md:h-9"
                onClick={applySuggestions}
              >
                <Sparkles className="size-4" aria-hidden />
                Usar las cuentas sugeridas ({suggestible.length})
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {lookup?.testData && editable ? (
        <p className="border-b border-border/60 bg-info/10 px-5 py-2 text-xs">
          ARCA está conectado solo en pruebas (homologación): los datos que trae son de prueba.
        </p>
      ) : null}

      {arcaError ? (
        <div
          role="alert"
          className="flex flex-col gap-2 border-b border-border/60 bg-destructive/10 px-5 py-3 text-sm text-destructive sm:flex-row sm:items-center"
        >
          <p className="flex-1">{arcaError.message}</p>
          {arcaError.step ? (
            <Link
              href={`${connectHref}#paso-${stepNumber(arcaError.step)}`}
              className="font-medium underline underline-offset-2"
            >
              Ver cómo arreglarlo
            </Link>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-border/60">
        {rows.map((r) => {
          const row = state[r.cuit]
          if (!row) return null
          const base = `${titleId}-${r.cuit}`
          const suggestion =
            r.suggestedAccountId && purchase.has(r.suggestedAccountId) ? r.suggestedAccountId : null
          return (
            <li key={r.cuit} className={cn('space-y-3 px-5 py-4', !row.include && 'opacity-70')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {editable ? (
                    <Checkbox
                      id={`${base}-inc`}
                      checked={row.include}
                      onCheckedChange={(v) => patch(r.cuit, { include: v === true })}
                      className="mt-1"
                      aria-label={`Crear a ${row.name}`}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="font-medium break-words">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      CUIT {formatCuit(r.cuit)} · {count(r.vouchers, 'comprobante', 'comprobantes')}
                    </p>
                  </div>
                </div>
                <Amount cents={r.totalCents} className="text-sm" />
              </div>

              {row.arca?.ok ? (
                <div className="space-y-1 text-xs">
                  <p className="flex items-center gap-1.5 text-success">
                    <BadgeCheck className="size-3.5" aria-hidden />
                    Según ARCA ({formatIsoDay(row.arca.data.fetchedAt.slice(0, 10))}):{' '}
                    {IVA_CONDITION_TEXT[row.arca.data.ivaCondition]}
                    {row.arca.data.activity?.description
                      ? ` · ${row.arca.data.activity.description}`
                      : ''}
                  </p>
                  {row.arca.data.warnings.map((w) => (
                    <p key={w.key} className="text-warning-text">
                      {w.message}
                    </p>
                  ))}
                </div>
              ) : row.arca && !row.arca.ok ? (
                <p className="text-xs text-warning-text">{row.arca.message}</p>
              ) : null}

              {editable && row.include ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_7rem]">
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor={`${base}-name`}>Razón social</Label>
                    <Input
                      id={`${base}-name`}
                      value={row.name}
                      maxLength={120}
                      className="h-11 text-base md:h-10 md:text-sm"
                      onChange={(e) => patch(r.cuit, { name: e.target.value, nameEdited: true })}
                    />
                  </div>
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor={`${base}-iva`}>Condición frente al IVA</Label>
                    <Select
                      value={row.condition}
                      onValueChange={(v) =>
                        patch(r.cuit, { condition: v as IvaCondition, conditionEdited: true })
                      }
                    >
                      <SelectTrigger id={`${base}-iva`} className={SELECT_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPLIER_IVA_CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {IVA_CONDITION_TEXT[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor={`${base}-acc`}>
                      ¿En qué gastás con él?
                      <span aria-hidden className="ml-0.5 text-destructive">
                        *
                      </span>
                    </Label>
                    <AccountCombobox
                      id={`${base}-acc`}
                      value={row.accountId}
                      accounts={accounts}
                      filter={(a) => purchase.has(a.id)}
                      placeholder="Elegí la cuenta"
                      invalid={row.failed !== null && !row.accountId}
                      onValueChange={(next) => patch(r.cuit, { accountId: next })}
                    />
                    {suggestion && row.accountId !== suggestion ? (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground md:min-h-0"
                        onClick={() => patch(r.cuit, { accountId: suggestion })}
                      >
                        <Sparkles className="size-3.5 shrink-0" aria-hidden />
                        Sugerida: {accountName(suggestion)}. Tocá para usarla.
                      </button>
                    ) : null}
                  </div>
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor={`${base}-term`}>
                      Plazo (días){' '}
                      <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                    </Label>
                    <Input
                      id={`${base}-term`}
                      value={row.term}
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="0"
                      className="h-11 text-base md:h-10 md:text-sm"
                      onChange={(e) => patch(r.cuit, { term: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                </div>
              ) : null}

              {row.failed ? (
                <p role="alert" className="text-xs text-destructive">
                  {row.failed}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>

      {editable ? (
        <footer className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground text-pretty" aria-live="polite">
            {missingAccount > 0
              ? `Falta elegir en qué gastás con ${count(missingAccount, 'proveedor', 'proveedores')}.`
              : ready.length > 0
                ? 'Todo listo para crearlos.'
                : 'Elegí al menos uno.'}
          </p>
          <Button
            type="button"
            className="h-11 w-full gap-2 sm:w-auto md:h-9"
            disabled={creating || ready.length === 0}
            onClick={create}
          >
            <UserPlus className="size-4" aria-hidden />
            {creating ? 'Creando…' : `Crear ${count(ready.length, 'proveedor', 'proveedores')}`}
          </Button>
        </footer>
      ) : null}
    </section>
  )
}

/** `s8_padron` → 8 (el ancla `#paso-8` de la guía). */
function stepNumber(step: string): number {
  return isArcaGuideStepId(step) ? guideStep(step).n : 0
}
