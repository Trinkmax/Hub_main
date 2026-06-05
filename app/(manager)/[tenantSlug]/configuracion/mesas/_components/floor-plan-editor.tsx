'use client'

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { floorPlanAnnouncements, floorPlanScreenReaderInstructions } from '@/lib/floor-plan/a11y'
import { addDecorAction, placeTableAction } from '@/lib/floor-plan/actions'
import {
  clampToArea,
  createSnapModifier,
  ELEMENT_DEFAULTS,
  GRID,
  restrictToParent,
  snapToGrid,
} from '@/lib/floor-plan/grid'
import type { ElementRow, FloorPlanData } from '@/lib/floor-plan/queries'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'
import { AreaManager } from './area-manager'
import { CreateTableDialog } from './create-table-dialog'
import { DecorInspector } from './decor-inspector'
import { ElementPalette } from './element-palette'
import { FloorCanvas } from './floor-canvas'
import { TableInspector } from './table-inspector'
import { TablesListFallback } from './tables-list-fallback'
import { TRAY_DRAG_PREFIX, UnplacedTray } from './unplaced-tray'
import { useGeometryQueue } from './use-geometry-queue'

export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  initial: FloorPlanData
}

const MIN_SCALE = 0.25
const MAX_SCALE = 2
const ZOOM_STEP = 0.2

type DecorKind = 'wall' | 'pillar' | 'island' | 'bar'

export function FloorPlanEditor({ slug, initial }: FloorPlanEditorProps) {
  const router = useRouter()

  // areas and unplaced are read-only (never optimistically mutated) — derive
  // directly from props so router.refresh() (new initial) updates them.
  const areas = initial.areas
  const unplaced = initial.unplacedTables

  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [createOpen, setCreateOpen] = useState(false)

  // Re-sync elements when server data changes after router.refresh().
  // initial is a new object reference every render, so we use a content
  // signature to avoid resetting on every render.
  const initialSig = useMemo(
    () =>
      initial.elements
        .map(
          (e) =>
            `${e.id}:${e.x}:${e.y}:${e.width}:${e.height}:${e.z_index}:${e.label}:${e.color}:${e.table ? `${e.table.active}:${e.table.label}:${e.table.capacity}` : ''}`,
        )
        .join('|'),
    [initial],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync solo cuando cambian los datos del server (initialSig), no en cada render
  useEffect(() => {
    setElements(initial.elements)
  }, [initialSig])

  // Guard activeAreaId: if the active area was deleted, fall back to the first.
  useEffect(() => {
    const first = areas[0]
    if (!first) return
    if (!areas.find((a) => a.id === activeAreaId)) {
      setActiveAreaId(first.id)
    }
  }, [areas, activeAreaId])

  // Snapshot de geometría previa por id, para revertir si el flush falla.
  const prevGeomRef = useRef<Map<string, ElementGeometry>>(new Map())

  const onQueueError = useCallback((ids: string[]) => {
    setElements((current) => {
      const snap = prevGeomRef.current
      return current.map((el) => {
        const prev = snap.get(el.id)
        if (!prev) return el
        if (!ids.includes(el.id)) return el
        return {
          ...el,
          x: prev.x,
          y: prev.y,
          width: prev.width,
          height: prev.height,
          z_index: prev.z_index,
        }
      })
    })
    toast.error('No se pudo guardar la posición. Revertimos el cambio; reintentá.')
  }, [])

  const queue = useGeometryQueue(slug, onQueueError)

  // Modifiers re-creados cuando cambia scale (cierran sobre el scale vigente).
  const getScale = useCallback(() => scale, [scale])
  const modifiers = useMemo(
    () => [createSnapModifier(GRID, getScale), restrictToParent(getScale)],
    [getScale],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, { currentCoordinates }) => {
        const step = GRID * scale
        switch (event.code) {
          case 'ArrowRight':
            return { ...currentCoordinates, x: currentCoordinates.x + step }
          case 'ArrowLeft':
            return { ...currentCoordinates, x: currentCoordinates.x - step }
          case 'ArrowDown':
            return { ...currentCoordinates, y: currentCoordinates.y + step }
          case 'ArrowUp':
            return { ...currentCoordinates, y: currentCoordinates.y - step }
          default:
            return undefined
        }
      },
    }),
  )

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null
  const areaElements = useMemo(
    () => (activeArea ? elements.filter((el) => el.area_id === activeArea.id) : []),
    [elements, activeArea],
  )
  const selectedElement = elements.find((el) => el.id === selectedId) ?? null

  // Tras mutaciones estructurales: deseleccionar + recargar el RSC (re-siembra initial).
  const onChanged = useCallback(() => {
    setSelectedId(null)
    router.refresh()
  }, [router])

  // Persiste geometría optimista y encola (guardando snapshot para rollback).
  const commitGeometry = useCallback(
    (
      el: ElementRow,
      next: { x: number; y: number; width: number; height: number; z_index: number },
    ) => {
      prevGeomRef.current.set(el.id, {
        id: el.id,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        z_index: el.z_index,
      })
      setElements((current) => current.map((e) => (e.id === el.id ? { ...e, ...next } : e)))
      queue.enqueue({ id: el.id, ...next })
    },
    [queue],
  )

  // Centro lógico del área activa (para alta de mesa/decor y colocar de bandeja).
  const areaCenter = useCallback(
    (w: number, h: number) => {
      if (!activeArea) return { x: 0, y: 0 }
      return clampToArea(
        snapToGrid(activeArea.width / 2 - w / 2, GRID),
        snapToGrid(activeArea.height / 2 - h / 2, GRID),
        w,
        h,
        activeArea.width,
        activeArea.height,
      )
    },
    [activeArea],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!activeArea) return
      const rawId = String(event.active.id)

      // Drag desde la bandeja → colocar mesa en el centro del área activa.
      if (rawId.startsWith(TRAY_DRAG_PREFIX)) {
        const tableId = rawId.slice(TRAY_DRAG_PREFIX.length)
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
        return
      }

      // Drag de un elemento del plano → pipeline canónica (snap lógico + clamp).
      const el = elements.find((e) => e.id === rawId)
      if (!el) return
      const logicalX = snapToGrid(el.x + event.delta.x / scale, GRID)
      const logicalY = snapToGrid(el.y + event.delta.y / scale, GRID)
      const clamped = clampToArea(
        logicalX,
        logicalY,
        el.width,
        el.height,
        activeArea.width,
        activeArea.height,
      )
      if (clamped.x === el.x && clamped.y === el.y) return
      commitGeometry(el, {
        x: clamped.x,
        y: clamped.y,
        width: el.width,
        height: el.height,
        z_index: el.z_index,
      })
    },
    [activeArea, elements, scale, areaCenter, slug, onChanged, commitGeometry],
  )

  const handleResizeEnd = useCallback(
    (id: string, size: { width: number; height: number }) => {
      if (!activeArea) return
      const el = elements.find((e) => e.id === id)
      if (!el) return
      const width = snapToGrid(size.width, GRID)
      const height = snapToGrid(size.height, GRID)
      const clamped = clampToArea(el.x, el.y, width, height, activeArea.width, activeArea.height)
      commitGeometry(el, {
        x: clamped.x,
        y: clamped.y,
        width,
        height,
        z_index: el.z_index,
      })
    },
    [activeArea, elements, commitGeometry],
  )

  // Zoom/pan: estado en el editor, controles en el canvas.
  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, Math.round((s + ZOOM_STEP) * 100) / 100)),
    [],
  )
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, Math.round((s - ZOOM_STEP) * 100) / 100)),
    [],
  )
  const fit = useCallback(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Paleta: "Mesa" abre el diálogo; decoración inserta el elemento en el centro.
  const onAddTable = useCallback(() => setCreateOpen(true), [])
  const onAddDecor = useCallback(
    (kind: DecorKind) => {
      if (!activeArea) return
      const def = ELEMENT_DEFAULTS[kind]
      const center = areaCenter(def.width, def.height)
      void (async () => {
        const r = await addDecorAction(slug, {
          area_id: activeArea.id,
          kind,
          shape: def.shape,
          x: center.x,
          y: center.y,
          width: def.width,
          height: def.height,
          label: null,
          color: null,
        })
        if (r.ok) onChanged()
        else toast.error(r.message)
      })()
    },
    [activeArea, areaCenter, slug, onChanged],
  )

  // Bandeja: "Colocar" ubica la mesa en el centro del área activa.
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

  // Para el merge-select del inspector: mesas (activas) ubicadas en el plano.
  const allTables = useMemo(
    () =>
      elements
        .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
        .map((el) => ({ id: el.physical_table_id as string, label: el.table?.label ?? '' })),
    [elements],
  )

  // Labels de mesas del área activa, para autosugerir el alta.
  const areaTableLabels = useMemo(
    () =>
      areaElements
        .filter((el) => el.kind === 'table' && el.table)
        .map((el) => el.table?.label ?? '')
        .filter((l) => l.length > 0),
    [areaElements],
  )

  // Lista accesible canónica: ubicadas (elemento kind='table') + bandeja.
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

  if (!activeArea) return null

  const tableCenter = areaCenter(ELEMENT_DEFAULTS.table.width, ELEMENT_DEFAULTS.table.height)

  return (
    <Tabs defaultValue="plano" className="gap-4">
      <TabsList>
        <TabsTrigger value="plano">Plano</TabsTrigger>
        <TabsTrigger value="lista">Lista</TabsTrigger>
      </TabsList>

      <TabsContent value="plano">
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
          <AreaManager
            slug={slug}
            areas={areas}
            activeAreaId={activeAreaId}
            onActiveAreaChange={(id) => {
              setSelectedId(null)
              setActiveAreaId(id)
            }}
            onChanged={onChanged}
          />

          <DndContext
            sensors={sensors}
            modifiers={modifiers}
            autoScroll={false}
            onDragEnd={handleDragEnd}
            accessibility={{
              announcements: floorPlanAnnouncements,
              screenReaderInstructions: floorPlanScreenReaderInstructions,
            }}
          >
            <div className="space-y-3">
              <ElementPalette onAddTable={onAddTable} onAddDecor={onAddDecor} />
              <FloorCanvas
                area={activeArea}
                elements={areaElements}
                scale={scale}
                pan={pan}
                selectedId={selectedId}
                onSelectElement={setSelectedId}
                onResizeEnd={handleResizeEnd}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onFit={fit}
              />
            </div>

            <aside className="space-y-3">
              {selectedElement && selectedElement.kind === 'table' ? (
                <TableInspector
                  slug={slug}
                  element={selectedElement}
                  allTables={allTables}
                  onChanged={onChanged}
                  onClose={() => setSelectedId(null)}
                />
              ) : selectedElement ? (
                <DecorInspector
                  slug={slug}
                  element={selectedElement}
                  onChanged={onChanged}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <UnplacedTray tables={unplaced} onPlace={onPlace} />
              )}
            </aside>
          </DndContext>
        </div>

        <CreateTableDialog
          slug={slug}
          areaId={activeArea.id}
          areaNumberStart={activeArea.number_start}
          existingLabels={areaTableLabels}
          centerX={tableCenter.x}
          centerY={tableCenter.y}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={onChanged}
        />
      </TabsContent>

      <TabsContent value="lista">
        <TablesListFallback slug={slug} tables={fallbackTables} />
      </TabsContent>
    </Tabs>
  )
}
