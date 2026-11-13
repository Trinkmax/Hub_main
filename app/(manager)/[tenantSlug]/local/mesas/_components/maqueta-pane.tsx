'use client'

import { useEffect, useMemo, useState } from 'react'
import { FloorModel } from '@/components/pos/floor/floor-model'
import type { LiveGeometryStore } from '@/lib/floor-plan/live-geometry'
import { freeTables, tableOrdinal, toFloorElements } from '@/lib/floor-plan/model'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { ModelGlyph } from './glyphs'

export type MaquetaPaneProps = {
  /** Los elementos del sector, tal como están en el editor (sin guardar incluido). */
  elements: readonly ElementRow[]
  areaName: string
  /** Lo que se está arrastrando, estirando o girando en este momento. */
  live: LiveGeometryStore
  /** La mesa elegida en el editor (id de mesa), para marcarla en la maqueta. */
  selectedTableId: string | null
  onTable: (tableId: string) => void
  /** Se entra desde el plano: la maqueta «se para» en vez de aparecer armada. */
  standUp: boolean
}

/** La geometría en el aire, a lo sumo una vez por cuadro. */
function useLiveGeometry(store: LiveGeometryStore) {
  const [snapshot, setSnapshot] = useState(() => store.get())
  useEffect(() => {
    let frame = 0
    setSnapshot(store.get())
    const unsubscribe = store.subscribe(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setSnapshot(store.get())
      })
    })
    return () => {
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [store])
  return snapshot
}

/**
 * La maqueta del sector mientras se edita: la MISMA que ve el salón
 * (`FloorModel`), con todas las mesas libres. Se alimenta del estado del editor
 * (no del servidor), así acompaña cada cambio: una mesa que se arrastra en el
 * plano se mueve acá al mismo tiempo.
 */
export function MaquetaPane({
  elements,
  areaName,
  live,
  selectedTableId,
  onTable,
  standUp,
}: MaquetaPaneProps) {
  const overrides = useLiveGeometry(live)
  const model = useMemo(() => toFloorElements(elements, overrides), [elements, overrides])
  const tables = useMemo(() => freeTables(model), [model])
  const tableCount = Object.keys(tables).length

  // Al venir del plano la maqueta arranca acostada y se levanta (la cámara de
  // FloorModel anima de 'plan' a 'model'): el plano se convierte en maqueta.
  const [raised, setRaised] = useState(!standUp)
  useEffect(() => {
    if (raised) return
    const frame = requestAnimationFrame(() => setRaised(true))
    return () => cancelAnimationFrame(frame)
  }, [raised])

  // La mesa elegida se marca en la maqueta: su zona de toque es la enésima
  // (`tableOrdinal` sigue el mismo orden en que FloorModel las dibuja).
  const ordinal = selectedTableId ? tableOrdinal(model, selectedTableId) : null

  return (
    <>
      <span className="fpe-pane-tag">
        <ModelGlyph />
        Así lo ve el salón
      </span>
      {ordinal ? (
        // El marco va sobre la mesa: la zona de toque sube 26 px más para abarcar su bandera.
        <style>{`.fpe-pane .fpe-model .pos-hit:nth-of-type(${ordinal})::after{content:"";position:absolute;inset:26px 0 0;border-radius:14px;box-shadow:0 0 0 3px var(--fpe-select),0 0 0 7px var(--fpe-select-soft);background:oklch(0.56 0.19 256 / 0.1);pointer-events:none}`}</style>
      ) : null}
      <FloorModel
        className="fpe-model"
        elements={model}
        tables={tables}
        view={raised ? 'model' : 'plan'}
        onTable={onTable}
        label={`Maqueta de ${areaName}: ${tableCount} ${tableCount === 1 ? 'mesa' : 'mesas'}`}
      />
      {model.length === 0 ? (
        <p className="fpe-model-empty">Lo que dibujes en el plano aparece acá, armado.</p>
      ) : null}
    </>
  )
}
