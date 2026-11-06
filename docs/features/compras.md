# Compras: del conteo de stock a la mercadería en la cámara

Reemplaza la app de Google (planilla «HUB_Compras» + Apps Script) que usaban la cocina y Tomás. El recorrido es el
mismo:

> la cocina cuenta → el sistema calcula → quien compra revisa y manda por WhatsApp → el proveedor confirma → la
> cocina recibe → quien compra resuelve las diferencias.

Se prende por bar con la función `purchasing` (panel de superadmin). Migración: `20261106224328_compras.sql`.

## Dónde está

| Quién | Dónde | Qué hace |
|---|---|---|
| Cocina (rol `kitchen`), caja y dueños | Salón › **Stock** (`/[bar]/salon/stock`), en el celular | Contar el stock por zona y recibir lo que llega. La cocina entra directo acá. |
| Dueños | Panel › **Compras** (`/[bar]/compras`) | Pedidos (revisar, mandar, confirmar, diferencias), Insumos, Recetas y Proveedores. |

Mozos, anfitriona, contenido y la contadora no ven nada (RLS `pur_*` y `PURCHASING_*_ROLES` en `lib/tenant/roles.ts`).

## La cuenta

```
A pedir = stock objetivo + lo que piden los eventos − lo contado − lo que ya viene en camino
```

redondeado hacia arriba a la presentación de compra («3 × Caja x 150 u»). Está en `lib/purchasing/suggest.ts`, con
pruebas en `tests/lib/purchasing.test.ts`.

- **Alcanza** = hay el objetivo. **No hay** = 0. **Poco** = el número que escriban o, si no escriben nada, la mitad
  del objetivo (`pur_settings.low_fraction`).
- Lo que **no se cuenta no se pide**, salvo lo que pide un evento, que se pide completo.
- Sin objetivo, con «No hay» o «Poco», la cantidad queda **a definir** y la completa quien compra antes de mandar.
- **En camino**: lo mandado o confirmado que todavía no llegó, para no pedirlo dos veces. Lo que faltó en una entrega
  deja de estar en camino y vuelve solo en el próximo pedido sugerido.
- La recepción **no suma stock**: el stock sale siempre de los conteos.

### Qué se cuenta

- **Frecuente**: en todos los conteos. **Secundario**: una vez por mes. **Eventual**: solo si un evento lo pide.
- Lo que pide un evento se cuenta con el **número exacto** (no hay «Alcanza» ni «Poco»).
- Hay un solo conteo abierto por bar: si se corta, se sigue el mismo, también entre dos personas. Se guarda solo.
- **Pedido** es el conteo de siempre. **Refuerzo**, uno extra: lo que cuenta reemplaza, producto por producto, lo que
  había en los borradores; lo demás queda (`pur_submit_count`).

### Los eventos

- Salen del **calendario** (`scheduled_events`) y las personas, de las **reservas** en pie (`pur_events_between`, que
  le da a la cocina solo el total por fecha, nunca datos de clientes).
- Cada formato tiene su **receta** para 60 personas (`pur_recipes`, una por variante). Se multiplica si la fecha tiene
  más reservas; nunca baja de 60 salvo que quien compra fije otro número para esa fecha.
- Si el formato tiene varias variantes (Ramen: cerdo, langostino…), hasta que se elige cuál va la fecha no suma.
- Una receta sin insumos es un **aviso** («Promo de martes: revisar pan y carne»).
- Las líneas «Se hace en el local» (caldos, salsas) aparecen como recordatorio y no se piden.
- Si la receta usa otra unidad que el insumo: kg↔g y L↔ml se pasan solos; si no hay cuenta segura (unidad contra
  kg), suma como viene y queda en «Datos para corregir».

## Estados de un pedido

`draft` (Para revisar) → `sent` (Enviado) → `confirmed` (Confirmado) → `completed`, o → `with_differences` →
`completed`. Desde el borrador, «Hoy no pido» lo descarta.

- **Aprobar y abrir WhatsApp** abre el chat del proveedor (wa.me) con el mensaje armado: productos con su presentación,
  la fecha de entrega (el próximo día de entrega del proveedor) y la nota. Sin WhatsApp cargado, copia el mensaje.
- Cuando el proveedor contesta: **Confirmado, va todo como se pidió** o **Hubo cambios** (lo que viene, con 0 = no lo
  tiene, la fecha y una nota para la cocina).
- La cocina ve los pedidos mandados (con el aviso de que no se confirmaron) y los confirmados. Recibe con «Llegó todo
  bien» o producto por producto (llegó / otra cantidad / no llegó).
- Con diferencias, quien compra tiene el reclamo armado por WhatsApp y «Cerrar».

Cada paso es un update condicional sobre el estado: si dos socios tocan el mismo pedido, el segundo ve «Este pedido
cambió mientras lo mirabas». Contar, mandar, confirmar y recibir quedan en `audit_log` (`purchasing.*`).

## Datos para corregir

`lib/purchasing/checks.ts`: proveedores sin WhatsApp o sin días de entrega, insumos sin proveedor, sin objetivo, sin
zona o sin presentación, líneas de receta sin cantidad, con un insumo que no está o desactivado, o con otra unidad, y
fechas que necesitan elegir la variante. Cada línea lleva a donde se arregla y la lista se vacía sola.

## Tablas

`pur_settings` · `pur_zones` · `pur_suppliers` (con `acc_party_id`, el mismo proveedor en Administración) ·
`pur_items` · `pur_recipes` + `pur_recipe_lines` · `pur_event_plans` · `pur_counts` + `pur_count_lines` ·
`pur_orders` + `pur_order_lines`. RPC: `pur_events_between`, `pur_submit_count`, `pur_receive_order`.

## Carga inicial de HUB (06/11/2026)

De la app de Google y del «Catálogo de eventos»: 6 zonas del recorrido, 33 proveedores (28 unidos a su par de
Administración), 267 insumos (185 de todos los días con zona, objetivo y presentación; 82 eventuales de los eventos)
y 14 recetas (335 líneas) unidas a sus formatos del calendario. Tomás tiene que cargar los WhatsApp y los días de
entrega de los proveedores: sin eso no se abre el chat ni se calcula la fecha.

## Pendiente

- Las recetas de Coraline y de El viaje de Chihiro (están en los PDF «Pedido – Menú», no en la planilla).
- Tex todavía no arma ni manda pedidos (solo sabe que la sección existe).
- Probar con el teclado de un iPhone de verdad.

## Smoke manual (06/11/2026, bar de ejemplo, celular 390 × 844 y compu 1440 × 900)

1. Cocina › Stock › Nuevo conteo › Empezar: aparecen las zonas en orden y el aviso de Shrek (dom 08/11, 60 personas).
2. Alcanza / Poco (con 2 kg) / No hay en tres productos: «Guardado 19:51».
3. Resumen: 3 contados de 200, 41 para pedir, «Faltan contar 197». Enviar igual → «Listo… 41 productos, en 12 pedidos».
4. Panel › Compras: 12 para revisar y mandar; Dulcar +1 → Aprobar (sin WhatsApp: copia el mensaje) → Enviados.
5. Hubo cambios (2 → 1, nota «Lo que falta viene el martes.») → Por llegar con la nota.
6. Cocina › ¿Qué llegó? › Dulcar (con «Tiene una nota») › No llegó › Terminar → «Recibido con diferencias».
7. Panel › Llegaron con diferencias: Azucar, esperado 1 × 10 kg, llegó Nada, −1 → Copiar el reclamo / Cerrar.
8. Un usuario de Cocina entra al salón y cae en Stock, sin la pestaña de Reservas.
