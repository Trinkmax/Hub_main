# Compras: del conteo de stock a la mercadería en la cámara

Reemplaza la app de Google (planilla «HUB_Compras» + Apps Script) que usaban la cocina y Tomás. El recorrido es el
mismo:

> la cocina cuenta → el sistema calcula → quien compra revisa y manda por WhatsApp → el proveedor confirma → la
> cocina recibe → quien compra resuelve las diferencias.

Se prende por bar con la función `purchasing` (panel de superadmin). Migraciones: `20261106224328_compras.sql` y
`20261111222154_compras_plazos_razones_sociales.sql` (plazos de los eventos y razones sociales).

## Dónde está

| Quién | Dónde | Qué hace |
|---|---|---|
| Cocina (rol `kitchen`), caja y dueños | Salón › **Stock** (`/[bar]/salon/stock`), en el celular | Contar el stock por zona y recibir lo que llega. La cocina entra directo acá. |
| Dueños | Panel › **Compras** (`/[bar]/compras`) | Pedidos (revisar, mandar, confirmar, diferencias), Insumos (también con una planilla de Excel), Recetas y Proveedores. |

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
- Lo que pide un evento se cuenta con el **número exacto** (no hay «Alcanza» ni «Poco»). Cada etiqueta dice cuánto
  lleva ese evento y arriba a la derecha está lo que tiene que haber (ver «Cuánto lleva cada evento»).
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

### Cuánto lleva cada evento (18/11/2026)

Lo pidió Tomás con una captura del conteo de Flor: «me dice cebolla blanca que se usa también para esos eventos, pero
necesito que me diga también la cantidad que trae en la receta. Es decir: cebolla blanca, objetivo 15 kilos; para
Ratatouille se usan 3 kilos, para Comida Coreana se usan 3 kilos más».

```
Cebolla Blanca                                         23,5 kg
kg · objetivo 15                                tiene que haber
[Para Ratatouille · mié 18/11  +4,5 kg]
[Para Comida Coreana · jue 19/11  +4 kg]
```

- Cada etiqueta violeta lleva la cantidad de **esa fecha**: la de la receta por las personas (las recetas son para
  60 y se multiplican si hay más reservas), en la unidad del insumo. Sale de `EventNeed.parts`
  (`lib/purchasing/events.ts`), que suma lo mismo que `qty`: si la receta nombra el insumo dos veces, la fecha va
  una sola vez con las dos cantidades.
- **Tiene que haber** = el objetivo de la carta + lo de cada evento (`mustHaveQty` en `suggest.ts`): es contra lo que
  la cuenta compara lo contado. Sin objetivo y con una sola fecha no aparece (ya lo dice la etiqueta).
- El **resumen** antes de enviar también lo dice por fecha: «Hay 10 kg · objetivo 15 · +4,5 para Ratatouille
  (mié 18/11) · +4 para Comida Coreana (jue 19/11)».
- El renglón del pedido guarda el total de los eventos y sus nombres (`event_qty`, `event_names`), no el detalle por
  fecha: el panel de quien compra sigue mostrando «eventos +8,5» con las etiquetas sin cantidad. Para tenerlo ahí
  hace falta una columna nueva en `pur_order_lines` y tocar `pur_submit_count` (coordinar con la tanda de sucursales,
  que también la reescribe).

## Plazos de los eventos (11/11/2026)

Lo pidió Tomás: «linkear los eventos de la semana con los días antes que tenés que pedir los insumos, con los días
de entrega, y como regla general te tiene que avisar para que esa cuenta te dé que la mercadería ingrese dos días
antes del evento». Y: los conteos se hacen **domingo y miércoles**; el del domingo incluye los eventos **hasta el
jueves** de esa semana y el del miércoles, la carta y los eventos **hasta el lunes** inclusive.

- **Ajustes de Compras**: los días de conteo, hasta qué día cubre los eventos cada uno (`pur_settings.count_windows`,
  `{"0": 4, "3": 5}`: días después del conteo) y cuántos días antes del evento tiene que llegar la mercadería
  (`arrive_days_before`: 2 al principio, **1 desde el 18/11/2026**). Un día de conteo sin ventana fijada cubre hasta
  el día antes de que el próximo conteo pueda traer la mercadería a tiempo (`defaultEventsUntil`: con 2 días, da lo
  mismo que pidió Tomás; HUB tiene las ventanas fijadas, así que pasar a 1 día no las mueve).
- **Nuevo conteo**: «Contar para los eventos hasta» sale de esa ventana y cambia con la fecha (mientras no lo
  toquen). Debajo dice «Los domingos cubre los eventos hasta el jueves; los miércoles, hasta el lunes.».
- **La cuenta** (`lib/purchasing/deadlines.ts`, puro, con pruebas en `tests/lib/purchasing-deadlines.test.ts`). Para
  cada fecha que suma insumos y cada proveedor que trae algo de su receta:

  ```
  tiene que llegar hasta = la fecha − 2
  llega                  = el último día de entrega del proveedor que no pasa de eso
  pedir hasta            = ese día − la anticipación del proveedor
  ```

  Y después: si ya está en un pedido (un renglón con el nombre del evento) mandado o para revisar, y si llega a
  tiempo; si lo vio un conteo ya mandado (alcanzaba con lo que había); si lo trae a tiempo un conteo que viene (el
  primero cuya ventana llega a la fecha, si se hace antes de «pedir hasta»); o si hay que **pedirlo aparte**: más
  adelante, hoy o, si ya es tarde, cuándo llegaría pidiéndolo hoy. Un proveedor sin días de entrega se calcula como
  si trajera cualquier día, y se avisa.
- **Panel › Pedidos › Eventos de la semana** (reemplaza a «Próximos 7 días»): cada fecha con un renglón por
  proveedor («Lo trae el conteo del domingo · pedir hasta el lun 16/11 · llega el mar 17/11», «Pedilo aparte hasta el
  mar 17/11», «Tarde: pedido hoy llega mañana»). Arriba, un aviso con lo que hay que resolver hoy. Lo de más adelante
  aparece si hay que pedirlo aparte dentro de la semana. «Editar» abre la variante y las personas, como antes.
- **Sumar al pedido** (`addEventToOrder`): lo que ningún conteo trae a tiempo va al pedido para revisar de ese
  proveedor (o a uno nuevo), con la cantidad de la receta por las personas y el nombre del evento en el renglón. El
  botón aparece desde el día antes de «pedir hasta» (y si ya es tarde): sumado antes, saldría con el próximo pedido
  de ese proveedor y llegaría días antes del evento.
- **Pedido para revisar**: si lleva algo para un evento y con su entrega llega tarde, lo dice («Llega tarde para
  Ramen»); si hay que mandarlo hoy para que llegue, también.
- **Tex**: `ver_pedidos` trae `eventos_de_la_semana` con el estado de cada proveedor; el manual explica la regla.

Con las ventanas de Tomás y un proveedor que pide con un día, los eventos de martes y de viernes no llegaban dos días
antes con ningún conteo (el del domingo llega el lunes; el del miércoles, el jueves): el panel los marcaba «Pedilo
aparte» para que se pidan a mano.

**Un día antes (18/11/2026).** Tomás, por audio: «viste que está puesto para que todo llegue dos días antes del
evento: lo corramos para que quede un día antes». Se cambió el ajuste de HUB por soporte (`arrive_days_before` 2 → 1,
auditoría `purchasing.settings_updated` con `via: soporte`); se puede volver a cambiar desde Compras › Ajustes. Con un
día, el conteo del domingo (llega el lunes) alcanza a los eventos del martes y el del miércoles (llega el jueves), a
los del viernes. Ese mismo día, en el panel de HUB: «Tapeo y Malbec» del vie 20/11 pasó de «tarde» a «lo trae el
conteo de hoy» con 7 proveedores, «Sushi en pasos» del 27/11 dejó de pedir 6 cosas aparte, y quedaron «tarde»
Ratatouille (mié 18) y Comida Coreana (jue 19) con varios proveedores, porque el domingo 15 no se mandó conteo.

## Proveedores: una sola ficha con Administración (11/11/2026)

Lo pidió Tomás por audio: «me puse a avanzar con los datos de los proveedores en Compras y me hace repetir datos de los
que tengo en Administración… ¿se pueden llevar de un lado para el otro?». Y: «¿qué hacer con los proveedores que me
facturan con distintas razones sociales? Tengo el caso de Vittis».

- Un proveedor de Compras se une a una o más **razones sociales** de Administración (`pur_supplier_parties`, que
  reemplaza a `pur_suppliers.acc_party_id`). Cada razón social va con un solo proveedor.
- **Los datos para pedirle se cargan una vez**: los días de entrega y la anticipación quedan iguales en Compras y en
  todas sus razones sociales, cambien donde cambien (triggers `pur_suppliers_sync_parties` y
  `acc_parties_sync_supplier`). El WhatsApp de Compras y el teléfono de Administración se completan uno con otro y
  se siguen mientras sean el mismo número; si Administración tiene otro a propósito (el de quien factura), no se
  pisa. El teléfono se pasa a WhatsApp con la misma cuenta de `canonicalPhone` (`private.pur_whatsapp_from_phone`;
  la prueba `tests/rls/purchasing-supplier-parties.test.ts` compara las dos).
- **Al unir**, se completa lo que falta: si los dos tienen días, manda Administración cuando es la primera razón
  social (es donde se cargó la ficha) y Compras cuando ya había otras.
- Unir es del dueño que carga en Administración (policy de la tabla). En **Compras › Proveedores**, la ficha muestra
  «En Administración»: las razones sociales unidas (con su CUIT y un link a su ficha), «Sumar otra razón social» y
  «Soltar». En la ficha de **Administración**, «Para pedirle» dice a qué proveedor de Compras está unida y con qué
  otras razones sociales factura.
- **Varias razones sociales (Vittis)**: cada una va como su propio proveedor en Administración, con su CUIT, sus
  comprobantes y su cuenta corriente (cada una factura y cobra por separado). En Compras es uno solo: un WhatsApp, un
  pedido, los mismos días de entrega.
- La migración pasó las 24 uniones que había en HUB: 19 proveedores de Compras tomaron los días, la anticipación o el
  WhatsApp de Administración, y Barracuda le completó el teléfono a Debelius SAS.

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

## Con Tex (07/11/2026)

Tex tiene el área **Compras: pedidos a proveedores** (`lib/tex/areas/pedidos.ts`), solo para el dueño y solo si el bar
tiene `purchasing`. Mira los pedidos, los insumos y los proveedores (`ver_pedidos`, `buscar_insumos`,
`ver_proveedores_compras`) y hace, siempre con un tique que corre la misma acción del panel:

| Herramienta | Acción del panel |
|---|---|
| `preparar_pedido`: corregir cantidades (0 saca), sumar insumos, la nota, el proveedor de uno «Sin proveedor» | `saveDraft` |
| `preparar_pedido` a un proveedor sin pedido para revisar: lo arma nuevo | `createDraft` |
| `preparar_envio_pedido`: mandarlo por WhatsApp | `approveOrder` |
| `preparar_confirmacion_pedido`: tal cual o «Hubo cambios» | `confirmOrder` / `confirmWithChanges` |
| `preparar_reclamo_pedido`: el reclamo por WhatsApp (no cambia el pedido) | — |
| `preparar_estado_pedido`: «Hoy no pido», volver a borrador, cerrar las diferencias | `skipOrder` / `backToDraft` / `closeDifferences` |
| `preparar_proveedor_compras`: WhatsApp, contacto, días de entrega, anticipación | `saveSupplier` |

- **Mandar es un toque.** El botón del tique es un link a wa.me: abre el chat en el mismo toque (si esperara al
  servidor, el celular bloquearía la ventana) y a la vez confirma el tique. Sin WhatsApp cargado, copia el mensaje.
  Un «sí» escrito y «Hacer los N» no lo mandan (`texTicketNeedsTap`): marcarían enviado sin abrir el chat.
- **El mensaje que se abre es el que queda guardado.** El tique arma el WhatsApp con la misma cuenta de
  `approveOrder` (`lib/purchasing/draft.ts`). Al confirmar, el ejecutor la rehace con lo que hay en la base y, si el
  pedido cambió mientras tanto (lo tocó otra persona, o pasó el día y cambió la entrega), no lo marca enviado.
- **`createDraft`** (pedido armado a mano) no arma un segundo pedido para un proveedor que ya tiene uno para revisar:
  los productos se suman a ese. La entrega sale de los días del proveedor. El panel todavía no tiene un botón para esto.
- A Tex no le llegan los teléfonos de los proveedores: ve «cargado (termina en 1234)». El link con el número vive solo
  en el tique y se borra cuando se decide.

## Planilla de insumos (09/11/2026)

Lo pidió Tomás por audio: «el listado de insumos, donde tiene el stock objetivo y esas cosas, me gustaría modificarlo
desde el Excel»; las recetas, en cambio, las sigue cambiando en el panel. Compras › Insumos › **Planilla**
(`/[bar]/compras/insumos/planilla`, solo dueños con `purchasing`):

1. **Bajar** (`GET /api/compras/insumos/planilla?slug=`): un `.xlsx` con toda la lista, ordenada por zona como se
   recorre la cocina. Columnas en el orden de la planilla vieja de Google: Código, Insumo, Marca, Zona, Unidad,
   Objetivo, Presentación, Cada una trae, Proveedor, Frecuencia, Activo, Notas y la oculta **Clave HUB** (el id).
   Zona, Proveedor, Frecuencia y Activo se eligen de una lista (hoja oculta «Listas»); la de Unidad sugiere, pero
   acepta otra. Trae también la hoja «Cómo usarla».
2. **Cambiarla** en Excel, Google Sheets o Numbers.
3. **Subirla** (`.xlsx` o CSV, con `openTable` de los importadores): antes de guardar muestra qué cambia en cada
   insumo («Objetivo: 10 kg → 12 kg»), cuáles se agregan, cuáles se desactivan y qué filas tienen problemas.

Reglas (`lib/purchasing/sheet.ts`, puro; las acciones en `sheet-actions.ts`):

- HUB sigue siendo el dueño de la lista: la planilla no queda conectada, es la forma de corregir muchos juntos.
- Cada fila va a su insumo por la Clave HUB; si no está (otra planilla, o la vieja de Google con «id, nombre, sector,
  contenido»), por el código y después por el nombre. Nunca dos filas al mismo insumo.
- Una **columna que no viene no se toca**. Una **celda vacía borra** el dato (sin objetivo, sin proveedor…), salvo
  Frecuencia y Activo, que quedan como estaban.
- **Borrar una fila no borra el insumo.** Para que deje de contarse: «No» en Activo.
- El proveedor tiene que existir: el parecido se sugiere («¿Es «Matias Mondino»?»), nunca se elige solo. Un
  proveedor nuevo se carga primero en Proveedores. Una zona que HUB no tiene ya no es un problema: ver «Zonas nuevas
  desde la planilla».
- Una fila con un problema no se carga entera; las demás sí.
- Guardar vuelve a leer el archivo y lo compara con HUB en ese momento; si alguien cambió uno de esos insumos mientras
  tanto (la huella incluye cómo estaba cada uno), no guarda y muestra la vista previa nueva. Todo va en un solo
  `upsert`: entran todos o ninguno. No pisa quién creó cada insumo. Auditoría `purchasing.items_sheet_imported`.
- El `.xlsx` se escribe sin librería (`lib/xlsx/write.ts`); las pruebas lo vuelven a leer con el lector de los
  importadores, y se validó con openpyxl y con la vista rápida de macOS.

Smoke (09/11/2026, bar de ejemplo, compu 1440 × 900 y celular 390 × 844 con toques): bajar → 267 insumos, 3 hojas,
5 listas; cambiar con otro programa (objetivo, proveedor, presentación, desactivar, uno nuevo y un proveedor mal
escrito) → «4 cambian · 1 se agrega · 1 fila con problemas · 262 quedan igual» → Guardar 5 cambios → la base quedó
igual que la vista previa; volver a subir la original deshizo todo.

### Zonas nuevas desde la planilla (18/11/2026)

Tomás cambió la lista de zonas de la planilla (la hoja oculta «Listas»: «modifiqué el desplegable de los lugares de
guardado») y al subirla 29 filas no entraron: «La zona «Freezer congelados y papas» no está en HUB. ¿Es «Freezer
congelados»?». La planilla le decía que las armara antes en el panel; él contestó «yo los modifiqué desde el Excel
nomás». Ahora la planilla también trae las zonas:

- Una zona que HUB no tiene aparece arriba de la vista previa, en **Zonas nuevas**: cuántos insumos lleva, dónde están
  hoy («Hoy: Freezer congelados (8) y Freezer carnes y panes (1)») y qué es, con tres opciones: **Es nueva** (se arma al
  guardar, al final del recorrido), **Es una que ya está** (las filas van a esa, que queda con su nombre) o **Le cambié
  el nombre** (esa zona toma el nombre de la planilla, con todos sus insumos y su lugar en el recorrido). Debajo dice
  lo que va a pasar. Cada elección vuelve a pedir la vista previa, así lo que se ve es lo que se guarda.
- Lo que viene elegido (`sheetZones` en `lib/purchasing/sheet.ts`): mal escrita por una o dos letras → esa zona; si
  sus insumos vienen de una zona que la planilla ya no nombra → le cambiaron el nombre a esa (si la reparten entre dos
  zonas nuevas, el nombre lo toma la que se lleva más); si no, nueva. A una zona se le cambia el nombre una sola vez.
- Una zona que solo nombran filas con otro problema no se arma. Un nombre de más de 60 letras, o sin letras, es un
  problema de la fila; dos zonas de HUB que se escriben igual, también.
- Guardar arma las nuevas (`pur_zones`, después de la última del recorrido), cambia los nombres y recién ahí guarda
  los insumos. Si los insumos fallan después de armar las zonas, lo dice: volver a subir la planilla termina el trabajo
  (las zonas ya van a estar). La huella incluye lo elegido y el nombre de hoy de la zona elegida. La auditoría suma
  `zones_created` y `zones_renamed`. Al terminar, «Acomodar las zonas» abre Zonas del recorrido.
- En el Excel, escribir una zona que no está en la lista ya no se bloquea: avisa («Esa zona no está en la lista»,
  `warnOnly` en `lib/xlsx/write.ts`) y deja. El proveedor sigue sin dejar.
- Excel no cambia las celdas cuando se cambia la lista: si se renombró una zona y alguna fila quedó con el nombre
  viejo, en esa misma subida va a la zona de siempre; si se vuelve a subir el mismo archivo después, ese nombre viejo
  aparece como zona nueva, con «Hoy: …» diciendo dónde está.

Smoke (18/11/2026, bar de ejemplo, compu 1190 × 660 y celular 390 × 844): bajar la planilla → en «Listas»,
«Freezer congelados» → «Freezer congelados y papas», y 14 insumos a «Freezer congelados y papas», «Freezer carnes
deposito» y «Frezzer panes deposito» → subirla: «6 cambian · 3 zonas nuevas en la planilla · 262 quedan igual»,
«Freezer congelados y papas» viene como «Le cambié el nombre» (sus 8 insumos y ninguna fila con el nombre viejo) y
las otras dos como nuevas → «Es una que ya está» muestra «¿Cuál es?» y «El insumo va a «Freezer carnes y panes»…» →
volver a «Es nueva» → Guardar 9 cambios → «Se armaron las zonas … al final del recorrido» y «Freezer congelados ahora se
llama Freezer congelados y papas»; en la base, las nuevas en 70 y 80 y la renombrada en su lugar con su planta. Subir
la original lo deshizo (propuso solo devolverle el nombre) y las dos zonas de prueba se borraron desde Zonas del
recorrido.

## Datos para corregir

`lib/purchasing/checks.ts`: proveedores sin WhatsApp o sin días de entrega, insumos sin proveedor, sin objetivo, sin
zona o sin presentación, líneas de receta sin cantidad, con un insumo que no está o desactivado, o con otra unidad, y
fechas que necesitan elegir la variante. Cada línea lleva a donde se arregla y la lista se vacía sola.

## Tablas

`pur_settings` · `pur_zones` · `pur_suppliers` · `pur_supplier_parties` (sus razones sociales en Administración) ·
`pur_items` · `pur_recipes` + `pur_recipe_lines` · `pur_event_plans` · `pur_counts` + `pur_count_lines` ·
`pur_orders` + `pur_order_lines`. RPC: `pur_events_between`, `pur_submit_count`, `pur_receive_order`.

## Carga inicial de HUB (06/11/2026)

De la app de Google y del «Catálogo de eventos»: 6 zonas del recorrido, 33 proveedores (28 unidos a su par de
Administración), 267 insumos (185 de todos los días con zona, objetivo y presentación; 82 eventuales de los eventos)
y 14 recetas (335 líneas) unidas a sus formatos del calendario. Tomás tiene que cargar los WhatsApp y los días de
entrega de los proveedores: sin eso no se abre el chat ni se calcula la fecha.

## Pendiente

- Las recetas de Coraline y de El viaje de Chihiro (están en los PDF «Pedido – Menú», no en la planilla).
- Probar con el teclado de un iPhone de verdad, y el botón de WhatsApp de Tex con WhatsApp instalado (ir y volver de
  la app con la charla abierta).
- Un botón «Nuevo pedido» en el panel (hoy un pedido a mano solo lo arma Tex).

## Smoke de «cuánto lleva cada evento» (18/11/2026, bar de ejemplo; celular 390 × 844 y 360 × 780, notebook 1190 × 660)

Con dos fechas de Shrek en la ventana del conteo (vie 20/11 y lun 23/11; la receta lleva 3 kg de cebolla blanca):

1. Stock › Nuevo conteo › Empezar: el cartel dice «Eventos hasta el lun 23/11 · Shrek · vie 20/11 · 60 personas ·
   Shrek · lun 23/11 · 60 personas».
2. Cámara de frío › Cebolla Blanca: «kg · objetivo 15», a la derecha «21 kg · tiene que haber», y dos etiquetas «Para
   Shrek · vie 20/11 +3 kg» y «Para Shrek · lun 23/11 +3 kg» (en la notebook, una al lado de la otra).
3. Escribir 10: queda «10 kg», «Guardado 13:34».
4. Para los eventos › Café en grano (sin objetivo, dos fechas): «2 kg · tiene que haber» con «+1 kg» en cada una.
5. Con etiquetas largas a 360 px, la de «Peli y comida: El viaje de Chihiro · dom 22/11» se parte en dos renglones y
   la cantidad queda a la derecha.
6. Resumen › Matias Mondino › Cebolla Blanca: «Hay 10 kg · objetivo 15 · +3 para Shrek (vie 20/11) · +3 para Shrek
   (lun 23/11)» → 11 kg.

## Smoke manual (06/11/2026, bar de ejemplo, celular 390 × 844 y compu 1440 × 900)

1. Cocina › Stock › Nuevo conteo › Empezar: aparecen las zonas en orden y el aviso de Shrek (dom 08/11, 60 personas).
2. Alcanza / Poco (con 2 kg) / No hay en tres productos: «Guardado 19:51».
3. Resumen: 3 contados de 200, 41 para pedir, «Faltan contar 197». Enviar igual → «Listo… 41 productos, en 12 pedidos».
4. Panel › Compras: 12 para revisar y mandar; Dulcar +1 → Aprobar (sin WhatsApp: copia el mensaje) → Enviados.
5. Hubo cambios (2 → 1, nota «Lo que falta viene el martes.») → Por llegar con la nota.
6. Cocina › ¿Qué llegó? › Dulcar (con «Tiene una nota») › No llegó › Terminar → «Recibido con diferencias».
7. Panel › Llegaron con diferencias: Azucar, esperado 1 × 10 kg, llegó Nada, −1 → Copiar el reclamo / Cerrar.
8. Un usuario de Cocina entra al salón y cae en Stock, sin la pestaña de Reservas.

## Smoke con Tex (07/11/2026, bar de ejemplo, modelo de verdad; celular 390 × 844 y compu 1440 × 900)

1. «¿Qué pedidos hay para mandar?» → los 11 para revisar con lo que lleva cada uno, y que ninguno tiene WhatsApp ni días.
2. «Cargale a Waggon el WhatsApp 351 555-0100, habla con Pablo, y entrega martes y viernes» → tique del proveedor →
   Guardar → lleva a Proveedores y señala a Waggon.
3. «Mandale el pedido a Waggon» → tique «Pedido por WhatsApp · para el martes 10/11» con «Mandar por WhatsApp».
   Escribir «sí» no lo manda: avisa que se toca el botón. Tocarlo → Enviado, y el mensaje guardado es igual, letra por
   letra, al del link; el tique ya no guarda el link.
4. «Pablo contestó: no tiene nuez moscada y lo demás llega el viernes» → Confirmado con cambios (1 kg → no lo tiene,
   mar 10/11 → vie 13/11).
5. «Armale un pedido a Dulcar: 2 bolsas de azúcar, 12 galletas oreo y 3 de vainilla» → Pedido nuevo para revisar.
6. «Al de San Jose sumale 2 de manteca y sacale el tomate triturado» → 1 × 2,5 kg → 3 × 2,5 kg, tomate → no se pide.
7. «Mandá el de Dulcar y el de San Jose» → dos tiques «Copiar y marcar enviado», sin «Hacer los 2»; uno por toque.
8. «Reclamale a Dulcar…» → reclamo armado; «Ya lo hablé, cerralo» → Cerrar las diferencias.
9. Al final, «Borrales el WhatsApp…» dejó los proveedores del bar de ejemplo como estaban.
