'use client'

import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SheetClose } from '@/components/ui/sheet'
import { deleteZone, reorderZones, saveZone } from '@/lib/purchasing/catalog-actions'
import type { PurZone } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'
import { CatalogSheet, CatalogSheetBody, CatalogSheetFooter } from './catalog-sheet'
import { FIELD_INPUT, Field } from './form-bits'

/** Cuántos insumos hay en cada zona: los activos (se muestran) y todos (al borrar). */
export type ZoneItemCounts = Readonly<Record<string, { active: number; total: number }>>

type ZoneDraft = { id: string | null; name: string; area: string }

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`
}

/**
 * Las zonas del recorrido, en el orden en que la cocina las camina para contar: subir y bajar,
 * cambiar el nombre (y la planta), agregar y borrar. El orden se guarda solo, sin botón.
 */
export function ZonesSheet({
  tenantSlug,
  open,
  zones,
  counts,
  onClose,
}: {
  tenantSlug: string
  open: boolean
  zones: readonly PurZone[]
  counts: ZoneItemCounts
  onClose: () => void
}) {
  const router = useRouter()
  const uid = useId()
  // El orden que se ve mientras se guarda (no espera al servidor). `null` = el de la base.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<ZoneDraft | null>(null)
  const [editingBase, setEditingBase] = useState<ZoneDraft | null>(null)
  const [toDelete, setToDelete] = useState<PurZone | null>(null)
  const [pending, startTransition] = useTransition()
  const [deleting, startDelete] = useTransition()
  // Mover varias veces seguidas: se guarda de a una vez y siempre el último orden.
  const savingOrder = useRef(false)
  const queuedOrder = useRef<string[] | null>(null)

  // Al abrir, sin formularios a medio llenar de la vez anterior.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setEditing(null)
      setEditingBase(null)
    }
  }

  const byId = new Map(zones.map((zone) => [zone.id, zone]))
  const ordered: PurZone[] = localOrder
    ? [
        ...localOrder.flatMap((id) => {
          const zone = byId.get(id)
          return zone ? [zone] : []
        }),
        ...zones.filter((zone) => !localOrder.includes(zone.id)),
      ]
    : [...zones]

  const flushOrder = async () => {
    if (savingOrder.current) return
    const ids = queuedOrder.current
    if (!ids) return
    queuedOrder.current = null
    savingOrder.current = true
    const result = await reorderZones({ slug: tenantSlug, ids })
    savingOrder.current = false
    if (!result.ok) {
      queuedOrder.current = null
      setLocalOrder(null)
      toast.error(result.message)
      return
    }
    if (queuedOrder.current) {
      void flushOrder()
      return
    }
    router.refresh()
  }

  const move = (index: number, delta: -1 | 1) => {
    const ids = ordered.map((zone) => zone.id)
    const to = index + delta
    const [moved] = ids.splice(index, 1)
    if (!moved || to < 0 || to > ids.length) return
    ids.splice(to, 0, moved)
    setLocalOrder(ids)
    queuedOrder.current = ids
    void flushOrder()
    // La fila se mueve en la lista: el foco la sigue (y si llegó a la punta, pasa al otro botón).
    requestAnimationFrame(() => {
      const edge = delta < 0 ? to === 0 : to === ids.length - 1
      const same = `${uid}-${moved}-${delta < 0 ? 'up' : 'down'}`
      const other = `${uid}-${moved}-${delta < 0 ? 'down' : 'up'}`
      document.getElementById(edge ? other : same)?.focus()
    })
  }

  const startEditing = (draft: ZoneDraft) => {
    setEditing(draft)
    setEditingBase(draft)
    requestAnimationFrame(() => document.getElementById(`${uid}-zone-name`)?.focus())
  }

  const dirty =
    editing !== null &&
    (editing.name !== (editingBase?.name ?? '') || editing.area !== (editingBase?.area ?? ''))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const name = editing.name.trim()
    if (!name) {
      document.getElementById(`${uid}-zone-name`)?.focus()
      toast.error('Poné el nombre de la zona.')
      return
    }
    const payload = {
      slug: tenantSlug,
      id: editing.id,
      name,
      area: editing.area.trim() || null,
    }
    startTransition(async () => {
      const result = await saveZone(payload)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        payload.id ? 'Guardamos la zona.' : `Agregamos «${name}» al final del recorrido.`,
      )
      setEditing(null)
      setEditingBase(null)
      router.refresh()
    })
  }

  const confirmDelete = () => {
    const zone = toDelete
    if (!zone) return
    startDelete(async () => {
      const result = await deleteZone({ slug: tenantSlug, id: zone.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`Borramos «${zone.name}».`)
      setToDelete(null)
      setEditing(null)
      setEditingBase(null)
      setLocalOrder((prev) => (prev ? prev.filter((id) => id !== zone.id) : prev))
      router.refresh()
    })
  }

  const form = (draft: ZoneDraft) => (
    <form onSubmit={submit} className="space-y-4 p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field id={`${uid}-zone-name`} label="Nombre">
          <Input
            id={`${uid}-zone-name`}
            value={draft.name}
            onChange={(e) => setEditing({ ...draft, name: e.target.value })}
            maxLength={60}
            autoComplete="off"
            placeholder="Ej.: Freezer"
            className={FIELD_INPUT}
          />
        </Field>
        <Field id={`${uid}-zone-area`} label="Planta" optional>
          <Input
            id={`${uid}-zone-area`}
            value={draft.area}
            onChange={(e) => setEditing({ ...draft, area: e.target.value })}
            maxLength={40}
            autoComplete="off"
            placeholder="Ej.: Planta alta"
            className={FIELD_INPUT}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} className="h-11 min-w-28 md:h-9">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {draft.id ? 'Guardar' : 'Agregar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setEditing(null)
            setEditingBase(null)
          }}
          className="h-11 md:h-9"
        >
          Cancelar
        </Button>
        {draft.id ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const zone = draft.id ? byId.get(draft.id) : undefined
              if (zone) setToDelete(zone)
            }}
            className="ml-auto h-11 text-destructive hover:text-destructive md:h-9"
          >
            <Trash2 className="size-4" aria-hidden />
            Borrar zona
          </Button>
        ) : null}
      </div>
    </form>
  )

  const deleteCount = toDelete ? (counts[toDelete.id]?.total ?? 0) : 0

  return (
    <>
      <CatalogSheet
        open={open}
        onClose={onClose}
        busy={pending}
        dirty={dirty}
        title="Zonas del recorrido"
        description="El orden en que la cocina camina el local para contar. Así aparecen los insumos en el conteo."
      >
        <CatalogSheetBody className="space-y-4">
          {ordered.length ? (
            <ol className="space-y-2">
              {ordered.map((zone, index) => {
                const count = counts[zone.id]?.active ?? 0
                const isEditing = editing?.id === zone.id
                return (
                  <li
                    key={zone.id}
                    className={cn(
                      'card-hairline rounded-xl border bg-card shadow-xs',
                      isEditing && 'ring-2 ring-ring/40',
                    )}
                  >
                    {isEditing && editing ? (
                      form(editing)
                    ) : (
                      <div className="flex items-center gap-1 py-1.5 pr-1.5 pl-3">
                        <span
                          aria-hidden
                          className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                        >
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            startEditing({ id: zone.id, name: zone.name, area: zone.area ?? '' })
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="sr-only">Editar </span>
                            <span className="block truncate font-medium">{zone.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {zone.area ? `${zone.area} · ` : ''}
                              {plural(count, 'insumo', 'insumos')}
                            </span>
                          </span>
                          <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                        <Button
                          id={`${uid}-${zone.id}-up`}
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          aria-label={`Subir ${zone.name}`}
                          className="size-11 md:size-9"
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button
                          id={`${uid}-${zone.id}-down`}
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={index === ordered.length - 1}
                          onClick={() => move(index, 1)}
                          aria-label={`Bajar ${zone.name}`}
                          className="size-11 md:size-9"
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-border/80 bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground text-pretty">
              Todavía no hay zonas. Agregá la primera, por ejemplo «Freezer», «Cámara» o «Almacén»,
              en el orden en que se recorren.
            </p>
          )}

          {editing && editing.id === null ? (
            <div className="card-hairline rounded-xl border bg-card shadow-xs ring-2 ring-ring/40">
              {form(editing)}
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => startEditing({ id: null, name: '', area: '' })}
              className="h-11 w-full md:h-10"
            >
              <Plus className="size-4" aria-hidden />
              Agregar zona
            </Button>
          )}
        </CatalogSheetBody>
        <CatalogSheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="outline" className="h-12 w-full sm:h-10 sm:w-auto">
              Listo
            </Button>
          </SheetClose>
        </CatalogSheetFooter>
      </CatalogSheet>

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) setToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrás «{toDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Los insumos de esta zona quedan sin zona
              {deleteCount ? ` (${plural(deleteCount, 'insumo', 'insumos')})` : ''}: la cocina los
              cuenta al final hasta que los muevas a otra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="h-11 sm:h-9">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                // Se cierra cuando la base confirma, no antes.
                event.preventDefault()
                confirmDelete()
              }}
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-9"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Borrar zona
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
