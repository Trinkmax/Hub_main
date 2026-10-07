'use client'

import { ArrowDown, ArrowUp, Cake, Check, CircleAlert, EyeOff, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CakeOptionPicker } from '@/components/reservations/cake-option-picker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Section } from '@/components/ui/section'
import { Switch } from '@/components/ui/switch'
import { formatNumber } from '@/lib/format/number-kind'
import { deleteCakeOption, reorderCakeOptions, upsertCakeOption } from '@/lib/salon/actions'
import type { CakeOptionRow } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const MAX_FILLINGS = 4

type Draft = {
  /** `null` mientras no se guardó nunca. */
  id: string | null
  /** Clave de React estable aunque el id llegue después de guardar. */
  key: string
  name: string
  base: string
  fillings: string[]
  active: boolean
}

type DraftErrors = { name?: string; base?: string; fillings?: string }

function toDraft(row: CakeOptionRow): Draft {
  return {
    id: row.id,
    key: row.id,
    name: row.name,
    base: row.base,
    fillings: row.fillings.length > 0 ? row.fillings : [''],
    active: row.active,
  }
}

/** ¿Cambió respecto de lo guardado? Sirve para no ofrecer "Guardar" al pedo. */
function isDirty(draft: Draft, saved: CakeOptionRow | undefined): boolean {
  if (!saved) return true
  const fillings = draft.fillings.map((f) => f.trim()).filter(Boolean)
  return (
    draft.name.trim() !== saved.name ||
    draft.base.trim() !== saved.base ||
    draft.active !== saved.active ||
    fillings.length !== saved.fillings.length ||
    fillings.some((f, i) => f !== saved.fillings[i])
  )
}

/** Lo que falta para poder guardar, dicho al lado de cada campo. */
function validateDraft(d: Draft): DraftErrors {
  const errors: DraftErrors = {}
  if (!d.base.trim()) errors.base = 'Poné el bizcochuelo (ej. «Bizcochuelo de vainilla»).'
  if (!d.name.trim()) errors.name = 'Poné un nombre (ej. «Opción 4»).'
  if (d.fillings.every((f) => !f.trim())) errors.fillings = 'Poné al menos un relleno.'
  return errors
}

/**
 * El menú de tortas del bar. Lo que se carga acá es exactamente lo que ve quien
 * toma una reserva de cumpleaños cuando marca que lleva torta — por eso abajo
 * está el preview real, con el mismo componente.
 *
 * Desactivar y borrar son cosas distintas y el editor lo dice: desactivada sale
 * del selector pero las reservas que ya la eligieron la siguen mostrando;
 * borrada desaparece, y por eso solo se puede borrar la que nadie usó.
 */
export function CakeCatalogEditor({
  tenantSlug,
  initial,
  usage,
}: {
  tenantSlug: string
  initial: CakeOptionRow[]
  /** cake_option_id → cuántas reservas la eligieron. */
  usage: Record<string, number>
}) {
  const [saved, setSaved] = useState<CakeOptionRow[]>(initial)
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft))
  const [errors, setErrors] = useState<Record<string, DraftErrors>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [newKeySeq, setNewKeySeq] = useState(0)

  const savedById = new Map(saved.map((s) => [s.id, s]))

  function patch(key: string, changes: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...changes } : d)))
    // El error de un campo se va apenas se lo toca.
    const touched = Object.keys(changes) as Array<keyof Draft>
    setErrors((prev) => {
      const current = prev[key]
      if (!current) return prev
      const next: DraftErrors = { ...current }
      for (const field of touched) {
        if (field === 'name' || field === 'base' || field === 'fillings') delete next[field]
      }
      return { ...prev, [key]: next }
    })
  }

  function addNew() {
    const key = `nueva-${newKeySeq}`
    setNewKeySeq((n) => n + 1)
    setDrafts((prev) => [
      ...prev,
      {
        id: null,
        key,
        name: `Opción ${prev.length + 1}`,
        base: '',
        fillings: ['', ''],
        active: true,
      },
    ])
  }

  function save(index: number) {
    const d = drafts[index]
    if (!d) return
    const problems = validateDraft(d)
    if (Object.keys(problems).length > 0) {
      setErrors((prev) => ({ ...prev, [d.key]: problems }))
      // El foco va al primer campo marcado de ESTA torta.
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-cake-key="${d.key}"] [aria-invalid="true"]`)
          ?.focus()
      })
      return
    }
    const fillings = d.fillings.map((f) => f.trim()).filter(Boolean)

    setPendingId(d.key)
    startTransition(async () => {
      const r = await upsertCakeOption(tenantSlug, {
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        base: d.base.trim(),
        fillings,
        position: index + 1,
        active: d.active,
      } as Record<string, unknown>)
      setPendingId(null)
      if (!r.ok) {
        toast.error(r.message)
        return
      }

      const id = (r.data?.id as string | undefined) ?? d.id
      if (!id) return
      const row: CakeOptionRow = {
        id,
        tenant_id: '',
        name: d.name.trim(),
        base: d.base.trim(),
        fillings,
        position: index + 1,
        active: d.active,
        created_at: '',
        updated_at: '',
      }
      setSaved((prev) => {
        const rest = prev.filter((p) => p.id !== id)
        return [...rest, row]
      })
      // La `key` NO cambia al guardar: si pasa de 'nueva-0' al uuid,
      // AnimatePresence ve desaparecer una tarjeta y aparecer otra, corre el
      // exit sobre la que se acaba de guardar (colapsa y vuelve) y el foco se
      // cae a <body>. El uuid ya vive en `d.id`, que es lo que consume todo lo
      // demás; `key` solo tiene que ser única y estable.
      setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, id, fillings } : x)))
      toast.success('Torta guardada.')
    })
  }

  /** Un borrador que nunca se guardó se descarta sin preguntar: no hay nada que borrar. */
  function discard(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  /** Borra una guardada. Espera con el diálogo abierto; si falla, el error queda adentro. */
  async function removeSaved(d: Draft): Promise<ConfirmResult> {
    if (!d.id) return
    const id = d.id
    const r = await deleteCakeOption(tenantSlug, id)
    if (!r.ok) return { ok: false, error: r.message }
    setDrafts((prev) => prev.filter((x) => x.key !== d.key))
    setSaved((prev) => prev.filter((p) => p.id !== id))
    toast.success('Torta borrada.')
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= drafts.length) return
    const next = [...drafts]
    const a = next[index]
    const b = next[target]
    if (!a || !b) return
    next[index] = b
    next[target] = a
    setDrafts(next)

    // La posición es el índice VISIBLE, no el de la sublista de guardadas: si no,
    // un borrador en el medio dejaba dos tortas empatadas y al recargar el orden
    // no era el que el dueño había dejado.
    const entries = next
      .map((d, i) => ({ id: d.id, position: i + 1 }))
      .filter((e): e is { id: string; position: number } => Boolean(e.id))
    if (entries.length === 0) return
    startTransition(async () => {
      const r = await reorderCakeOptions(tenantSlug, entries)
      if (!r.ok) toast.error(r.message)
    })
  }

  // El preview usa solo lo que ya está guardado y activo: mostrar un borrador a
  // medio escribir haría creer que ya se puede elegir.
  const previewOptions = drafts
    .filter((d) => d.id && d.active && d.base.trim())
    .map((d) => ({
      id: d.id as string,
      name: d.name.trim(),
      base: d.base.trim(),
      fillings: d.fillings.map((f) => f.trim()).filter(Boolean),
    }))

  return (
    // Con «reducir movimiento», las tarjetas aparecen y se reordenan sin animar.
    <MotionConfig reducedMotion="user">
      <div className="flex max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          {drafts.length === 0 ? (
            <EmptyState
              icon={Cake}
              variant="dashed"
              title="Todavía no cargaste tortas"
              description="Cargá los bizcochuelos y rellenos que hace el bar: van a aparecer para elegir cuando una reserva de cumpleaños lleve torta."
              action={
                <Button type="button" onClick={addNew}>
                  <Plus aria-hidden />
                  Sumar la primera torta
                </Button>
              }
            />
          ) : null}

          <AnimatePresence initial={false}>
            {drafts.map((d, idx) => (
              <motion.div
                key={d.key}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                // Al irse, la tarjeta se cierra hacia arriba: sin esto se vería por
                // fuera de su caja mientras el alto llega a 0.
                className="overflow-hidden"
              >
                <CakeCard
                  draft={d}
                  index={idx}
                  total={drafts.length}
                  errors={errors[d.key] ?? {}}
                  dirty={isDirty(d, d.id ? savedById.get(d.id) : undefined)}
                  used={d.id ? (usage[d.id] ?? 0) : 0}
                  busy={pending && pendingId === d.key}
                  onPatch={(changes) => patch(d.key, changes)}
                  onSave={() => save(idx)}
                  onDiscard={() => discard(d.key)}
                  onRemove={() => removeSaved(d)}
                  onMove={(delta) => move(idx, delta)}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {drafts.length > 0 ? (
            <Button type="button" variant="secondary" onClick={addNew} className="w-full">
              <Plus aria-hidden />
              Sumar otra torta
            </Button>
          ) : null}
        </div>

        {/* El preview no es adorno: el dueño escribe los rellenos pensando en el
            cliente del otro lado del teléfono, y acá ve exactamente cómo le van a
            quedar dictados. */}
        <Section
          divider
          title="Así lo ve quien toma la reserva"
          description="El mismo selector que aparece al cargar una reserva de cumpleaños. Muestra solo las tortas guardadas que se ofrecen."
        >
          {/* Sin tarjeta alrededor: las opciones del selector ya son tarjetas
              (nunca una adentro de otra). */}
          <CakeOptionPicker
            options={previewOptions}
            value={previewOptions[0]?.id ?? null}
            onChange={() => {}}
            cakeCount={1}
          />
        </Section>
      </div>
    </MotionConfig>
  )
}

function CakeCard({
  draft: d,
  index,
  total,
  errors,
  dirty,
  used,
  busy,
  onPatch,
  onSave,
  onDiscard,
  onRemove,
  onMove,
}: {
  draft: Draft
  index: number
  total: number
  errors: DraftErrors
  dirty: boolean
  used: number
  busy: boolean
  onPatch: (changes: Partial<Draft>) => void
  onSave: () => void
  onDiscard: () => void
  onRemove: () => Promise<ConfirmResult>
  onMove: (delta: number) => void
}) {
  const baseId = useId()
  const fillingsErrorId = `${baseId}-rellenos-error`
  const activeId = `${baseId}-activa`
  const title = d.base.trim() || d.name.trim() || `la torta ${index + 1}`
  const filled = d.fillings.filter((f) => f.trim()).length

  return (
    <Card
      data-cake-key={d.key}
      role="group"
      aria-label={`Torta ${index + 1}: ${title}`}
      className={cn(!d.active && 'border-dashed bg-transparent')}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-[1.625rem] flex size-8 shrink-0 items-center justify-center rounded-lg type-label type-amount',
            d.active ? 'bg-brand-soft text-brand-text' : 'bg-secondary text-muted-foreground',
          )}
        >
          {index + 1}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Bizcochuelo" error={errors.base}>
              <Input
                value={d.base}
                onChange={(e) => onPatch({ base: e.target.value })}
                placeholder="Bizcochuelo de vainilla"
              />
            </Field>
            <Field label="Cómo la llamás" error={errors.name}>
              <Input
                value={d.name}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder="Opción 1"
              />
            </Field>
          </div>

          <fieldset
            aria-describedby={errors.fillings ? fillingsErrorId : undefined}
            className="flex min-w-0 flex-col gap-2"
          >
            {/* La leyenda no es parte del flex del fieldset: su aire va en el margen. */}
            <legend className="mb-2 type-label text-foreground">
              Rellenos <span className="font-normal text-subtle-foreground">({filled})</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {d.fillings.map((f, fi) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: el relleno se edita en su posición; usar el texto como key rompe el foco al tipear
                  key={`${d.key}-filling-${fi}`}
                  className="flex items-center gap-1.5"
                >
                  <Input
                    value={f}
                    onChange={(e) => {
                      const next = [...d.fillings]
                      next[fi] = e.target.value
                      onPatch({ fillings: next })
                    }}
                    placeholder={fi === 0 ? 'Dulce de leche' : 'Crema y frutillas'}
                    aria-label={`Relleno ${fi + 1}`}
                    aria-invalid={errors.fillings && fi === 0 ? true : undefined}
                  />
                  {d.fillings.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Quitar relleno ${fi + 1}`}
                      onClick={() => onPatch({ fillings: d.fillings.filter((_, i) => i !== fi) })}
                    >
                      <X aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            {errors.fillings ? (
              <p
                id={fillingsErrorId}
                className="flex items-start gap-1 type-caption text-destructive-text"
              >
                <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>{errors.fillings}</span>
              </p>
            ) : null}
            {d.fillings.length < MAX_FILLINGS ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => onPatch({ fillings: [...d.fillings, ''] })}
              >
                <Plus aria-hidden />
                Sumar relleno
              </Button>
            ) : null}
          </fieldset>
        </div>

        <div className="mt-[1.625rem] flex shrink-0 flex-col items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Subir ${title}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Bajar ${title}`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Switch
            id={activeId}
            checked={d.active}
            onCheckedChange={(v) => onPatch({ active: v })}
          />
          <Label
            htmlFor={activeId}
            className={cn('font-normal', !d.active && 'text-muted-foreground')}
          >
            {d.active ? 'Se ofrece' : 'No se ofrece'}
          </Label>
        </div>

        {used > 0 ? (
          <span className="type-caption text-muted-foreground">
            Elegida en {formatNumber(used)} {used === 1 ? 'reserva' : 'reservas'}
          </span>
        ) : null}

        <div className="ms-auto flex flex-wrap items-center gap-2">
          {used > 0 ? (
            // Borrar rompería la comanda de esas reservas (la FK es
            // `restrict`), así que ni ofrecemos el botón: la salida es
            // apagar el switch de arriba.
            <span className="inline-flex items-center gap-1.5 type-caption text-muted-foreground">
              <EyeOff aria-hidden className="size-3.5" />
              Para sacarla del selector, desactivala
            </span>
          ) : d.id ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="danger-ghost" size="sm">
                  <Trash2 aria-hidden />
                  Borrar
                </Button>
              }
              title={`¿Borrar «${title}»?`}
              description="Deja de estar en el menú de tortas. Ninguna reserva la eligió todavía, así que no se pierde nada."
              confirmLabel="Borrar torta"
              pendingLabel="Borrando…"
              tone="danger"
              onConfirm={onRemove}
            />
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
              Descartar
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            disabled={!dirty && !busy}
            loading={busy}
            loadingText="Guardando…"
            onClick={onSave}
          >
            <Check aria-hidden />
            {dirty ? 'Guardar' : 'Guardado'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
