/**
 * Lo que la persona acaba de cambiar, encima de lo último que se leyó de la base — PURO y
 * testeado (`tests/lib/pos-settings-overlay.test.ts`).
 *
 * En «Sucursales» nada tiene botón de guardar: se toca y queda. Para que se vea al instante,
 * cada cambio se anota acá mientras el servidor guarda:
 *
 *   · el servidor dice que sí → la marca deja de estar «guardando», y se queda hasta que llegue
 *     una lectura posterior al guardado (ahí manda la base y la marca sobra);
 *   · el servidor dice que no → la marca se va y vuelve a verse lo que hay en la base (o lo que
 *     el servidor contestó que hay ahora, si otra persona lo cambió).
 *
 * Es la misma idea que el borrador de «Precios» (`lib/menu/prices/view.ts`), sin atarse a una
 * forma: cada dato tiene una llave (`ajuste:creditSurchargeBp`, `sucursal:<id>:name`).
 */

export type OverlayEntry = {
  value: unknown
  /** El pedido que la escribió: un cambio posterior sobre el mismo dato la reemplaza. */
  token: number
  saving: boolean
  /** Reloj del servidor cuando terminó de guardarse. */
  savedAt: number | null
}

export type Overlay = Readonly<Record<string, OverlayEntry>>

export const EMPTY_OVERLAY: Overlay = {}

/** Lo que se acaba de cambiar se ve ya, marcado como «guardando». */
export function overlayStart(
  overlay: Overlay,
  token: number,
  entries: ReadonlyArray<readonly [key: string, value: unknown]>,
): Overlay {
  const next: Record<string, OverlayEntry> = { ...overlay }
  for (const [key, value] of entries) {
    next[key] = { value, token, saving: true, savedAt: null }
  }
  return next
}

/**
 * El servidor guardó. `loadedAt` es la lectura que la pantalla tiene en este momento: si ya es
 * posterior al guardado, las marcas de ese pedido sobran. `values` reemplaza lo anotado por lo
 * que de verdad quedó escrito (el servidor puede haber acomodado el dato: un texto sin
 * espacios de más).
 */
export function overlaySettle(
  overlay: Overlay,
  token: number,
  args: { savedAt: number; loadedAt: number; values?: Readonly<Record<string, unknown>> },
): Overlay {
  const covered = args.savedAt <= args.loadedAt
  const next: Record<string, OverlayEntry> = {}
  for (const [key, entry] of Object.entries(overlay)) {
    if (entry.token !== token) {
      next[key] = entry
      continue
    }
    if (covered) continue
    const value = args.values && key in args.values ? args.values[key] : entry.value
    next[key] = { ...entry, value, saving: false, savedAt: args.savedAt }
  }
  return next
}

/**
 * El pedido falló: todo lo suyo vuelve a lo leído. Con `current` (lo que el servidor dijo que
 * hay ahora, porque otra persona lo cambió) se muestra eso hasta la próxima lectura.
 */
export function overlayDrop(
  overlay: Overlay,
  token: number,
  current?: { at: number; loadedAt: number; values: Readonly<Record<string, unknown>> },
): Overlay {
  const next: Record<string, OverlayEntry> = {}
  for (const [key, entry] of Object.entries(overlay)) {
    if (entry.token !== token) {
      next[key] = entry
      continue
    }
    if (!current || current.at <= current.loadedAt || !(key in current.values)) continue
    next[key] = { value: current.values[key], token, saving: false, savedAt: current.at }
  }
  return next
}

/** Llegó una lectura nueva: lo que esa lectura ya incluye deja de hacer falta. */
export function overlaySync(overlay: Overlay, loadedAt: number): Overlay {
  let changed = false
  const next: Record<string, OverlayEntry> = {}
  for (const [key, entry] of Object.entries(overlay)) {
    if (entry.savedAt !== null && entry.savedAt <= loadedAt) {
      changed = true
      continue
    }
    next[key] = entry
  }
  return changed ? next : overlay
}

/** El valor que se muestra: lo anotado, o lo leído de la base si no hay nada anotado. */
export function overlayRead<T>(overlay: Overlay, key: string, base: T): T {
  const entry = overlay[key]
  return entry ? (entry.value as T) : base
}

/** ¿Ese dato se está guardando en este momento? */
export function overlaySaving(overlay: Overlay, key: string): boolean {
  return overlay[key]?.saving === true
}

/** ¿Hay algo guardándose? (para no tapar con una lectura vieja lo que se acaba de tocar) */
export function overlayBusy(overlay: Overlay): boolean {
  return Object.values(overlay).some((entry) => entry.saving)
}
