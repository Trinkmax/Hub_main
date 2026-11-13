# Punto de venta

El salón en vivo: la mesa se abre, pide, come y paga, y lo que los dueños quieren saber (per cápita, ventas,
caja, proyección) sale solo de ahí. Es un sistema con varias sucursales, no un sistema por sucursal.

Nace de la reunión del 11/11/2026 con los dueños de HUB (el local nuevo del Cerro abre sin su sistema
anterior) y de la propuesta de experiencia del 12/11. Está detrás del interruptor `pos` (apagado por defecto;
lo prende un superadmin por bar).

## Reglas que cruzan todo

1. **Nadie escribe lo que el sistema ya sabe.** Los comensales salen de la reserva, la seña de la entrada y
   los puntos del cobro.
2. **Todo responde al toque y se puede deshacer.** Solo se confirma lo que no tiene vuelta; lo que se corrige
   después deja quién fue.
3. **Cada pantalla es para una persona en un momento:** el mozo con una mano, el cocinero a tres metros, el
   encargado a las 2 de la mañana, el dueño desde el celular.
4. **Si se corta internet, nada se pierde y se nota.** Cada pedido muestra «enviado» y «cocina lo vio».
5. **El estado nunca va solo en color:** color + ícono + palabra.

## Qué hay hecho

| Parte | Dónde | Estado |
|---|---|---|
| Sucursales | `branches`, `lib/pos/queries.ts` (`getActiveBranch`) | hecho |
| Mapa en vivo (maqueta) | `/[bar]/salon/mapa`, `components/pos/floor/*` | hecho |
| Abrir mesa (dos toques, con reserva) | `open-table-sheet.tsx`, RPC `pos_open_table` | hecho |
| Comanda del mozo | `/[bar]/salon/mesa/[sesión]`, `components/pos/order/*`, `lib/pos/order/*` | hecho |
| Pantalla de cocina | `/[bar]/salon/tele`, `components/pos/kitchen/*`, `lib/pos/kitchen/*` | hecho |
| Cambiar una mesa de lugar | `floor-model.tsx` (mantener y arrastrar), `floor-live.tsx`, RPC `pos_move_table` | hecho |
| «¿Dónde trabajás hoy?» | `components/pos/ui/branch-chooser.tsx` | hecho |
| Editor del plano por sucursal | `/[bar]/local/mesas` (ver `docs/floor-plan-mesas.md`): tablero a sangre con ficha flotante, juntar arrastrando, mesas nuevas en fila | hecho |
| Precios (buscar y cambiar, aumentos en bloque, por sucursal, historial) | `/[bar]/menu/precios`, `lib/menu/prices/*` | hecho (se ve con `pos` prendido) |
| Cobro y caja por turno: base y capa de servidor | migraciones `pos_cobro_tablas`, `pos_cobro_cuenta_y_cobrar` y `pos_cobro_descuentos_y_caja`, `lib/pos/cash/*` | hecho |
| La cuenta y la bandeja de pedidos | `/[bar]/salon/mesa/[sesión]/cuenta`, `components/pos/pay/*`, `components/pos/approvals/*` | hecho |
| La caja por turno | `/[bar]/salon/caja`, `components/pos/cash/*` | hecho |
| Sucursales, lista de apertura y ajustes del punto de venta | `/[bar]/local/sucursales`, `lib/pos/branches/*`, `lib/pos/settings/*` | hecho |
| Cocina y aclaraciones (estaciones y a dónde va cada cosa; aclaraciones de cada producto) | `/[bar]/menu/cocina`, `lib/menu/kitchen/*` | hecho |
| «Hoy en vivo» para los dueños | `/[bar]/local/hoy`, `lib/pos/today/*` | hecho |
| Modo práctica por sucursal | `pos_set_practice`, Sucursales › Modo práctica, la franja del salón | hecho |
| Liberar una mesa abierta por error | `pos_release_table`, la hoja de la mesa en la comanda | hecho |
| Ventas día por día | `pos_sales_days`, la tira de «Hoy en vivo» | hecho |
| Juntar dos mesas | `pos_merge_tables`, el mapa (levantar una mesa y soltarla, o tocar, sobre una ocupada) | hecho |
| La Proyección de Administración toma estas ventas | `withPosSales`, `projectionUsesPos` (sin cambios en la base) | hecho |
| El cierre del día arranca precargado con lo cobrado | `posCloseFill`, `getPosCloseDay` (sin cambios en la base) | hecho |
| QR del cliente, vincular la tele, PIN | — | sigue |

## Modelo de datos

Migraciones `pos_sucursales` y `pos_salon_en_vivo`.

- **`branches`**: sucursales del bar. Cada bar nace con una («Principal»). Carta, club, clientes y equipo son
  del bar; **mapa, mesas, cocina, cajas y agotados son de la sucursal** (`branch_id` en `floor_plan_areas`,
  `physical_tables`, `table_sessions`; opcional en `salon_reservations`, donde vacío = la principal).
- **Mesa abierta** = `table_sessions` (+ `reservation_id`, `customer_id`, `bill_requested_at`, `service_day`,
  `is_practice`, `kind`).
- **Tanda** = `tickets` (+ `course`, `held`, `fired_at`, `kitchen_seen_at`, `ready_at`). `held` = «después»:
  está cargada pero cocina no la ve hasta que se marcha.
- **Renglón** = `ticket_items` (+ `station_id`, `prep_status` `queued → preparing → ready → served`,
  `modifiers` con la foto de las aclaraciones). El estado de la tanda sale del de sus renglones
  (`private.pos_sync_ticket`).
- **Carta**: `kitchen_stations` (la estación se pone en la categoría y la heredan sus productos),
  `menu_modifier_groups/options/links` (aclaraciones para tocar), `menu_item_branches` (precio propio y si se
  vende en una sucursal), `menu_stockouts` (agotado por sucursal y día de servicio: se levanta solo),
  `menu_price_changes` (historial, lo anota un disparador).
- **`pos_settings`**: tiempos de alerta, recargo de crédito, qué medios se facturan, billetes.

Todo lo que cambia el estado va por RPC `pos_*` (chequean el rol contra el bar de la fila y avisan en vivo);
las tablas de mesa y comanda no tienen escritura directa. Las lecturas también son una RPC por pantalla
(`pos_floor_snapshot`, `pos_session_detail`, `pos_menu`, `pos_kitchen_queue`).

**En vivo:** cada RPC que cambia algo manda un aviso sin datos al canal público `pos:<sucursal>`
(`private.pos_poke` → `realtime.send`). Las pantallas escuchan con `usePosPoke` y vuelven a leer lo suyo. Si
el canal se cae, la pantalla lo dice y al volver se pone al día sola.

**Día de servicio:** hasta las 5 de la mañana sigue siendo la noche anterior (igual que el tablero operativo).

## Quién puede

`lib/tenant/roles.ts`: `POS_FLOOR_ROLES` (dueño, caja, mozo, anfitriona: abrir, pedir, servir, cuenta),
`POS_KITCHEN_ROLES` (dueño, cocina, caja, mozo: avanzar comandas), `POS_VIEW_ROLES` (ver el salón).

## El mapa

- Es el inicio del salón. Una **maqueta**: mesas con volumen, sillas y un comensal sentado por cada persona,
  pintado del color del estado. La geometría es pura (`lib/pos/floor/projection.ts`, `scene.ts`): una cámara
  ortográfica, sin fuga, así una mesa del fondo se toca igual que una del frente. Tres vistas: maqueta, plano
  y lista.
- La cámara se acomoda a la pantalla (`chooseCamera`): si girar el sector un cuarto de vuelta lo agranda de
  verdad, lo gira; en un celular afloja el giro y la inclinación para que las mesas no queden chicas.
- **Quién tapa a quién** (`paintOrder` en `scene.ts`). Cada cosa suelta apoyada en el piso es una «pieza»:
  una mesa (pata y tapa), cada silla (asiento, respaldo y quien está sentado), cada banqueta, la barra, un
  tramo de pared. Dos piezas solo se pueden tapar si comparten columna de pantalla, y ahí va adelante la que
  está más cerca de quien mira: se pregunta de a pares (`comparePieces`) y con eso se arma el orden. Antes
  se ordenaba por un solo punto de cada volumen, y con todo lo largo fallaba (13/11: en una barra, las
  banquetas pasaban atrás a partir de la cuarta; a las sillas de adelante de una mesa larga les pasaba lo
  mismo). Si dos huellas se pisan no hay respuesta exacta: la más baja hace de piso de la otra (una mesa
  sobre el escenario), y entre dos igual de altas (paredes en una esquina) va adelante la que llega más
  cerca. Las paredes se siguen partiendo en tramos: así dos que se cruzan se intercalan bien.
- **Estados** (de `lib/pos/table-state.ts`, sin que nadie marque nada a mano), por prioridad:
  comida lista sin llevar › pidió la cuenta › esperando comida › comiendo › sin pedido › reservada › libre.
  Cada uno escala a «miralo» y «ya es tarde» con los minutos de `pos_settings`.
- Lo urgente se mueve: la mesa con comida lista late; la demorada se pone roja.
- Arriba, el salón en una línea. Cada pestaña de sector avisa cuántas mesas tienen algo pendiente.
- Una reserva toma su mesa desde 45 minutos antes; antes de eso la mesa está libre pero avisa la hora.
- **Cambiar de mesa:** mantener apretada una mesa ocupada la levanta; las libres quedan marcadas y se
  arrastra hasta una (la ficha en el dedo dice «7 → 10») o se toca el destino. El cambio se ve al instante y
  el aviso trae «Deshacer». Soltar sin haber arrastrado solo deja la mesa levantada. Desde la comanda,
  «Cambiar de mesa» (en «¿Cuántos son?») lleva al mapa con `?mover=<sesión>`. Juntar dos mesas ocupadas
  todavía no está.
- **Lo único que tiene color es el estado.** La decoración (barra, paredes, islas) va en su material aunque en
  el editor tenga un color elegido.
- **Una mesa de práctica se nota:** su chapa va con el borde punteado y arriba dice «Práctica» (y lo lee el
  lector de pantalla). Con la práctica prendida conviven mesas de verdad (las abiertas antes) y de prueba:
  quien cobra tiene que ver cuál es cuál sin acordarse.
- El nombre de una mesa entra en su tapa: los de una o dos cifras usan el tamaño de siempre, los largos se
  achican (`labelSize`).
- Con más de una sucursal, la primera vez que entra un dispositivo se le pregunta dónde está
  («¿Dónde trabajás hoy?»). Después no pregunta más.

## La barra de abajo del salón

`components/shell/salon/salon-nav.ts`. Entran cinco pestañas; con más, la quinta es «Más» y abre el resto en
una hoja. Con el punto de venta el orden es salón, caja, reservas, cocina; el club (sumar puntos, QR) y lo de
algunas noches quedan detrás de «Más». La comanda (`/salon/mesa/*`) no lleva pestañas: se vuelve con la
flecha. El punto de venta trae el plano del salón: prender `pos` alcanza (`getEffectiveFeatures`).

## Cobro y caja por turno

Tres migraciones (`20261113113800_pos_cobro_tablas`, `20261113114128_pos_cobro_cuenta_y_cobrar` y
`20261113114414_pos_cobro_descuentos_y_caja`; es un solo diseño, partido en tres para aplicarlo): ocho tablas nuevas (`pos_registers`,
`pos_shifts`, `pos_payments`, `pos_payment_edits`, `pos_cash_movements`, `pos_approvals`, `pos_discounts`,
`pos_closed_bills`) y 28 funciones. No toca la estructura de nada que ya existe.

- La cuenta: consumo − descuentos − la seña = lo que falta. Se paga en partes y cada parte con su medio.
- El recargo de crédito y la propina van aparte: no son venta. La propina no entra en el efectivo que tiene
  que haber en el cajón.
- Cuando no queda nada por cobrar la mesa se cierra sola y el socio suma sus puntos.
- Descuentos y bajas: quien puede aprobar los aplica directo; el resto los pide.
- Nada se borra: un cobro se anula o se corrige y queda quién y cuándo. Con el turno cerrado, solo un dueño.
- La plata la leen dueño y caja; nadie escribe directo en las tablas (todo entra por las funciones).

## La cuenta (cobrar una mesa)

`/[bar]/salon/mesa/[sesión]/cuenta` · `components/pos/pay/*` · `lib/pos/pay/*` · pruebas `tests/lib/pos-pay-*.test.ts`.

- **«Cuenta» es un toque.** Desde la comanda pide la cuenta (la mesa cambia de estado en el mapa) y abre esta
  pantalla; la flecha vuelve a la comanda. «Todavía no la pidieron» lo deshace mientras no haya cobros.
- **Lo que falta, siempre arriba y grande**, escrito sobre el paño (no es otra franja). Al lado, cuántos son y
  cuánto le toca a cada uno; después de un cobro, cuánto se lleva cobrado.
- **La cuenta es la cuenta de papel del bar:** membrete, renglones con puntos guía (lo mismo de distintas
  tandas va junto: «4 Mojito»), lo que se descuenta, el total abajo y, debajo de la línea de corte, los cobros.
  «Documento no válido como factura».
- **El talón de cobro** (abajo en el celular, a la derecha con ancho) pregunta de a una cosa: «¿Cómo paga?»
  (seis teclas) y lo mínimo de cada medio. Efectivo: con cuánto paga y el vuelto enorme. Transferencia: el
  alias. Crédito: el recargo antes de cobrar. «Facturar» viene según el medio; la propina va aparte.
- **Dividir** es otra pregunta: todo junto, partes iguales (arranca en los comensales; el plan se lee de los
  rótulos «Parte 2 de 4», así cualquier celular lo sigue), por producto (se marca en la cuenta) u otro monto.
- **El último cobro cierra la mesa sola:** sello COBRADO, vuelto si hubo, puntos del socio y «Volver al salón».
- **Un cobro nunca se encola.** Sin señal se dice que no se registró y se reintenta con la misma clave; «No
  cobrar» primero relee la cuenta para saber si había entrado.
- **Plata escrita a mano** (otro monto, con cuánto paga, propina, descuento en pesos): en pesos, y si no es
  razonable para ese campo pregunta «¿$ 129 o $ 129.000?» (`lib/pos/pay/typed.ts`).
- **Descuentos y bajas** se piden con motivo. Quien puede aprobar los aplica directo; el resto deja un pedido
  que se ve punteado en la cuenta sin cambiar el total.
- La pantalla sigue `can` (lo que la base dice que puede cada uno) y el momento de la cuenta
  (`lib/pos/pay/mode.ts`): cobrando, caja cerrada, cubierta por la seña, cobrada de más, cobrada.

## La bandeja de pedidos

`components/pos/approvals/*`. Una campanita en la barra de arriba del mapa y de la cuenta. A quien puede dar
el OK le cuenta cuántos pedidos esperan (late y avisa cuando entra uno); a quien pidió, le avisa qué le
contestaron. Si no hay nada para esa persona, no se dibuja.

- Aprobar un descuento: un toque, y se puede deshacer (se quita el descuento).
- Rechazar o retirar: un toque; viaja a los cinco segundos (o al cerrar la hoja) y hasta entonces se deshace.
- Aprobar una baja no tiene vuelta: se pregunta una vez.
- No abre su propio canal en vivo: la pantalla que la aloja le pasa `signal`.

Bajas desde la comanda: tocar un renglón → motivo → `requestVoid` (`pos_request_void`). Si quien toca puede
darla (o cocina no lo empezó y la mesa todavía no pidió la cuenta ni pagó nada) se da de baja ahí mismo; si
no, queda el pedido y la comanda avisa «Baja pedida».

## La caja por turno

`/[bar]/salon/caja` (dueño y caja), `components/pos/cash/*`, lecturas y acciones en `lib/pos/cash/*`. Una
pantalla por sucursal (`?sucursal=<slug>` o la que eligió el dispositivo).

- **Abrir**: la primera vez se escribe con cuánto cambio arranca; después muestra lo que dejó el turno
  anterior y pregunta «¿Están en el cajón?» (si no están, se escribe lo que hay).
- **El turno abierto**: cuánto entró, las teclas de los medios (cuentan y filtran), la cinta que se escribe
  sola con cada cobro y, abajo, cuánto efectivo tiene que haber en el cajón. «Sacar plata» y «Entró plata»
  piden monto y motivo. Tocar un cobro lo corrige (medio, factura) o lo anula; queda quién y cuándo.
- **Cerrar**: se cuentan los billetes sin ver cuánto tenía que haber, después se compara (si no coincide,
  la pantalla sugiere qué cobro mirar), se dice cuánto queda de cambio y se confirma. Queda el resumen del
  turno, para copiar o mandar por WhatsApp.
- **Práctica**: un turno aparte para aprender; no entra en ningún número.
- Desde la cuenta de una mesa con la caja cerrada, «Abrir la caja» lleva a la caja de la sucursal de esa mesa.

### Prueba de punta a punta (13/11, bar de ejemplo, sucursal Cerro, base real)

1. Caja sin turnos → abrir con $ 15.000 → cajón $ 15.000.
2. Mesa 7 → Efectivo → Cobrar $ 47.000 → sello COBRADO; en Caja, $ 47.000 y cajón $ 62.000.
3. Sacar $ 6.500 («Hielo») → cajón $ 55.500.
4. Cerrar: contado $ 55.500 → cuadra → quedan $ 15.000 → resumen (se retiran $ 40.500).
5. Con la caja cerrada, la cuenta de la mesa 26 avisa «La caja está cerrada» → Abrir la caja → «¿Están en el
   cajón?» → Sí.
6. Mesa 26 en dos partes: débito $ 11.200 y crédito $ 11.200 + $ 1.120 de recargo → se cierra sola.
7. Mesa 8 (con socio) por QR $ 101.000 → «Laura sumó 101 puntos».

Queda para probar con dos dispositivos a la vez y sin señal (pasos 12 a 15 del guion de la cuenta).

## Sucursales y ajustes del punto de venta

`/[bar]/local/sucursales` (solo el dueño, con `pos`). Lee todo de una vez (`getBranchBoard`) y nada tiene botón
de guardar: se toca y queda, con «Deshacer» (`lib/pos/settings/overlay.ts` muestra lo recién tocado encima de
la última lectura; cada escritura viaja con lo que la persona veía y no pisa lo que otro dueño cambió recién).

- **La cuadra:** una vidriera por sucursal (`storefront.tsx`), con el cartel y el toldo en su color. La
  persiana está tan levantada como avanzada está su lista de apertura.
- **Lista de apertura** (`lib/pos/branches/checklist.ts`): el plano, la carta, la cocina, la caja, el equipo y
  el cobro. Nadie tilda nada a mano: cada paso sale de lo que ya está cargado y lleva a donde se resuelve, ya
  parado en esa sucursal. El paso de la cocina trae el link y el QR de la pantalla de cocina de esa sucursal.
- **Sus datos:** nombre, nombre corto (lo que se lee arriba en el salón), dirección y color (una paleta que
  se lee con letra clara). Principal, orden, activar o desactivar (no con mesas abiertas) y borrar (solo si
  no tiene plano, mesas ni historia).
- **Ajustes** (`?ver=ajustes`, valen para todo el bar): cuándo avisa una mesa, recargo de crédito, alias y
  titular para transferencias, propinas que se ofrecen, qué medios facturan, quién da el OK a descuentos y
  bajas, y con qué billetes se cuenta la caja.

Probado contra la base real en el bar de ejemplo (13/11): nombre corto que se guarda solo y se deshace; crear
«Prueba QA» (persiana a medias, «Faltan tres pasos») y borrarla; recargo de 10 % a 12 % y deshacer.

## Cocina y aclaraciones

`/[bar]/menu/cocina` (dueño y contenido, con `pos`; se entra desde la Carta). Dos pestañas, las dos sobre las
mismas tablas que leen la comanda y la pantalla de cocina (`kitchen_stations`, `station_id` en categorías y
productos, `menu_modifier_*`). Todo se guarda solo, en orden, y se puede deshacer (`use-kitchen-writes.ts`
lleva la cola y la lista de «Deshacer»; `lib/menu/kitchen/ops.ts` aplica cada cambio encima de lo leído).

- **Estaciones:** el número de arriba dice si cada producto tiene a dónde salir, con la barra del reparto.
  Se marca como con un resaltador: se elige una estación (con un toque o con su número; `0` es la goma, `Esc`
  la suelta) y se toca en la carta lo que va ahí. Marcar una categoría alcanza: lo de adentro la sigue, salvo
  lo que tenga su propia marca («Todo a Barra, menos Postres (Fríos)»). También se puede cambiar un renglón
  solo desde su etiqueta. «Lo que falta» lista lo que quedó sin estación o va a una apagada, y si los nombres
  lo dejan claro se ofrece marcar por nombre. «Editar estaciones» abre la hoja para crearlas, renombrarlas,
  cambiarles el color, ordenarlas, apagarlas o borrarlas (una que ya recibió pedidos queda apagada).
- **Aclaraciones:** cada una es una pregunta con sus opciones («Punto de la carne»: jugoso, a punto, bien
  cocido). Se elige cómo se contesta (una si hace falta, una sí o sí, las que hagan falta, al menos una),
  cada opción puede sumar al precio (en pesos) y se ofrece en categorías enteras o en productos sueltos. El
  estado dice si el mozo la ve y en cuántos productos. Hay cuatro de arranque para no empezar de cero.

Probado contra la base real en el bar de ejemplo (13/11): Vinos a Fríos con el marcador y deshacer; marcador
con el teclado; estación «Parrilla QA» creada y borrada; opción «Vuelta y vuelta» sumada y sacada.

## Hoy en vivo (los dueños)

`/[bar]/local/hoy` (solo el dueño, con `pos`). Cómo va el día en el salón, pensado para mirarlo desde el
celular. Sale todo de lo que el salón ya cargó: lee con el cliente de la persona las tablas que el dueño ya
puede ver (`pos_payments`, `pos_closed_bills`, `pos_shifts`, mesas y comandas), sin funciones nuevas en la
base, y las cuentas se hacen en `lib/pos/today/summary.ts` con las mismas reglas que el resumen de la caja.

- **El número grande** es lo vendido (lo que bajó de las cuentas); el recargo de crédito y las propinas se
  dicen aparte. Con más de una sucursal, se ven todas juntas o de a una, cada una con su vidriera.
- **Por dónde entró** (medios de pago, con y sin factura), **el salón** (por persona, mesas abiertas y lo
  que falta cobrar, mesas con socio, señas descontadas), **lo que más salió** y **los turnos de caja**.
- **Para mirar:** descuentos, productos dados de baja, cobros anulados o corregidos y cajas que no cuadraron.
- El día es el de servicio, como ventana de tiempo (de 5 a 5): una mesa abierta ayer y cobrada hoy es venta
  de hoy. `?dia=AAAA-MM-DD` mira un día anterior y `?sucursal=` una sola. Mientras es hoy, se relee sola cada
  30 segundos.

Abajo, **los últimos 14 días** como una tira de barras (`pos_sales_days`, una función de la base que suma por
día de servicio): cada barra lleva a su día, y arriba dice cuánto se vendió en el tramo, el promedio de los
días con ventas, el consumo por persona y cuál fue el mejor.

## La Proyección de Administración se completa sola

Pedido de los socios (reunión del 11/11): «que la proyección se complete sola con las ventas». Hasta ahora
salía solo de los cierres del día que alguien carga a mano en Administración.

- **Qué hace.** En Ventas › Proyección, el Resumen y lo que responde Tex, un día **sin cierre** toma lo que
  cobró el punto de venta ese día de servicio (`pos_sales_days`). La noche en curso se ve en vivo.
- **El cierre sigue mandando.** Es lo que va a los libros (ventas, IVA, cajas). Cuando un día tiene cierre,
  la planilla usa el cierre y lo del punto de venta no se suma ni lo pisa. Por eso «Cargar cierre» sigue en
  el renglón, y los avisos de cierres que faltan no cambian.
- **No escribe nada.** Es solo cómo se arma la planilla: ni una tabla ni una función nueva en la base, y nada
  en los libros. `getSalesProjection(…, { pos })` pide las ventas y `withPosSales` se las cuelga a cada día;
  quién manda lo decide `buildProjection` (`lib/accounting/projection.ts`).
- **Se nota de dónde sale.** El monto lleva una marca (con texto para lectores de pantalla), abajo se
  explica, y tocarlo abre ese día en «Hoy en vivo».
- **Comisiones.** Se estiman igual que en los cierres: cada medio × el porcentaje de Ajustes › Partícipes. El
  par de cada medio sale del `system_key` del medio de Administración (efectivo, transferencia, QR →
  `qr_mp`, débito, crédito); «Otro» va entero.
- **La noche abierta** suma en «Vas vendiendo», pero todavía no se mide contra su objetivo ni entra en
  «Objetivo a hoy» (compararía una noche a medias contra un objetivo entero), y no se le reclama la caja.
- **Quién lo ve.** El dueño de un bar con `pos` (`projectionUsesPos`). La contadora no: está aislada de todo
  lo que no es Administración, y para ella sale de los cierres, como siempre. Un bar sin `pos` no pide nada:
  queda exactamente como estaba (lo fija una prueba).

**Decisiones mías, a confirmar con Nacho:**

1. **Las señas descontadas cuentan como venta de la noche del consumo** (la mesa consumió eso), pero quedan
   afuera de «ventas contra caja» porque esa plata entró antes. Si en la planilla de los socios la seña se
   cuenta el día que se cobra, hay que darlo vuelta.
2. **La contadora no ve estas ventas.** Si tiene que verlas, hace falta una función que las lea con su
   permiso de lectura.
3. **Es del bar entero**, las dos sucursales juntas, igual que los objetivos. Una proyección por sucursal
   necesita objetivos por sucursal.

### El cierre del día arranca precargado

El paso que seguía, hecho el 13/11. En un bar con `pos`, «Cargar cierre» (Administración › Ventas) ya no
arranca en blanco: cada medio trae lo que se cobró por su par del salón ese día de servicio.

- Arriba de los importes dice de dónde salen («Precargado con lo que cobró el punto de venta: $ X en N
  mesas»), con un toque para ver ese día en «Hoy en vivo» y otro para empezar en blanco.
- **No guarda nada solo.** La persona revisa y toca «Cargar cierre», que es la acción de siempre con sus
  validaciones: recién ahí va a los libros. El efectivo contado, los rangos de tiques y lo facturado se
  siguen cargando a mano.
- El par de cada medio sale de su `system_key` (el bar puede haberlo renombrado). Lo cobrado por un medio
  sin par activo («Otro», o uno desactivado en Ajustes) no se reparte: se dice cuánto es.
- **Las señas y las propinas no entran:** las señas ya se habían cobrado y las propinas no son venta. La
  nota lo dice cuando las hay.
- Solo el **primer cierre del día**: si ese día ya tiene uno, no se precarga (lo del punto de venta es del
  día entero y se contaría dos veces).
- Si después de escribir a mano se pide «Traer lo del punto de venta», pregunta antes de pisar.

Código: `lib/accounting/pos-close.ts` (puro: `posCloseFill`, `posCloseWords`, `posCloseChanges`),
`getPosCloseDay` en `lib/accounting/queries/projection.ts`, la nota en
`ventas/cierre/_components/pos-close-note.tsx`. Pruebas: `tests/lib/administracion-cierre-pos.test.ts`.

**Lo que sigue de esto** (sin hacer): precargar también el efectivo contado con lo que contó la caja al
cerrar el turno, y lo facturado con lo que el punto de venta marcó «con factura».

## Auditoría del 13/11 y lo que falta cerrar

Una revisión independiente de la rama confirmó lo estructural (cada RPC chequea el rol contra el bar de la
fila, RLS y política del contador en todas las tablas nuevas, sin `service_role` nuevo, sin datos de personas
en los registros). Lo que encontró y ya está arreglado en el código: el teléfono guardaba páginas con nombres
y las mostraba sin sesión (`public/sw.js` las borra al llegar a la pantalla de entrar); el celular podía abrir
mesas de práctica; cualquiera que mirara la cola marcaba «cocina lo vio»; un aviso en vivo se perdía si
llegaba durante una lectura (`lib/pos/live-reload.ts`); una tanda sin enviar salía con la sesión de otra
persona (`mayAutoSend`).

**Cerrado en la base con la migración `20261113121745_pos_endurecer` (aplicada el 13/11):**
- `pos_cancel_item` tiene las mismas reglas que `pos_request_void`: la mesa abierta, nada ya cobrado por
  producto, y con la cuenta pedida o un cobro hecho la baja la da quien puede aprobar (antes un mozo podía
  dar de baja lo que faltaba pagar y la mesa se cerraba en cero).
- Todas las funciones `pos_*` miran el interruptor del bar (`pos_disabled` si está apagado; un superadmin
  que además trabaja en el bar entra igual).
- `pos_open_table`: la práctica solo vale si abre un dueño; una reserva con el socio borrado se sienta sin socio.
- `pos_send_order`: primero la clave del pedido, después si la mesa está abierta (el reintento de una tanda
  que ya entró no falla si la mesa se cerró en el medio).
- `pos_update_table`: cambiar el socio de la mesa deja un evento (`guest_registered`, `change: customer`).
- `pos_kitchen_queue`: no arrastra tandas de mesas cerradas de otros días.
- `menu_stockouts` y `menu_price_changes`: solo lectura para `authenticated` (se escriben por su función y
  por los disparadores de precio).

Probada en una base local con 103 comprobaciones (cada punto de arriba) y, ya aplicada, con una pasada en el
bar de ejemplo: cocina, tanda con la misma clave dos veces, baja, baja repetida, escritura directa rechazada.

**Anotado al probar:** los renglones de una tanda nacen todos con la misma hora (`created_at` es la de la
transacción), así que dentro de la tanda el orden lo termina decidiendo el id y no el orden en que el mozo
los cargó. Falta una posición explícita en `ticket_items`.

**Cerrado con la migración `20261113132936_pos_practica_y_ventas` (aplicada el 13/11):**
- **Modo práctica de la sucursal.** Lo prende un dueño (Sucursales › Modo práctica) y se apaga solo a las 5
  de la mañana. Mientras está prendido, cada mesa que se abre ahí es de práctica (lo decide la base, no el
  celular): se carga, sale en cocina con su cinta de «Prueba» y se cobra sin caja, pero no entra en ningún
  número, no suma puntos y no toca la reserva. El salón lo avisa con una franja. Al apagarlo (o a la
  madrugada, si quedó vencido) las mesas de práctica abiertas se levantan.
- **Liberar una mesa** abierta por error (`pos_release_table`, desde la hoja de la mesa en la comanda): solo
  si no tiene nada vivo cargado ni cobros.
- **Un candado al final de cada transacción** (`table_sessions_pos_guard`): en un bar con el punto de venta,
  una mesa no pasa a «cobrada» sin su cuenta cerrada, ni a «abandonada» o «juntada» con cobros hechos o con
  consumo sin cobrar. Las funciones viejas del servicio de mesa (`mark_session_paid`,
  `mark_session_abandoned`, `merge_sessions`) no conocen los cobros: si alguien las llama sobre una mesa
  del punto de venta, no queda nada escrito. Para no cobrar una mesa (invitación, se fueron sin pagar) el
  camino es un descuento con su OK, que deja quién fue.
- **El cierre automático de la madrugada** ya no toca las mesas de un bar con el punto de venta: una mesa
  que debe plata la cierra una persona.
- **El orden de los renglones** de una tanda es el orden en que se cargaron.

Probada en una base local con 60 comprobaciones y, ya aplicada, con una pasada en el bar de ejemplo
(práctica prendida → mesa de prueba cobrada sin caja → práctica apagada; mesa vacía liberada; ventas por día).

**Juntar mesas** (migración `20261113140234_pos_juntar_mesas`, aplicada el 13/11): se levanta una mesa en el
mapa (manteniéndola apretada o con «Cambiar de mesa») y se la suelta sobre una ocupada, o se la toca (soltar
arrastrando vale desde el 13/11: `FloorModel` › `move.joins`). La pantalla pregunta, porque no tiene vuelta. `pos_merge_tables` pasa a la mesa que queda las tandas, los cobros, los descuentos y los pedidos
de aprobación, suma las personas y, si no tenía socio, reserva o nombre, toma los de la otra (así la seña y
los puntos no se pierden). No junta una mesa de práctica con una de verdad ni dos mesas con dos reservas
distintas. 36 comprobaciones en la base local y probado en el bar de ejemplo (la 1 con la 3).

**La baja vieja** (migración `20261113153432_pos_baja_vieja`, aplicada el 13/11). `cancel_ticket_item` es la
baja del servicio de mesa anterior: con un motivo, cualquier mozo o la cocina daba de baja un renglón. En un
bar con punto de venta eso salteaba el OK, el «no tocar lo ya cobrado» y el registro de quién fue; dando de
baja una mesa renglón por renglón se la podía liberar sin cobrar. Ahora, con `pos` prendido, esa función no
da de baja nada (`pos_only`) y la pantalla vieja dice que se hace desde la cuenta de la mesa. Un bar sin
punto de venta queda igual. Revisé las demás puertas viejas (13/11): `update_ticket_status` solo avanza una
comanda, `reject_ticket` y `cancel_pending_ticket` solo tocan pedidos del cliente todavía sin aceptar,
`split_session` solo mueve lo que cargó un comensal (el punto de venta no carga así), y cerrar o abandonar
una mesa con consumo ya lo frena el disparador de las mesas. Las tablas no se escriben directo: solo tienen
política de lectura. 28 comprobaciones en la base local y probado en el bar de ejemplo.

**Pendiente (otra tanda):**
- El canal en vivo `pos:<sucursal>` es público: no lleva datos de mesas ni de personas, pero cualquiera con
  el id de la sucursal puede escucharlo y emitir. Tiene que pasar a privado, con lectura por membresía.
- Las acciones validan el bar de la dirección y la RPC opera sobre el bar de la fila: quien trabaja en dos
  bares puede operar una fila de uno desde la dirección del otro (sin ganar permisos, pero la auditoría
  queda en el bar equivocado). Cada RPC tiene que recibir el bar esperado.

## Diseño: el mundo «papel»

El rastro de papel del bar, vivo: la maqueta de cartón del salón, la comanda con duplicado, la cuenta, la
cinta de la caja. Nace de lo que el oficio ya usa (el talonario con carbónico: se escribe una vez y llega a
cocina, a la caja y al dueño), no del tablero de rectángulos de colores de los sistemas de siempre.

- **Material:** papel crema y cartón blanco sobre un paño verde bosque. Lo único que tiene color es el estado.
- **Tinta:** `--pos-ink` para lo impreso (rótulos, nombres); `--pos-carbon` (violeta de carbónico) para lo que
  el sistema escribe solo: horas, montos, cantidades de personas.
- **Sellos** para lo que terminó o no tiene vuelta (COBRADO, ANULADO, ENTREGADO). Nunca para un estado en curso.
- **Letra:** Archivo (grotesca argentina con eje de ancho, `lib/pos/font.ts`). Angosta y pesada
  (`font-stretch: 78–86 %`, peso 700–800) para números de mesa, cantidades y rótulos; ancho normal para texto.
  Números siempre `tabular-nums`. Se carga solo en las pantallas del punto de venta.
- **Estados:** reservada violeta · sin pedido tinta · en cocina naranja · para llevar verde vivo · comiendo
  verde agua · cuenta azul · demorada rojo. Tokens `--pos-st-*`; el color del estado viaja en `--st`.
- **Toque:** nada interactivo mide menos de 48 px; lo principal, 52–68 px, abajo, al alcance del pulgar.
- **Movimiento:** solo el que dice algo (lo listo late, lo demorado respira). Al tocar, `scale(0.97)` en
  140 ms. Nada anima al entrar a una pantalla que se abre cien veces por noche. Curva `--pos-ease`. Con
  «reducir movimiento», queda el color y se va el movimiento.
- **Plata:** en pesos, sin centavos (`formatCentsShort` de `lib/money`).
- **Voz:** de bar, de vos. «Mesa», «tanda», «marchar», «cuenta», «caja», «agotado». Los botones dicen lo que
  hacen.

Todo cuelga de la clase `.pos` (tokens al final de `app/globals.css`). Los portales (hojas, diálogos) llevan
`pos` y la variable de la letra aparte, porque se dibujan fuera del árbol.

## Probarlo

El bar de ejemplo (`demo-administracion`) tiene dos sucursales (Alta Córdoba y Cerro), el plano del Cerro en
tres sectores y la carta de HUB copiada. Las mesas «en plena noche» se arman con un guion que se puede correr
las veces que haga falta (vive fuera del repo, en el espacio de trabajo de la sesión).

Pruebas: `tests/lib/pos-floor.test.ts` (proyección y maqueta), `tests/lib/pos-table-state.test.ts` (estados),
`tests/lib/pos-order-*.test.ts` (carrito, búsqueda, tandas, bandeja de salida) y `tests/lib/pos-kitchen*.test.ts`
(tarjetas, totales, selección con dos botones).

## La comanda del mozo

- Arriba, una sola fila: volver, la mesa, cuántos son y el nombre. Lo demás (seña, alertas, evento, socio) va
  dentro de la comanda.
- Cada tanda es un tique de papel con sus tildes: enviada, «cocina lo vio», en preparación, lista, servida.
  Lo que no tiene vuelta lleva sello (SERVIDA, ANULADO con el motivo).
- Se pide buscando. Sin escribir: lo que más sale a esa hora, «repetir la ronda» y las categorías.
- Las aclaraciones son fichas para tocar; el texto libre es la última opción.
- Abajo, una acción obvia según el momento: enviar (o dejar para después), servir, marchar la tanda, agregar.
- Un pedido nunca se pierde ni se duplica: cada tanda lleva su clave, se guarda en el teléfono hasta que la base
  la confirma y se reintenta sola; lo que quedó sin enviar también sale desde el mapa (`PosOutboxRunner`).

## La pantalla de cocina

- Una tarjeta por tanda, colgada del riel por orden de llegada; nunca se reacomoda sola.
- Arriba, el total que se está preparando («8 Bacon · 5 Lomito»).
- Dos botones: Siguiente mueve el marco, Avanzar pasa de Nuevo a En preparación y a Listo; mantenerlo deshace.
  Llegan como teclas (flecha derecha / Enter), así sirve cualquier botonera que se presente como teclado.
- Cada pantalla elige qué estaciones muestra (`?estaciones=`); lo de las otras queda de pie de tarjeta.
- Con un evento, la pantalla se parte: el evento con totales por plato a un lado, las mesas a la carta al otro.
- Sin conexión, la franja de arriba es el aviso, con la hora del último dato.
