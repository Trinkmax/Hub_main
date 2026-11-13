/**
 * Lo que el dueño tiene «en el aire» mientras arrastra, estira o gira — PURO y
 * testeado (`tests/lib/floor-plan-live-geometry.test.ts`).
 *
 * El editor mueve los elementos sin pasar por el estado de React (60 cuadros
 * por segundo no aguantan un render del plano entero) y recién al soltar guarda
 * la posición. La maqueta de al lado tiene que acompañar el gesto, así que el
 * gesto deja acá su geometría provisoria y la maqueta la lee: el plano no se
 * vuelve a dibujar y la maqueta sí.
 *
 * Cada cambio arma un mapa nuevo (nunca se muta el anterior), así quien lo usa
 * en un `useMemo` se entera por identidad.
 */
import type { LiveGeometry } from './model'

export type LiveGeometryStore = {
  /** La foto actual: id de elemento → geometría provisoria. */
  get(): ReadonlyMap<string, LiveGeometry>
  /** Mezcla la geometría provisoria de un elemento con la que ya tenía. */
  set(id: string, geometry: LiveGeometry): void
  /** Varios elementos de una (un grupo que se arrastra junto). */
  setMany(entries: Iterable<readonly [string, LiveGeometry]>): void
  /** Terminó el gesto: vuelve a mandar la geometría guardada. */
  clear(): void
  /** Avisa en cada cambio. Devuelve cómo desuscribirse. */
  subscribe(listener: () => void): () => void
}

const EMPTY: ReadonlyMap<string, LiveGeometry> = new Map()

export function createLiveGeometryStore(): LiveGeometryStore {
  let snapshot: ReadonlyMap<string, LiveGeometry> = EMPTY
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const merge = (
    base: Map<string, LiveGeometry>,
    id: string,
    geometry: LiveGeometry,
  ): Map<string, LiveGeometry> => {
    base.set(id, { ...base.get(id), ...geometry })
    return base
  }

  return {
    get: () => snapshot,
    set(id, geometry) {
      snapshot = merge(new Map(snapshot), id, geometry)
      emit()
    },
    setMany(entries) {
      const next = new Map(snapshot)
      let touched = false
      for (const [id, geometry] of entries) {
        merge(next, id, geometry)
        touched = true
      }
      if (!touched) return
      snapshot = next
      emit()
    },
    clear() {
      if (snapshot.size === 0) return
      snapshot = EMPTY
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
