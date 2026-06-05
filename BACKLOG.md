# BACKLOG

Hallazgos fuera del scope de la tarea en curso, anotados para retomar
(ver CLAUDE.md §14.7). No bloquean el merge de la feature donde se detectaron.

## Carta del comensal + captura (rama `feat/carta-comensal-captura`)

- **Imágenes de menú huérfanas en Storage (ítems).** `deleteMenuImageByUrl`
  (`lib/menu/upload-image.ts`) ya se usa al reemplazar/limpiar la foto de una
  **categoría** (`category-edit-dialog.tsx`), pero el flujo de **ítems**
  (alta/edición) nunca borra la imagen previa al reemplazarla o quitarla → deja
  archivos huérfanos en el bucket `menu-images`. Aplicar el mismo patrón en el
  editor de ítems, o centralizar el borrado dentro de `MenuImageUploader` cuando
  cambia `value`.
- **`next/image unoptimized` en toda la carta del comensal.** Todas las imágenes
  de `/m/[qrToken]` usan `unoptimized` (convención preexistente: item-detail,
  closing-screen, mesa-screen, y las nuevas item-row/category-card/recommended).
  `next.config.ts` ya whitelistea `*.supabase.co/storage`, así que se podría
  habilitar la optimización de Next (responsive + WebP/AVIF + lazy) quitando
  `unoptimized`. Evaluar el tradeoff de costo de Image Optimization en Vercel
  vs. performance, y aplicarlo de forma consistente (no solo en los componentes
  nuevos) si se decide adoptar.
- **Carrusel "Recomendados": scroll por teclado.** El contenedor
  `overflow-x-auto` (`recommended-carousel.tsx`) no es operable con flechas del
  teclado (los botones internos sí son alcanzables por Tab). Coincide con el
  patrón del viejo `menu-list.tsx` (no es regresión). Mejora a11y: `role="region"`
  + manejo de Left/Right, o patrón WAI-ARIA de carrusel.
- **`OrderConfirmation`: focus-trap completo.** Se agregaron `role="dialog"`,
  `aria-modal`, `aria-labelledby` y foco al montar. Falta trap real (Tab no
  debería salir del overlay) y restaurar foco al cerrar. Evaluar migrar a shadcn
  `Dialog` para heredar estos comportamientos.
- **`CategoryCard` fallback sin imagen: acento dorado.** El spec (§4.1) pedía un
  "detalle dorado (acento)" en el contador cuando la categoría no tiene foto;
  hoy usa `text-primary-foreground/80`. Cosmético — definir el token de acento
  (¿`--forest-glow`/`--warning`?) y aplicarlo manteniendo contraste AA.

## Floor plan de mesas (rama `feat/floor-plan-mesas`)

Hallazgos Minor del code-review de la Migración A (`20260605000100_floor_plan_editor.sql`,
ya aplicada al remoto vía MCP — **no editar**; corregir en una migración follow-up
cuando aterrice el editor v1):

- **`floor_plan_elements.rotation` sin CHECK.** La columna es "siempre 0 en v1" pero no lo
  enforcea el DB. Agregar en follow-up `check (rotation between 0 and 359)` (forward-compat
  con v2) o `check (rotation = 0)` (invariante estricta v1).
- **`floor_plan_areas.position` y `floor_plan_elements.z_index` sin cota superior.** El resto
  de las columnas numéricas (width/height/x/y/number_start) tienen rango; estas no. Agregar
  `check (… between 0 and 9999)` en follow-up para frenar basura de un bug de cliente.
- **Estilo de `revoke` divergente.** `fp_elements_integrity` revoca en dos statements
  (`from anon` + `from public`) y omite `authenticated`; funcionalmente equivalente, pero el
  resto del repo usa `revoke execute … from public, anon, authenticated;` en un solo statement.
  Consolidar en la próxima migración que toque la función.
- **`types/database.ts`: aliases `FloorElementKind`/`FloorElementShape` fuera de orden alfabético**
  (apendizados al final en vez de tras `EventStatus`). Nit cosmético en la sección hand-maintained.
- **`reorderAreasAction` no es atómico.** Hace N `update` secuenciales de `position`; un fallo
  parcial deja el orden inconsistente (no hay rollback). Bajo riesgo (un solo owner edita, y un
  retry restaura el orden). Mejorar con un único statement/RPC transaccional (p. ej. update con
  CASE o un `fp_reorder_areas(p_ids uuid[])`).
- **`splitTableAction` no re-chequea que el elemento fuente siga existiendo** entre la lectura y el
  RPC. Benigno (crea la mesa igual en el área correcta); informativo.
