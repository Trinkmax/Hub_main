# Carta por sucursal

Un bar con dos o más sucursales activas abre su carta (la dirección del QR, `/carta/<bar>`) con un **selector**:
una tarjeta por sucursal, en su color. Cada sucursal tiene **su carta** en `/carta/<bar>?sucursal=<slug>`
(el mismo `?sucursal=` que usan los links del resto del sistema).

Con una sola sucursal (o ninguna cargada) no hay selector: la carta se abre directo, como siempre.

## Qué cambia en la carta de una sucursal

Sale de `menu_item_branches`, la misma fila que usa el punto de venta. Sin fila, vale la carta del bar.

- Lo que en esa sucursal **no se vende** no aparece: tampoco en el buscador ni en los destacados.
- Lo que tiene **precio propio** se muestra con ese precio.

Se cambia en el panel, en **Carta → Precios**, eligiendo la sucursal arriba: el interruptor «Se vende acá» y el
precio de cada producto. Los mismos cambios valen para el punto de venta de esa sucursal: lo que no se vende ahí no
aparece en su menú y el pedido se rechaza.

Desde la migración `20261127150000_carta_al_dia_por_sucursal`, cambiar esa fila sube la versión de la carta del bar
(`menu_revisions`): las cartas abiertas en los celulares se ponen al día solas, igual que con cualquier otro cambio
(ver `carta-al-dia.md`).

## La inauguración de una sucursal

Sale de `branches.opened_on` (la fecha de apertura) y del día de servicio del bar, que corta a las 5 de la mañana:
la noche de la inauguración sigue siendo la inauguración después de las 12.

- **El día que abre** (`opening`):
  - en el selector, su tarjeta tiene una cinta dorada con moño y un sello que gira («Inauguramos hoy»). Al tocarla,
    la cinta se corta, sale papel picado y se abre su carta;
  - arriba de su carta va la bienvenida «¡Hoy inauguramos!» con su sello;
  - quien entra sin pasar por el selector recibe una lluvia de papel picado, una vez por pestaña.
- **Los 14 días siguientes** (`new`): solo la etiqueta «Nuevo» en el selector.
- Después, nada: no hay que apagar nada a mano.

Con «reducir movimiento» no hay papel picado ni animaciones: el toque abre la carta directo.

La fecha de apertura no tiene pantalla todavía; la carga soporte (`branches.opened_on`). La del Cerro de HUB es el
27/11/2026.

## Archivos

- `lib/menu/carta-branch.ts`: lo puro (aplicar lo de la sucursal, la fiesta, las direcciones). Pruebas en
  `tests/lib/carta-branch.test.ts`.
- `lib/menu/queries.ts`: `listCartaBranches` y `listItemBranchOverrides`. Si fallan, la carta se muestra entera, sin
  selector: nunca se rompe por esto.
- `app/carta/[tenantSlug]/_lib/carta-page.tsx`: `resolveCarta` decide entre el selector y la carta; `loadCarta`
  arma la carta de la sucursal.
- `app/carta/[tenantSlug]/_components/`: `branch-picker.tsx` (el selector), `celebration.tsx` (cinta, sello y
  bienvenida), `confetti.ts` (papel picado en un lienzo propio, que sigue cayendo al cambiar de página). Las
  animaciones están en `carta.css`.
- La carta nueva (`/carta/<bar>/nueva`) no pasa por el selector: con `?sucursal=<slug>` muestra la carta de esa
  sucursal y, sin él, la del bar entera. Si el bar tiene prendida «Carta nueva», el selector se ve igual y cada
  sucursal abre la nueva con lo suyo (sin la pastilla ni la bienvenida, que son de la clásica).
