'use client'

import { ArrowDown, ArrowUp, Cake, Check, EyeOff, Loader2, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CakeOptionPicker } from '@/components/reservations/cake-option-picker'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [newKeySeq, setNewKeySeq] = useState(0)

  const savedById = new Map(saved.map((s) => [s.id, s]))

  function patch(index: number, changes: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...changes } : d)))
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
    const fillings = d.fillings.map((f) => f.trim()).filter(Boolean)
    if (!d.name.trim()) {
      toast.error('Poné un nombre (ej. "Opción 4").')
      return
    }
    if (!d.base.trim()) {
      toast.error('Poné el bizcochuelo (ej. "Bizcochuelo de vainilla").')
      return
    }
    if (fillings.length === 0) {
      toast.error('Poné al menos un relleno.')
      return
    }

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
      setDrafts((prev) => prev.map((x, i) => (i === index ? { ...x, id, key: id, fillings } : x)))
      toast.success('Torta guardada.')
    })
  }

  function remove(index: number) {
    const d = drafts[index]
    if (!d) return
    if (!d.id) {
      setDrafts((prev) => prev.filter((_, i) => i !== index))
      return
    }
    setPendingId(d.key)
    startTransition(async () => {
      const r = await deleteCakeOption(tenantSlug, d.id as string)
      setPendingId(null)
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      setDrafts((prev) => prev.filter((_, i) => i !== index))
      setSaved((prev) => prev.filter((p) => p.id !== d.id))
      toast.success('Torta eliminada.')
    })
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

    const ids = next.map((d) => d.id).filter((id): id is string => Boolean(id))
    if (ids.length === 0) return
    startTransition(async () => {
      const r = await reorderCakeOptions(tenantSlug, ids)
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
    <div className="space-y-8">
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {drafts.map((d, idx) => {
            const dirty = isDirty(d, d.id ? savedById.get(d.id) : undefined)
            const used = d.id ? (usage[d.id] ?? 0) : 0
            const busy = pending && pendingId === d.key
            return (
              <motion.div
                key={d.key}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'card-hairline rounded-2xl border bg-card/70 p-4',
                  d.active ? 'border-border/70' : 'border-dashed border-border/60 bg-card/30',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold tabular-nums',
                      d.active
                        ? 'bg-primary/12 text-primary'
                        : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {idx + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Bizcochuelo
                        </Label>
                        <Input
                          value={d.base}
                          onChange={(e) => patch(idx, { base: e.target.value })}
                          placeholder="Bizcochuelo de vainilla"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Cómo la llamás
                        </Label>
                        <Input
                          value={d.name}
                          onChange={(e) => patch(idx, { name: e.target.value })}
                          placeholder="Opción 1"
                          className="h-10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Rellenos ({d.fillings.filter((f) => f.trim()).length})
                      </Label>
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
                                patch(idx, { fillings: next })
                              }}
                              placeholder={fi === 0 ? 'Dulce de leche' : 'Crema y frutillas'}
                              className="h-10"
                            />
                            {d.fillings.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-9 shrink-0 text-muted-foreground"
                                aria-label={`Quitar relleno ${fi + 1}`}
                                onClick={() =>
                                  patch(idx, { fillings: d.fillings.filter((_, i) => i !== fi) })
                                }
                              >
                                <X className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {d.fillings.length < MAX_FILLINGS ? (
                        <button
                          type="button"
                          onClick={() => patch(idx, { fillings: [...d.fillings, ''] })}
                          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          <Plus className="size-3" />
                          Sumar relleno
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Subir"
                      disabled={idx === 0}
                      onClick={() => move(idx, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Bajar"
                      disabled={idx === drafts.length - 1}
                      onClick={() => move(idx, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3">
                  <div className="flex items-center gap-2 text-[13px]">
                    <Switch
                      id={`${d.key}-active`}
                      checked={d.active}
                      onCheckedChange={(v) => patch(idx, { active: v })}
                    />
                    <Label
                      htmlFor={`${d.key}-active`}
                      className={cn('font-normal', !d.active && 'text-muted-foreground')}
                    >
                      {d.active ? 'Se ofrece' : 'No se ofrece'}
                    </Label>
                  </div>

                  {used > 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      Elegida en {used} {used === 1 ? 'reserva' : 'reservas'}
                    </span>
                  ) : null}

                  <div className="ml-auto flex items-center gap-2">
                    {used > 0 ? (
                      // Borrar rompería la comanda de esas reservas (la FK es
                      // `restrict`), así que ni ofrecemos el botón: la salida es
                      // apagar el switch de arriba.
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <EyeOff className="size-3" />
                        Para sacarla del selector, desactivala
                      </span>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                            Borrar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Borrar esta torta?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {d.base.trim() || 'La torta'} deja de estar en el menú. Ninguna
                              reserva la eligió todavía, así que no se pierde nada.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(idx)}>
                              Borrar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      disabled={!dirty || busy}
                      onClick={() => save(idx)}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      {dirty ? 'Guardar' : 'Guardado'}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <Button type="button" variant="outline" onClick={addNew} className="w-full gap-2">
          <Plus className="size-4" />
          Sumar otra torta
        </Button>
      </div>

      {/* El preview no es adorno: el dueño escribe los rellenos pensando en el
          cliente del otro lado del teléfono, y acá ve exactamente cómo le van a
          quedar dictados. */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Cake className="size-4 text-primary" aria-hidden />
          <h2 className="font-serif text-lg font-semibold tracking-tight">
            Así lo ve quien toma la reserva
          </h2>
        </div>
        <div className="card-hairline rounded-2xl border border-border/70 bg-card/40 p-4">
          <CakeOptionPicker
            options={previewOptions}
            value={previewOptions[0]?.id ?? null}
            onChange={() => {}}
            cakeCount={1}
          />
        </div>
      </section>
    </div>
  )
}
