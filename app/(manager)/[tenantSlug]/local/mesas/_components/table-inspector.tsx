'use client'

import { ArrowDownToLine, ArrowUpToLine, Combine, RefreshCw, Split, Trash2, X } from 'lucide-react'
import { useActionState, useEffect, useEffectEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Separator } from '@/components/ui/separator'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import {
  mergeTablesAction,
  removeFromPlanAction,
  setElementShapeAction,
  setElementZIndexAction,
  setTableActiveAction,
  splitTableAction,
} from '@/lib/floor-plan/actions'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { regenerateQrToken, updateTable } from '@/lib/tables/actions'
import { PrintQrButton } from './print-qr-button'
import { type TableShape, TableShapeChips } from './table-shape-chips'

type TableInspectorProps = {
  slug: string
  element: ElementRow
  allTables: { id: string; label: string }[]
  onChanged: () => void
  onClose: () => void
}

const initialUpdate = { ok: false as const, message: '' }

const SHAPES: { value: TableShape; label: string }[] = [
  { value: 'circle', label: 'Redonda' },
  { value: 'rect', label: 'Rectangular' },
  { value: 'banquette', label: 'Banquette' },
]

/**
 * Panel de la mesa elegida en el plano. El editor lo monta con `key` por
 * elemento: al elegir otra mesa arranca de cero (campos, interruptor y
 * respuesta del guardado).
 */
export function TableInspector({
  slug,
  element,
  allTables,
  onChanged,
  onClose,
}: TableInspectorProps) {
  const titleId = useId()
  const tableId = element.physical_table_id as string
  const meta = element.table
  const tableLabel = meta?.label ?? element.label ?? ''
  const [active, setActive] = useState(meta?.active ?? true)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Editar nombre/capacidad → updateTable (FormData id,label,capacity; NUNCA active).
  const [updateState, updateAction] = useActionState(
    (prev: Awaited<ReturnType<typeof updateTable>>, fd: FormData) => updateTable(slug, prev, fd),
    initialUpdate,
  )

  // Una vez por respuesta del server: `onChanged` cambia de identidad con cada
  // render del editor y, en las dependencias, repetía el aviso de error.
  const onUpdateResult = useEffectEvent((result: typeof updateState) => {
    if (result.ok && result.tableId) {
      toast.success('Mesa actualizada.')
      onChanged()
    } else if (!result.ok && result.message && !result.fieldErrors) {
      // Los errores de un campo se ven al lado del campo; el resto, en un aviso.
      toast.error(result.message)
    }
  })
  useEffect(() => {
    onUpdateResult(updateState)
  }, [updateState])
  const fieldErrors = updateState.ok ? undefined : updateState.fieldErrors

  // Sincroniza el switch local si cambia la mesa seleccionada.
  useEffect(() => {
    setActive(meta?.active ?? true)
  }, [meta?.active])

  const onToggleActive = (next: boolean) => {
    const prev = active
    setActive(next)
    start(async () => {
      const r = await setTableActiveAction(slug, tableId, next)
      if (r.ok) {
        toast.success(next ? 'Mesa activada.' : 'Mesa desactivada.')
        onChanged()
      } else {
        setActive(prev)
        toast.error(r.message)
      }
    })
  }

  // Confirmaciones: esperan con el diálogo abierto y, si fallan, muestran el error adentro.
  const onRegenerate = async (): Promise<ConfirmResult> => {
    const r = await regenerateQrToken(slug, tableId)
    if (!r.ok) return { ok: false, error: r.message }
    toast.success('QR regenerado.')
    onChanged()
  }

  const onMerge = async (): Promise<ConfirmResult> => {
    if (!mergeTarget) return
    const r = await mergeTablesAction(slug, tableId, mergeTarget)
    if (!r.ok) return { ok: false, error: r.message }
    toast.success('Mesas combinadas.')
    // `onChanged` suelta la selección y este panel se desmonta: no hace falta limpiar la elegida.
    onChanged()
  }

  const onRemove = async (): Promise<ConfirmResult> => {
    const r = await removeFromPlanAction(slug, element.id)
    if (!r.ok) return { ok: false, error: r.message }
    toast.success('Mesa quitada del plano.')
    onChanged()
  }

  const onSplit = () => {
    start(async () => {
      const r = await splitTableAction(slug, element.id)
      if (r.ok) {
        toast.success('Mesa dividida.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onZIndex = (zIndex: number) => {
    start(async () => {
      const r = await setElementZIndexAction(slug, element.id, zIndex)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const onSetShape = (shape: TableShape) => {
    if (shape === element.shape) return
    start(async () => {
      const r = await setElementShapeAction(slug, element.id, shape)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const mergeOptions = allTables
    .filter((t) => t.id !== tableId)
    .map((t) => ({ value: t.id, label: t.label }))
  const mergeLabel = mergeOptions.find((o) => o.value === mergeTarget)?.label ?? ''

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="min-w-0 truncate type-subtitle text-foreground">
          Mesa {tableLabel}
        </h2>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Cerrar el panel de la mesa"
          className="-my-1"
        >
          <X aria-hidden />
        </Button>
      </div>

      {/* Nombre y capacidad → updateTable (FormData id, label, capacity). */}
      <form action={updateAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={tableId} />
        <Field label="Nombre" name="label" required error={fieldErrors?.label}>
          <Input maxLength={40} defaultValue={meta?.label ?? ''} autoComplete="off" />
        </Field>
        <Field label="Personas" name="capacity" optional error={fieldErrors?.capacity}>
          <NumberField
            min={1}
            max={50}
            defaultValue={meta?.capacity ?? null}
            placeholder="Sin definir"
          />
        </Field>
        <SubmitButton size="sm" pendingText="Guardando…" disabled={pending}>
          Guardar
        </SubmitButton>
      </form>

      <Separator />

      {/* Las sillas se redibujan según forma + capacidad. */}
      <TableShapeChips
        legend="Forma"
        options={SHAPES}
        value={element.shape}
        onValueChange={onSetShape}
        disabled={pending}
      />

      <Separator />

      <div className="flex flex-col gap-2">
        <span className="type-label text-foreground">Código QR</span>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono type-caption text-muted-foreground">
            {meta?.qr_token}
          </code>
          <PrintQrButton qrToken={meta?.qr_token ?? ''} tableLabel={tableLabel} />
        </div>
        <ConfirmDialog
          tone="danger"
          icon={RefreshCw}
          title={`¿Regenerar el QR de «${tableLabel}»?`}
          description="El QR impreso deja de funcionar. Vas a tener que imprimir el nuevo y pegarlo en la mesa."
          confirmLabel="Regenerar QR"
          pendingLabel="Regenerando…"
          onConfirm={onRegenerate}
          trigger={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              className="self-start"
            >
              <RefreshCw aria-hidden />
              Regenerar QR
            </Button>
          }
        />
      </div>

      <Separator />

      {/* Activar / desactivar (RPC-only, NUNCA updateTable). */}
      <Field
        layout="toggle"
        label="Mesa activa"
        hint="Apagala si ya no se usa: no se borra y conserva su historial."
      >
        <Switch checked={active} onCheckedChange={onToggleActive} disabled={pending} />
      </Field>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Button type="button" size="sm" variant="secondary" onClick={onSplit} disabled={pending}>
            <Split aria-hidden />
            Dividir
          </Button>
          <p className="type-caption text-pretty text-subtle-foreground">
            Suma una mesa igual al lado, con su propio QR.
          </p>
        </div>

        {mergeOptions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Field
              label="Combinar con"
              hint="La mesa que elijas se suma a esta y su QR se desactiva. El historial no se pierde."
            >
              <Combobox
                options={mergeOptions}
                value={mergeTarget}
                onValueChange={(value) => setMergeTarget(typeof value === 'string' ? value : null)}
                placeholder="Elegí una mesa…"
                searchPlaceholder="Buscar mesa…"
                emptyText="No hay otra mesa con ese nombre"
                disabled={pending}
              />
            </Field>
            <ConfirmDialog
              tone="danger"
              icon={Combine}
              title={`¿Combinar «${mergeLabel}» con «${tableLabel}»?`}
              description={`La mesa «${tableLabel}» absorbe a «${mergeLabel}». El QR de «${mergeLabel}» se desactiva y el historial no se pierde. No se puede deshacer.`}
              confirmLabel="Combinar mesas"
              pendingLabel="Combinando…"
              onConfirm={onMerge}
              trigger={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending || !mergeTarget}
                >
                  <Combine aria-hidden />
                  Combinar
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index + 1)}
          disabled={pending}
        >
          <ArrowUpToLine aria-hidden />
          Al frente
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index - 1)}
          disabled={pending}
        >
          <ArrowDownToLine aria-hidden />
          Al fondo
        </Button>
      </div>

      <Separator />

      {/* Quitar del plano: la mesa sigue activa y vuelve a la bandeja. */}
      <ConfirmDialog
        icon={Trash2}
        title={`¿Quitar la mesa «${tableLabel}» del plano?`}
        description="Sigue activa, con su QR, y la podés volver a colocar desde «Mesas sin ubicar». Si está ocupada en este momento, no se puede quitar."
        confirmLabel="Quitar del plano"
        pendingLabel="Quitando…"
        onConfirm={onRemove}
        trigger={
          <Button type="button" size="sm" variant="danger-ghost" disabled={pending}>
            <Trash2 aria-hidden />
            Quitar del plano
          </Button>
        }
      />
    </section>
  )
}
