'use client'

import { ArrowRightLeft, Bell, CircleDot, QrCode, Receipt, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { toast } from 'sonner'
import { MoveTableSheet } from '@/components/floor-plan/move-table-sheet'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
import { AreaManager } from './area-manager'
import { BulkCreateDialog } from './bulk-create-dialog'
import { ContextualToolbar } from './contextual-toolbar'
import { DecorInspector } from './decor-inspector'
import { ElementPalette } from './element-palette'
import { FloorElement } from './floor-element'
import { LiveFloor } from './live-floor'
import { PanZoomStage, readStageTransform, stagePointFromClient } from './pan-zoom-stage'
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
}

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage'
type Mode = 'editar' | 'vivo'

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
}: FloorPlanEditorProps) {
  const router = useRouter()

  const areas = initial.areas
  const unplaced = initial.unplacedTables

  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  const [mode, setMode] = useState<Mode>('editar')

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

  // Confirmación de borrado.
  const [deleteOpen, setDeleteOpen] = useState(false)

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
  const runOp = useCallback((fn: () => void) => {
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
      }
    }
  }, [])

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    for (const ch of entry) {
      const el = elementsRef.current.find((e) => e.id === ch.id)
      if (el) commitGeometry(el, ch.prev)
    }
    redoStackRef.current.push(entry)
  }, [commitGeometry])

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop()
    if (!entry) return
    for (const ch of entry) {
      const el = elementsRef.current.find((e) => e.id === ch.id)
      if (el) commitGeometry(el, ch.next)
    }
    undoStackRef.current.push(entry)
  }, [commitGeometry])

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
          const c = clampToArea(el.x + dx, el.y + dy, el.width, el.height, area.width, area.height)
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
        const clamped = clampToArea(el.x, el.y, width, height, area.width, area.height)
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
          const c = clampToArea(pos.x, pos.y, el.width, el.height, area.width, area.height)
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
      router.refresh()
      if (newIds.length) selectSet(new Set(newIds))
    })()
  }, [slug, router, selectSet])

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

  const performDelete = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    const els = ids
      .map((id) => elementsRef.current.find((e) => e.id === id))
      .filter((e): e is ElementRow => !!e)
    setElements((cur) => cur.filter((e) => !ids.includes(e.id)))
    clearSelection()
    setDeleteOpen(false)
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
      router.refresh()
    })()
  }, [slug, router, clearSelection])

  // ── Teclado ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'editar') return
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
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
        setDeleteOpen(true)
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
  }, [mode, clearSelection, duplicateSelected, bringTo, rotate90, applyDelta, undo, redo])

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
          router.refresh()
        } else {
          toast.error(r.message)
        }
      })()
    },
    [activeArea, slug, router, elements, selectSet],
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
  const onDeleteTrayTable = useCallback(
    (tableId: string) => {
      void (async () => {
        const r = await deleteTablePermanentlyAction(slug, tableId)
        if (r.ok) {
          toast.success('Mesa eliminada.')
          onChanged()
        } else {
          toast.error(r.message)
        }
      })()
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

  if (!activeArea) return null

  return (
    <>
      <Tabs defaultValue="plano" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="plano">Plano</TabsTrigger>
            <TabsTrigger value="lista">Lista</TabsTrigger>
          </TabsList>

          <div className="inline-flex items-center rounded-lg border border-border/60 bg-card p-0.5">
            <button
              type="button"
              onClick={() => setMode('editar')}
              aria-pressed={mode === 'editar'}
              className={
                mode === 'editar'
                  ? 'rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-xs'
                  : 'rounded-md px-3 py-1 font-medium text-muted-foreground text-xs'
              }
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setMode('vivo')}
              aria-pressed={mode === 'vivo'}
              className={
                mode === 'vivo'
                  ? 'rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-xs'
                  : 'rounded-md px-3 py-1 font-medium text-muted-foreground text-xs'
              }
            >
              En vivo
            </button>
          </div>
        </div>

        <TabsContent value="plano">
          {mode === 'vivo' ? (
            initialLive ? (
              <LiveFloor
                slug={slug}
                tenantId={tenantId}
                areas={liveAreas}
                activeAreaId={initialLive.area.id}
                initial={initialLive}
                onTableOpen={onLiveTableOpen}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                No hay áreas para mostrar en vivo. Creá un área en el modo Editar.
              </p>
            )
          ) : (
            <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
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

              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <ElementPalette
                    onQuickAdd={handleQuickAdd}
                    onChipPointerDown={onChipPointerDown}
                    shouldSuppressClick={shouldSuppressClick}
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <BulkCreateDialog slug={slug} areaId={activeArea.id} onCreated={onChanged} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={!hasPlacedTables}
                      title={
                        hasPlacedTables ? undefined : 'Colocá mesas en el área para imprimir sus QR'
                      }
                      onClick={() =>
                        window.open(`/print/qrs/${activeArea.id}`, '_blank', 'noopener')
                      }
                    >
                      <QrCode className="size-4" aria-hidden />
                      Imprimir QRs
                    </Button>
                  </div>
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
                    onDelete={() => setDeleteOpen(true)}
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

              <aside className="space-y-3">
                {selectedSingle && selectedSingle.kind === 'table' ? (
                  <TableInspector
                    slug={slug}
                    element={selectedSingle}
                    allTables={allTables}
                    onChanged={onChanged}
                    onClose={clearSelection}
                  />
                ) : selectedSingle ? (
                  <DecorInspector
                    slug={slug}
                    element={selectedSingle}
                    onChanged={onChanged}
                    onClose={clearSelection}
                  />
                ) : (
                  <UnplacedTray tables={unplaced} onPlace={onPlace} onDelete={onDeleteTrayTable} />
                )}
              </aside>
            </div>
          )}
        </TabsContent>

        <TabsContent value="lista">
          <TablesListFallback slug={slug} tables={fallbackTables} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedCount > 1 ? `Eliminar ${selectedCount} elementos` : 'Eliminar elemento'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Las mesas vuelven a "Mesas sin ubicar" (conservan su QR). La decoración se elimina
              definitivamente. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={liveDetail !== null}
        onOpenChange={(o) => {
          if (!o) setLiveDetail(null)
        }}
      >
        <SheetContent side="right" className="gap-0">
          <SheetHeader>
            <SheetTitle className="font-serif">
              {liveDetail?.session?.alias ?? liveDetail?.label ?? 'Mesa'}
            </SheetTitle>
            <SheetDescription>
              {liveDetail?.session
                ? 'Estado de la sesión en curso (solo lectura).'
                : 'Mesa libre — no hay sesión abierta.'}
            </SheetDescription>
          </SheetHeader>

          {liveDetail?.session ? (
            <div className="space-y-4 px-6 py-6">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">
                  Gasto acumulado
                </span>
                <span className="font-semibold font-serif text-2xl tabular-nums">
                  {ARSFormat(liveDetail.session.total_cents)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {liveDetail.session.party_size !== null ? (
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" aria-hidden />
                    {liveDetail.session.party_size}{' '}
                    {liveDetail.session.party_size === 1 ? 'comensal' : 'comensales'}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="gap-1">
                  <CircleDot className="size-3" aria-hidden />
                  {elapsedLabel(liveDetail.session.opened_at)}
                </Badge>
                {liveDetail.session.kitchen === 'preparing' ? (
                  <Badge variant="warning" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    Preparando
                  </Badge>
                ) : null}
                {liveDetail.session.kitchen === 'ready' ? (
                  <Badge variant="success" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    Lista
                  </Badge>
                ) : null}
                {liveDetail.session.bill_requested ? (
                  <Badge variant="destructive" className="gap-1">
                    <Receipt className="size-3" aria-hidden />
                    Cuenta pedida
                  </Badge>
                ) : null}
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowMoveLive(true)}
              >
                <ArrowRightLeft className="size-4" aria-hidden />
                Mover de mesa
              </Button>
              <p className="text-muted-foreground text-xs">
                Cobrar y dividir se hacen desde el salón.
              </p>
            </div>
          ) : (
            <div className="px-6 py-6">
              <p className="text-muted-foreground text-sm">
                Esta mesa no tiene una sesión abierta en este momento.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {liveDetail?.session ? (
        <MoveTableSheet
          slug={slug}
          sessionId={liveDetail.session.id}
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
