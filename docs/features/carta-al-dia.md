# La carta siempre al día

Pedido de Nacho Badra (audios del 15/11/2026): clientes que ya habían abierto la carta seguían viendo precios viejos. Pidió «un botón como el de WordPress para borrar el caché». La respuesta: se hace solo y, además, está el botón.

## El diagnóstico

- **El servidor no guarda la carta.** `/carta/[slug]` es `force-dynamic`, sale con `Cache-Control: private, no-cache, no-store` y `x-vercel-cache: MISS`. De nuestro lado no hay caché que borrar.
- **La copia vieja vive en el celular.** La pestaña queda abierta días y Safari o Chrome la muestran de memoria, sin volver a pedirla. El «atrás» hace lo mismo: devuelve la página entera congelada (bfcache).
- **El desfase se nota.** HUB cambió 168 de sus 238 ítems en los últimos 30 días.

## Cómo funciona

1. **Un número de versión por bar.** Vive en `public.menu_revisions`, con una fila por bar.
   - `rev` sube solo con cualquier cambio del menú. Lo suben disparadores por sentencia en `menu_items`, `menu_categories`, `item_tags` y `menu_item_tag_assignments`.
   - No importa de dónde venga el cambio: el editor, el Excel, Tex o los precios del punto de venta.
   - Cambiar 200 precios de una sube el número una sola vez.
2. **La página sabe qué versión tiene.** `app/carta/[tenantSlug]/page.tsx` lee `getMenuRev` en el mismo `Promise.all` del menú, sin un viaje más. Se lo pasa a `CartaFreshness` junto con la hora del render.
3. **El celular pregunta.** `CartaFreshness` no dibuja nada.
   - Le pregunta `carta_menu_rev` a Supabase directo desde el navegador, sin pasar por una función de Vercel.
   - Pregunta al volver a primer plano, al volver con el «atrás», al recuperar el foco o la señal, y cada 4 min mientras la carta está a la vista.
   - Entre una respuesta y la siguiente pasan como mínimo 15 s.
4. **Si la versión es más nueva, la carta se refresca.** Usa `router.refresh()`: la carta nueva llega sin perder la sección abierta ni el scroll. Aparece el aviso «Carta actualizada» (una píldora chica arriba), una sola vez por versión.
   - Si el detalle de un ítem estaba abierto, también muestra el precio nuevo.
   - El refresh de Next reescribe el `history.state` y borraba la marca con la que cada hoja sabe que su entrada del «atrás» es suya. `use-dismiss-on-back.ts` ahora también se fija si el «atrás» ya la consumió, así cerrar la hoja con la X no deja una entrada de más.
5. **Red de seguridad.** Si la consulta falla pero el servidor contestó (un 4xx), una carta de más de 12 h se refresca igual.
   - Sin señal, o con Supabase caído (5xx), nunca se refresca. Si el pedido falla, Next hace una navegación completa y el celular mostraría una página de error en lugar de la carta.
6. **Para que no entre en bucle:**
   - Solo refresca con un número MAYOR. Igual, menor o vacío no refresca.
   - El número pedido queda como base aunque el render nuevo llegue sin el suyo.
   - Hay 6 s de gracia mientras llega el render.
   - La red de seguridad no se repite antes de 12 h, contadas con el reloj del celular, así que un reloj corrido no la dispara.
7. **El botón.** «Actualizar en los celulares», en Catálogo › Carta, al lado de «Ver carta».
   - Explica que ya es automático y muestra el último cambio.
   - «Actualizar ahora» llama a `forceCartaRefresh`, que llama a `menu_force_refresh`. Esa función sube el número, marca `forced_at` y `forced_by` y deja `menu.carta_refresh_forced` en la auditoría.
   - Pueden usarlo el dueño y Contenido.
8. **Lo que no se toca.** La sesión del socio del club (la cookie httpOnly `hub_wallet_<tenantId>`) sigue igual. El refresh vuelve a leer la billetera con la misma cookie.

## Dónde está

| Qué | Archivo |
| --- | --- |
| Tabla, disparadores y RPCs | `supabase/migrations/20261115225854_menu_revisions.sql` |
| Las decisiones (puras) y las constantes | `lib/menu/freshness.ts` |
| `getMenuRev` y `getMenuRevisionStatus` | `lib/menu/revision.ts` |
| `forceCartaRefresh` | `lib/menu/actions.ts` |
| El chequeo en el celular | `app/carta/[tenantSlug]/_components/carta-freshness.tsx` |
| El detalle abierto con el precio nuevo | `app/carta/[tenantSlug]/_components/carta-experience.tsx` |
| El «atrás» de las hojas después de un refresh | `app/carta/[tenantSlug]/_components/use-dismiss-on-back.ts` |
| El botón del editor | `app/(manager)/[tenantSlug]/menu/_components/carta-refresh-button.tsx` |

## Costos

- **Cada celular con la carta a la vista** hace una consulta chica a Supabase cada 4 min, más una al volver. No usa funciones de Vercel.
- **El refresh** sí carga la página entera, como cualquier visita a la carta. Pasa solo cuando la carta cambió.
- **supabase-js** se baja recién con el primer chequeo (import dinámico). No pesa en la carga inicial de la carta de quien no es socio.

## Decisión a revisar

`getMenuRev` pregunta con la RPC `carta_menu_rev` como anónimo, no con el cliente de servicio.

El motivo: la migración no le da GRANT a `service_role` sobre `menu_revisions`, y Supabase retira los default privileges desde el 30/10/2026 (ver `20261026120100_ticketing_tables.sql`). Leer la tabla con service podría dar 42501, la carta saldría siempre con versión 0 y cada celular se refrescaría una vez de más.

La RPC tiene EXECUTE explícito para `anon`. Además es la misma que pregunta el celular, así que el número del render y el del chequeo salen del mismo lugar.

## Cómo probarlo

Hacelo en el bar de ejemplo, no en HUB: los precios de HUB son los de verdad.

1. Abrí la carta en el celular (o en otra ventana) y dejala abierta en una sección.
2. En el panel, cambiá el precio de un ítem de esa sección.
3. Volvé a la carta: cambiá de app o de pestaña y volvé. **Esperado:** en uno o dos segundos aparece «Carta actualizada», el precio es el nuevo y seguís en la misma sección y a la misma altura.
4. Repetí con el detalle del ítem abierto. **Esperado:** el precio del detalle también cambia. Cerralo con la X y tocá «atrás»: vuelve a la página anterior al primer toque, sin un «atrás» que no hace nada.
5. En Catálogo › Carta, tocá «Actualizar en los celulares» › «Actualizar ahora». **Esperado:** «Listo: los celulares con la carta abierta la recargan apenas la miren.» y «Último cambio: recién, a mano.» La carta abierta se refresca al volver a mirarla, aunque no haya cambios.
6. Desde la carta andá a otra página, cambiá un precio en el panel y volvé con «atrás». **Esperado:** se refresca.
7. Con el celular en modo avión, volvé a la carta. **Esperado:** no pasa nada, sigue la que estaba. Al volver la señal, pregunta y se pone al día.
8. En Network, la pregunta es un `POST` a `…supabase.co/rest/v1/rpc/carta_menu_rev`, no a Vercel. Con la carta quieta no hay ningún pedido a la página.

Pruebas automáticas:

- `tests/lib/menu-freshness.test.ts`: cuándo refrescar, la red de seguridad, el reloj corrido y el mínimo entre chequeos.
- `tests/lib/menu-carta-refresh-action.test.ts`: el botón (permisos, errores, auditoría).
