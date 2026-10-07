# `components/legacy`: vistas congeladas del salón y lo público

El panel del dueño estrena el kit HUB (`components/ui`). El salón (`app/(salon)/**`)
y lo público (`/carta`, `/c`, `/m`, `/r`, `/v`, `/l`, `/p`, `/print`, `/capture`)
**no se rediseñan ahora** y tienen que verse exactamente igual que antes. Para eso:

- `components/ui-legacy/**` es la copia literal del kit viejo (41 archivos). Solo
  cambian los 5 imports absolutos entre archivos del kit, que apuntan a la copia.
- Esta carpeta guarda las **vistas de dominio** que renderiza el salón y que el
  panel va a migrar. Son copias literales; solo cambian sus imports del kit
  (a `ui-legacy`) y entre ellas.

Las dos carpetas están fuera de Biome (son copias, no se lintan).

## Las copias

| Copia congelada | Original (panel) | La usa |
|---|---|---|
| `reservations/cake-chip.tsx` | `components/reservations/cake-chip.tsx` | `salon/reservas-operativo/_components/reservation-card.tsx` |
| `reservations/guest-count-stepper.tsx` | `components/reservations/guest-count-stepper.tsx` (borrado: el panel no lo usaba) | `reservation-card.tsx` |
| `reservations/service-alert-chips.tsx` | `components/reservations/service-alert-chips.tsx` | `reservation-card.tsx` |
| `reservations/segment-meter.tsx` | `components/reservations/segment-meter.tsx` | `salon/reservas-operativo/_components/capacity-header.tsx` |
| `loyalty/award-form.tsx` | `components/loyalty/award-form.tsx` | `salon/escanear/_components/scan-screen.tsx` |
| `loyalty/customer-header.tsx` | `components/loyalty/customer-header.tsx` | `scan-screen.tsx` |
| `loyalty/punch-stamper.tsx` | `components/loyalty/punch-stamper.tsx` (antes en `acreditar/_components`) | `scan-screen.tsx` |
| `loyalty/redemption-panel.tsx` | `components/loyalty/redemption-panel.tsx` (antes en `acreditar/_components`) | `scan-screen.tsx` |
| `floor-plan/move-table-sheet.tsx` | `components/floor-plan/move-table-sheet.tsx` | `salon/mesas/[sessionId]/_components/session-detail.tsx` |
| `floor-plan/live-floor.tsx` | `components/floor-plan/live-floor.tsx` (antes en `local/mesas/_components`) | `salon/mesas/_components/salon-view.tsx` |
| `floor-plan/live-table-card.tsx` | `components/floor-plan/live-table-card.tsx` (ídem) | la copia de `live-floor` |
| `floor-plan/pan-zoom-stage.tsx` | `components/floor-plan/pan-zoom-stage.tsx` (ídem) | la copia de `live-floor` (botones de zoom) |
| `floor-plan/table-glyph.tsx` | `components/floor-plan/table-glyph.tsx` | las copias de `live-floor` y `live-table-card` |

**Compartidos sin copiar** (comportamiento o lógica sin estilo propio): `media/storage-image`,
`shell/brand-mark`, `shell/claims-refresher`, `shell/refresh-on-return`,
`shell/sign-out-action`, `theme/brand-accent-provider` e `icons/curated-lucide`. Toda la
lógica de dominio sigue en `lib/` y le llega a los dos lados.

## Reglas

- **Son solo vista.** No se editan, salvo arreglos de seguridad.
- **Un arreglo de lógica va en `lib/`** y le llega al panel y a la copia.
- **Se borran** con el rediseño del salón y lo público.
- **La lista vive acá.** Una copia nueva se suma en esta tabla y en `LEGACY_COPIES` de
  `scripts/codemods/freeze-legacy-ui.mjs`; el test de límites chequea que las tres cosas
  coincidan.

## Guardas

- `node scripts/codemods/freeze-legacy-ui.mjs --check` sale con 1 si algún archivo congelado
  todavía importa `@/components/ui/*` o una vista del panel (también por path relativo). Sin
  `--check`, los reapunta.
- `biome.json`: en las rutas congeladas prohíbe `@/components/ui/*`, `@/app/(manager)/*` y las
  carpetas de dominio del panel; en el resto prohíbe `ui-legacy` y `legacy`.
- `tests/lib/import-boundaries.test.ts` resuelve cada import (alias o relativo) y recorre el
  grafo desde lo congelado: es la guarda que no depende de los globs de Biome.
- Del panel a lo público o al salón se navega **siempre con recarga** (`<a>` o
  `target="_blank"`, nunca `<Link>`): en una navegación blanda el `<html>` del layout raíz no se
  vuelve a renderizar y la página llegaría con el tema del panel.
