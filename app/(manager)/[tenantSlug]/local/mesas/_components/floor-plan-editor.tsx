'use client'

import './floor-editor.css'
import { LayoutList, Loader2, PencilRuler, Plus, Radio } from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { toast } from 'sonner'
import {
  addDecorAction,
  createTableInPlanAction,
  deleteDecorAction,
  deleteTablePermanentlyAction,
  duplicateElementAction,
  placeTableAction,
  removeFromPlanAction,
  saveGeometryAction,
} from '@/lib/floor-plan/actions'
import {
  hasBranchChoice,
  inkOn,
  type PlanBranch,
  planHref,
  suggestNumberStart,
} from '@/lib/floor-plan/branches'
import {
  clampToArea,
  clampToAreaRotated,
  ELEMENT_DEFAULTS,
  GRID,
  normalizeRotation,
  RESIZE_MIN,
  snapToGrid,
  stagePointFromClient,
} from '@/lib/floor-plan/grid'
import { createLiveGeometryStore } from '@/lib/floor-plan/live-geometry'
import {
  applyPatch,
  contentBox,
  DEFAULT_SEATS,
  type ElementPatch,
  elementName,
  type LiveGeometry,
  listTables,
  planSignature,
  pruneRemoved,
  type RemovedTable,
  removedTableOf,
  sectorTableCounts,
  unplacedWithRemoved,
} from '@/lib/floor-plan/model'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'
import type { ElementRow, FloorPlanData } from '@/lib/floor-plan/queries'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'
import { type AlignKind, alignBoxes, type Guide } from '@/lib/floor-plan/snap'
import { readStageTransform } from '@/lib/floor-plan/stage-transform'
import { cn } from '@/lib/utils'
import { BulkCreateDialog } from './bulk-create-dialog'
import { ContextualToolbar } from './contextual-toolbar'
import { DecorInspector } from './decor-inspector'
import { EditorStage } from './editor-stage'
import { EditorToolbar, type EditorView } from './editor-toolbar'
import { ElementPalette } from './element-palette'
import { FloorElement } from './floor-element'
import { EmptyFloorArt } from './glyphs'
import { LegacyLive } from './legacy-live'
import { LivePane } from './live-pane'
import { MaquetaPane } from './maqueta-pane'
import { SectorCreateForm, SectorTabs } from './sector-tabs'
import { GroupPanel, SectorPanel } from './side-panel'
import { TableInspector } from './table-inspector'
import { TablesListFallback } from './tables-list-fallback'
import { useGeometryQueue } from './use-geometry-queue'
import { useLiveModel } from './use-live-model'
import { type PaletteKind, usePaletteDrag } from './use-palette-drag'

export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  /** La sucursal en la que está parado el editor. `null` = el bar no tiene sucursales cargadas. */
  branch: PlanBranch | null
  /** Las sucursales activas del bar. Con una sola no se muestra el selector. */
  branches: PlanBranch[]
  /** El plano de ESA sucursal: sus sectores, lo dibujado y sus mesas sin ubicar. */
  initial: FloorPlanData
  /** Punto de venta prendido: «En vivo» es la maqueta del salón con los estados reales. */
  posEnabled: boolean
  /** QR de mesa prendidos: se ofrece imprimirlos y cambiarlos. */
  qrEnabled: boolean
  timeZone: string
}

type Mode = 'editar' | 'vivo' | 'lista'

const VIEW_KEY = 'hub:fpe:view'
/** Ancho del editor desde el que entran el plano y la maqueta lado a lado. */
const SPLIT_MIN_WIDTH = 960

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

const geomOf = (el: ElementRow): GeomFields => ({
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
  rotation: el.rotation,
  corner_radius: el.corner_radius,
  z_index: el.z_index,
})

// Líneas guía de alineación (se dibujan en coords lógicas dentro del piso).
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
            className="fpe-guide"
            style={{
              left: g.pos,
              top: g.from,
              width: 'calc(1.5px * var(--fpe-inv, 1))',
              height: g.to - g.from,
            }}
          />
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: guías efímeras por gesto
            key={i}
            aria-hidden
            className="fpe-guide"
            style={{
              top: g.pos,
              left: g.from,
              height: 'calc(1.5px * var(--fpe-inv, 1))',
              width: g.to - g.from,
            }}
          />
        ),
      )}
    </>
  )
}

/** Mientras se navega a otra sucursal, su pastilla lo dice. */
function BranchPending() {
  const { pending } = useLinkStatus()
  return pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null
}

/**
 * Las teclas del editor no se roban de donde significan otra cosa: un campo de
 * texto, una lista desplegable, un diálogo, una ventanita.
 */
function keysBelongElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (
    target.closest(
      '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"],[data-radix-popper-content-wrapper]',
    ) !== null
  )
}

function removedMessage(rows: ElementRow[]): string {
  const [only] = rows
  if (rows.length === 1 && only) {
    return only.kind === 'table'
      ? `${elementName(only)} quedó en «Mesas sin ubicar».`
      : `${elementName(only)}: quitada del plano.`
  }
  return `${rows.length} elementos quitados del plano.`
}

export function FloorPlanEditor({
  slug,
  tenantId,
  branch,
  branches,
  initial,
  posEnabled,
  qrEnabled,
  timeZone,
}: FloorPlanEditorProps) {
  const router = useRouter()

  const areas = initial.areas
  const multiBranch = hasBranchChoice(branches)

  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  const [mode, setMode] = useState<Mode>('editar')
  const [view, setView] = useState<EditorView>('split')

  // Selección múltiple. El ref es la fuente de verdad sincrónica (gestos),
  // el estado es el espejo para render.
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const [selectedIds, setSelectedIdsState] = useState<Set<string>>(new Set())
  const selectSet = useCallback((s: Set<string>) => {
    selectedIdsRef.current = s
    setSelectedIdsState(s)
  }, [])
  const clearSelection = useCallback(() => {
    if (selectedIdsRef.current.size > 0) selectSet(new Set())
  }, [selectSet])
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

  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  // El tablero del plano: ahí se sueltan las piezas que vienen de la paleta.
  const planRef = useRef<HTMLDivElement>(null)
  // Nodos DOM de cada FloorElement (para mover los pares durante el group-drag).
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const registerNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodesRef.current.set(id, node)
    else nodesRef.current.delete(id)
  }, [])

  const draggingRef = useRef(false)
  // Lo que se arrastra, estira o gira ahora mismo: lo lee la maqueta de al lado.
  const liveStore = useMemo(() => createLiveGeometryStore(), [])
  // Cambios de la ficha que todavía viajan al servidor: se sostienen sobre un refresco.
  const heldRef = useRef<Map<string, ElementPatch>>(new Map())
  // Elementos que se están quitando (por id): un refresco a mitad de camino no los revive.
  const removingRef = useRef<Set<string>>(new Set())
  // Mesas recién quitadas del plano: aparecen en «sin ubicar» sin esperar al servidor.
  const [removedTables, setRemovedTables] = useState<RemovedTable[]>([])

  // Re-sync de elements cuando cambian los datos del server.
  const initialSig = useMemo(() => planSignature(initial.elements), [initial.elements])
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync solo cuando cambian los datos del server (initialSig)
  useEffect(() => {
    if (draggingRef.current) return
    const held = heldRef.current
    const removing = removingRef.current
    const rows =
      removing.size === 0 ? initial.elements : initial.elements.filter((r) => !removing.has(r.id))
    setElements(
      held.size === 0
        ? rows
        : rows.map((row) => {
            const patch = held.get(row.id)
            return patch ? applyPatch(row, patch) : row
          }),
    )
  }, [initialSig])
  // Cuando el servidor ya trae las mesas quitadas, lo provisorio sobra.
  useEffect(() => {
    setRemovedTables((current) =>
      current.length === 0 ? current : pruneRemoved(current, initial, removingRef.current),
    )
  }, [initial])

  // El sector activo sigue existiendo; y si se acaba de crear uno, se salta a ese.
  const wantedAreaRef = useRef<string | null>(null)
  useEffect(() => {
    const wanted = wantedAreaRef.current
    if (wanted && areas.some((a) => a.id === wanted)) {
      wantedAreaRef.current = null
      setActiveAreaId(wanted)
      return
    }
    if (!areas.some((a) => a.id === activeAreaId)) setActiveAreaId(areas[0]?.id ?? '')
  }, [areas, activeAreaId])

  // ── Cómo se mira: plano, maqueta o los dos (recuerda la última elección) ──
  const [canSplit, setCanSplit] = useState(false)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setCanSplit(host.getBoundingClientRect().width >= SPLIT_MIN_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === 'plan' || saved === 'split' || saved === 'model') setView(saved)
    } catch {
      // sin almacenamiento (modo privado): arranca con el plano y la maqueta
    }
  }, [])
  // La maqueta «se para» solo cuando el dueño la pide; al abrir el editor ya está armada.
  const viewChosenRef = useRef(false)
  const chooseView = useCallback((next: EditorView) => {
    viewChosenRef.current = true
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // idem
    }
  }, [])
  const showModel = view === 'model' || (view === 'split' && canSplit)

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
    toast.error('No se pudo guardar el cambio. Lo dejé como estaba: probá de nuevo.')
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

  /**
   * Algo cambió en el servidor (se agregó, se quitó, se renombró): volver a leer.
   * Primero se guarda la posición pendiente, así un movimiento sin guardar no se
   * pierde al refrescar. `keepSelection` deja elegido lo que estaba elegido.
   */
  const onChanged = useCallback(
    (keepSelection = false) => {
      if (!keepSelection) clearSelection()
      void queue.flushNow().finally(() => router.refresh())
    },
    [router, clearSelection, queue],
  )

  const patchElement = useCallback((id: string, patch: ElementPatch) => {
    setElements((current) => current.map((row) => (row.id === id ? applyPatch(row, patch) : row)))
  }, [])
  const holdPatch = useCallback((id: string, patch: ElementPatch | null) => {
    if (patch) heldRef.current.set(id, { ...heldRef.current.get(id), ...patch })
    else heldRef.current.delete(id)
  }, [])

  const commitGeometry = useCallback(
    (el: ElementRow, next: GeomFields) => {
      if (!prevGeomRef.current.has(el.id)) {
        prevGeomRef.current.set(el.id, { id: el.id, ...geomOf(el) })
      }
      // Registrar en la transacción de undo activa (si la hay).
      if (txnRef.current) {
        txnRef.current.push({ id: el.id, prev: geomOf(el), next })
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
    [runOp, commitGeometry],
  )

  // Cajas de los hermanos (para snap-a-objeto), excluyendo el propio id.
  const getSiblings = useCallback(
    (id: string) =>
      areaElementsRef.current
        .filter((e) => e.id !== id)
        .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })),
    [],
  )

  // Al apretar un elemento que no estaba elegido: queda elegido él solo o, con
  // Shift/Cmd, se suma a lo que ya había (así un grupo se arma tocando y se puede
  // arrastrar entero). Devuelve si se eligió recién ahora.
  const onDragStart = useCallback(
    (id: string, additive: boolean) => {
      draggingRef.current = true
      const current = selectedIdsRef.current
      if (current.has(id)) return false
      selectSet(additive ? new Set([...current, id]) : new Set([id]))
      return true
    },
    [selectSet],
  )
  const onDragEnd = useCallback(() => {
    draggingRef.current = false
  }, [])

  // Move vivo: la maqueta acompaña el gesto y, si hay un grupo elegido, sus pares
  // se mueven con el que se arrastra (a mano, sin pasar por React).
  const onMoveLive = useCallback(
    (id: string, dx: number, dy: number) => {
      const sel = selectedIdsRef.current
      const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id]
      const entries: [string, LiveGeometry][] = []
      for (const pid of ids) {
        const el = elementsRef.current.find((e) => e.id === pid)
        if (!el) continue
        entries.push([pid, { x: el.x + dx, y: el.y + dy }])
        if (pid === id) continue
        const node = nodesRef.current.get(pid)
        if (node) node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      }
      liveStore.setMany(entries)
    },
    [liveStore],
  )

  // Commit del move: aplica el delta al grupo (o al único) + limpia transforms de pares.
  const onMoveEnd = useCallback(
    (id: string, dx: number, dy: number) => {
      const sel = selectedIdsRef.current
      const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id]
      applyDelta(ids, dx, dy)
      liveStore.clear()
      // Limpiar transforms imperativos de los pares tras el commit de React.
      requestAnimationFrame(() => {
        for (const pid of ids) {
          if (pid === id) continue
          const node = nodesRef.current.get(pid)
          if (node) node.style.transform = ''
        }
      })
    },
    [applyDelta, liveStore],
  )

  const onLive = useCallback(
    (id: string, geometry: LiveGeometry) => liveStore.set(id, geometry),
    [liveStore],
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
      liveStore.clear()
    },
    [runOp, commitGeometry, liveStore],
  )

  const handleRotateEnd = useCallback(
    (id: string, rotation: number) => {
      runOp(() => {
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el || el.rotation === rotation) return
        commitGeometry(el, { ...geomOf(el), rotation })
      })
      liveStore.clear()
    },
    [runOp, commitGeometry, liveStore],
  )

  // ── Acciones de la barra contextual / teclado / ficha ──────────────────────

  const rotate90 = useCallback(() => {
    runOp(() => {
      for (const id of selectedIdsRef.current) {
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el) continue
        commitGeometry(el, { ...geomOf(el), rotation: normalizeRotation(el.rotation + 90) })
      }
    })
  }, [runOp, commitGeometry])

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
    [runOp, commitGeometry],
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
    [runOp, commitGeometry],
  )

  const duplicateSelected = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    if (ids.length === 0) return
    void (async () => {
      // Guardar la posición pendiente ANTES de duplicar: la copia sale de lo guardado.
      await queue.flushNow()
      const newIds: string[] = []
      for (const id of ids) {
        const r = await duplicateElementAction(slug, id)
        if (r.ok) newIds.push(r.data.elementId)
        else toast.error(r.message)
      }
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

  // Volver a poner lo que se quitó, donde estaba y como estaba.
  const restore = useCallback(
    (rows: ElementRow[]) => {
      void (async () => {
        const geometry: ElementGeometry[] = []
        let failed = 0
        for (const row of rows) {
          let created: { ok: true; data?: unknown } | { ok: false; message: string }
          if (row.kind === 'table') {
            if (!row.physical_table_id) continue
            created = await placeTableAction(slug, {
              table_id: row.physical_table_id,
              area_id: row.area_id,
              x: row.x,
              y: row.y,
              shape: row.shape,
            })
          } else if (row.kind !== 'booth') {
            created = await addDecorAction(slug, {
              area_id: row.area_id,
              kind: row.kind,
              shape: row.shape,
              x: row.x,
              y: row.y,
              width: row.width,
              height: row.height,
              label: row.label,
              color: row.color,
            })
          } else {
            failed += 1
            continue
          }
          const id = created.ok ? (created.data as { id?: string } | undefined)?.id : undefined
          if (!id) {
            failed += 1
            continue
          }
          geometry.push({ id, ...geomOf(row) })
        }
        // Tamaño, giro y orden vuelven con una sola escritura.
        if (geometry.length > 0) await saveGeometryAction(slug, geometry)
        router.refresh()
        if (failed > 0) toast.error('Algo no se pudo volver a poner. Revisá el plano.')
      })()
    },
    [slug, router],
  )

  /**
   * Quitar lo elegido del plano. No se pregunta: tiene vuelta («Deshacer» en el
   * aviso). Una mesa no se borra, vuelve a «Mesas sin ubicar»; lo demás se va.
   */
  const removeSelected = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    const rows = ids
      .map((id) => elementsRef.current.find((e) => e.id === id))
      .filter((e): e is ElementRow => !!e)
    if (rows.length === 0) return
    // Al toque: salen del plano y las mesas aparecen en «sin ubicar».
    for (const id of ids) removingRef.current.add(id)
    setElements((cur) => cur.filter((e) => !ids.includes(e.id)))
    setRemovedTables((cur) => [
      ...cur,
      ...rows.map(removedTableOf).filter((t): t is RemovedTable => t !== null),
    ])
    clearSelection()
    void (async () => {
      // Guardar ANTES: quitar no debe revertir los movimientos sin guardar.
      await queue.flushNow()
      const removed: ElementRow[] = []
      for (const row of rows) {
        const r =
          row.kind === 'table'
            ? await removeFromPlanAction(slug, row.id)
            : await deleteDecorAction(slug, row.id)
        if (!r.ok) {
          toast.error(r.message)
          break
        }
        removed.push(row)
      }
      for (const id of ids) removingRef.current.delete(id)
      // Lo que no se pudo quitar vuelve al plano tal como estaba.
      const kept = rows.filter((row) => !removed.includes(row))
      if (kept.length > 0) {
        const keptIds = new Set(kept.map((row) => row.id))
        setElements((cur) => [...cur.filter((e) => !keptIds.has(e.id)), ...kept])
        setRemovedTables((cur) => cur.filter((t) => !keptIds.has(t.elementId)))
      }
      router.refresh()
      if (removed.length > 0) {
        toast(removedMessage(removed), {
          duration: 9000,
          action: { label: 'Deshacer', onClick: () => restore(removed) },
        })
      }
    })()
  }, [slug, router, clearSelection, queue, restore])

  // ── Teclado ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'editar') return
    function onKey(e: KeyboardEvent) {
      if (keysBelongElsewhere(e.target)) return
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
        if (selectedIdsRef.current.size === 0) return
        e.preventDefault()
        duplicateSelected()
        return
      }
      if (selectedIdsRef.current.size === 0) return
      // Con otra tecla de comando apretada es un atajo del navegador, no nuestro.
      if (e.metaKey || e.ctrlKey) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
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
      const arrow =
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      if (!arrow) return
      e.preventDefault()
      // Alt + flechas: agrandar o achicar (de a un cuadro) el único elegido.
      if (e.altKey) {
        const [only] = [...selectedIdsRef.current]
        const el =
          selectedIdsRef.current.size === 1
            ? elementsRef.current.find((x) => x.id === only)
            : undefined
        if (!el) return
        const dw = e.key === 'ArrowRight' ? GRID : e.key === 'ArrowLeft' ? -GRID : 0
        const dh = e.key === 'ArrowDown' ? GRID : e.key === 'ArrowUp' ? -GRID : 0
        handleResizeEnd(el.id, {
          width: Math.max(RESIZE_MIN, el.width + dw),
          height: Math.max(RESIZE_MIN, el.height + dh),
        })
        return
      }
      const step = e.shiftKey ? GRID : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      applyDelta([...selectedIdsRef.current], dx, dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    mode,
    clearSelection,
    duplicateSelected,
    removeSelected,
    bringTo,
    rotate90,
    applyDelta,
    handleResizeEnd,
    undo,
    redo,
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
    (kind: PaletteKind, x: number, y: number) => {
      if (!activeArea) return
      if (kind === 'table') {
        const areaLabels = elements
          .filter((el) => el.area_id === activeArea.id && el.kind === 'table' && el.table)
          .map((el) => el.table?.label ?? '')
          .filter((l) => l.length > 0)
        const label = suggestNextLabel(activeArea.number_start, areaLabels)
        void (async () => {
          await queue.flushNow()
          const r = await createTableInPlanAction(slug, {
            area_id: activeArea.id,
            label,
            // Una mesa nueva nace de cuatro: es lo que dibuja el salón y se cambia al toque.
            capacity: DEFAULT_SEATS,
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
        await queue.flushNow()
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
          const id = (r.data as { id?: string } | undefined)?.id
          if (id) selectSet(new Set([id]))
          router.refresh()
        } else {
          toast.error(r.message)
        }
      })()
    },
    [activeArea, slug, router, elements, selectSet, queue],
  )

  const handleDropKind = useCallback(
    (kind: PaletteKind, clientX: number, clientY: number) => {
      if (!activeArea) return
      const wrapper = planRef.current
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

  // La huella de lo que se arrastra desde la paleta: su tamaño real con el zoom actual.
  const footprint = useCallback((kind: PaletteKind) => {
    const def = ELEMENT_DEFAULTS[kind]
    const { scale } = readStageTransform(transformRef)
    return { width: def.width * scale, height: def.height * scale, round: def.shape === 'circle' }
  }, [])

  const { onChipPointerDown, shouldSuppressClick, ghostNode } = usePaletteDrag({
    wrapperRef: planRef,
    onDrop: handleDropKind,
    footprint,
  })

  const handleQuickAdd = useCallback(
    (kind: PaletteKind) => {
      const def = ELEMENT_DEFAULTS[kind]
      const center = areaCenter(def.width, def.height)
      insertAt(kind, center.x, center.y)
    },
    [areaCenter, insertAt],
  )

  const onPlace = useCallback(
    async (tableId: string) => {
      if (!activeArea) return
      const def = ELEMENT_DEFAULTS.table
      const center = areaCenter(def.width, def.height)
      const r = await placeTableAction(slug, {
        table_id: tableId,
        area_id: activeArea.id,
        x: center.x,
        y: center.y,
      })
      if (r.ok) {
        const id = (r.data as { id?: string } | undefined)?.id
        if (id) selectSet(new Set([id]))
        onChanged(true)
      } else {
        toast.error(r.message)
      }
    },
    [activeArea, areaCenter, slug, onChanged, selectSet],
  )

  // Borra una mesa de la bandeja de forma definitiva (mesa + QR). El RPC bloquea
  // si la mesa tuvo sesiones → mensaje "desactivala en su lugar".
  const onDeleteTrayTable = useCallback(
    (tableId: string) => {
      void (async () => {
        const r = await deleteTablePermanentlyAction(slug, tableId)
        if (r.ok) {
          toast.success('Mesa borrada.')
          onChanged()
        } else {
          toast.error(r.message)
        }
      })()
    },
    [slug, onChanged],
  )

  // ── Lo que se deriva para dibujar ──────────────────────────────────────────

  const counts = useMemo(() => sectorTableCounts(elements), [elements])
  const unplaced = useMemo(
    () =>
      unplacedWithRemoved(
        initial.unplacedTables,
        removedTables,
        new Set(elements.map((e) => e.physical_table_id).filter((id): id is string => id !== null)),
      ),
    [initial.unplacedTables, removedTables, elements],
  )
  const fitBox = useMemo(() => contentBox(areaElements), [areaElements])
  const extent = useMemo(
    () =>
      areaElements.reduce(
        (acc, el) => ({
          width: Math.max(acc.width, el.x + el.width),
          height: Math.max(acc.height, el.y + el.height),
        }),
        { width: 0, height: 0 },
      ),
    [areaElements],
  )
  const listed = useMemo(() => listTables(initial), [initial])
  const suggestedStart = useMemo(
    () => suggestNumberStart(listed.filter((t) => t.active).map((t) => t.label)),
    [listed],
  )

  const selectedCount = selectedIds.size
  const selectedSingle =
    selectedCount === 1 ? (elements.find((e) => selectedIds.has(e.id)) ?? null) : null
  const selectedTableId = selectedSingle?.kind === 'table' ? selectedSingle.physical_table_id : null
  const mergeCandidates = useMemo(
    () =>
      elements
        .filter(
          (el) =>
            el.kind === 'table' &&
            el.physical_table_id &&
            el.table &&
            el.physical_table_id !== selectedTableId,
        )
        .map((el) => ({ id: el.physical_table_id as string, label: el.table?.label ?? '' }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true })),
    [elements, selectedTableId],
  )
  const areaTables = areaElements.filter((el) => el.kind === 'table' && el.physical_table_id)
  const areaSeats = areaTables.reduce((sum, el) => sum + (el.table?.capacity ?? DEFAULT_SEATS), 0)
  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0

  // Tocar una mesa en la maqueta la elige en el editor.
  const selectTable = useCallback(
    (tableId: string) => {
      const el = elementsRef.current.find((e) => e.physical_table_id === tableId)
      if (el) selectSet(new Set([el.id]))
    },
    [selectSet],
  )

  const liveModelOn = posEnabled && branch !== null
  const live = useLiveModel({
    enabled: mode === 'vivo' && liveModelOn,
    slug,
    branchId: branch?.id ?? null,
    timeZone,
  })

  const chooseMode = (next: Mode) => {
    if (next !== 'editar') clearSelection()
    setMode(next)
  }
  const chooseArea = (id: string) => {
    clearSelection()
    setActiveAreaId(id)
  }
  const onSectorCreated = (areaId: string | null) => {
    wantedAreaRef.current = areaId
    onChanged()
  }

  const frameStyle = branch ? ({ '--branch': branch.color } as React.CSSProperties) : undefined

  return (
    <>
      <div ref={hostRef} className="fpe-host">
        <section
          className="fpe"
          aria-label="Plano del salón"
          data-mode={mode}
          data-ink={branch ? inkOn(branch.color) : 'light'}
          style={frameStyle}
        >
          <header className="fpe-band">
            <h1 className="fpe-title">Plano del salón</h1>

            {multiBranch ? (
              <nav className="fpe-branches" aria-label="Sucursal">
                {branches.map((b) => (
                  <Link
                    key={b.id}
                    href={planHref(slug, b.slug)}
                    scroll={false}
                    className="fpe-branch"
                    aria-current={b.id === branch?.id ? 'page' : undefined}
                    style={{ '--swatch': b.color } as React.CSSProperties}
                  >
                    <span className="fpe-swatch" aria-hidden />
                    {b.name}
                    <BranchPending />
                  </Link>
                ))}
              </nav>
            ) : null}

            {/* biome-ignore lint/a11y/useSemanticElements: un grupo de botones con nombre, no un formulario */}
            <div className="fpe-modes" role="group" aria-label="Qué querés hacer">
              <button
                type="button"
                className="fpe-mode"
                aria-pressed={mode === 'editar'}
                onClick={() => chooseMode('editar')}
              >
                <PencilRuler aria-hidden />
                Editar
              </button>
              <button
                type="button"
                className="fpe-mode"
                aria-pressed={mode === 'vivo'}
                onClick={() => chooseMode('vivo')}
              >
                <Radio aria-hidden />
                En vivo
              </button>
              <button
                type="button"
                className="fpe-mode"
                aria-pressed={mode === 'lista'}
                onClick={() => chooseMode('lista')}
              >
                <LayoutList aria-hidden />
                Lista
              </button>
            </div>
          </header>

          {mode !== 'lista' && areas.length > 0 ? (
            <SectorTabs
              slug={slug}
              branchId={branch?.id ?? null}
              multiBranch={multiBranch}
              areas={areas}
              activeAreaId={activeArea?.id ?? ''}
              counts={counts}
              pending={mode === 'vivo' && liveModelOn ? live.pending : null}
              editable={mode === 'editar'}
              suggestedStart={suggestedStart}
              extent={extent}
              onSelect={chooseArea}
              onCreated={onSectorCreated}
              onChanged={() => onChanged(true)}
            />
          ) : null}

          <div className="fpe-body">
            {mode === 'lista' ? (
              <TablesListFallback
                slug={slug}
                tables={listed}
                qrEnabled={qrEnabled}
                branchName={multiBranch ? (branch?.name ?? null) : null}
              />
            ) : !activeArea ? (
              // Sucursal sin sectores: se enseña a dibujar el primero.
              <div className="fpe-empty">
                <EmptyFloorArt className="fpe-empty-art" />
                <h2>
                  {multiBranch && branch
                    ? `Dibujá el primer sector de ${branch.name}`
                    : 'Dibujá el primer sector'}
                </h2>
                <p>
                  Un sector es un piso o un ambiente del local: «Salón», «Planta alta», «Terraza».
                  Ponele nombre y después ubicás sus mesas, la barra y las paredes como están en la
                  realidad.
                </p>
                <div className="fpe-paper fpe-empty-form">
                  <SectorCreateForm
                    slug={slug}
                    branchId={branch?.id ?? null}
                    sectors={areas}
                    multiBranch={multiBranch}
                    suggestedStart={suggestedStart}
                    onCreated={onSectorCreated}
                  />
                </div>
              </div>
            ) : mode === 'vivo' ? (
              liveModelOn ? (
                <LivePane
                  slug={slug}
                  branch={branch}
                  areaId={activeArea.id}
                  areaName={activeArea.name}
                  live={live}
                />
              ) : (
                <LegacyLive key={activeArea.id} slug={slug} tenantId={tenantId} area={activeArea} />
              )
            ) : (
              <>
                <EditorToolbar
                  view={view}
                  canSplit={canSplit}
                  onView={chooseView}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={undo}
                  onRedo={redo}
                  onAddTable={() => handleQuickAdd('table')}
                  onAddTablePointerDown={(e) => onChipPointerDown('table', 'Mesa', e)}
                  shouldSuppressClick={shouldSuppressClick}
                  bulk={
                    <BulkCreateDialog
                      slug={slug}
                      areaId={activeArea.id}
                      areaName={activeArea.name}
                      onCreated={() => onChanged()}
                    />
                  }
                  qr={
                    qrEnabled
                      ? {
                          ready: areaTables.length > 0,
                          onPrint: () =>
                            window.open(`/print/qrs/${activeArea.id}`, '_blank', 'noopener'),
                        }
                      : null
                  }
                />

                <div className="fpe-work" data-view={view}>
                  <ElementPalette
                    onQuickAdd={handleQuickAdd}
                    onChipPointerDown={onChipPointerDown}
                    shouldSuppressClick={shouldSuppressClick}
                  />

                  <div ref={planRef} className="fpe-pane fpe-pane-plan">
                    <EditorStage
                      width={activeArea.width}
                      height={activeArea.height}
                      transformRef={transformRef}
                      content={fitBox}
                      fitKey={activeArea.id}
                      onBackground={clearSelection}
                      label={`Plano de ${activeArea.name}`}
                      overlay={
                        <>
                          <ContextualToolbar
                            count={selectedCount}
                            name={selectedSingle ? elementName(selectedSingle) : ''}
                            canPrintQr={qrEnabled && selectedSingle?.kind === 'table'}
                            onRotate90={rotate90}
                            onBringFront={() => bringTo('front')}
                            onBringBack={() => bringTo('back')}
                            onDuplicate={duplicateSelected}
                            onQr={printQrSelected}
                            onAlign={alignSelected}
                            onDelete={removeSelected}
                          />
                          {areaElements.length === 0 ? (
                            <div className="fpe-canvas-empty">
                              <div className="fpe-note fpe-ui">
                                <h3>Empezá a dibujar {activeArea.name}</h3>
                                <p>
                                  Tocá «Agregar mesa» y aparece en el medio del piso, o arrastrala
                                  desde la barra de arriba hasta su lugar. La maqueta se arma sola
                                  mientras dibujás.
                                </p>
                                <div className="fpe-note-actions">
                                  <button
                                    type="button"
                                    className="fpe-btn fpe-btn-primary"
                                    onClick={() => handleQuickAdd('table')}
                                  >
                                    <Plus aria-hidden />
                                    Agregar mesa
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      }
                    >
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
                          onLive={onLive}
                          onGuides={setGuides}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                        />
                      ))}
                    </EditorStage>
                  </div>

                  <div className="fpe-pane fpe-pane-model">
                    {showModel ? (
                      <MaquetaPane
                        elements={areaElements}
                        areaName={activeArea.name}
                        live={liveStore}
                        selectedTableId={selectedTableId}
                        onTable={selectTable}
                        standUp={viewChosenRef.current}
                      />
                    ) : null}
                  </div>

                  <aside
                    className={cn('fpe-side fpe-paper')}
                    aria-label={
                      selectedSingle
                        ? `Ficha de ${elementName(selectedSingle)}`
                        : selectedCount > 1
                          ? 'Varios elementos elegidos'
                          : `Sector ${activeArea.name}`
                    }
                  >
                    {selectedSingle && selectedSingle.kind === 'table' ? (
                      <TableInspector
                        key={selectedSingle.id}
                        slug={slug}
                        element={selectedSingle}
                        others={mergeCandidates}
                        qrEnabled={qrEnabled}
                        onPatch={patchElement}
                        onHold={holdPatch}
                        flushGeometry={queue.flushNow}
                        onRotate={rotate90}
                        onDuplicate={duplicateSelected}
                        onFront={() => bringTo('front')}
                        onBack={() => bringTo('back')}
                        onRemove={removeSelected}
                        onChanged={onChanged}
                        onClose={clearSelection}
                      />
                    ) : selectedSingle ? (
                      <DecorInspector
                        key={selectedSingle.id}
                        slug={slug}
                        element={selectedSingle}
                        onPatch={patchElement}
                        onHold={holdPatch}
                        flushGeometry={queue.flushNow}
                        onRotate={rotate90}
                        onDuplicate={duplicateSelected}
                        onFront={() => bringTo('front')}
                        onBack={() => bringTo('back')}
                        onRemove={removeSelected}
                        onClose={clearSelection}
                      />
                    ) : selectedCount > 1 ? (
                      <GroupPanel
                        count={selectedCount}
                        onAlign={alignSelected}
                        onRemove={removeSelected}
                        onClose={clearSelection}
                      />
                    ) : (
                      <SectorPanel
                        areaName={activeArea.name}
                        tables={areaTables.length}
                        seats={areaSeats}
                        unplaced={unplaced}
                        onPlace={onPlace}
                        onDeleteTable={onDeleteTrayTable}
                      />
                    )}
                  </aside>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Fuera del contenedor medido: ahí adentro `position: fixed` no sigue a la ventana. */}
      {ghostNode}
    </>
  )
}
