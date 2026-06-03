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
