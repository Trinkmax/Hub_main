'use client'

import {
  Activity,
  ArrowRightLeft,
  Keyboard,
  List,
  PencilRuler,
  QrCode,
  Redo2,
  Undo2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { toast } from 'sonner'
import { LiveFloor } from '@/components/floor-plan/live-floor'
import { MoveTableSheet } from '@/components/floor-plan/move-table-sheet'
import {
  PanZoomStage,
  readStageTransform,
  stagePointFromClient,
} from '@/components/floor-plan/pan-zoom-stage'
import { LIVE_SIGNAL, liveSignals } from '@/components/floor-plan/status-meta'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { InfoTip } from '@/components/ui/info-tip'
import { KPI } from '@/components/ui/kpi'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { StatusBadge } from '@/components/ui/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  addDecorAction,
  createTableInPlanAction,
  deleteDecorAction,
  deleteTablePermanentlyAction,
  duplicateElementAction,
  placeTableAction,
  removeFromPlanAction,
} from '@/lib/floor-plan/actions'
import {
  clampToArea,
  clampToAreaRotated,
  ELEMENT_DEFAULTS,
  GRID,
  normalizeRotation,
  snapToGrid,
} from '@/lib/floor-plan/grid'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'
import type {
  AreaRow,
  ElementRow,
  FloorPlanData,
  LiveFloorData,
  LiveTable,
} from '@/lib/floor-plan/queries'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'
import { type AlignKind, alignBoxes, type Guide } from '@/lib/floor-plan/snap'
import { elapsedLabel } from '@/lib/salon/format'
import { AreaManager } from './area-manager'
import { BulkCreateDialog } from './bulk-create-dialog'
import { ContextualToolbar } from './contextual-toolbar'
import { DecorInspector } from './decor-inspector'
import { KIND_WITH_ARTICLE } from './element-labels'
import { ElementPalette } from './element-palette'
import { FloorElement } from './floor-element'
import { FLOOR_VIEW_PARAM, type FloorView, isFloorView } from './floor-view'
import { TableInspector } from './table-inspector'
import { TablesListFallback } from './tables-list-fallback'
import { UnplacedTray } from './unplaced-tray'
import { useGeometryQueue } from './use-geometry-queue'
import { usePaletteDrag } from './use-palette-drag'

export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  initial: FloorPlanData
  liveAreas: AreaRow[]
  initialLive: LiveFloorData | null
  /** La pestaña con la que abre (`?vista=`): la lee la página en el server. */
  initialView?: FloorView
}

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage'

/**
 * Teclas que ya maneja el control enfocado (pestañas, segmentados, menús,
 * comboboxes) o que caen adentro de un diálogo: los atajos del lienzo no las
 * toman, así una flecha en las pestañas no mueve también la mesa elegida.
 */
const KEY_OWNER_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="tablist"], [role="radiogroup"], [role="listbox"], [role="menu"], [role="combobox"]'

/** Qué dice la confirmación de «Quitar» según lo elegido: mesas vuelven a la bandeja, la decoración se borra. */
function deleteCopy(els: ElementRow[]): {
  title: string
  description: string
  confirmLabel: string
  tone: 'default' | 'danger'
} {
  const tables = els.filter((e) => e.kind === 'table').length
  const decor = els.length - tables
  const only = els.length === 1 ? els[0] : undefined
  if (only) {
    if (only.kind === 'table') {
      const label = only.table?.label ?? only.label ?? ''
      return {
        title: `¿Quitar la mesa «${label}» del plano?`,
        description:
          'Vuelve a «Mesas sin ubicar» y conserva su QR. La podés volver a colocar cuando quieras.',
        confirmLabel: 'Quitar del plano',
        tone: 'default',
      }
    }
    return {
      title: `¿Borrar ${KIND_WITH_ARTICLE[only.kind]}${only.label ? ` «${only.label}»` : ''}?`,
      description: 'Se borra del plano. No se puede deshacer.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    }
  }
  if (decor === 0) {
    return {
      title: `¿Quitar ${tables} mesas del plano?`,
      description: 'Vuelven a «Mesas sin ubicar» y conservan su QR.',
      confirmLabel: 'Quitar del plano',
      tone: 'default',
    }
  }
  if (tables === 0) {
    return {
      title: `¿Borrar ${decor} elementos de decoración?`,
      description: 'Se borran del plano. No se puede deshacer.',
      confirmLabel: 'Borrar',
      tone: 'danger',
    }
  }
  return {
    title: `¿Quitar ${els.length} elementos del plano?`,
    description: `${tables === 1 ? 'La mesa vuelve' : `Las ${tables} mesas vuelven`} a «Mesas sin ubicar» con su QR. ${
      decor === 1 ? 'La decoración se borra' : `Los ${decor} elementos de decoración se borran`
    } y no se puede deshacer.`,
    confirmLabel: 'Quitar y borrar',
    tone: 'danger',
  }
}

const FIT_TARGET_ID = 'fp-fit-target'

// Geometría sin id (para snapshots de undo/redo).
type GeomFields = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  corner_radius: number
  z_index: number
}
type GeomChange = { id: string; prev: GeomFields; next: GeomFields }

// Líneas guía de alineación (se dibujan en coords lógicas dentro del stage).
function SnapGuides({ guides }: { guides: Guide[] }) {
  if (guides.length === 0) return null
  return (
    <>
      {guides.map((g, i) =>
        g.axis === 'v' ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: guías efímeras por gesto
            key={i}
            aria-hidden
            className="pointer-events-none absolute bg-primary/70"
            style={{ left: g.pos, top: g.from, width: 1, height: g.to - g.from }}
          />
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: guías efímeras por gesto
            key={i}
            aria-hidden
            className="pointer-events-none absolute bg-primary/70"
            style={{ top: g.pos, left: g.from, height: 1, width: g.to - g.from }}
          />
        ),
      )}
    </>
  )
}

export function FloorPlanEditor({
  slug,
  tenantId,
  initial,
  liveAreas,
  initialLive,
  initialView = 'editar',
}: FloorPlanEditorProps) {
  const router = useRouter()

  const areas = initial.areas
  const unplaced = initial.unplacedTables

  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  // Pestaña activa (Editar plano · En vivo · Lista). La URL la lleva `Tabs syncParam`.
  const [view, setView] = useState<FloorView>(initialView)

  // Selección múltiple. El ref es la fuente de verdad sincrónica (gestos),
  // el estado es el espejo para render.
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const [selectedIds, setSelectedIdsState] = useState<Set<string>>(new Set())
  const selectSet = useCallback((s: Set<string>) => {
    selectedIdsRef.current = s
    setSelectedIdsState(s)
  }, [])
  const clearSelection = useCallback(() => selectSet(new Set()), [selectSet])
  const onSelect = useCallback(
    (id: string, additive: boolean) => {
      if (additive) {
        const s = new Set(selectedIdsRef.current)
        if (s.has(id)) s.delete(id)
        else s.add(id)
        selectSet(s)
      } else {
        selectSet(new Set([id]))
      }
    },
    [selectSet],
  )

  // Guías de alineación vivas.
  const [guides, setGuides] = useState<Guide[]>([])

  // Confirmación de «Quitar»: lo elegido se guarda al abrir, así el texto del
  // diálogo no cambia mientras se cierra.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState<ElementRow[]>([])

  const [liveDetail, setLiveDetail] = useState<LiveTable | null>(null)
  const [showMoveLive, setShowMoveLive] = useState(false)
  const onLiveTableOpen = useCallback((table: LiveTable) => setLiveDetail(table), [])

  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Nodos DOM de cada FloorElement (para mover los pares durante el group-drag).
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const registerNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodesRef.current.set(id, node)
    else nodesRef.current.delete(id)
  }, [])

  const draggingRef = useRef(false)

  // Re-sync de elements cuando cambian los datos del server.
  const initialSig = useMemo(
    () =>
      initial.elements
        .map(
          (e) =>
            `${e.id}:${e.x}:${e.y}:${e.width}:${e.height}:${e.rotation}:${e.corner_radius}:${e.z_index}:${e.label}:${e.color}:${e.table ? `${e.table.active}:${e.table.label}:${e.table.capacity}` : ''}`,
        )
        .join('|'),
    [initial],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync solo cuando cambian los datos del server (initialSig)
  useEffect(() => {
    if (draggingRef.current) return
    setElements(initial.elements)
  }, [initialSig])

  useEffect(() => {
    const first = areas[0]
    if (!first) return
    if (!areas.find((a) => a.id === activeAreaId)) setActiveAreaId(first.id)
  }, [areas, activeAreaId])

  const prevGeomRef = useRef<Map<string, ElementGeometry>>(new Map())

  // Undo/redo de geometría: cada transacción agrupa N cambios en un paso.
  const txnRef = useRef<GeomChange[] | null>(null)
  const undoStackRef = useRef<GeomChange[][]>([])
  const redoStackRef = useRef<GeomChange[][]>([])
  // Fuerza re-render para refrescar el habilitado de los botones deshacer/rehacer
  // (las pilas son refs; este tick re-evalúa canUndo/canRedo).
  const [, setHistoryTick] = useState(0)
  const bumpHistory = useCallback(() => setHistoryTick((v) => v + 1), [])

  const onQueueError = useCallback((ids: string[]) => {
    setElements((current) => {
      const snap = prevGeomRef.current
      return current.map((el) => {
        const prev = snap.get(el.id)
        if (!prev || !ids.includes(el.id)) return el
        return {
          ...el,
          x: prev.x,
          y: prev.y,
          width: prev.width,
          height: prev.height,
          rotation: prev.rotation,
          corner_radius: prev.corner_radius,
          z_index: prev.z_index,
        }
      })
    })
    toast.error('No se pudo guardar la posición. Revertimos el cambio; reintentá.')
  }, [])

  // Tras un flush exitoso, el baseline de rollback pasa a ser lo persistido (si no,
  // un fallo posterior revertiría al estado del inicio de la sesión).
  const onQueueSuccess = useCallback((items: ElementGeometry[]) => {
    for (const it of items) {
      prevGeomRef.current.set(it.id, it)
    }
  }, [])

  const queue = useGeometryQueue(slug, onQueueError, onQueueSuccess)

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null
  const areaElements = useMemo(
    () => (activeArea ? elements.filter((el) => el.area_id === activeArea.id) : []),
    [elements, activeArea],
  )

  // Refs vivos para closures estables (gestos / teclado).
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const areaElementsRef = useRef(areaElements)
  areaElementsRef.current = areaElements
  const activeAreaRef = useRef(activeArea)
  activeAreaRef.current = activeArea

  const askDelete = useCallback(() => {
    const els = [...selectedIdsRef.current]
      .map((id) => elementsRef.current.find((e) => e.id === id))
      .filter((e): e is ElementRow => !!e)
    if (els.length === 0) return
    setDeleteTargets(els)
    setDeleteOpen(true)
  }, [])

  const onChanged = useCallback(() => {
    clearSelection()
    // Flush de geometría pendiente ANTES de re-sembrar el RSC, así un move
    // optimista sin flushear no se pierde al refrescar tras una op estructural.
    void queue.flushNow().finally(() => router.refresh())
  }, [router, clearSelection, queue])

  const commitGeometry = useCallback(
    (
      el: ElementRow,
      next: {
        x: number
        y: number
        width: number
        height: number
        rotation: number
        corner_radius: number
        z_index: number
      },
    ) => {
      if (!prevGeomRef.current.has(el.id)) {
        prevGeomRef.current.set(el.id, {
          id: el.id,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          rotation: el.rotation,
          corner_radius: el.corner_radius,
          z_index: el.z_index,
        })
      }
      // Registrar en la transacción de undo activa (si la hay).
      if (txnRef.current) {
        txnRef.current.push({
          id: el.id,
          prev: {
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            rotation: el.rotation,
            corner_radius: el.corner_radius,
            z_index: el.z_index,
          },
          next,
        })
      }
      setElements((current) => current.map((e) => (e.id === el.id ? { ...e, ...next } : e)))
      queue.enqueue({ id: el.id, ...next })
    },
    [queue],
  )

  // Agrupa los commits de una operación en una sola entrada de undo (re-entrante:
  // si ya hay una transacción abierta, no anida).
  const runOp = useCallback(
    (fn: () => void) => {
      if (txnRef.current) {
        fn()
        return
      }
      txnRef.current = []
      try {
        fn()
      } finally {
        const buf = txnRef.current
        txnRef.current = null
        if (buf && buf.length > 0) {
          undoStackRef.current.push(buf)
          if (undoStackRef.current.length > 80) undoStackRef.current.shift()
          redoStackRef.current = []
          bumpHistory()
        }
      }
    },
    [bumpHistory],
  )

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    for (const ch of entry) {
      const el = elementsRef.current.find((e) => e.id === ch.id)
      if (el) commitGeometry(el, ch.prev)
    }
    redoStackRef.current.push(entry)
    bumpHistory()
  }, [commitGeometry, bumpHistory])

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop()
    if (!entry) return
    for (const ch of entry) {
      const el = elementsRef.current.find((e) => e.id === ch.id)
      if (el) commitGeometry(el, ch.next)
    }
    undoStackRef.current.push(entry)
    bumpHistory()
  }, [commitGeometry, bumpHistory])

  const geomOf = useCallback(
    (el: ElementRow) => ({
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation,
      corner_radius: el.corner_radius,
      z_index: el.z_index,
    }),
    [],
  )

  // Aplica un delta lógico (dx,dy) a un conjunto de ids, clampeando cada uno.
  const applyDelta = useCallback(
    (ids: string[], dx: number, dy: number) => {
      runOp(() => {
        const area = activeAreaRef.current
        if (!area) return
        for (const id of ids) {
          const el = elementsRef.current.find((e) => e.id === id)
          if (!el) continue
          const c = clampToAreaRotated(
            el.x + dx,
            el.y + dy,
            el.width,
            el.height,
            el.rotation,
            area.width,
            area.height,
          )
          if (c.x === el.x && c.y === el.y) continue
          commitGeometry(el, { ...geomOf(el), x: c.x, y: c.y })
        }
      })
    },
    [runOp, commitGeometry, geomOf],
  )

  // Cajas de los hermanos (para snap-a-objeto), excluyendo el propio id.
  const getSiblings = useCallback(
    (id: string) =>
      areaElementsRef.current
        .filter((e) => e.id !== id)
        .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })),
    [],
  )

  // Drag start: si el elemento no está seleccionado, pasa a ser la selección única.
  const onDragStart = useCallback(
    (id: string) => {
      draggingRef.current = true
      if (!selectedIdsRef.current.has(id)) selectSet(new Set([id]))
    },
    [selectSet],
  )
  const onDragEnd = useCallback(() => {
    draggingRef.current = false
  }, [])

  // Move vivo: mueve los pares seleccionados (group-drag) imperativamente.
  const onMoveLive = useCallback((id: string, dx: number, dy: number) => {
    const sel = selectedIdsRef.current
    if (!sel.has(id) || sel.size <= 1) return
    for (const pid of sel) {
      if (pid === id) continue
      const node = nodesRef.current.get(pid)
      if (node) node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    }
  }, [])

  // Commit del move: aplica el delta al grupo (o al único) + limpia transforms de pares.
  const onMoveEnd = useCallback(
    (id: string, dx: number, dy: number) => {
      const sel = selectedIdsRef.current
      const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id]
      applyDelta(ids, dx, dy)
      // Limpiar transforms imperativos de los pares tras el commit de React.
      requestAnimationFrame(() => {
        for (const pid of ids) {
          if (pid === id) continue
          const node = nodesRef.current.get(pid)
          if (node) node.style.transform = ''
        }
      })
    },
    [applyDelta],
  )

  const handleResizeEnd = useCallback(
    (id: string, size: { width: number; height: number }) => {
      runOp(() => {
        const area = activeAreaRef.current
        if (!area) return
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el) return
        const width = snapToGrid(size.width)
        const height = snapToGrid(size.height)
        const clamped = clampToAreaRotated(
          el.x,
          el.y,
          width,
          height,
          el.rotation,
          area.width,
          area.height,
        )
        commitGeometry(el, { ...geomOf(el), x: clamped.x, y: clamped.y, width, height })
      })
    },
    [runOp, commitGeometry, geomOf],
  )

  const handleRotateEnd = useCallback(
    (id: string, rotation: number) => {
      runOp(() => {
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el || el.rotation === rotation) return
        commitGeometry(el, { ...geomOf(el), rotation })
      })
    },
    [runOp, commitGeometry, geomOf],
  )

  // ── Acciones de la barra contextual / teclado ──────────────────────────────

  const rotate90 = useCallback(() => {
    runOp(() => {
      for (const id of selectedIdsRef.current) {
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el) continue
        commitGeometry(el, { ...geomOf(el), rotation: normalizeRotation(el.rotation + 90) })
      }
    })
  }, [runOp, commitGeometry, geomOf])

  const bringTo = useCallback(
    (dir: 'front' | 'back') => {
      runOp(() => {
        const ids = [...selectedIdsRef.current]
        if (ids.length === 0) return
        const zs = areaElementsRef.current.map((e) => e.z_index)
        const base = dir === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1
        ids.forEach((id, i) => {
          const el = elementsRef.current.find((e) => e.id === id)
          if (!el) return
          commitGeometry(el, { ...geomOf(el), z_index: dir === 'front' ? base + i : base - i })
        })
      })
    },
    [runOp, commitGeometry, geomOf],
  )

  const alignSelected = useCallback(
    (kind: AlignKind) => {
      runOp(() => {
        const area = activeAreaRef.current
        if (!area) return
        const ids = [...selectedIdsRef.current]
        const items = ids
          .map((id) => elementsRef.current.find((e) => e.id === id))
          .filter((e): e is ElementRow => !!e)
          .map((e) => ({ id: e.id, box: { x: e.x, y: e.y, width: e.width, height: e.height } }))
        const res = alignBoxes(items, kind)
        for (const [id, pos] of res) {
          const el = elementsRef.current.find((e) => e.id === id)
          if (!el) continue
          const c = clampToAreaRotated(
            pos.x,
            pos.y,
            el.width,
            el.height,
            el.rotation,
            area.width,
            area.height,
          )
          if (c.x === el.x && c.y === el.y) continue
          commitGeometry(el, { ...geomOf(el), x: c.x, y: c.y })
        }
      })
    },
    [runOp, commitGeometry, geomOf],
  )

  const duplicateSelected = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    if (ids.length === 0) return
    void (async () => {
      const newIds: string[] = []
      for (const id of ids) {
        const r = await duplicateElementAction(slug, id)
        if (r.ok) newIds.push(r.data.elementId)
        else toast.error(r.message)
      }
      // Flush de geometría pendiente ANTES de refrescar (si no, el re-seed pisa
      // movimientos optimistas sin guardar → "se mueve todo").
      await queue.flushNow()
      router.refresh()
      if (newIds.length) selectSet(new Set(newIds))
    })()
  }, [slug, router, selectSet, queue])

  const printQrSelected = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    if (ids.length !== 1) return
    const el = elementsRef.current.find((e) => e.id === ids[0])
    const token = el?.table?.qr_token
    if (!token) {
      toast.error('Esta mesa no tiene QR.')
      return
    }
    window.open(`/print/qr/${encodeURIComponent(token)}`, '_blank', 'width=600,height=800')
  }, [])

  // Optimista: saca lo elegido del lienzo, cierra el diálogo y persiste atrás.
  const performDelete = useCallback(() => {
    const els = deleteTargets
    const ids = els.map((e) => e.id)
    setElements((cur) => cur.filter((e) => !ids.includes(e.id)))
    clearSelection()
    void (async () => {
      for (const el of els) {
        const r =
          el.kind === 'table'
            ? await removeFromPlanAction(slug, el.id)
            : await deleteDecorAction(slug, el.id)
        if (!r.ok) {
          toast.error(r.message)
          break
        }
      }
      // Flush ANTES de refrescar: borrar no debe revertir los moves sin guardar.
      await queue.flushNow()
      router.refresh()
    })()
  }, [deleteTargets, slug, router, clearSelection, queue])

  // ── Teclado ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'editar') return
    function onKey(e: KeyboardEvent) {
      // Ya la usó el control enfocado (Radix previene las flechas que maneja).
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable ||
          t.closest(KEY_OWNER_SELECTOR))
      ) {
        return
      }
      if (e.key === 'Escape') {
        clearSelection()
        return
      }
      // Undo / redo de geometría.
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.key === 'y' || e.key === 'Y') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        redo()
        return
      }
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        duplicateSelected()
        return
      }
      if (selectedIdsRef.current.size === 0) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        askDelete()
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        bringTo('front')
        return
      }
      if (e.key === '[') {
        e.preventDefault()
        bringTo('back')
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        rotate90()
        return
      }
      const step = e.shiftKey ? GRID : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      applyDelta([...selectedIdsRef.current], dx, dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    view,
    clearSelection,
    duplicateSelected,
    bringTo,
    rotate90,
    applyDelta,
    undo,
    redo,
    askDelete,
  ])

  // Centro lógico del área activa (fallback no-drag de la paleta).
  const areaCenter = useCallback(
    (w: number, h: number) => {
      if (!activeArea) return { x: 0, y: 0 }
      return clampToArea(
        snapToGrid(activeArea.width / 2 - w / 2),
        snapToGrid(activeArea.height / 2 - h / 2),
        w,
        h,
        activeArea.width,
        activeArea.height,
      )
    },
    [activeArea],
  )

  const insertAt = useCallback(
    (kind: Kind, x: number, y: number) => {
      if (!activeArea) return
      if (kind === 'table') {
        const areaLabels = elements
          .filter((el) => el.area_id === activeArea.id && el.kind === 'table' && el.table)
          .map((el) => el.table?.label ?? '')
          .filter((l) => l.length > 0)
        const label = suggestNextLabel(activeArea.number_start, areaLabels)
        void (async () => {
          const r = await createTableInPlanAction(slug, {
            area_id: activeArea.id,
            label,
            capacity: null,
            shape: ELEMENT_DEFAULTS.table.shape,
            x,
            y,
          })
          if (r.ok) {
            selectSet(new Set([r.elementId]))
            await queue.flushNow()
            router.refresh()
          } else {
            toast.error(r.message)
          }
        })()
        return
      }
      const def = ELEMENT_DEFAULTS[kind]
      void (async () => {
        const r = await addDecorAction(slug, {
          area_id: activeArea.id,
          kind,
          shape: def.shape,
          x,
          y,
          width: def.width,
          height: def.height,
          label: null,
          color: null,
        })
        if (r.ok) {
          await queue.flushNow()
          router.refresh()
        } else {
          toast.error(r.message)
        }
      })()
    },
    [activeArea, slug, router, elements, selectSet, queue],
  )

  const handleDropKind = useCallback(
    (kind: Kind, clientX: number, clientY: number) => {
      if (!activeArea) return
      const wrapper = wrapperRef.current
      if (!wrapper) return
      const { scale, positionX, positionY } = readStageTransform(transformRef)
      const rect = wrapper.getBoundingClientRect()
      const point = stagePointFromClient(clientX, clientY, rect, scale, positionX, positionY)
      const def = ELEMENT_DEFAULTS[kind]
      const clamped = clampToArea(
        snapToGrid(point.x - def.width / 2),
        snapToGrid(point.y - def.height / 2),
        def.width,
        def.height,
        activeArea.width,
        activeArea.height,
      )
      insertAt(kind, clamped.x, clamped.y)
    },
    [activeArea, insertAt],
  )

  const { onChipPointerDown, shouldSuppressClick, ghostNode } = usePaletteDrag({
    wrapperRef,
    onDrop: handleDropKind,
  })

  const handleQuickAdd = useCallback(
    (kind: Kind) => {
      const def = ELEMENT_DEFAULTS[kind]
      const center = areaCenter(def.width, def.height)
      insertAt(kind, center.x, center.y)
    },
    [areaCenter, insertAt],
  )

  const onPlace = useCallback(
    (tableId: string) => {
      if (!activeArea) return
      const def = ELEMENT_DEFAULTS.table
      const center = areaCenter(def.width, def.height)
      void (async () => {
        const r = await placeTableAction(slug, {
          table_id: tableId,
          area_id: activeArea.id,
          x: center.x,
          y: center.y,
        })
        if (r.ok) onChanged()
        else toast.error(r.message)
      })()
    },
    [activeArea, areaCenter, slug, onChanged],
  )

  // Borra una mesa de la bandeja de forma definitiva (mesa + QR). El RPC bloquea
  // si la mesa tuvo sesiones → mensaje "desactivala en su lugar".
  // Devuelve el resultado al diálogo: si falla, el error se ve adentro y no se cierra.
  const onDeleteTrayTable = useCallback(
    async (tableId: string): Promise<ConfirmResult> => {
      const r = await deleteTablePermanentlyAction(slug, tableId)
      if (!r.ok) return r
      toast.success('Mesa borrada.')
      onChanged()
    },
    [slug, onChanged],
  )

  const allTables = useMemo(
    () =>
      elements
        .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
        .map((el) => ({ id: el.physical_table_id as string, label: el.table?.label ?? '' })),
    [elements],
  )

  const fallbackTables = useMemo(
    () =>
      [
        ...initial.elements
          .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
          .map((el) => ({
            id: el.physical_table_id as string,
            label: el.table?.label ?? el.label ?? '',
            capacity: el.table?.capacity ?? null,
            qr_token: el.table?.qr_token ?? '',
            active: el.table?.active ?? true,
          })),
        ...initial.unplacedTables.map((t) => ({
          id: t.id,
          label: t.label,
          capacity: t.capacity,
          qr_token: t.qr_token,
          active: true,
        })),
      ].sort((a, b) => a.label.localeCompare(b.label, 'es')),
    [initial.elements, initial.unplacedTables],
  )

  // Bounding box del contenido del área (para "Ajustar").
  const fitBox = useMemo(() => {
    if (areaElements.length === 0) return null
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const e of areaElements) {
      minX = Math.min(minX, e.x)
      minY = Math.min(minY, e.y)
      maxX = Math.max(maxX, e.x + e.width)
      maxY = Math.max(maxY, e.y + e.height)
    }
    const pad = 60
    return {
      x: Math.max(0, minX - pad),
      y: Math.max(0, minY - pad),
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    }
  }, [areaElements])

  const selectedCount = selectedIds.size
  const selectedSingle =
    selectedCount === 1 ? (elements.find((e) => selectedIds.has(e.id)) ?? null) : null
  const singleIsTable = selectedSingle?.kind === 'table'
  const hasPlacedTables = areaElements.some(
    (el) => el.kind === 'table' && el.physical_table_id !== null,
  )
  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0

  if (!activeArea) return null

  const confirmCopy = deleteCopy(deleteTargets)
  const liveSession = liveDetail?.session ?? null

  return (
    <>
      <Tabs
        syncParam={FLOOR_VIEW_PARAM}
        defaultValue={initialView}
        onValueChange={(value) => setView(isFloorView(value) ? value : 'editar')}
        className="gap-6"
      >
        <TabsList aria-label="Vistas del plano">
          <TabsTrigger value="editar" icon={PencilRuler}>
            Editar plano
          </TabsTrigger>
          <TabsTrigger value="vivo" icon={Activity}>
            En vivo
          </TabsTrigger>
          <TabsTrigger value="lista" icon={List}>
            Lista de mesas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editar">
          {/* Angosto: todo en una columna (áreas, lienzo, panel). lg: lienzo +
              panel, con las áreas arriba. xl: áreas · lienzo · panel. El orden
              del DOM es el orden visual en todos los anchos. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
            <div className="min-w-0 lg:col-span-2 xl:col-span-1">
              <AreaManager
                slug={slug}
                areas={areas}
                activeAreaId={activeAreaId}
                onActiveAreaChange={(id) => {
                  clearSelection()
                  setActiveAreaId(id)
                }}
                onChanged={onChanged}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <ElementPalette
                  onQuickAdd={handleQuickAdd}
                  onChipPointerDown={onChipPointerDown}
                  shouldSuppressClick={shouldSuppressClick}
                />
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 pointer-coarse:gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canUndo}
                          onClick={undo}
                          aria-label="Deshacer"
                        >
                          <Undo2 aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Deshacer</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canRedo}
                          onClick={redo}
                          aria-label="Rehacer"
                        >
                          <Redo2 aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Rehacer</TooltipContent>
                    </Tooltip>
                  </div>
                  <BulkCreateDialog slug={slug} areaId={activeArea.id} onCreated={onChanged} />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    // Enfocable aunque no haya mesas: al tocarlo explica por qué no imprime.
                    aria-disabled={!hasPlacedTables || undefined}
                    onClick={() => {
                      if (!hasPlacedTables) {
                        toast.info('Colocá al menos una mesa en esta área para imprimir sus QR.')
                        return
                      }
                      window.open(`/print/qrs/${activeArea.id}`, '_blank', 'noopener')
                    }}
                  >
                    <QrCode aria-hidden />
                    Imprimir QRs
                  </Button>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-pretty type-caption text-muted-foreground">
                  Arrastrá un elemento al plano o tocalo para sumarlo en el centro. Tocá algo del
                  plano para moverlo, rotarlo o editarlo.
                </p>
                <span className="flex shrink-0 items-center gap-1 type-caption text-muted-foreground">
                  <Keyboard className="size-3.5" aria-hidden />
                  Atajos
                  <InfoTip label="Atajos de teclado del plano" side="bottom">
                    <span className="flex flex-col gap-1">
                      <span>Flechas: mover (con Shift, de a un casillero)</span>
                      <span>Shift + clic: elegir varios</span>
                      <span>R: rotar 90° (Shift al rotar: de a 15°)</span>
                      <span>] y [: traer al frente y enviar al fondo</span>
                      <span>Ctrl o Cmd + D: duplicar</span>
                      <span>Ctrl o Cmd + Z: deshacer (con Shift, rehacer)</span>
                      <span>Supr o Borrar: quitar lo elegido</span>
                      <span>Alt al soltar: sin pegar a la grilla</span>
                      <span>Esc: soltar lo elegido</span>
                    </span>
                  </InfoTip>
                </span>
              </div>
              <div ref={wrapperRef} className="relative">
                <ContextualToolbar
                  count={selectedCount}
                  singleTable={!!singleIsTable}
                  onRotate90={rotate90}
                  onBringFront={() => bringTo('front')}
                  onBringBack={() => bringTo('back')}
                  onDuplicate={duplicateSelected}
                  onQr={printQrSelected}
                  onAlign={alignSelected}
                  onDelete={askDelete}
                />
                <PanZoomStage
                  width={activeArea.width}
                  height={activeArea.height}
                  transformRef={transformRef}
                  interactive
                  gridSize={GRID}
                  fitTargetId={FIT_TARGET_ID}
                  onBackgroundClick={clearSelection}
                >
                  {fitBox ? (
                    <div
                      id={FIT_TARGET_ID}
                      aria-hidden
                      className="pointer-events-none absolute"
                      style={{
                        left: fitBox.x,
                        top: fitBox.y,
                        width: fitBox.width,
                        height: fitBox.height,
                      }}
                    />
                  ) : null}
                  <SnapGuides guides={guides} />
                  {areaElements.map((element) => (
                    <FloorElement
                      key={element.id}
                      element={element}
                      selected={selectedIds.has(element.id)}
                      transformRef={transformRef}
                      areaWidth={activeArea.width}
                      areaHeight={activeArea.height}
                      onSelect={onSelect}
                      getSiblings={getSiblings}
                      registerNode={registerNode}
                      onMoveLive={onMoveLive}
                      onMoveEnd={onMoveEnd}
                      onResizeEnd={handleResizeEnd}
                      onRotateEnd={handleRotateEnd}
                      onGuides={setGuides}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                    />
                  ))}
                </PanZoomStage>
              </div>
            </div>

            {/* Panel del costado: lo elegido, o las mesas sin ubicar. Se monta con
                `key` por elemento para que cada uno arranque de cero. */}
            <Card padding="sm" className="min-w-0 self-start">
              {selectedSingle && selectedSingle.kind === 'table' ? (
                <TableInspector
                  key={selectedSingle.id}
                  slug={slug}
                  element={selectedSingle}
                  allTables={allTables}
                  onChanged={onChanged}
                  onClose={clearSelection}
                />
              ) : selectedSingle ? (
                <DecorInspector
                  key={selectedSingle.id}
                  slug={slug}
                  element={selectedSingle}
                  onChanged={onChanged}
                  onClose={clearSelection}
                />
              ) : (
                <UnplacedTray tables={unplaced} onPlace={onPlace} onDelete={onDeleteTrayTable} />
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="vivo">
          {initialLive ? (
            <LiveFloor
              slug={slug}
              tenantId={tenantId}
              areas={liveAreas}
              activeAreaId={initialLive.area.id}
              initial={initialLive}
              onTableOpen={onLiveTableOpen}
            />
          ) : (
            <EmptyState
              size="sm"
              title="Todavía no hay nada para ver en vivo"
              description="Creá un área en «Editar plano» y ubicá sus mesas: acá vas a ver cuáles están ocupadas."
            />
          )}
        </TabsContent>

        <TabsContent value="lista">
          <TablesListFallback slug={slug} tables={fallbackTables} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone={confirmCopy.tone}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        onConfirm={performDelete}
      />

      <Sheet
        open={liveDetail !== null}
        onOpenChange={(o) => {
          if (!o) setLiveDetail(null)
        }}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{liveSession?.alias ?? `Mesa ${liveDetail?.label ?? ''}`}</SheetTitle>
            <SheetDescription>
              {liveSession
                ? `${liveSession.alias ? `Mesa ${liveDetail?.label ?? ''} · ` : ''}Así viene la mesa ahora. Es solo para mirar.`
                : 'Está libre en este momento.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-6">
            {liveSession ? (
              <>
                <KPI
                  label="Gasto acumulado"
                  value={<Amount cents={liveSession.total_cents} decimals={0} />}
                />
                <p className="type-small text-muted-foreground">
                  {liveSession.party_size !== null
                    ? `${liveSession.party_size} ${liveSession.party_size === 1 ? 'comensal' : 'comensales'} · `
                    : ''}
                  Abierta hace {elapsedLabel(liveSession.opened_at)}
                </p>
                {liveSignals(liveSession).length > 0 ? (
                  <ul aria-label="Avisos de la mesa" className="flex flex-wrap gap-2">
                    {liveSignals(liveSession).map((signal) => (
                      <li key={signal}>
                        <StatusBadge status={signal} map={LIVE_SIGNAL} size="md" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="type-body text-pretty text-muted-foreground">
                Cuando un mozo la abra o alguien escanee su QR, acá vas a ver el gasto y los avisos
                de la cocina.
              </p>
            )}
          </SheetBody>

          {liveSession ? (
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => setShowMoveLive(true)}>
                <ArrowRightLeft aria-hidden />
                Cambiar de mesa
              </Button>
              <p className="type-caption text-muted-foreground">
                Cobrar y dividir la cuenta se hace desde el salón.
              </p>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      {liveSession && liveDetail ? (
        <MoveTableSheet
          slug={slug}
          sessionId={liveSession.id}
          currentTableId={liveDetail.physical_table_id}
          currentLabel={liveDetail.label}
          open={showMoveLive}
          onOpenChange={setShowMoveLive}
          onMoved={() => {
            setShowMoveLive(false)
            setLiveDetail(null)
            router.refresh()
          }}
        />
      ) : null}

      {ghostNode}
    </>
  )
}
