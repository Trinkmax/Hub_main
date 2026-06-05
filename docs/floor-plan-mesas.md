# Plano de mesas (floor-plan editor)

Editor visual de plano de mesas para el dueño (`owner`, workspace `(manager)`).
Permite dibujar la distribución real del local: áreas/pisos, mesas con su QR y
elementos de decoración (paredes, columnas, islas, barras), arrastrando y
redimensionando sobre un canvas con grilla, zoom y pan.

Ruta: `/{tenantSlug}/configuracion/mesas` (solo `owner`).

## Modelo de datos

- `floor_plan_areas` — áreas/pisos configurables por tenant (nombre, posición,
  ancho/alto lógicos del canvas, `number_start` para autosugerir números de mesa).
- `floor_plan_elements` — todo lo que vive en el canvas: mesas (`kind='table'`,
  con `physical_table_id`) y decoración (`wall`/`pillar`/`island`/`bar`).
  `physical_tables` queda intacto (las mesas físicas y sus QR no cambian).

Las RPCs `fp_*` (SECURITY DEFINER, owner-only) encapsulan las operaciones con
invariantes: crear/combinar/activar/borrar mesas y borrar áreas.

## Persistencia de geometría

Mover y redimensionar son operaciones de alta frecuencia: van por una cola
optimista (`use-geometry-queue.ts`) con debounce de 600 ms y flush en
`beforeunload`. Si el flush falla, el editor revierte el estado optimista de los
ids afectados y muestra un toast. Las mutaciones estructurales (alta/baja/merge,
áreas, colocar/quitar del plano) usan `router.refresh()` para re-sembrar el RSC.

El pipeline de commit de un drag es canónico: los deltas de dnd-kit vienen en px
de pantalla, así que se dividen por `scale` antes de snapear a la grilla en
espacio lógico y clampear al área (`snapToGrid(el.x + delta.x / scale)` →
`clampToArea`). El `DndContext` usa `autoScroll={false}` y mide contra el
viewport sin transform (el stage escalado vive dentro).

## Accesibilidad y fallback

El editor de plano es desktop-first y visual, pero el camino accesible es de
primera clase, no un respaldo de segunda:

- **Tab "Lista" (siempre presente):** dentro del editor, la tab secundaria "Lista"
  renderiza `TablesListFallback` — una `<table>` HTML real con todas las mesas y
  sus acciones (imprimir QR, regenerar token, activar/desactivar con un `Switch`,
  eliminar definitivamente solo si la mesa no tiene historial). No depende de
  `DndContext` ni del canvas.
- **Fallback de error:** el editor cliente se monta dentro de
  `FloorPlanErrorBoundary` (en `page.tsx`). Si revienta en render, la pantalla
  degrada a un banner `role="alert"` + `TablesListFallback`, sin perder la
  gestión de mesas.
- **dnd-kit en español:** `DndContext` recibe `floorPlanAnnouncements` y
  `floorPlanScreenReaderInstructions` (`lib/floor-plan/a11y.ts`) en es-AR; el
  live region anuncia levantar/mover/soltar/cancelar.

### Keymap del canvas

| Tecla | Acción |
|---|---|
| Click / Enter | Selecciona el elemento y abre su inspector |
| Barra espaciadora | Levanta el elemento para arrastre por teclado |
| Flechas ↑ ↓ ← → | Mueven el elemento levantado 1 celda de grilla (`GRID * scale` px) |
| Barra espaciadora (de nuevo) | Suelta el elemento en la posición nueva |
| Escape | Cancela el arrastre y vuelve a la posición original |

Los elementos decorativos llevan `aria-label` (kind + etiqueta) y el body es el
único activador del drag (los handles de resize cortan la propagación), de modo
que no quedan tab-stops mudos ni pelean drag y resize.
