# Rubros con horario y lo que sale primero

Pedidos de los socios de HUB del 22/11/2026, de las «Revisiones punto de venta»:

- «Agregar en carta menús al mediodía, debe aparecer en determinados horarios.»
- «Fines de semana debe aparecer únicamente el menú del fin de semana.»
- «Que un producto pueda tener "prioridad" (el caso de una entrada).»

Los tres se resuelven en la carta: dos son **cuándo se muestra** un rubro y el tercero es **qué encabeza la comanda** en cocina.

## Cuándo se muestra un rubro

Cada categoría de la carta puede tener un horario: una o más franjas de días y horas. Sin horario se muestra siempre, que es lo que pasa con todas las que nadie tocó.

- **Dónde se carga.** Catálogo › Carta › el menú «⋯» de la categoría › «Horario en la carta» (es el mismo diálogo de «Editar»: el nombre y la foto a la izquierda, el horario a la derecha, y «Guardar» siempre a la vista).
- **De un toque.** «Siempre», «Mediodía de lunes a viernes» (12 a 16), «Fin de semana», «De lunes a viernes» y «Solo de noche» (20 a 3). Después se ajustan los días y las horas, o se suma otra franja (hasta seis).
- **Dicho en palabras.** Abajo, una oración dice lo que va a pasar («Se muestra de lunes a viernes de 12 a 16 h.») y si ahora mismo se está mostrando. En la lista, la categoría lleva su horario en el mismo renglón que la cantidad de ítems y «Ahora no se muestra» cuando corresponde; adentro de la categoría se lee lo mismo debajo de la ruta.
- **Lo de adentro la sigue.** Si «Menú del mediodía» está fuera de horario, tampoco se ven sus subcategorías ni sus productos (ni en el buscador ni en los destacados).
- **La hora es la del bar** (`tenants.timezone`), no la del teléfono de quien mira ni la del servidor.
- **Una franja que termina antes de lo que empieza cruza la medianoche** («de 20 a 3»): la madrugada cuenta como parte de la noche en que empezó, igual que el día de servicio del salón.

### Los dos casos del pedido

| Lo que piden | Cómo se arma |
| --- | --- |
| El menú del mediodía, en su horario | La categoría del menú, con «Mediodía de lunes a viernes» (ajustando las horas si hace falta). |
| El fin de semana, el menú del fin de semana | La categoría del menú del fin de semana, con «Fin de semana». El del mediodía ya no aparece (es de lunes a viernes). |
| El fin de semana, **solo** ese menú y nada más de la carta | Además, a las categorías que no van el fin de semana se les pone «De lunes a viernes». |

No hay un «modo exclusivo»: cada rubro dice cuándo va. Es una decisión del diseño, cambiable.

### En la carta del cliente

`app/carta/[tenantSlug]/page.tsx` saca los rubros fuera de horario antes de armar el árbol (`visibleNow`, con la hora del bar). La página no se guarda en el servidor (`force-dynamic`), así que cada pedido sale con la hora de ese momento.

La carta que quedó abierta en un celular se pone al día sola, con el mismo mecanismo de [La carta siempre al día](./carta-al-dia.md):

1. El render dice en cuánto es el próximo cambio (`changeInMs`: el comienzo o el final de una franja, o la medianoche).
2. `CartaFreshness` se vuelve a pedir la carta unos segundos después de ese momento (`CARTA_SCHEDULE_MARGIN_MS`), con un reloj propio si la carta está a la vista o al volver a mirarla.
3. No hay aviso «Carta actualizada»: nadie la editó, solo es otra hora.
4. Sin señal no se vuelve a pedir (como siempre), y cada horario se usa una sola vez por render: no hay bucle.

Si alguien estaba adentro de una sección que deja de mostrarse, la carta lo lleva a la última que sigue existiendo (antes quedaba en una pantalla vacía sin «volver»; también pasaba al pausar una categoría).

### Para el mozo

El pedido del mozo (`pos_menu`) trae el horario de cada categoría. Lo que está fuera de horario:

- se ve **atenuado** y dice «Fuera de horario», y la ficha de su categoría también;
- **se puede cargar igual**: el mozo decide (alguien pidió el menú del mediodía a las 16:05);
- no se ofrece en «lo que más sale» ni en «para empezar»;
- en la búsqueda la lista va en cuatro escalones: lo de esta hora que se llama así, lo fuera de horario que se llama así, y después lo que solo coincide por su categoría (primero lo de esta hora). «milanesa» trae las milanesas de ahora, enseguida la del menú del mediodía (atenuada) y recién después el resto de «Tablas y milanesas». Enter agrega el primero de la lista.

## Lo que sale primero en cocina

Carta › Cocina y aclaraciones › pestaña **Sale primero** (`?ver=primero`). Lo marcado encabeza la comanda de su mesa, antes que el resto de los rubros.

- **Se marca en la categoría** y lo de adentro la sigue (subcategorías y productos).
- **Un producto puede decir otra cosa**: marcarse él solo, o no salir primero aunque su categoría sí. Al volver a como está su categoría, pierde la marca propia y la vuelve a seguir.
- Una subcategoría de una categoría marcada no se desmarca sola: se desmarca la de arriba, o producto por producto.
- **No necesita estaciones.** Un bar que no reparte su cocina en pantallas (HUB, hoy) lo usa igual.
- Se guarda solo y se puede deshacer, como el resto de la pantalla. Si otra persona lo cambió recién, no se pisa: se avisa y se muestra cómo quedó.

La regla es la de la base (`private.pos_item_first`): vale lo que diga el producto; si no dice nada, alcanza con que esté marcada su categoría o alguna de las que la contienen. La cola de cocina (`pos_kitchen_queue`) manda cada renglón con `priority`, y la comanda lo pone arriba (docs/features/pos.md).

## Dónde está

| Qué | Archivo |
| --- | --- |
| Columnas y funciones | migración `pos_revisiones_socios` (`menu_categories.availability`, `menu_categories.kitchen_first`, `menu_items.kitchen_first`, `private.pos_item_first`, `pos_menu`, `pos_kitchen_queue`) |
| El horario: la regla, las palabras y lo que se edita (puro) | `lib/menu/availability.ts` |
| Guardar el horario | `setCategoryAvailability` en `lib/menu/actions.ts` (zod `setCategoryAvailabilitySchema`, auditoría `menu_category.availability_set`) |
| El campo «¿Cuándo se muestra?» | `app/(manager)/[tenantSlug]/menu/_components/availability-field.tsx` |
| El filtro de la carta pública | `app/carta/[tenantSlug]/page.tsx` (`visibleNow`) |
| Volver a pedirla en el cambio de franja | `lib/menu/freshness.ts` (`cartaScheduleDueAt`, `scheduleDue`) y `carta-freshness.tsx` |
| Fuera de horario en el pedido del mozo | `lib/pos/order/menu-index.ts` (`offHoursItems`) y `components/pos/order/product-picker.tsx` |
| «Sale primero»: la regla y las palabras (puro) | `lib/menu/kitchen/first.ts` |
| Guardar «sale primero» | `setKitchenFirst` en `lib/menu/kitchen/actions.ts` (zod `setKitchenFirstSchema`, plan `planFirstWrites`, auditoría `menu.kitchen_first_set`) |
| La pestaña | `app/(manager)/[tenantSlug]/menu/cocina/_components/first-pane.tsx` |

Pruebas: `tests/lib/menu-availability.test.ts`, `menu-freshness.test.ts`, `menu-kitchen-first.test.ts`, `menu-kitchen-ops.test.ts` y `pos-order-menu.test.ts`.

## Si el código sale antes que la migración

Las lecturas de categorías (`readCategories` en `lib/menu/queries.ts`) piden el horario y, si la columna todavía no existe, vuelven a leer sin él: la carta pública no queda vacía y todo se muestra siempre, como antes. La pantalla «Cocina y aclaraciones» sí necesita la migración (lee `kitchen_first`): sin ella muestra «No pudimos leer la carta».

## Cómo probarlo

En el bar de ejemplo, no en HUB. Recorrido de punta a punta el 23/11/2026 (carta pública en el celular: a los 7 s de pasada la hora la categoría desapareció sola, sin aviso; y apareció sola al llegar su hora).

En el bar de ejemplo quedó una muestra: «Menú del mediodía» (lunes a viernes de 12 a 16) y «Menú de fin de semana» (sábados y domingos), cada una con dos productos, y «Papas, rabas, nuggets y nachos» marcada como «Sale primero».

1. **Horario.** Catálogo › Carta › «⋯» de una categoría › «Horario en la carta» › «Otro horario». Elegí hoy, con una franja que termine en dos minutos. Guardá. **Esperado:** la lista dice el horario; la oración del diálogo decía «Ahora se está mostrando».
2. Abrí `/carta/<bar>` en otra ventana y entrá a esa categoría. Esperá a que pase la hora. **Esperado:** a los pocos segundos la carta vuelve al inicio (o a la sección de arriba) y la categoría ya no está, sin aviso. En la lista del panel, a lo sumo un minuto después, dice «Ahora no se muestra».
3. Buscá en la carta un producto de esa categoría. **Esperado:** no aparece.
4. **Mozo.** En el salón, abrí una mesa y buscá ese producto. **Esperado:** aparece atenuado, con «Fuera de horario», después de lo de esta hora que se llama igual; se puede cargar. No está en «lo que más sale» y la ficha de su categoría también se ve atenuada.
5. **Sale primero.** Carta › Cocina y aclaraciones › Sale primero. Marcá una categoría. **Esperado:** el número de arriba sube, sus productos dicen «Sale primero por su categoría» y aparece el aviso con «Deshacer».
6. Apagá un producto de esa categoría. **Esperado:** «Este no, aunque su categoría sí». Volvé a prenderlo: vuelve a «Sale primero por su categoría».
7. Mandá a cocina una tanda con un producto marcado y otros que no. **Esperado:** en la comanda, lo marcado va arriba, en el bloque «Sale primero».
