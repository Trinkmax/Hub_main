'use client'

import { Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { removeRateTier, upsertRateTier } from '@/lib/salon/actions'
import { type CommissionRateTierRow, MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

/** Lo que acepta la action (`rateTierSchema`): de 1 a 999 personas y hasta $ 999.999,99. */
const MAX_GUESTS = 999
const MAX_RATE_CENTS = 99_999_999

/**
 * Un tramo en edición. `_key` es la clave de React: estable aunque el id
 * llegue después de guardar (antes un tramo nuevo usaba `Math.random()` y se
 * volvía a montar en cada tecla: el campo perdía el foco al tipear). La plata
 * puede quedar vacía mientras se escribe (`null`): se guarda como $ 0, igual
 * que antes.
 */
type Draft = Omit<Partial<CommissionRateTierRow>, 'rate_per_guest_cents'> & {
  _key: string
  _isNew?: boolean
  rate_per_guest_cents?: number | null
}

/** Por servicio y, adentro, por «desde». Solo al cargar: mientras se edita las filas no saltan. */
function sortTiers(rows: CommissionRateTierRow[]): CommissionRateTierRow[] {
  return [...rows].sort((a, b) => (a.min_guests ?? 0) - (b.min_guests ?? 0))
}

/** «de 1 a 10 personas» · «de 11 personas en adelante». */
function rangeText(t: Pick<Draft, 'min_guests' | 'max_guests'>): string {
  const from = t.min_guests ?? 1
  if (t.max_guests === null || t.max_guests === undefined) {
    return `de ${from} ${from === 1 ? 'persona' : 'personas'} en adelante`
  }
  return `de ${from} a ${t.max_guests} personas`
}

export function RateTiersEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: CommissionRateTierRow[]
}) {
  const [tiers, setTiers] = useState<Draft[]>(() =>
    sortTiers(initial).map((t) => ({ ...t, _key: t.id })),
  )
  const [pending, startTransition] = useTransition()
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Draft | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const keySeq = useRef(0)

  const byMeal = useMemo(() => {
    const out = new Map<MealType, Draft[]>()
    for (const m of MEAL_TYPES) out.set(m, [])
    for (const t of tiers) {
      if (t.meal_type) out.get(t.meal_type as MealType)?.push(t)
    }
    return out
  }, [tiers])

  function addTier(meal: MealType) {
    keySeq.current += 1
    setTiers((prev) => [
      ...prev,
      {
        _key: `nuevo-${keySeq.current}`,
        _isNew: true,
        meal_type: meal,
        min_guests: 1,
        max_guests: null,
        rate_per_guest_cents: null,
        active: true,
      },
    ])
  }

  function patch<K extends keyof Draft>(key: string, field: K, value: Draft[K]) {
    setTiers((prev) => prev.map((x) => (x._key === key ? { ...x, [field]: value } : x)))
  }

  function save(t: Draft) {
    setSavingKey(t._key)
    startTransition(async () => {
      const r = await upsertRateTier(tenantSlug, {
        ...(t.id && !t._isNew ? { id: t.id } : {}),
        meal_type: t.meal_type,
        min_guests: t.min_guests,
        max_guests: t.max_guests,
        rate_per_guest_cents: t.rate_per_guest_cents ?? 0,
        active: t.active ?? true,
      } as Record<string, unknown>)
      setSavingKey(null)
      if (r.ok) {
        toast.success('Tramo guardado.')
        if (t._isNew && r.data?.id) {
          const id = r.data.id as string
          setTiers((prev) => prev.map((x) => (x._key === t._key ? { ...x, id, _isNew: false } : x)))
        }
      } else {
        toast.error(r.message)
      }
    })
  }

  function remove(t: Draft) {
    // Un tramo que nunca se guardó se descarta sin preguntar: no hay nada que borrar.
    if (!t.id || t._isNew) {
      setTiers((prev) => prev.filter((x) => x._key !== t._key))
      return
    }
    setToDelete(t)
    setDeleteOpen(true)
  }

  async function confirmRemove(): Promise<ConfirmResult> {
    const target = toDelete
    if (!target?.id) return
    const r = await removeRateTier(tenantSlug, target.id)
    if (!r.ok) return { ok: false, error: r.message }
    setTiers((prev) => prev.filter((x) => x._key !== target._key))
    toast.success('Tramo borrado.')
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-pretty type-body text-muted-foreground">
        Cuánto cobra el gestor por cada persona, según el tamaño de la reserva. Si una reserva no
        entra en ningún tramo activo, no suma comisión. Dejá «Hasta» vacío para que el tramo no
        tenga tope.
      </p>

      {MEAL_TYPES.map((meal) => {
        const rows = byMeal.get(meal) ?? []
        return (
          <MealCard key={meal} meal={meal} onAdd={() => addTier(meal)} empty={rows.length === 0}>
            {rows.map((t) => (
              <TierRow
                key={t._key}
                tier={t}
                busy={pending && savingKey === t._key}
                disabled={pending}
                onPatch={(field, value) => patch(t._key, field, value)}
                onSave={() => save(t)}
                onRemove={() => remove(t)}
              />
            ))}
          </MealCard>
        )
      })}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Borrar este tramo?"
        description={
          toDelete
            ? `${MEAL_TYPE_LABELS[toDelete.meal_type as MealType] ?? 'Tramo'}, ${rangeText(toDelete)}. Deja de aplicarse a las comisiones y no se puede deshacer.`
            : undefined
        }
        confirmLabel="Borrar tramo"
        pendingLabel="Borrando…"
        tone="danger"
        onConfirm={confirmRemove}
      />
    </div>
  )
}

function MealCard({
  meal,
  empty,
  onAdd,
  children,
}: {
  meal: MealType
  empty: boolean
  onAdd: () => void
  children: React.ReactNode
}) {
  const titleId = useId()
  return (
    <Card role="group" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="type-subtitle">
          {MEAL_TYPE_LABELS[meal]}
        </h2>
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          <Plus aria-hidden />
          Agregar tramo
        </Button>
      </div>
      {empty ? (
        <p className="type-small text-muted-foreground">
          Sin tramos todavía: las reservas de este servicio no suman comisión.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">{children}</div>
      )}
    </Card>
  )
}

/**
 * Un tramo es su propio formulario: Enter guarda y, si un número o un importe
 * no se entiende, el navegador frena el envío y el campo muestra por qué.
 */
function TierRow({
  tier,
  busy,
  disabled,
  onPatch,
  onSave,
  onRemove,
}: {
  tier: Draft
  busy: boolean
  disabled: boolean
  onPatch: <K extends keyof Draft>(field: K, value: Draft[K]) => void
  onSave: () => void
  onRemove: () => void
}) {
  const activeId = useId()
  const meal = MEAL_TYPE_LABELS[tier.meal_type as MealType] ?? ''

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave()
  }

  return (
    // Sin nombre accesible a propósito: con nombre, cada tramo sería un punto de
    // referencia «formulario» y el lector anunciaría diez. El contexto lo da la
    // tarjeta del servicio (un grupo con su título).
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-2 items-start gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[9rem_9rem_minmax(10rem,14rem)_minmax(0,1fr)]"
    >
      {/* Sin `value`: con un número fuera de rango, el NumberField controlado
          borraba lo tipeado. Lo que se escribe igual llega al borrador. */}
      <Field label="Desde" required>
        <NumberField
          defaultValue={tier.min_guests ?? null}
          onValueChange={(n) => onPatch('min_guests', n ?? undefined)}
          min={1}
          max={MAX_GUESTS}
          steppers={false}
        />
      </Field>
      <Field label="Hasta">
        <NumberField
          defaultValue={tier.max_guests ?? null}
          onValueChange={(n) => onPatch('max_guests', n)}
          min={1}
          max={MAX_GUESTS}
          steppers={false}
          placeholder="Sin tope"
        />
      </Field>
      <Field label="Por persona" className="col-span-2 sm:col-span-1">
        <MoneyField
          cents={tier.rate_per_guest_cents ?? null}
          onCentsChange={(cents) => onPatch('rate_per_guest_cents', cents)}
          decimals="auto"
          maxCents={MAX_RATE_CENTS}
        />
      </Field>
      {/* 1,625 rem = etiqueta (18 px) + 8 px: los botones quedan a la altura de los campos. */}
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:mt-[1.625rem] sm:min-h-(--control-md) sm:justify-end">
        <div className="me-auto flex items-center gap-2 sm:me-2">
          <Switch
            id={activeId}
            checked={tier.active ?? true}
            onCheckedChange={(v) => onPatch('active', v)}
          />
          <Label htmlFor={activeId}>Activo</Label>
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={disabled && !busy}
        >
          Guardar
        </Button>
        <Button
          type="button"
          variant="danger-ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Borrar el tramo de ${meal}, ${rangeText(tier)}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </form>
  )
}
