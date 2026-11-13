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
| Editor del plano por sucursal | `/[bar]/local/mesas` (ver `docs/floor-plan-mesas.md`) | hecho |
| Precios (buscar y cambiar, aumentos en bloque, por sucursal, historial) | `/[bar]/menu/precios`, `lib/menu/prices/*` | hecho |
| Cobro y caja por turno: base y capa de servidor | migración `pos_cobro_y_caja` (**sin aplicar**), `lib/pos/cash/*` | diseñado y ensayado |
| La cuenta y la bandeja de pedidos | `/[bar]/salon/mesa/[sesión]/cuenta`, `components/pos/pay/*`, `components/pos/approvals/*` | hecho con datos de ejemplo |
| La caja por turno | `/[bar]/salon/caja` | en construcción |
| Tablero del dueño, QR del cliente, modo práctica | — | sigue |

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
- El nombre de una mesa entra en su tapa: los de una o dos cifras usan el tamaño de siempre, los largos se
  achican (`labelSize`).
- Con más de una sucursal, la primera vez que entra un dispositivo se le pregunta dónde está
  («¿Dónde trabajás hoy?»). Después no pregunta más.

## La barra de abajo del salón

`components/shell/salon/salon-nav.ts`. Entran cinco pestañas; con más, la quinta es «Más» y abre el resto en
una hoja. Con el punto de venta el orden es salón, caja, reservas, cocina; el club (sumar puntos, QR) y lo de
algunas noches quedan detrás de «Más». La comanda (`/salon/mesa/*`) no lleva pestañas: se vuelve con la
flecha. El punto de venta trae el plano del salón: prender `pos` alcanza (`getEffectiveFeatures`).

## Cobro y caja por turno (diseñado, sin aplicar)

Migración `supabase/migrations/20261113030000_pos_cobro_y_caja.sql`: ocho tablas nuevas (`pos_registers`,
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

Probado con datos de ejemplo: la prueba de punta a punta espera que se aplique la migración de cobro.

## Auditoría del 13/11 y lo que falta cerrar

Una revisión independiente de la rama confirmó lo estructural (cada RPC chequea el rol contra el bar de la
fila, RLS y política del contador en todas las tablas nuevas, sin `service_role` nuevo, sin datos de personas
en los registros). Lo que encontró y ya está arreglado en el código: el teléfono guardaba páginas con nombres
y las mostraba sin sesión (`public/sw.js` las borra al llegar a la pantalla de entrar); el celular podía abrir
mesas de práctica; cualquiera que mirara la cola marcaba «cocina lo vio»; un aviso en vivo se perdía si
llegaba durante una lectura (`lib/pos/live-reload.ts`); una tanda sin enviar salía con la sesión de otra
persona (`mayAutoSend`).

**En la migración `pos_endurecer` (escrita aparte, va junto con cobro):** `pos_cancel_item` no mira la mesa,
la cuenta ni los cobros; `pos_require_role` no mira el interruptor del bar; `pos_open_table` acepta la
práctica de cualquier rol; `pos_send_order` mira la mesa antes que la clave; permisos de tabla de más en
`menu_stockouts` y `menu_price_changes`; una reserva con el socio borrado no se puede sentar; cambiar el
socio de una mesa no deja evento; la cola de cocina muestra tandas de mesas cerradas.

**Pendiente antes de usarlo con plata de verdad (otra tanda):**
- Las funciones viejas del servicio de mesa (`mark_session_paid`, `cancel_ticket_item`, `merge_sessions`,
  `mark_session_abandoned`, el cierre automático de las 2 de la mañana) no conocen los cobros.
- El canal en vivo `pos:<sucursal>` es público: no lleva datos de mesas ni de personas, pero cualquiera con
  el id de la sucursal puede escucharlo y emitir. Tiene que pasar a privado, con lectura por membresía.
- Las acciones validan el bar de la dirección y la RPC opera sobre el bar de la fila: quien trabaja en dos
  bares puede operar una fila de uno desde la dirección del otro (sin ganar permisos, pero la auditoría
  queda en el bar equivocado). Cada RPC tiene que recibir el bar esperado.
- El modo práctica: de la sucursal, prendido por el dueño, con hora de apagado.

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
