'use client'

import { Bell, CircleDot, Receipt, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { addDecorAction, createTableInPlanAction, placeTableAction } from '@/lib/floor-plan/actions'
import { clampToArea, ELEMENT_DEFAULTS, GRID, snapToGrid } from '@/lib/floor-plan/grid'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'
import type {
  AreaRow,
  ElementRow,
  FloorPlanData,
  LiveFloorData,
  LiveTable,
} from '@/lib/floor-plan/queries'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
import { AreaManager } from './area-manager'
import { DecorInspector } from './decor-inspector'
import { ElementPalette } from './element-palette'
import { FloorElement } from './floor-element'
import { LiveFloor } from './live-floor'
import { PanZoomStage, stagePointFromClient } from './pan-zoom-stage'
import { TableInspector } from './table-inspector'
import { TablesListFallback } from './tables-list-fallback'
import { UnplacedTray } from './unplaced-tray'
import { useGeometryQueue } from './use-geometry-queue'

export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  initial: FloorPlanData
  liveAreas: AreaRow[]
  initialLive: LiveFloorData | null
}

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar'
type Mode = 'editar' | 'vivo'

export function FloorPlanEditor({
  slug,
  tenantId,
  initial,
  liveAreas,
  initialLive,
}: FloorPlanEditorProps) {
  const router = useRouter()

  // areas / unplaced son read-only: derivan de props (router.refresh re-siembra).
  const areas = initial.areas
  const unplaced = initial.unplacedTables

  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('editar')

  // Detalle de mesa en vivo (panel read-only del dueño; no hay ruta de sesión en (manager)).
  const [liveDetail, setLiveDetail] = useState<LiveTable | null>(null)

  const onLiveTableOpen = useCallback((table: LiveTable) => {
    setLiveDetail(table)
  }, [])

  // Ref único del stage de react-zoom-pan-pinch (scale/positionX/positionY).
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  // Wrapper del stage para medir su rect en el drop-from-palette.
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Re-sync de elements cuando cambian los datos del server (firma de contenido
  // para no resetear en cada render — initial es una ref nueva cada vez).
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

  // Guard: si borraron el área activa, caer a la primera.
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

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null
  const areaElements = useMemo(
    () => (activeArea ? elements.filter((el) => el.area_id === activeArea.id) : []),
    [elements, activeArea],
  )
  const selectedElement = elements.find((el) => el.id === selectedId) ?? null

  // Tras mutaciones estructurales: deseleccionar + recargar el RSC.
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
      // Snapshot solo del primer cambio de este id en el batch corriente.
      if (!prevGeomRef.current.has(el.id)) {
        prevGeomRef.current.set(el.id, {
          id: el.id,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          z_index: el.z_index,
        })
      }
      setElements((current) => current.map((e) => (e.id === el.id ? { ...e, ...next } : e)))
      queue.enqueue({ id: el.id, ...next })
    },
    [queue],
  )

  // Move optimista durante el drag de un elemento (FloorElement → onMove).
  const handleMove = useCallback(
    (id: string, x: number, y: number) => {
      const el = elements.find((e) => e.id === id)
      if (!el) return
      if (el.x === x && el.y === y) return
      commitGeometry(el, { x, y, width: el.width, height: el.height, z_index: el.z_index })
    },
    [elements, commitGeometry],
  )

  const handleResizeEnd = useCallback(
    (id: string, size: { width: number; height: number }) => {
      if (!activeArea) return
      const el = elements.find((e) => e.id === id)
      if (!el) return
      const width = snapToGrid(size.width)
      const height = snapToGrid(size.height)
      const clamped = clampToArea(el.x, el.y, width, height, activeArea.width, activeArea.height)
      commitGeometry(el, { x: clamped.x, y: clamped.y, width, height, z_index: el.z_index })
    },
    [activeArea, elements, commitGeometry],
  )

  // Centro lógico del área activa (para el fallback no-drag de la paleta).
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

  // Crea/coloca el kind en el punto lógico (x,y) ya clampeado.
  const insertAt = useCallback(
    (kind: Kind, x: number, y: number) => {
      if (!activeArea) return
      if (kind === 'table') {
        // Autosugerir el próximo label libre del área (el inspector permite editarlo).
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
            // Re-sembrar y abrir el inspector de la mesa nueva (por su element_id).
            setSelectedId(r.elementId)
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
        if (r.ok) onChanged()
        else toast.error(r.message)
      })()
    },
    [activeArea, slug, router, onChanged, elements],
  )

  // Drop-from-palette: punto de pantalla → coords lógicas del stage → clamp → insertar.
  const handleDropKind = useCallback(
    (kind: Kind, clientX: number, clientY: number) => {
      if (!activeArea) return
      const wrapper = wrapperRef.current
      const state = transformRef.current?.state
      if (!wrapper || !state) return
      const rect = wrapper.getBoundingClientRect()
      const point = stagePointFromClient(
        clientX,
        clientY,
        rect,
        state.scale,
        state.positionX,
        state.positionY,
      )
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

  // Fallback no-drag de la paleta: agregar en el centro del área activa.
  const handleQuickAdd = useCallback(
    (kind: Kind) => {
      const def = ELEMENT_DEFAULTS[kind]
      const center = areaCenter(def.width, def.height)
      insertAt(kind, center.x, center.y)
    },
    [areaCenter, insertAt],
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

  // Merge-select del inspector: mesas (activas) ubicadas en el plano.
  const allTables = useMemo(
    () =>
      elements
        .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
        .map((el) => ({ id: el.physical_table_id as string, label: el.table?.label ?? '' })),
    [elements],
  )

  // Lista accesible canónica: ubicadas + bandeja.
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

  return (
    <>
      <Tabs defaultValue="plano" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="plano">Plano</TabsTrigger>
            <TabsTrigger value="lista">Lista</TabsTrigger>
          </TabsList>

          {/* Toggle Editar / En vivo (solo aplica a la pestaña Plano). */}
          <div className="inline-flex items-center rounded-lg border border-border/60 bg-card p-0.5">
            <button
              type="button"
              onClick={() => setMode('editar')}
              aria-pressed={mode === 'editar'}
              className={
                mode === 'editar'
                  ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground'
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
                  ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground'
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
              <p className="text-sm text-muted-foreground">
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
                  setSelectedId(null)
                  setActiveAreaId(id)
                }}
                onChanged={onChanged}
              />

              <div className="space-y-3">
                <ElementPalette onQuickAdd={handleQuickAdd} />
                <div ref={wrapperRef}>
                  <PanZoomStage
                    width={activeArea.width}
                    height={activeArea.height}
                    transformRef={transformRef}
                    interactive
                    gridSize={GRID}
                    onBackgroundClick={() => setSelectedId(null)}
                    onDropKind={handleDropKind}
                  >
                    {areaElements.map((element) => (
                      <FloorElement
                        key={element.id}
                        element={element}
                        selected={element.id === selectedId}
                        transformRef={transformRef}
                        areaWidth={activeArea.width}
                        areaHeight={activeArea.height}
                        onSelect={setSelectedId}
                        onMove={handleMove}
                        onResizeEnd={handleResizeEnd}
                      />
                    ))}
                  </PanZoomStage>
                </div>
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
            </div>
          )}
        </TabsContent>

        <TabsContent value="lista">
          <TablesListFallback slug={slug} tables={fallbackTables} />
        </TabsContent>
      </Tabs>

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
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Gasto acumulado
                </span>
                <span className="font-serif text-2xl font-semibold tabular-nums">
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
              <p className="text-xs text-muted-foreground">
                La gestión de la mesa (cobrar, dividir, mover) se hace desde el salón.
              </p>
            </div>
          ) : (
            <div className="px-6 py-6">
              <p className="text-sm text-muted-foreground">
                Esta mesa no tiene una sesión abierta en este momento.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
