'use client'

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Minus,
  Plus,
  PowerOff,
  QrCode,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  mergeTablesAction,
  setElementShapeAction,
  setTableActiveAction,
  splitTableAction,
} from '@/lib/floor-plan/actions'
import { DEFAULT_SEATS, type ElementPatch } from '@/lib/floor-plan/model'
import type { ElementRow, FloorShape } from '@/lib/floor-plan/queries'
import { regenerateQrToken, updateTable } from '@/lib/tables/actions'
import { cn } from '@/lib/utils'
import { BanquetteGlyph, RoundTableGlyph, TableGlyph } from './glyphs'
import { PAPEL } from './papel'

export type TableInspectorProps = {
  slug: string
  element: ElementRow
  /** Las otras mesas dibujadas en la sucursal (para juntar). */
  others: { id: string; label: string }[]
  /** El bar tiene prendidos los QR de mesa. */
  qrEnabled: boolean
  /** Cambia al instante lo que se ve en el plano y en la maqueta. */
  onPatch: (elementId: string, patch: ElementPatch) => void
  /**
   * Mientras un cambio de nombre o lugares viaja al servidor, el editor lo
   * sostiene por encima de lo que llegue de un refresco (`null` = ya llegó).
   */
  onHold: (elementId: string, patch: ElementPatch | null) => void
  /** Guarda lo que haya pendiente de posición antes de hablar con el servidor. */
  flushGeometry: () => Promise<void>
  onRotate: () => void
  onDuplicate: () => void
  onFront: () => void
  onBack: () => void
  /** Quitar del plano (se puede deshacer). */
  onRemove: () => void
  /** Algo cambió en el servidor; `keepSelection` deja la mesa elegida. */
  onChanged: (keepSelection?: boolean) => void
  onClose: () => void
}

const SAVE_DELAY_MS = 450
const NO_STATE = { ok: false as const, message: '' }

const SHAPES: {
  value: FloorShape
  label: string
  Glyph: (props: { className?: string }) => React.ReactNode
}[] = [
  { value: 'rect', label: 'Recta', Glyph: TableGlyph },
  { value: 'circle', label: 'Redonda', Glyph: RoundTableGlyph },
  { value: 'banquette', label: 'Banquette', Glyph: BanquetteGlyph },
]

/**
 * La ficha de una mesa. Nombre, lugares y forma cambian al toque (se ven en el
 * plano y en la maqueta antes de que conteste el servidor); solo se confirma lo
 * que no tiene vuelta fácil.
 *
 * Se monta con `key` = id del elemento: otra mesa, otra ficha.
 */
export function TableInspector({
  slug,
  element,
  others,
  qrEnabled,
  onPatch,
  onHold,
  flushGeometry,
  onRotate,
  onDuplicate,
  onFront,
  onBack,
  onRemove,
  onChanged,
  onClose,
}: TableInspectorProps) {
  const id = useId()
  const tableId = element.physical_table_id as string
  const meta = element.table
  const [label, setLabel] = useState(meta?.label ?? '')
  const [capacity, setCapacity] = useState<number | null>(meta?.capacity ?? null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [pending, start] = useTransition()

  // Lo último que el servidor aceptó, lo que falta mandar y el reloj que lo manda.
  const saved = useRef({ label: meta?.label ?? '', capacity: meta?.capacity ?? null })
  const queued = useRef<{ label: string; capacity: number | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ slug, tableId, elementId: element.id, onPatch, onHold, flushGeometry })
  latest.current = { slug, tableId, elementId: element.id, onPatch, onHold, flushGeometry }
  const mounted = useRef(true)

  const send = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const next = queued.current
    if (!next) return
    queued.current = null
    const ctx = latest.current
    // La posición pendiente va primero: guardar la mesa refresca el plano desde
    // el servidor y pisaría un movimiento que todavía no se guardó.
    await ctx.flushGeometry()
    const form = new FormData()
    form.set('id', ctx.tableId)
    form.set('label', next.label)
    form.set('capacity', next.capacity === null ? '' : String(next.capacity))
    const result = await updateTable(ctx.slug, NO_STATE, form)
    if (result.ok) {
      saved.current = next
    } else {
      // No se guardó: el plano y la ficha vuelven a lo último que sí quedó.
      toast.error(result.message)
      ctx.onPatch(ctx.elementId, { table: saved.current })
      if (mounted.current && !queued.current) {
        setLabel(saved.current.label)
        setCapacity(saved.current.capacity)
      }
    }
    // Si mientras tanto llegó otro cambio, sigue en espera; si no, se suelta.
    if (!queued.current) ctx.onHold(ctx.elementId, null)
  }, [])

  const queue = useCallback(
    (next: { label: string; capacity: number | null }, delay: number) => {
      queued.current = next
      const ctx = latest.current
      ctx.onPatch(ctx.elementId, { table: next })
      ctx.onHold(ctx.elementId, { table: next })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void send()
      }, delay)
    },
    [send],
  )

  // Si la ficha se cierra con algo sin mandar, se manda igual.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (queued.current) void send()
    }
  }, [send])

  const shown = capacity ?? DEFAULT_SEATS
  const setSeats = (next: number) => {
    const clean = Math.max(1, Math.min(50, next))
    setCapacity(clean)
    queue({ label: queued.current?.label ?? saved.current.label, capacity: clean }, SAVE_DELAY_MS)
  }

  const commitLabel = () => {
    const clean = label.trim()
    const current = queued.current?.label ?? saved.current.label
    if (!clean) {
      setLabel(current)
      return
    }
    if (clean === current) return
    setLabel(clean)
    queue({ label: clean, capacity: queued.current?.capacity ?? saved.current.capacity }, 0)
  }

  const setShape = (shape: FloorShape) => {
    if (shape === element.shape) return
    const previous = element.shape
    onPatch(element.id, { shape })
    start(async () => {
      await flushGeometry()
      const r = await setElementShapeAction(slug, element.id, shape)
      if (!r.ok) {
        onPatch(element.id, { shape: previous })
        toast.error(r.message)
      }
    })
  }

  const regenerate = () => {
    start(async () => {
      const r = await regenerateQrToken(slug, tableId)
      if (r.ok) {
        toast.success('QR nuevo listo. Imprimilo y cambiá el de la mesa.')
        onChanged(true)
      } else {
        toast.error(r.message)
      }
    })
  }

  const split = () => {
    start(async () => {
      const r = await splitTableAction(slug, element.id)
      if (r.ok) {
        toast.success('Listo: hay una mesa nueva al lado.')
        onChanged(true)
      } else {
        toast.error(r.message)
      }
    })
  }

  const merge = () => {
    if (!mergeTarget) return
    start(async () => {
      const r = await mergeTablesAction(slug, tableId, mergeTarget)
      if (r.ok) {
        toast.success('Mesas juntadas.')
        setMergeTarget('')
        onChanged(true)
      } else {
        toast.error(r.message)
      }
    })
  }

  const deactivate = () => {
    start(async () => {
      const r = await setTableActiveAction(slug, tableId, false)
      if (r.ok) {
        toast.success(`Mesa ${saved.current.label} desactivada. La reactivás desde Lista.`)
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const printQr = () => {
    const token = meta?.qr_token
    if (!token) return
    window.open(`/print/qr/${encodeURIComponent(token)}`, '_blank', 'width=600,height=800')
  }

  const mergeLabel = others.find((t) => t.id === mergeTarget)?.label ?? ''
  const shownLabel = label.trim() || saved.current.label
  const tableName = `Mesa ${shownLabel}`
  // En medio de una frase: «la mesa 12» (sin tocar las mayúsculas de un nombre).
  const theTable = `mesa ${shownLabel}`

  return (
    <>
      <div className="fpe-side-head">
        <h2 className="fpe-side-title">{tableName}</h2>
        <button
          type="button"
          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
          onClick={onClose}
          aria-label="Cerrar la ficha de la mesa"
          title="Cerrar (Esc)"
        >
          <X aria-hidden />
        </button>
      </div>

      <div className="fpe-side-body">
        <div className="fpe-group">
          <div className="fpe-field">
            <label className="fpe-label" htmlFor={`${id}-label`}>
              Número o nombre
            </label>
            <input
              id={`${id}-label`}
              className="fpe-input"
              value={label}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </div>
          <div className="fpe-field">
            <span className="fpe-label" id={`${id}-seats`}>
              Lugares
            </span>
            {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
            <div className="fpe-stepper" role="group" aria-labelledby={`${id}-seats`}>
              <button
                type="button"
                aria-label="Un lugar menos"
                disabled={shown <= 1}
                onClick={() => setSeats(shown - 1)}
              >
                <Minus aria-hidden />
              </button>
              <output aria-live="polite" aria-label={`${shown} lugares`}>
                {shown}
              </output>
              <button
                type="button"
                aria-label="Un lugar más"
                disabled={shown >= 50}
                onClick={() => setSeats(shown + 1)}
              >
                <Plus aria-hidden />
              </button>
              <span className="fpe-stepper-unit">{shown === 1 ? 'persona' : 'personas'}</span>
            </div>
            {capacity === null ? (
              <p className="fpe-hint">Todavía sin cargar: el salón la dibuja de {DEFAULT_SEATS}.</p>
            ) : null}
          </div>
        </div>

        <div className="fpe-group">
          <h3 className="fpe-group-title" id={`${id}-shape`}>
            Forma
          </h3>
          {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
          <div className="fpe-shapes" role="group" aria-labelledby={`${id}-shape`}>
            {SHAPES.map(({ value, label: shapeLabel, Glyph }) => (
              <button
                key={value}
                type="button"
                className="fpe-shape"
                aria-pressed={element.shape === value}
                onClick={() => setShape(value)}
              >
                <Glyph />
                {shapeLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="fpe-group">
          <h3 className="fpe-group-title">Acomodar</h3>
          <div className="fpe-grid-2">
            <button type="button" className="fpe-btn fpe-btn-quiet fpe-btn-sm" onClick={onRotate}>
              <RotateCw aria-hidden />
              Girar
            </button>
            <button
              type="button"
              className="fpe-btn fpe-btn-quiet fpe-btn-sm"
              onClick={onDuplicate}
            >
              <Copy aria-hidden />
              Duplicar
            </button>
            <button type="button" className="fpe-btn fpe-btn-quiet fpe-btn-sm" onClick={onFront}>
              <ArrowUpToLine aria-hidden />
              Al frente
            </button>
            <button type="button" className="fpe-btn fpe-btn-quiet fpe-btn-sm" onClick={onBack}>
              <ArrowDownToLine aria-hidden />
              Al fondo
            </button>
          </div>
        </div>

        {qrEnabled && meta?.qr_token ? (
          <div className="fpe-group">
            <h3 className="fpe-group-title">QR de la mesa</h3>
            <code className="fpe-code" title={meta.qr_token}>
              {meta.qr_token}
            </code>
            <div className="fpe-grid-2">
              <button type="button" className="fpe-btn fpe-btn-quiet fpe-btn-sm" onClick={printQr}>
                <QrCode aria-hidden />
                Imprimir QR
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="fpe-btn fpe-btn-quiet fpe-btn-sm"
                    disabled={pending}
                  >
                    <RefreshCw aria-hidden />
                    Cambiar QR
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className={cn(PAPEL, 'fpe-dialog')}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Cambiar el QR de la {theTable}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      El QR que está pegado en la mesa deja de funcionar. Vas a tener que imprimir
                      el nuevo y cambiarlo.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="fpe-btn fpe-btn-quiet">Dejarlo</AlertDialogCancel>
                    <AlertDialogAction className="fpe-btn fpe-btn-primary" onClick={regenerate}>
                      Cambiar el QR
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : null}

        <div className="fpe-group">
          <h3 className="fpe-group-title">Juntar y dividir</h3>
          <button
            type="button"
            className="fpe-btn fpe-btn-quiet fpe-btn-sm"
            disabled={pending}
            onClick={split}
          >
            <Copy aria-hidden />
            Dividir: sumar otra al lado
          </button>
          {others.length > 0 ? (
            <div className="fpe-row">
              <div className="fpe-field" style={{ flex: 1 }}>
                <label className="fpe-sr" htmlFor={`${id}-merge`}>
                  Juntar con otra mesa
                </label>
                <select
                  id={`${id}-merge`}
                  className="fpe-input"
                  value={mergeTarget}
                  disabled={pending}
                  onChange={(e) => setMergeTarget(e.target.value)}
                >
                  <option value="">Juntar con…</option>
                  {others.map((t) => (
                    <option key={t.id} value={t.id}>
                      Mesa {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="fpe-btn fpe-btn-quiet"
                    disabled={pending || !mergeTarget}
                  >
                    Juntar
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className={cn(PAPEL, 'fpe-dialog')}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Juntar la mesa {mergeLabel} con la {theTable}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      La {theTable} se queda y absorbe a la otra: la mesa {mergeLabel} sale del
                      plano y queda desactivada. No pierde su historial y la podés reactivar desde
                      Lista.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="fpe-btn fpe-btn-quiet">
                      Dejarlas
                    </AlertDialogCancel>
                    <AlertDialogAction className="fpe-btn fpe-btn-primary" onClick={merge}>
                      Juntar las mesas
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </div>

        <div className="fpe-group">
          <div className="fpe-grid-2">
            <button
              type="button"
              className="fpe-btn fpe-btn-danger fpe-btn-sm"
              onClick={onRemove}
              title="Vuelve a «Mesas sin ubicar» (Supr)"
            >
              <Trash2 aria-hidden />
              Quitar
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="fpe-btn fpe-btn-danger fpe-btn-sm"
                  disabled={pending}
                >
                  <PowerOff aria-hidden />
                  Desactivar
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className={cn(PAPEL, 'fpe-dialog')}>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Desactivar la {theTable}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Sale del plano y el salón deja de verla. No se puede si está abierta. No pierde
                    su historial y la reactivás cuando quieras desde Lista.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="fpe-btn fpe-btn-quiet">Dejarla</AlertDialogCancel>
                  <AlertDialogAction className="fpe-btn fpe-btn-danger-solid" onClick={deactivate}>
                    Desactivar la mesa
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <p className="fpe-hint">
            «Quitar» la saca del plano y la deja en «Mesas sin ubicar». «Desactivar» la saca de uso.
          </p>
        </div>
      </div>
    </>
  )
}
