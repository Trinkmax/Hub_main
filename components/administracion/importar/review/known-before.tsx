'use client'

import { BadgeCheck, Check, Sparkles, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { Amount } from '@/components/administracion/amount'
import { CategoryPicker, Panel, Pill, Term } from '@/components/administracion/kit'
import { PartyCombobox } from '@/components/administracion/party-combobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IvaCondition } from '@/lib/accounting/types'
import { guideStep, isArcaGuideStepId } from '@/lib/arca/guide'
import { formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { IVA_CONDITION_TEXT, SUPPLIER_IVA_CONDITIONS } from '@/lib/imports/ui/labels'
import { count } from '@/lib/imports/ui/progress'
import { cn } from '@/lib/utils'
import type {
  LookupView,
  NewSuppliersModel,
  NewSupplierView,
  SupplierRowState,
} from './new-suppliers'
import { ANSWER_BUTTON, QUIET_ANSWER } from './question-card'
import { useReview } from './review-context'

/** `s8_padron` → 8 (el ancla `#paso-8` de la guía). */
function stepNumber(step: string): number {
  return isArcaGuideStepId(step) ? guideStep(step).n : 0
}

/**
 * «¿Los tenés de antes?»: los proveedores de las facturas que llegan con un
 * CUIT que el bar no tiene cargado. Antes era un formulario de cuatro campos
 * por proveedor que no preguntaba lo único que importa: si ya lo tenés. Con
 * proveedores cargados a mano sin CUIT, «Crear» los duplicaba a todos.
 *
 * Una fila abierta por vez (la primera sin contestar): el papel a la izquierda
 * (razón social, CUIT, facturas, total) y la pregunta a la derecha, con
 * respuestas grandes. Las contestadas quedan en una línea con «Cambiar». Al
 * pie, UN botón: «Guardar las N respuestas».
 *
 * Solo dibuja: el estado y el guardado son de `useNewSuppliers`. Quien solo lee
 * ve la lista quieta, sin ningún botón.
 */
export function KnownBefore({
  model,
  lookup,
  connectHref,
}: {
  model: NewSuppliersModel
  lookup: LookupView
  connectHref: string
}) {
  const { editable } = useReview()
  const { rows, state, counts, canLink } = model
  const waiting = rows.filter((r) => needsAnswer(state[r.cuit]))
  const firstOpen = waiting[0]?.cuit ?? null
  const [openCuit, setOpenCuit] = useState<string | null>(null)
  // La fila abierta: la que la persona eligió o, si no, la primera que falta contestar.
  const open = openCuit && state[openCuit] ? openCuit : firstOpen
  const answered = rows.length - waiting.length
  const next = (after: string) => {
    const at = rows.findIndex((r) => r.cuit === after)
    const following = [...rows.slice(at + 1), ...rows.slice(0, at)].find((r) =>
      needsAnswer(state[r.cuit]),
    )
    setOpenCuit(following?.cuit ?? CLOSED)
  }

  if (!editable) {
    return (
      <Panel
        id="proveedores-nuevos"
        title={`Proveedores que faltan reconocer (${rows.length})`}
        description="Aparecen en las facturas con un CUIT que todavía no está cargado."
      >
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <li key={r.cuit} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <div className="min-w-0">
                <p className="font-medium [overflow-wrap:anywhere]">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  CUIT {formatCuit(r.cuit)} · {count(r.vouchers, 'factura', 'facturas')}
                </p>
              </div>
              <Amount cents={r.totalCents} className="text-sm" />
            </li>
          ))}
        </ul>
      </Panel>
    )
  }

  const title = canLink
    ? rows.length === 1
      ? '¿A este lo tenés de antes?'
      : `¿A estos ${rows.length} los tenés de antes?`
    : rows.length === 1
      ? '1 proveedor que no conozco'
      : `${rows.length} proveedores que no conozco`

  return (
    <Panel
      id="proveedores-nuevos"
      title={title}
      description={
        canLink
          ? 'Aparecen en las facturas con un CUIT que no tengo. Si alguno ya es un proveedor tuyo, decime cuál y le guardo el CUIT: así no queda dos veces y encuentro lo que ya le cargaste.'
          : 'Aparecen en las facturas y todavía no son proveedores tuyos. Decime en qué le comprás a cada uno y los creo todos juntos.'
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <Progress done={answered} total={rows.length} />
          {/* Los atajos: en el celular, links en una fila (tres botones a todo el ancho
              empujaban la primera pregunta fuera de la pantalla); con lugar, botones. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0 sm:gap-2">
            {canLink && counts.pending > 0 ? (
              <button
                type="button"
                className={SHORTCUT}
                onClick={() => {
                  model.allNew()
                  setOpenCuit(null)
                }}
              >
                Son todos nuevos
              </button>
            ) : null}
            {model.suggestible > 0 ? (
              <button type="button" className={SHORTCUT} onClick={model.applySuggestions}>
                <Sparkles className="size-4 shrink-0" aria-hidden />
                Usar las categorías sugeridas ({model.suggestible})
              </button>
            ) : null}
            {lookup?.environment ? (
              <button
                type="button"
                className={SHORTCUT}
                disabled={model.looking}
                onClick={model.completeWithArca}
              >
                <Wand2 className="size-4 shrink-0" aria-hidden />
                {model.looking ? 'Consultando ARCA…' : 'Completar los nombres con ARCA'}
              </button>
            ) : (
              <Link href={connectHref} className={QUIET_ANSWER}>
                Conectá ARCA para completarlos solos
              </Link>
            )}
          </div>
        </div>

        {lookup?.testData ? (
          <p className="rounded-xl bg-secondary/50 px-3.5 py-2 text-xs">
            ARCA está conectado solo en pruebas: los datos que trae son de prueba.
          </p>
        ) : null}

        {model.arcaError ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive sm:flex-row sm:items-center"
          >
            <p className="flex-1">{model.arcaError.message}</p>
            {model.arcaError.step ? (
              <Link
                href={`${connectHref}#paso-${stepNumber(model.arcaError.step)}`}
                className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Ver cómo arreglarlo
              </Link>
            ) : null}
          </div>
        ) : null}

        <ul className="divide-y divide-border/60 border-y border-border/60">
          {rows.map((r) => {
            const row = state[r.cuit]
            if (!row) return null
            return (
              <li key={r.cuit}>
                {open === r.cuit ? (
                  <OpenRow supplier={r} row={row} model={model} onDone={() => next(r.cuit)} />
                ) : (
                  <ClosedRow
                    supplier={r}
                    row={row}
                    model={model}
                    onOpen={() => setOpenCuit(r.cuit)}
                  />
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground text-pretty" aria-live="polite">
            {model.saving
              ? `Guardando ${model.saving.done} de ${model.saving.total}…`
              : footerText(counts)}
          </p>
          <Button
            type="button"
            className="h-11 w-full shrink-0 px-5 sm:w-auto"
            disabled={model.saving !== null || counts.toSave === 0}
            onClick={() => void model.save()}
          >
            {counts.toSave === 0
              ? 'Guardar las respuestas'
              : counts.toSave === 1
                ? 'Guardar la respuesta'
                : `Guardar las ${counts.toSave} respuestas`}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/** Ninguna fila abierta a propósito (todas contestadas). */
const CLOSED = '—'

/**
 * Un atajo de arriba («Son todos nuevos», «Usar las categorías sugeridas»): en
 * el celular es un link callado de 44 px; desde `sm`, un botón de contorno.
 */
const SHORTCUT =
  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md text-left text-sm font-medium text-foreground underline underline-offset-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:h-11 sm:border sm:border-border sm:bg-card sm:px-3.5 sm:no-underline sm:shadow-xs sm:hover:bg-cream-tint md:pointer-fine:h-9 md:pointer-fine:min-h-9'

/** ¿Le falta una respuesta? Sin contestar, o «nuevo» sin decir en qué se le compra. */
function needsAnswer(row: SupplierRowState | undefined): boolean {
  return row !== undefined && (row.answer === 'pending' || (row.answer === 'new' && !row.accountId))
}

function footerText(counts: NewSuppliersModel['counts']): string {
  const parts = [
    counts.fresh > 0 ? count(counts.fresh, 'nuevo', 'nuevos') : null,
    counts.known > 0 ? `${counts.known} que ya tenías` : null,
    counts.later > 0 ? `${counts.later} para después` : null,
  ].filter(Boolean)
  const missing = counts.fresh - counts.ready
  const tail =
    missing > 0
      ? ` A ${missing === 1 ? '1 nuevo le falta' : `${missing} nuevos les falta`} decir en qué le comprás.`
      : ''
  if (parts.length === 0) return 'Todavía no contestaste ninguno.'
  return `${parts.join(' · ')}.${tail}`
}

/** «5 de 14», con un puntito por proveedor (hasta 24: con más, solo el número). */
function Progress({ done, total }: { done: number; total: number }) {
  return (
    <p className="flex items-center gap-2.5 text-sm">
      <span className="font-medium tabular-nums">
        {done} de {total}
      </span>
      {total <= 24 ? (
        <span aria-hidden className="flex flex-wrap gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: puntitos idénticos, sin reordenar
              key={i}
              className={cn('size-2 rounded-full', i < done ? 'bg-adm-s1' : 'bg-adm-track')}
            />
          ))}
        </span>
      ) : null}
      <span className="text-muted-foreground">contestados</span>
    </p>
  )
}

type RowProps = { supplier: NewSupplierView; row: SupplierRowState; model: NewSuppliersModel }

/**
 * El papel de un proveedor: tal cual viene en las facturas, sobre una hojita
 * (la misma de las bandejas). Suelto era texto, no un papel.
 */
function SupplierPaper({ supplier, row }: Pick<RowProps, 'supplier' | 'row'>) {
  return (
    <div className="force-light min-w-0 space-y-1 self-start rounded-md border border-adm-paper-rule/60 bg-adm-paper px-3.5 py-3 text-adm-paper-ink shadow-xs">
      <p className="font-medium leading-snug [overflow-wrap:anywhere]">{row.name}</p>
      <p className="text-xs text-muted-foreground">
        CUIT {formatCuit(supplier.cuit)} · {count(supplier.vouchers, 'factura', 'facturas')}
      </p>
      <Amount cents={supplier.totalCents} className="block text-sm font-medium" />
      {row.arca?.ok ? (
        <div className="space-y-1 pt-1 text-xs">
          <p className="flex items-start gap-1.5 text-success">
            <BadgeCheck className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Según ARCA ({formatIsoDay(row.arca.data.fetchedAt.slice(0, 10))}):{' '}
              {IVA_CONDITION_TEXT[row.arca.data.ivaCondition]}
              {row.arca.data.activity?.description
                ? ` · ${row.arca.data.activity.description}`
                : ''}
            </span>
          </p>
          {row.arca.data.warnings.map((w) => (
            <p key={w.key} className="text-warning-text">
              {w.message}
            </p>
          ))}
        </div>
      ) : row.arca && !row.arca.ok ? (
        <p className="pt-1 text-xs text-warning-text">{row.arca.message}</p>
      ) : null}
    </div>
  )
}

function ClosedRow({ supplier, row, model, onOpen }: RowProps & { onOpen: () => void }) {
  const knownName =
    row.answer === 'known'
      ? (model.linkable.find((p) => p.id === row.knownId)?.tradeName ??
        model.linkable.find((p) => p.id === row.knownId)?.name ??
        null)
      : null
  const account =
    row.answer === 'new' ? (model.accounts.find((a) => a.id === row.accountId)?.name ?? null) : null
  return (
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={row.name}>
          {row.name}
        </p>
        <p
          className={cn(
            'flex items-center gap-1.5 text-sm',
            row.answer === 'pending' || row.answer === 'later'
              ? 'text-muted-foreground'
              : 'text-foreground',
          )}
        >
          {row.answer === 'known' || (row.answer === 'new' && account) ? (
            <Check aria-hidden className="size-4 shrink-0 text-success" strokeWidth={2.5} />
          ) : null}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {row.answer === 'known'
              ? `Es ${knownName ?? 'un proveedor tuyo'}: le guardo el CUIT`
              : row.answer === 'new'
                ? account
                  ? `Nuevo · ${account}`
                  : 'Nuevo · falta decir en qué le comprás'
                : row.answer === 'later'
                  ? 'Para después'
                  : 'Sin contestar'}
          </span>
        </p>
        {row.failed ? (
          <p role="alert" className="text-xs text-destructive">
            {row.failed}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={cn(QUIET_ANSWER, 'self-start sm:self-auto')}
        onClick={onOpen}
      >
        {row.answer === 'pending' ? 'Contestar' : 'Cambiar'}
        <span className="sr-only"> lo de {supplier.name}</span>
      </button>
    </div>
  )
}

function OpenRow({ supplier, row, model, onDone }: RowProps & { onDone: () => void }) {
  const base = useId()
  const [other, setOther] = useState(false)
  const [fullPlan, setFullPlan] = useState(false)
  const matches = model.suggestions[supplier.cuit] ?? []
  const suggestion =
    supplier.suggestedAccountId && model.purchase.has(supplier.suggestedAccountId)
      ? supplier.suggestedAccountId
      : null
  // La elegida en el plan completo que no es una de las píldoras.
  const outside =
    row.accountId && !model.categories.some((o) => o.id === row.accountId)
      ? {
          id: row.accountId,
          name: model.accounts.find((a) => a.id === row.accountId)?.name ?? '',
        }
      : null
  const asNew = row.answer === 'new'
  const set = (next: Partial<SupplierRowState>) =>
    model.patch(supplier.cuit, { failed: null, ...next })
  const pickKnown = (id: string) => {
    set({ answer: 'known', knownId: id })
    onDone()
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
      <SupplierPaper supplier={supplier} row={row} />
      <div className="min-w-0 space-y-3">
        {model.canLink ? (
          <>
            <p className="font-serif text-lg font-semibold leading-snug tracking-tight">
              ¿Lo tenés de antes?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {matches.map((m) => (
                <Pill
                  key={m.id}
                  size="touch"
                  activeTone="brand"
                  active={row.answer === 'known' && row.knownId === m.id}
                  onClick={() => pickKnown(m.id)}
                  className="h-auto min-h-11 whitespace-normal py-2 text-left"
                >
                  Sí: es {m.label}
                </Pill>
              ))}
              <Pill
                size="touch"
                activeTone="brand"
                active={other}
                aria-expanded={other}
                onClick={() => setOther((v) => !v)}
              >
                Sí, es otro…
              </Pill>
              <Pill
                size="touch"
                activeTone="brand"
                active={asNew}
                onClick={() => {
                  setOther(false)
                  set({ answer: 'new', knownId: null })
                }}
              >
                No, es nuevo
              </Pill>
            </div>
            {other ? (
              <div className="grid gap-1.5 sm:max-w-md">
                <Label htmlFor={`${base}-known`}>¿Cuál de tus proveedores es?</Label>
                <PartyCombobox
                  id={`${base}-known`}
                  value={row.answer === 'known' ? row.knownId : null}
                  parties={model.linkable}
                  placeholder="Buscá el proveedor"
                  onValueChange={(id) => {
                    if (!id) return
                    setOther(false)
                    pickKnown(id)
                  }}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {asNew ? (
          <div className="space-y-3">
            {/* La misma pregunta y el mismo selector que en Compras (lo habitual de un proveedor). */}
            <p
              id={`${base}-cat`}
              className={cn(
                'font-medium [overflow-wrap:anywhere]',
                !model.canLink && 'font-serif text-lg font-semibold leading-snug tracking-tight',
              )}
            >
              ¿En qué le comprás a {row.name}?
            </p>
            <CategoryPicker
              aria-labelledby={`${base}-cat`}
              options={model.categories}
              value={row.accountId}
              onChange={(next) => set({ accountId: next })}
              featured={model.featured}
              // La sugerida se marca con su chispa; nunca viene elegida.
              suggestedId={suggestion}
              outside={outside}
              size="touch"
              invalid={row.failed !== null && !row.accountId}
              onOpenFullPlan={() => setFullPlan(true)}
            />
            {fullPlan ? (
              <div className="grid gap-1.5 sm:max-w-md">
                <Label htmlFor={`${base}-acc`}>Buscar en el plan completo</Label>
                <AccountCombobox
                  id={`${base}-acc`}
                  value={row.accountId}
                  accounts={model.accounts}
                  filter={(a) => model.purchase.has(a.id)}
                  placeholder="Elegí la categoría"
                  onValueChange={(next) => set({ accountId: next })}
                />
              </div>
            ) : null}
            <details className="group/more">
              <summary className={cn(QUIET_ANSWER, 'list-none [&::-webkit-details-marker]:hidden')}>
                Más datos
              </summary>
              <div className="mt-2 grid gap-3">
                <div className="grid gap-1.5 sm:max-w-md">
                  <Label htmlFor={`${base}-name`}>Nombre</Label>
                  <Input
                    id={`${base}-name`}
                    value={row.name}
                    maxLength={120}
                    className="h-11 text-base md:h-10 md:text-sm"
                    onChange={(e) => set({ name: e.target.value, nameEdited: true })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <p id={`${base}-iva`} className="text-sm font-medium">
                    <Term name="Condición frente al IVA">Cómo factura</Term>
                  </p>
                  <fieldset
                    aria-labelledby={`${base}-iva`}
                    className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
                  >
                    {SUPPLIER_IVA_CONDITIONS.map((c: IvaCondition) => (
                      <Pill
                        key={c}
                        size="touch"
                        activeTone="brand"
                        active={row.condition === c}
                        onClick={() => set({ condition: c, conditionEdited: true })}
                      >
                        {IVA_CONDITION_TEXT[c]}
                      </Pill>
                    ))}
                  </fieldset>
                </div>
                <div className="grid gap-1.5 sm:max-w-[12rem]">
                  <Label htmlFor={`${base}-term`}>Plazo de pago (días)</Label>
                  <Input
                    id={`${base}-term`}
                    value={row.term}
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="0"
                    className="h-11 text-base md:h-10 md:text-sm"
                    onChange={(e) => set({ term: e.target.value.replace(/\D/g, '') })}
                  />
                </div>
              </div>
            </details>
            {/* Sin categoría elegida no hay botón: apagado parecía un campo vacío. */}
            {row.accountId ? (
              <Button type="button" variant="outline" className={ANSWER_BUTTON} onClick={onDone}>
                Listo: el que sigue
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Elegí una categoría para seguir.</p>
            )}
          </div>
        ) : null}

        {row.failed ? (
          <p role="alert" className="text-sm text-destructive">
            {row.failed}
          </p>
        ) : null}

        <button
          type="button"
          className={QUIET_ANSWER}
          onClick={() => {
            set({ answer: 'later', knownId: null })
            onDone()
          }}
        >
          Lo dejo para después
        </button>
      </div>
    </div>
  )
}
