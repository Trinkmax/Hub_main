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
| Precios (buscar y cambiar, aumentos en bloque, por sucursal, historial) | `/[bar]/menu/precios`, `lib/menu/prices/*`, `menu_apply_price_changes` (entero o nada, un aumento = una tanda) | hecho (se ve con `pos` prendido) |
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
| Comandas, cuenta y cierre de caja por la comandera | `lib/pos/print/*`, `components/pos/print/*` (sin cambios en la base) | hecho |
| El pase: una pantalla por estación (Cocina, Barra, Pizzeros, Plancha) con teclado numérico y mouse | `/[bar]/salon/tele`, `components/pos/kitchen/pass-*`, `lib/pos/kitchen/{board,keypad,station-kind}.ts`, RPC `pos_kitchen_move` | hecho (26/11) |
| De quién es cada mesa (el mozo ve las suyas; las de otro, tomadas) | `table_sessions.waiter_id`, `lib/pos/floor/waiter.ts`, RPC `pos_assign_waiter` y `pos_floor_team` | hecho (26/11) |
| Dibujos de comida y bebida sobre cada mesa | `lib/pos/floor/prep.ts`, `floor-model.tsx` | hecho (26/11) |
| Avisos al mozo: con la app abierta y notificación con el celular bloqueado | `pos_notices`, `push_subscriptions`, `lib/pos/notices/*`, `lib/push/*`, `/api/cron/pos-push` | hecho (26/11) |
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

**En vivo:** cada RPC que cambia algo manda un aviso sin datos al canal `pos:<sucursal>`
(`private.pos_poke` → `realtime.send`). Las pantallas escuchan con `usePosPoke` y vuelven a leer lo suyo. Si
el canal se cae, la pantalla lo dice y al volver se pone al día sola.

El canal es **privado** (migración `20261113195644_pos_canal_privado`, aplicada el 13/11). Antes era público: no llevaba datos, pero
cualquiera con la clave pública del proyecto y el id de una sucursal podía escucharlo (y saber cuándo se
mueve un salón) o mandarle avisos falsos. Ahora:

- la base manda al canal privado (`realtime.send(..., true)`);
- Realtime deja entrar solo a quien pasa la política `pos_live_listen` de `realtime.messages`: alguien con
  un rol en el bar de esa sucursal (lee `branches` con los permisos de quien pregunta y además pide
  `user_role_in_tenant`). Un nombre de canal que no es `pos:<id>` no entra y no rompe;
- nadie manda desde el navegador: no hay política de escritura;
- `usePosPoke` le pasa al socket la sesión de ese momento (`authorizeSocket`) y recién después se une con
  `{ config: { private: true } }`: los permisos se fijan al entrar.

**El token del canal se renueva solo (23/11/2026).** Los socios avisaron que «hay que actualizar todo el
tiempo para ver los cambios de colores». La causa: la app le escribía el token A MANO al socket
(`realtime.setAuth(token)`), y un token puesto a mano queda fijo: la librería deja de renovarlo en cada
latido y dura una hora. Pasada la hora, Realtime cierra los canales privados y cada reintento vuelve a
entrar con el token vencido (`InvalidJWTExpiration`): el salón quedaba «sin conexión» hasta recargar. Peor
todavía porque acá la sesión muchas veces la renueva el servidor (el proxy, en cada pedido) y el navegador
nunca se entera por un evento. Ahora (`lib/supabase/browser.ts`):

- `syncRealtimeAuth()` llama a `realtime.setAuth()` SIN token: el socket le pide la sesión vigente al
  cliente (la lee de las cookies) y se la manda a los canales si cambió;
- se repite en cada latido (`onHeartbeat`), porque cuando el navegador sí renueva la sesión supabase-js
  vuelve a escribirle el token a mano y la renovación automática se apagaría otra vez;
- si el canal se cae, antes de que la librería reintente se le pasa la sesión de ahora (`use-poke.ts`);
- y la red de seguridad dejó de ser fija: 20 s con el canal en vivo, 6 s sin canal (`safetyNetMs`). Un
  salón sin avisos se pone al día cada 6 segundos, no cada 40.

Vale para toda la app (la bandeja de mensajes y las suscripciones de `lib/realtime/subscribe.ts` usan el
mismo socket).

**Al desbloquear el celular, la conexión se revisa sola (25/11/2026).** Nacho avisó que «en el sistema de
los mozos no se actualizan las cosas en tiempo real». En HUB los mozos son dueños en el sistema y anoche
usaron los tableros de reservas, no el mapa. Medido en producción con dos navegadores (uno cambia una
reserva, el otro la espera): en vivo llegaba en menos de un segundo, pero al bloquear y desbloquear la
pantalla el navegador congela la página y el servidor corta la conexión sin que la página se entere. El
socket seguía figurando abierto y la librería recién lo daba por muerto cuando un latido quedaba sin
respuesta (hasta ~50 s). Con el tablero del salón era peor: no volvía a leer las reservas ni al
reconectar ni en su red de seguridad, que solo releía los cupos, así que **no se ponía al día nunca**
hasta recargar.

- `lib/realtime/probe.ts` + `probeRealtime()` en `lib/supabase/browser.ts`: al volver la pantalla
  (después de 4 s oculta), al volver la red y al restaurar la página desde la caché se manda un latido. Si
  no contesta en 3,5 s, se usa el camino de la librería para un latido vencido: canales con error,
  reconexión y vuelven a unirse. Cada pantalla, al ver su canal otra vez en vivo, relee lo suyo.
- Tablero de reservas del salón (`/salon/reservas-operativo`): relee reservas y cupos al reconectar, al
  volver la red, al volver la pantalla y cada 30 s (6 s sin canal). Un INSERT o un cambio de cliente,
  gestor, torta o evento se completa leyendo (la fila en vivo llega sin esos datos).
- El Operativo y las Mesas del panel pasaron a la misma red de seguridad que el salón: 30 s / 20 s con el
  canal en vivo y 6 s sin él.

Medido antes y después (bar de ejemplo, misma prueba): un cambio después de desbloquear pasó de **nunca**
a 5,7 s en el tablero del salón y de 57 s a 0,9 s en el Operativo; al volver la red, de **nunca** a 4,6 s
en el salón.

**Volver a una pantalla nunca muestra lo de antes (25/11/2026).** Nacho: «aprieto [servido] y a veces no se
marca, y el tema de la cuenta también». Para que ir y volver sea instantáneo, el navegador guarda la última
versión de cada pantalla (Next: `staleTimes.dynamic = 30`, y «atrás» siempre usa la copia). Las pantallas del
punto de venta arrancaban con esa copia y no se volvían a leer hasta la red de seguridad: reproducido en
producción, marcar como servido → volver al mapa → entrar otra vez a la mesa mostraba «Servido · 6» de
nuevo durante 20 s (el servidor ya lo tenía servido). La cuenta podía arrancar con un total viejo.

- `lib/pos/freshest.ts`: cada versión que llega (la copia guardada, una lectura, la respuesta de una acción)
  se compara por la hora del servidor (`now`) con la más nueva que vio la pestaña, y gana la más nueva. La
  mesa, la cuenta y el mapa nunca vuelven para atrás (tampoco cuando una lectura lenta vuelve después de la
  respuesta de una acción).
- La mesa, la cuenta, el mapa, la caja y la cocina leen apenas se abren.
- El mapa no se vuelve a montar al cambiar de sucursal (cambia solo `?sucursal=`): lee siempre la sucursal de
  la página, guarda cada lectura con la sucursal que trae adentro y descarta la que vuelve después de un
  cambio de sucursal, para no mostrar nunca una sucursal en lugar de otra.

Con el arreglo, misma secuencia: al volver a la mesa ya aparece servido desde el primer instante, y una baja
hecha desde otro celular se ve en la cuenta en ~1 s al volver a entrar (antes, hasta 20 s: lo que tardaba la
red de seguridad).

Es la única política que tiene `realtime.messages`; los canales públicos del resto del sistema (billetera
del cliente, cambios de tablas) no se enteran. Lo prueban `tests/rls/pos-live-channel.test.ts` (la puerta,
contra el servicio de verdad) y 31 comprobaciones en la base local. Una pantalla sin usuario (la tele de
cocina, el QR del cliente) va a necesitar su propio camino cuando se haga: hoy no existe ninguna.

**Día de servicio:** hasta las 5 de la mañana sigue siendo la noche anterior (igual que el tablero operativo).

## Quién puede

`lib/tenant/roles.ts`: `POS_FLOOR_ROLES` (dueño, caja, mozo, anfitriona: abrir, pedir, servir, cuenta),
`POS_KITCHEN_ROLES` (dueño, cocina, caja, mozo: avanzar comandas), `POS_VIEW_ROLES` (ver el salón) y
`POS_KITCHEN_SCREEN_ROLES` (dueño y cocina: quién tiene la pantalla de cocina entre sus pestañas).

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
  para retirar › pidió la cuenta › en preparación › comiendo › sin pedido › reservada › libre.
  Cada uno escala a «miralo» y «ya es tarde» con los minutos de `pos_settings`.
- **Cómo se llaman y de qué color van lo eligió el bar (16/11/2026):** «En preparación» (naranja)
  mientras cocina trabaja, «Para retirar» (verde) cuando ya salió y espera que la lleven, «Comiendo»
  en violeta, «Cuenta» en azul y «Reservada» en gris. «Para llevar» NO se usa para lo que está listo:
  en un bar quiere decir que el cliente se lo lleva, no que va a una mesa. El 25/11/2026, a pedido de Nacho, «En despacho» pasó a llamarse
  «Para retirar». El sello de «cobrado» y lo
  que salió bien usan su propio color (`--pos-good`), que no es un estado de mesa.
- Lo urgente se mueve: la mesa con comida lista late; la demorada se pone roja.
- **Antes de ponerse roja, avisa** (23/11/2026): cuando una mesa pasa su primer tiempo («miralo») la chapa
  lleva un borde amarillo (`pos-urg-warn`). Antes ese paso solo sumaba al contador del sector.
- **«Colores»** (la ficha de la paleta, abajo a la izquierda) abre la leyenda: qué quiere decir cada color
  y a los cuántos minutos avisa y se pone roja cada estado, con los minutos del bar. Los socios lo
  preguntaron («¿cuáles son los tiempos de las demoras?») y no había dónde leerlo. Sale de
  `lib/pos/floor/legend.ts`, y una prueba la compara con la cuenta del mapa (`pos-floor-legend.test.ts`):
  no puede decir otra cosa. El dueño tiene ahí «Cambiar los tiempos» (lleva a Sucursales › Ajustes).
- **La marca del bar** va sobre el paño, abajo a la derecha, arriba del selector de vista
  (`components/pos/ui/pos-brand.tsx`): el logo de Configuración › Apariencia pintado con máscara (sale
  crema sin importar de qué color sea el archivo) o, si no hay logo, el nombre. En la cocina va al final
  del estante de abajo.
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

### Acciones rápidas: la ficha de la mesa (25/11/2026)

Nacho: «si yo toco en una mesa, poder tener la acción rápida, para que no se me abra un menú completo o
cambiar de pantalla para marcar servida una comida […] desde el celu principalmente». Antes, tocar una mesa
ocupada entraba a la comanda: marcar algo como servido eran dos cambios de pantalla.

- **Tocar una mesa ocupada la elige** (aro en el piso, borde de la tapa marcado) y abajo aparece su **ficha**
  (`components/pos/floor/table-quick.tsx`): la mesa, en qué está, cuánto lleva, y a lo sumo tres botones. Es
  la barra de abajo de la comanda traída al mapa: las mismas palabras, el mismo orden, y el botón que manda
  a la derecha, donde cae el pulgar. **Tocar la misma mesa otra vez** (o el encabezado de la ficha) entra a
  la comanda. Tocar el paño, Escape o la cruz la cierra. Una mesa libre se abre como siempre.
- **Qué manda** lo decide `quickCard` (`lib/pos/floor/quick.ts`, con pruebas), siempre lo mismo que se ve
  pintado en la mesa:

  | La mesa está | Botón que manda | Qué hace |
  | --- | --- | --- |
  | Para retirar | **Servido · N** | Marca servido todo lo listo, sin salir del mapa |
  | Pidió la cuenta | **Cobrar** | Abre la cuenta |
  | Comiendo o sin pedido, con una tanda esperando | **Marchar tanda N** | La manda a cocina, sin salir del mapa |
  | Cualquier otra cosa | **Agregar** | Entra a la comanda con la carta abierta |

  «Cuenta» (la pide y la abre, igual que en la comanda) y «Agregar» están siempre.
- **Dos fuentes.** El mapa (en vivo) decide QUÉ se ofrece. El detalle de la mesa, que se lee al elegirla,
  solo lo completa: cuántas unidades («Servido · 7»), qué hay que llevar («4 Mojito · 3 Branca y Cola») y qué
  tanda espera. Si todavía no llegó, la ficha ya anda (el lugar del rótulo queda reservado: no cambia de
  alto). Ese detalle queda como «lo más nuevo» de la mesa: si después se entra a la comanda, arranca con eso.
- **Se ve al instante.** «Servido» y «Marchar» cierran la ficha y pintan la mesa como va a quedar
  (`withPending`); la base confirma después y un aviso lo dice («Mesa 2: servido»). Si la base dice que no,
  se avisa y la mesa vuelve a como estaba. Medido en el bar de ejemplo: a los 120 ms de tocar, la mesa ya
  cambió; el aviso de confirmación llega a los ~0,7 s.
- **La mesa elegida nunca queda tapada.** Si caía debajo de la ficha (un celular chico), el mapa se corre lo
  justo (`.pos-pan`); no se vuelve a encuadrar, el salón no cambia de tamaño por tocar una mesa.
- **Con ancho (la compu de la caja) es una sola fila baja**, en el lugar de las fichas del resumen: en una
  notebook el mapa mide poco de alto y la ficha del celular le tapaba un tercio.
- **Un toque, acciones rápidas; doble toque, entrar a la mesa.** Entre un toque y el otro la pantalla cambia
  debajo del dedo (aparece la ficha, el mapa se corre): el segundo toque de un doble toque caía en un botón
  («Servido») o en la mesa de al lado. Se lo reconoce por el lugar (`isEchoTap`: mismo punto de la pantalla,
  menos de medio segundo) y entra a la mesa elegida, caiga donde caiga. No es una espera: tocar la mesa y
  enseguida un botón, en otro lugar de la pantalla, anda siempre (probado a los 165 ms).
- Lo que hay que llevar junta lo igual (`unitsLabel`): una mesa que pidió lo mismo en dos tandas dice
  «4 Mojito», no «2 Mojito · 2 Mojito». Vale también para la barra de la comanda.
- Quien solo mira (la cocina) sigue entrando al pedido con un toque. En la lista funciona igual: la fila
  elegida queda marcada.

### Los dibujos sobre la mesa y de quién es cada una (26/11/2026)

Nacho: «en las mesas que aparezcan los emojis arriba de la mesa si hay comida y bebida» y «el mozo debe
ver las que él atiende; las ya atendidas por otro mozo le tienen que aparecer así, bloqueadas o atendidas».

- **Un dibujo por estación** en la bandera de la mesa (🍔 cocina, 🍹 barra, 🍕 pizzeros; el dibujo es el de
  la estación, `stationIcon`). Mientras se prepara va apagado; cuando esa estación lo tiene **para
  retirar** lleva un tilde y salta. El color de la bandera sigue diciendo el estado de la mesa, así que
  los dibujos reemplazan al ícono y a la palabra. Con las mesas muy chicas se muestra solo lo que ya está
  para retirar. Sale de `prep` en cada mesa de `pos_floor_snapshot` (unidades por estación y paso) y lo
  arma `prepChips` (`lib/pos/floor/prep.ts`). Al marcar «Servido» los tildes se van al instante.
- **Cada mesa abierta tiene quién la atiende** (`table_sessions.waiter_id`): el mozo que la abrió o, si
  la sentó la anfitriona, el primer **mozo** que le carga un pedido. Lo ponen dos disparadores, así vale
  para cualquier pantalla que abra o cargue. La caja o un dueño pueden cargarle lo que haga falta sin
  quedársela (migración `pos_solo_mozos_toman_mesa`): si no, con el primer pedido de la caja la mesa se
  les bloqueaba a todos los mozos. El aviso de cocina de un pedido cargado en una mesa sin mozo le llega
  a quien lo cargó.
- **Al mozo, la mesa de otro se le muestra tomada**: gris, con candado y el nombre de quien la atiende.
  La puede tocar (la ficha dice de quién es) pero no abrirla ni cargarle nada, ni desde el mapa ni
  entrando por la dirección (`TakenTable`). El resumen de arriba y «lo que tengo que llevar» cuentan solo
  las suyas y las que todavía no tienen a nadie.
- **Al encargado no se le bloquea nada** (dueño, caja, anfitriona): ve quién atiende cada mesa en la
  ficha y la puede pasar. El filtro «Mis mesas» deja a la vista solo las propias.
- **Pasar una mesa**: en la ficha, el cartel con el nombre abre «¿Quién atiende la mesa N?» con el equipo
  de esa sucursal (`pos_floor_team`). La pasa su propio mozo o el encargado (`pos_assign_waiter`); el
  encargado además puede dejarla sin nadie. Queda en auditoría (`pos.table_waiter_changed`).
- **Decisión (cambiable):** el bloqueo es de pantalla, no de la base. Un mozo no ve cómo operar la mesa de
  otro, pero las funciones de la base no lo rechazan; se eligió así para que una noche complicada
  (alguien se va antes, un celular sin batería) nunca deje una mesa sin poder atenderse.

## La barra de abajo del salón

`components/shell/salon/salon-nav.ts`. Entran cinco pestañas; con más, la quinta es «Más» y abre el resto en
una hoja. Con el punto de venta el orden es salón, caja, reservas, cocina; el club (sumar puntos, QR) y lo de
algunas noches quedan detrás de «Más». **La pestaña «Cocina» la ven solo la cocina y el dueño** (25/11/2026,
Nacho: «no tiene sentido esa pantalla, solo debe de verse en la cocina»): a mozos y cajeros no les aparece,
y al mozo le entran todas sus pestañas sin «Más». No cambia quién puede avanzar una comanda. La comanda (`/salon/mesa/*`) no lleva pestañas: se vuelve con la
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
- **Cobro parcial sin cerrar la mesa** (pedido del 16/11/2026): se divide «por producto», se marca lo
  que paga quien se va y se cobra; la cuenta muestra «2 de 8 ya cobrados» y lo que falta. Con una parte
  cobrada aparece **«La mesa sigue»**: le saca a la mesa el aviso de cuenta (si no, queda como «pidió
  la cuenta» y en rojo toda la noche) y vuelve a la comanda para seguir pidiendo.
- **«Imprimir la cuenta»** (en la compu que tiene la comandera) saca la cuenta en papel: ver «La comandera».
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

- **Abrir**: la primera vez se escribe con cuánto cambio arranca. Después, a un socio le muestra lo que
  dejó el turno anterior y pregunta «¿Están en el cajón?» (si no están, escribe lo que hay); quien no es
  socio abre a ciegas: cuenta y escribe, sin ver cuánto había quedado (ver «La caja a ciegas»).
- **En un día nuevo la caja arranca limpia**: la cinta del turno anterior acompaña mientras sea del mismo
  día (se cerró el mediodía, se abre la noche). Si el último turno es de otro día, a la derecha queda la
  cinta vacía; lo de antes está en «Ver cómo cerró» y en «Turnos». (Nacho, 26/11/2026, mirando el jueves la
  cinta del domingo: «¿por qué me sale esto así, si hoy es un día nuevo?».)
- **El turno abierto**: cuánto entró, las teclas de los medios (cuentan y filtran), la cinta que se escribe
  sola con cada cobro y, abajo, cuánto efectivo tiene que haber en el cajón. «Sacar plata» y «Entró plata»
  piden monto y motivo; con Administración en marcha, «Sacar plata» pregunta además para qué sale y a
  quién (ver «Retiros con destino»). Tocar un cobro lo corrige (medio, factura) o lo anula; queda quién y
  cuándo.
- **Cerrar**: se cuentan los billetes sin ver cuánto tenía que haber, después se compara (si no coincide,
  la pantalla sugiere qué cobro mirar), se dice cuánto queda de cambio y se confirma. Queda el resumen del
  turno, para copiar o mandar por WhatsApp.
- **Práctica**: un turno aparte para aprender; no entra en ningún número.
- Desde la cuenta de una mesa con la caja cerrada, «Abrir la caja» lleva a la caja de la sucursal de esa mesa.

### La caja a ciegas y el cierre que les llega a los socios (23/11/2026)

Pedido de los socios (audio del 22/11): «hicimos un cierre de caja, hay un montón de info que no queremos
que vea el encargado, y además es un chorizo largo escrito […] ¿hay posibilidad que cuando cierre la caja
esto nos lo mande a nosotros y que no manipule la información el encargado?».

- **De quién son los números del salón:** de los socios. Socio = dueño con acceso completo a Administración
  (la lista que el bar ya mantiene en Administración › Ajustes › Accesos: un solo lugar para decidir quién
  ve la plata). En un bar sin Administración, todos los dueños. El rol Cajero nunca. Lo decide
  `seesSalonNumbers` (`lib/pos/cash/blind.ts`). En HUB hoy son 6 personas; los otros usuarios con rol de
  dueño (entre ellos el de los encargados) operan a ciegas.
- **Qué ve quien no es socio:** la caja entera para operar (abrir, la cinta con cada cobro del turno para
  poder corregir uno, sacar y entrar plata, contar y cerrar), pero sin totales: el visor dice cuántos cobros
  lleva el turno, las teclas de los medios cuentan cobros y el cajón dice «se cuenta al cerrar». No hay
  «Turnos» anteriores ni «Así viene el turno».
- **Abrir a ciegas (26/11/2026).** Nacho: «en el arqueo se ve todo el tiempo la plata que debería de haber,
  la idea es que ellos tengan que contarla, así se hace el arqueo. No quiero que roben nada». Cerrar ya era
  a ciegas, pero ABRIR le mostraba a cualquiera cuánto había dejado el turno anterior y pedía confirmar
  («¿Están en el cajón?»): si la pantalla dice cuánto tiene que haber, nadie cuenta. Ahora quien no es
  socio ve «¿Cuánto hay en el cajón?», cuenta y escribe. Antes de abrir se le pregunta UNA cosa al servidor
  (`checkOpeningCount`: ¿coincide con lo que quedó?, sí o no); si no coincide se pide contar una vez más,
  sin decir cuánto ni para qué lado, y si insiste abre igual: queda anotado lo que contó, lo que había
  quedado y quién abrió, y la diferencia sale en el resumen del turno que reciben los socios. Lo que dejó
  el turno anterior ya no viaja a su navegador por ningún lado: ni en la caja (`last_closed`), ni en el
  turno cerrado (lo contado, lo que quedó, con cuánto había abierto, sus retiros), ni en la respuesta de
  abrir. Quien cierra a ciegas sigue viendo su comprobante («Contaste $ X»), pero desde la respuesta de su
  propio cierre: si recarga, o lo mira otro, ya no está.
- **Cerrar a ciegas:** se cuentan los billetes y se dice cuánto queda de cambio. No hay paso de comparar. Para
  que un fajo mal contado no sea una falsa alarma, antes de seguir se le pregunta UNA cosa a la base
  (`checkShiftCount`: ¿coincide?, sí o no) y, si no coincide, se pide contar de nuevo una sola vez, sin decir
  cuánto ni para qué lado. Queda «Turno cerrado», lo que contó, y el comprobante para imprimir y firmar
  (`closeSlipDoc`).
- **Los números no viajan:** la capa de servidor le saca a la lectura todo lo que no hace falta para operar
  (`blindSnapshot`, `blindCloseResult`) antes de mandarla al navegador. No es un candado de la base: quien
  cobra ve cada cobro que hace, y un usuario con rol de dueño puede leer las tablas. Es no ponerle el
  resumen adelante a quien no le corresponde. El candado de verdad es darle al encargado el rol Cajero.
- **El resumen les llega a los socios por mail**, apenas se cierra el turno (lo cierre quien lo cierre). Lo
  arma el sistema con lo que quedó en la base: el número del turno, cómo dio el arqueo («cuadró» / «faltaron
  $ 1.000»), lo que entró por cada medio, las mesas, el cajón y lo que hay que mirar. Trae un botón para
  abrir ese turno en la caja (`?turno=<id>`) y otro para reenviarlo al grupo de WhatsApp. Va por la cola de
  trabajos (`pos_shift_closed` → `lib/pos/cash/notice.ts`, que corre en el despachador con la clave de
  servicio); un turno de práctica no avisa. WhatsApp no deja que un sistema escriba en un grupo: por eso es
  mail a cada socio, más el botón para reenviarlo.
- **También a ciegas:** «Hoy en vivo» y «Vendido en el salón» del Resumen son de los socios.

Probado en el bar de ejemplo con un usuario Cajero de prueba (`qa.cajero+demoadm`): caja abierta a ciegas,
conteo de $ 10.000 contra $ 15.000 → «Contá una vez más» → recuento → cierre → «Turno cerrado»; y con el
dueño de prueba, el mismo turno abierto desde el link (`?turno=`), con el resumen entero.

### Retiros con destino: para qué sale la plata (23/11/2026)

Pedido de los socios (22/11): «cuando se pone sacar plata de la caja y se selecciona el proveedor, se debe
abrir el desplegable para cargar la compra, pago o comprapago», «si pongo adelanto de sueldo, debe dar la
apertura del personal para cargar el adelanto y que se cargue» y «tiene que haber una opción de "hora extra"
igual que "adelanto personal" o "proveedores" […] cargar el monto sin dar más información que eso».

**Cómo se usa.** Con Administración en marcha, «Sacar plata» es un recorrido de un paso por pantalla:

1. **¿Para qué sale la plata?** Cinco fichas: Proveedor, Adelanto de sueldo, Hora extra, Pago de sueldo y
   Otro motivo (el retiro de siempre, con el motivo escrito y el atajo de las propinas con tarjeta).
2. **¿A quién?** La lista, con el buscador pegado arriba (sin tildes ni mayúsculas; primero los que
   empiezan con lo escrito). Con buscador la hoja es alta y no cambia de alto mientras se escribe: en el
   celular, lo de arriba es lo que queda a la vista con el teclado abierto. Del equipo van primero los de
   esta sucursal y después «De otra sucursal»; con menos de siete personas no hay buscador. Un proveedor
   que no está en la lista se anota igual: se escribe el nombre y aparece «Usar "…" · No está en la lista»
   (si lo escrito se parece a uno de la lista, queda como salida chica: «¿No es ninguno? Usar "…"»).
3. **¿Cuánto?** El monto, con la misma pregunta de los ceros de toda la caja. Un proveedor de la lista
   suma, si lo hay, el N.º de factura o remito; uno escrito a mano es el nombre y el monto (la base guarda
   ese texto como nombre del proveedor). El pago de un sueldo suma, opcional, «¿Qué fechas cubre?»:
   «1.ª quincena», «2.ª quincena» y «Todo noviembre» (del mes que se está pagando: hasta el día 10, el
   anterior), «Esta semana» u «Otras fechas»; al elegir se lee el rango entero («Del 1 al 15 de
   noviembre»), que va en sus columnas y también en el motivo, para que se lea en la cinta y en el
   cierre. Un adelanto o unas horas extra no piden nada más.
4. **Anotado.** El sello, el monto y qué pasa ahora: los del equipo, «los socios lo ven en Sueldos»; el
   de un proveedor, «quedó anotado para Administración» y, si quien está puede cargar compras
   (`access.accounting.buyWrite`), el botón **«Cargar la compra ahora»**, que lleva a
   `/[bar]/administracion/compras?caja=<retiro>`: ahí está «De la caja del salón», con ese retiro
   resaltado y «Cargar la compra / Era un pago / Descartar».

**Lo que ve quien atiende la caja: nombres y nada más.** Ni sueldos, ni saldos, ni lo que se le debe a un
proveedor, ni si algo va en blanco o en negro: eso es de los socios, en Administración. A ciegas tampoco
se dice cuánto tiene que quedar en el cajón. En un turno de práctica el retiro se anota igual, avisa que
no va a Administración y no ofrece cargar la compra.

**Piezas.**

- Base (`pos_revisiones_socios`): `pos_cash_targets(p_branch_id)` → `{ suppliers: [{id,name}], employees:
  [{id,name,here}] }` (dueño o caja; listas vacías si el bar no usa Administración) y `pos_cash_move(…)`,
  que es `pos_cash_movement` con el destino (`p_purpose`: `supplier` | `advance` | `overtime` | `salary`),
  a quién (`p_party_id` o `p_employee_id`) y, para un sueldo, `p_period_from/to`. El motivo que queda en la
  cinta lo arma la base («Adelanto de sueldo · Ana», «Proveedor · Hielo Sur · Remito 12»), así se lee igual
  en la cinta, en el cierre impreso y en el mail a los socios. `pos_cash_movement` sigue existiendo para la
  app vieja; la nueva usa siempre `pos_cash_move`.
- `lib/pos/cash/targets.ts` (puro, con pruebas): los destinos y sus palabras, el buscador, los atajos de
  fechas, lo que se manda (`targetFields`) y las mismas reglas de la base para avisar antes del viaje
  (`moveProblem`).
- `lib/pos/cash/actions.ts`: `cashMovement` (ahora con destino) y `cashTargets`. En la auditoría de un
  retiro con destino van el destino y los ids, nunca el nombre ni la nota.
- `components/pos/cash/move-out-flow.tsx` (el recorrido y `useCashTargets`: las listas se piden al abrir
  la hoja, no al cargar la caja), `move-form.tsx` (el formulario de siempre) y `movement-sheets.tsx` (la
  hoja, que elige: con `payees` el recorrido; sin Administración, o para «Entró plata», el de siempre).
- La página de la caja le pasa `payees` (Administración prendida y configurada) y `canLoadPurchases`.

**Lo que falta de este lado.** La foto del comprobante: `photo_path` viaja hasta la base pero la caja
todavía no tiene dónde sacarla. Un retiro anulado después de pasado a los libros no avisa en
Administración.

**Recorrido el 23/11/2026** en el bar de ejemplo (Cerro, base real), en compu (1190 × 660) y celular:
con el dueño de prueba, proveedor de la lista ($ 25.000, «Remito 12») → «Anotado» con «Cargar la compra
ahora», que abre Compras con el retiro resaltado; hora extra y pago de sueldo con «1.ª quincena»; con el
cajero de prueba (a ciegas), proveedor escrito a mano y adelanto → «Anotado» sin el botón y sin decir
cuánto queda en el cajón. En un turno de práctica: «Otro motivo», «Entró plata», buscar a alguien que no
existe («No hay nadie con ese nombre»), buscar sin tildes («nan» encuentra a Ñáñez), monto vacío (el
botón dice qué falta) y sin conexión («No hay señal: no se guardó», y al volver se anota una sola vez).
En la cinta, en «El turno en detalle» y en el cierre se lee «Retiro · Adelanto de sueldo · …».

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

## La comandera (comandas, cuenta y cierre en papel)

Pedido del 16/11/2026: «se necesitan comandas en ticket, con cable USB; va a haber dos compus, una
afuera y otra adentro» y «cierre de caja: imprimir una planilla en la comandera».

`lib/pos/print/*` (puro, probado en `tests/lib/pos-print.test.ts`) · `components/pos/print/*`. No toca
la base.

- **Cómo imprime.** La comandera es una impresora térmica de rollo enchufada por USB a una compu, con su
  driver, como cualquier impresora. El tique se arma como una hoja angosta (72 mm de ancho útil en el
  rollo de 80; 48 en el de 58), todo en negro pleno, y se manda por el camino de siempre del navegador
  (`printJob`: un marco que no se ve, `print()`). Sirve cualquier marca; no hace falta hablarle en su
  idioma. Para que salga **sin preguntar**: la comandera como impresora predeterminada y Chrome abierto
  con `--kiosk-printing` (la hoja «Comandera» lo explica). Sin eso muestra el cuadro de imprimir y
  alcanza con Enter.
- **Quién imprime las comandas.** La compu que tiene la impresora, no el celular del mozo. En esa compu
  se prende **«Imprimir las comandas acá»** (botón de la impresora en la barra de arriba del mapa, de la
  caja y de la tele de cocina; en un celular no se dibuja). Desde entonces, cada pedido que entra sale
  solo, se mire la pantalla que se mire (`PosPrintStation` vive en el marco del salón). Se entera por el
  aviso en vivo y, por las dudas, mira cada 15 segundos.
- **Qué imprime cada una** es de cada compu y queda guardado en el dispositivo (`hub:pos:printer:<sucursal>`):
  todas las estaciones o algunas (la de adentro, la plancha; la de afuera, la barra), **un tique por
  estación** para cortar y repartir, papel de 80 o 58 mm y una o dos copias.
- **No repite ni saltea.** Imprime lo que salió a cocina desde que se prendió y todavía no imprimió; la
  lista de lo impreso queda en el dispositivo (36 horas). Lo anota ANTES de mandarlo, con un candado del
  navegador: dos pestañas abiertas en la misma compu no imprimen dos veces. Si la impresión falla, lo
  desanota, avisa una vez por minuto y reintenta sola. Si la compu se apagó un rato, al volver imprime lo
  que entró mientras tanto.
- **La comanda** (`comandaDoc`): la mesa enorme, sector, personas y tanda, la hora del pedido, los avisos
  de salud en negativo, y los productos como en la tele: los iguales juntos («x2 Cheese Burger») y debajo
  cómo va cada uno. **«Reimprimir»** está en cada tanda de la comanda del mozo (por si se trabó el papel).
- **La cuenta** (`billDoc`): membrete, productos juntos, descuentos y seña, total, lo ya pagado y lo que
  falta, el alias para transferir y «Documento no válido como factura».
- **El tique del cobro** (`paymentDoc`, pedido del 16/11/2026: «imprimir un tique al cobrar»): con «Imprimir
  un tique al cobrar» prendido en esa compu, cada cobro saca el suyo: qué se pagó (los productos, si fue por
  producto; la parte, si se dividió), el medio, propina, recargo y vuelto, y cuánto le queda a la mesa.
  Tocando un cobro en la cuenta, «Imprimir tique» lo saca de nuevo. No es una factura y lo dice: el punto de
  venta marca cada cobro «con factura» o «sin factura», pero todavía no emite la factura.
- **El cierre de caja** (`shiftDoc`): el mismo resumen del turno que se copia o se manda por WhatsApp,
  con el arqueo arriba (en negativo si no cuadra) y lugar para firmar («Contó», «Controló»). El formato
  definitivo lo van a pasar los dueños: cuando llegue se cambia en `lib/pos/print/shift.ts` y solo ahí.
- **Qué no hace todavía:** no imprime el nombre del mozo ni los vasos (la cola de cocina ya los trae
  desde el 26/11; falta ponerlos en el papel), no reimprime
  sola una comanda a la que le dieron de baja algo, y si dos compus distintas tienen prendida la
  impresión de la misma estación, las dos imprimen (es a propósito: cada una tiene su impresora).

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
  cambiarles el color, decir **de qué son (comida o bebida) y con qué dibujo** se las reconoce (26/11),
  ordenarlas, apagarlas o borrarlas (una que ya recibió pedidos queda apagada).
- **Aclaraciones:** cada una es una pregunta con sus opciones («Punto de la carne»: jugoso, a punto, bien
  cocido). Se elige cómo se contesta (una si hace falta, una sí o sí, las que hagan falta, al menos una),
  cada opción puede sumar al precio (en pesos) y se ofrece en categorías enteras o en productos sueltos. El
  estado dice si el mozo la ve y en cuántos productos. Hay cuatro de arranque para no empezar de cero.

- **Sale primero (23/11):** tercera pestaña (`?ver=primero`). Lo que se marca ahí encabeza la comanda en cocina
  («Sale primero»): ideal para entradas. Se marca una categoría entera o un producto suelto; no depende de que
  haya estaciones. El detalle, junto con los **horarios por categoría** (el menú del mediodía, el del fin de
  semana), está en [`carta-horarios-y-sale-primero.md`](./carta-horarios-y-sale-primero.md).

Probado contra la base real en el bar de ejemplo (13/11): Vinos a Fríos con el marcador y deshacer; marcador
con el teclado; estación «Parrilla QA» creada y borrada; opción «Vuelta y vuelta» sumada y sacada.

## Hoy en vivo (los dueños)

> **Desde el 18/11/2026 no tiene entrada propia en el menú.** Convivía con el Operativo y con la ficha de
> hoy del Resumen: tres lugares para la misma pregunta. Ahora el Resumen tiene una sola ficha «Hoy»
> (`_components/today-salon-overview.tsx`) y, si el bar usa el punto de venta, una de sus columnas es
> «Vendido en el salón», que abre esta pantalla como detalle. El menú del panel muestra una única entrada
> del salón, «Salón en vivo» (abre `/salon`); Sucursales y Plano se entran desde Configuración › Salón.

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

## Lo que salió sin venderse (16/11/2026)

Pedido de los socios: «bajar de stock lo mal comandado, lo de los socios, etc.». El sistema **no lleva stock por
producto** (el stock sale de los conteos de la cocina, ver `docs/features/compras.md`, y la carta no tiene recetas),
así que no hay de dónde «bajar». Nacho eligió **anotar y ver cuánto fue**, y para el consumo de socios, lo que dijo
Tomás: «se descuenta de stock y no cuenta la plata como ingreso». No se tocó la base: todo sale de lo que ya se
guardaba (descuentos y bajas con motivo, cuentas cerradas).

**Tres cosas que no son lo mismo** (`lib/pos/unsold/report.ts`, `buildUnsold`):

| Qué | Cuándo | Cuenta en «Salió sin venderse» |
|---|---|---|
| **No se cobró** | Una mesa que cerró sin que entrara plata: ni cobros ni seña, y la bonificación cubrió todo (`isComp`). | Sí: todo su consumo, con sus productos. |
| **Baja de algo ya hecho** | Un renglón dado de baja con «ya estaba hecho», o que la cocina ya había empezado. | Sí: ese producto. |
| **Baja de algo que no se hizo** | Lo demás: se anuló antes de salir. | No (aparte: «no se perdió nada»). |
| **Descuento** | Bonificación a una mesa que sí pagó. | No (aparte: es plata, no productos). |

Se valúa al **precio de la carta**. No es venta, no entra a la caja y no cambia nada de Administración.

- **«No se cobra»** (la cuenta de la mesa, `CompSheet` en `components/pos/pay/pay-sheets.tsx`): motivo (Consumo de
  socios · Invitación de la casa · Personal del bar · otro) y, si quieren, para quién. Bonifica lo que falta
  (`pos_add_discount` con ese monto y el motivo «Consumo de socios · Nacho») y cierra la mesa (`pos_close_table`).
  Quien no puede dar el OK lo pide, como cualquier descuento; una mesa sin ningún cobro la cierra quien puede aprobar.
  La cuenta cerrada dice «No se cobró» (el sello, el número de arriba y el estado), no «Cobrado».
- **Los motivos de una baja van en dos grupos** (`lib/pos/unsold/reasons.ts`; la comanda y la cuenta usan los
  mismos): «Todavía no se hizo» (Mal comandado · El cliente cambió de idea · No hay más) y «Ya estaba hecho» (Mal
  comandado · Vino mal · Se demoró). Sigue siendo un toque. El «ya estaba hecho» viaja en el texto del motivo
  (`MADE_MARK`), porque la base lo guarda como texto libre; al leerlo vale la marca o que la cocina ya lo hubiera
  empezado (`prep_status`). Los motivos de antes («Error de carga») se leen como «Mal comandado».
- **Dónde se ve:** Hoy en vivo › «Salió sin venderse» (`unsold-panel.tsx`): el total, por motivo, y uno por uno (hora,
  mesa, qué fue, quién dio el OK). Con `?dia=` se mira cualquier día; con `?sucursal=`, una sola.
- **En los números del día** una mesa que no se cobró no es una «mesa cobrada»: no cuenta en las mesas, las personas
  ni el per cápita, y su bonificación no suma a «Descuentos» (`summarizeToday`).
- **El descuento manual** que pidió Franco ya estaba: Cobrar › Descuento › «Otro %» o «En pesos», con motivo.

Lo que falta: la tira de 14 días y el arqueo de la caja (que salen de la base) siguen contando la mesa sin cobrar
entre las mesas y las personas; un resumen por semana o por mes de lo que salió; el nombre de quien dio de baja (hoy
está en el arqueo de Caja). Y descontar insumos de verdad necesita la receta de cada producto de la carta.

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

**Cerrado en la base el 13/11, segunda tanda** (dos migraciones, cada una con su ensayo en producción que se
deshace solo y sus candados de entrada y de salida):
- `20261113195644_pos_canal_privado`: el canal en vivo dejó de ser público (ver «En vivo», arriba).
- `20261113195633_menu_precios_de_una`: `menu_apply_price_changes` cambia precios en una sola operación. Entra
  entera o no entra; cada precio se cambia solo si sigue valiendo lo que la persona veía (lo que otro cambió,
  o ya no está, vuelve en `failed` con lo que vale ahora); un aumento y su deshacer quedan marcados como una
  tanda (`batch_id`, que los disparadores leen de `pos.price_batch`). Corre con los permisos de quien llama:
  mandan las mismas políticas de `menu_items` y `menu_item_branches` (dueño y editor), y además pide el rol
  para contestar «no podés». En el ensayo, un aumento a los 233 productos del bar de ejemplo entró en 163 ms.
  `lib/menu/prices/actions.ts` ya no lee, planea y escribe de a tandas: arma el pedido y lee la respuesta
  (`plan.ts`). Probada en `tests/rls/menu-price-changes.test.ts` y con 72 comprobaciones en la base local.

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

## La pantalla de cocina: el pase (rediseño del 26/11/2026)

Pedido de Nacho: «lo que es comida a cocina, lo que es bebida a la barra, lo que es pizza a la pantalla
de pizzeros […] en cocina va a estar el encargado, que va a manejar todo desde ahí […] cada estación va a
tener un keypad numérico que va a marcar los estados; el de la cocina también un mouse, porque ve en la
tele de 42 pulgadas la cocina y las otras dos pantallas más chicas […] deben entrar muchas comandas».

### Estaciones

- Cada estación es una fila de `kitchen_stations` con su color, **de qué es** (`kind`: comida o bebida) y
  **su ícono** (`icon`). Se editan en Carta › Cocina y aclaraciones › Editar estaciones. El ícono es el
  que va sobre la mesa en el mapa; el tipo decide si la comanda muestra los vasos y cómo se le dice al
  mozo («para retirar en la barra»).
- **Íconos, no emojis** (Nacho, 26/11: «los emojis no me gustan»). `icon` guarda la clave de un ícono
  del catálogo (`STATION_ICON_KEYS` en `lib/pos/kitchen/station-kind.ts`: gorro de cocinero,
  hamburguesa, pizza, copa…) y el dibujo lo pone `components/pos/ui/station-icon.tsx`: los de Lucide, a
  dos tintas (trazo más un relleno suave) para que a 14 píxeles sobre una bandera se reconozca la forma.
  Lo guardado el primer día como emoji se lee como el ícono que le corresponde (`stationIconKey`). El
  texto de la notificación no lleva dibujo: dice la estación con su nombre.
- **A dónde va cada cosa** se decide en la Carta (por rubro, o producto por producto). El reparto que
  pidió Nacho: cafetería, bebidas, tragos, botellas y vinos a **Barra**; las pizzas a **Pizzeros**; y
  la cocina en sus dos sectores, «así se divide»: **lomitos, hamburguesas y papas** (con los tostados,
  las rabas, los nuggets y los nachos) a **Plancha**, y **tablas, milanesas y pastas** a **Cocina**, con
  el resto de la comida (platos especiales, brunch, pastelería, medialunas, postres, los combos
  «Infusión + …»). Solo la limonada y la pomelada, que son bebidas, van a **Cocina**. En HUB quedó
  Cocina 67 · Barra 117 · Pizzeros 18 · Plancha 36.
- **Las pantallas de HUB**: la tele grande es la de Cocina (el encargado, que ve las cuatro), y hay tres
  monitores, uno para Barra, otro para Pizzeros y otro para Plancha.

### Qué se ve

- **El pase** (la tele del encargado): la estación principal ocupa media pantalla y las otras van al
  costado, cada una en su columna de arriba a abajo, con la letra un 20 % más chica. Con tres al costado
  (Barra, Pizzeros y Plancha) cada una queda de una columna de comandas y su encabezado muestra solo lo
  que falta empezar y lo demorado. Cada monitor de
  estación muestra solo la suya. Qué estaciones muestra cada pantalla queda guardado en ese equipo y en
  la dirección (`?estaciones=`); «Agrandar» pasa una del costado al medio.
- **Una pared de comandas, no una fila**: las comandas se acomodan solas en columnas, siempre en la más
  corta, sin cambiar el orden de llegada (`packWall`, con la altura real de cada una). Una comanda
  gigante toma dos columnas o se achica hasta entrar; nunca se corta. A 1920 × 1080 entran unas 23
  comandas a la vista con tres estaciones.
- **Lo que no entra no se pierde**: queda en «En cola», una ficha por mesa con sus minutos, y sube sola
  cuando se libera lugar. Lo que ya está listo pasa a «Listos» (la ficha se pone roja si nadie lo retira).
- **Cada comanda**: el número de mesa bien grande, quién la atiende, el estado en la franja (**Nuevo**
  amarillo, **En preparación** naranja, **Listo** verde), los minutos (en rojo si está demorada), cuántos
  son, el nombre de la mesa, los renglones por rubro con lo que «sale primero» arriba y las aclaraciones
  resaltadas. Al pie, lo que esa misma mesa tiene en las otras estaciones y cómo viene.
- **Los vasos**: en una estación de bebidas cada comanda dice cuántos vasos lleva la mesa, que son las
  personas (`glassesFor`): una mesa de 6 son 6 vasos.
- Arriba de la principal, la suma de lo que hay que hacer ahora («5 Pancakes · 5 Tabla mixta»).
- Los productos iguales van juntos y hay una comanda por mesa, como antes (`buildTableCards`,
  `groupSameProducts`). Si la mesa suma algo con la comanda en marcha, la franja dice «Se sumó».
- **La alerta de comanda nueva** no cambió: campana, cartel con la mesa, la franja late, y vuelve a sonar
  si nadie la empieza. En el pase, lo que entra a una estación del costado suena más bajo y marca su
  panel. El sonido pasa por Fuerte, Suave y Silencio.
- **Tamaño de la letra**: tres medidas (Chica, Media, Grande), por equipo. Con la chica entran más.
- **En un celular** se ve como lista, una estación por vez.
- Sin conexión, la franja de arriba es el aviso, con la hora del último dato.

### El teclado numérico

Se usa como una calculadora: **el número de la mesa y Enter** (`lib/pos/kitchen/keypad.ts`).

| Tecla | Qué hace |
|---|---|
| `12` `Enter` | La comanda de la mesa 12 avanza un paso: Nuevo → En preparación → Listo |
| `Enter` | Avanza la enmarcada (la más vieja sin terminar) |
| `12` `+` | La 12 queda lista de una (una gaseosa no pasa por «en preparación») |
| `12` `−` | La 12 vuelve un paso atrás, aunque ya esté en «Listos» |
| `−` | Recién apretado Enter: deshace eso (7 segundos). Si no, vuelve atrás la enmarcada |
| `.` | Borra lo tecleado |
| `÷` `×` | En el pase: pasa a la estación anterior o siguiente |
| flechas | Mueven el marco |

- Mientras se teclea, el marco salta a esa mesa: se ve cuál va a cambiar **antes** de apretar Enter. Si
  esa mesa no tiene nada en la estación, la pantalla lo dice («No está en Cocina»), no cambia nada y el
  marco vuelve a donde estaba (teclear «12» cuando existe la 1 no deja el marco en la 1).
- El marco no se queda pegado: si la comanda enmarcada pasa a «Listos» o se va, vuelve a la más vieja
  sin terminar. Con una hoja abierta (la de la comandera), las teclas son de esa hoja.
- Las teclas se reconocen por su lugar, no por lo que escriben: anda con «Bloq Num» prendido o apagado.
- Una mesa sin número (una barra, «Terraza A») recibe un código corto que se ve en su comanda («01»).
- El botón **Teclas** de arriba muestra el teclado dibujado con qué hace cada tecla.
- La barra de abajo repite lo mismo con botones, para el mouse o el dedo.

### El mouse (el encargado)

- Un clic enmarca una comanda; doble clic la avanza.
- Un clic en la cantidad de un renglón da por listo **ese** renglón (o lo vuelve atrás).
- **Arrastrar** una comanda entera, o un renglón, a otra estación la pasa a esa estación. Lo mismo hacen
  los botones «Pasar a Barra / Pizzeros» de la barra de abajo. Llega como «Nuevo» y suena allá.
- Todo se mueve por renglones con `pos_kitchen_move` (estado, estación o las dos cosas). Pasar algo de
  estación queda en auditoría (`pos.kitchen_rerouted`).

### Lo que se sacó

- La pantalla partida de los eventos: un evento ahora es una etiqueta en su comanda.
- Los «dos botones» como concepto: las flechas y Enter siguen andando, así que una botonera de flechas
  sirve igual.

## Avisos al mozo (26/11/2026)

Nacho: «que le llegue una notificación push cuando esté su pedido en el próximo paso, vibrar y hacer
sonidos».

- **Qué avisa.** Cuando una estación empieza lo de una mesa («Mesa 3 · en preparación»), cuando lo
  termina («Mesa 2 · para retirar — 🍔 Cocina: 3 Clásica triple · 1 Milanesa») y si lo vuelve atrás
  («todavía no»). Le llega **siempre a quien atiende esa mesa**, lo haya marcado quien lo haya marcado
  (migración `pos_avisos_tambien_a_quien_movio`: al principio se salteaba a quien hacía el movimiento,
  y un dueño que atiende mesas con la cocina abierta en su mismo usuario no recibía nada). La pantalla
  de cocina no muestra estos avisos, aunque esté abierta con el usuario de alguien que atiende.
- **Con la app abierta** suena (tres notas que suben para «para retirar», un toque corto para «en
  preparación»), vibra y muestra el aviso con «Ver mesa». Vive en el marco del salón, así que avisa se
  mire el mapa, una mesa o la caja (`WaiterNotices`). Lo que pudo perderse con la app atrás se lee al
  volver.
- **Con el celular bloqueado o la app cerrada** llega una notificación de verdad, con vibración. Tocarla
  abre esa mesa. Lo que hay que ir a buscar queda en pantalla hasta que se toca.
- **La notificación es solo para «para retirar»** (Nacho, 26/11: «si no le van a llegar muchas
  notificaciones»). «En preparación» y «todavía no» no mandan notificación nunca (`pushesNotice`);
  «en preparación» además viene apagado dentro de la app y cada uno lo puede prender en su equipo.
- **Cómo se prende.** Al mozo se le ofrece una vez al entrar. A la caja o al dueño, recién cuando le
  llega el primer aviso de una mesa suya. Siempre está en Tu cuenta › Avisos de cocina: prender o apagar
  en ese equipo, probar cómo suena, y elegir si con la app abierta avisa también cuando lo empiezan.
- **En iPhone** las notificaciones andan desde la app instalada (Compartir › «Agregar a pantalla de
  inicio»). En Android y en la compu, desde el navegador. Dos límites de Apple: la app abierta **no
  puede hacer vibrar** el iPhone y su sonido se calla con la tecla de silencio; por eso ahí la
  notificación nunca va en silencio (es la única que hace vibrar) y llega aunque la app esté adelante.
- **Cómo está hecho.** Un disparador sobre `ticket_items` escribe el aviso en `pos_notices`, lo manda por
  el canal en vivo de la sucursal (evento `notice`) y, si esa persona tiene un equipo anotado, le pega a
  `/api/cron/pos-push` (con `pg_net`, el secreto de los cron). Esa ruta manda la notificación con Web Push
  escrito acá, sin dependencias nuevas (`lib/push/web-push.ts`: cifrado RFC 8291 y firma VAPID RFC 8292
  con `node:crypto`, probados contra los vectores de las normas). Las claves VAPID se generan solas la
  primera vez y viven cifradas en Vault; no hay variables de entorno nuevas. Solo se le escribe a
  servicios de push conocidos (`lib/push/allowed.ts`).
- **Se limpia solo.** Un equipo que falla 12 veces seguidas o que el servicio da por caído se da de baja;
  los avisos de más de 7 días se borran. Al cerrar sesión, ese equipo deja de recibir.
- **Probado de punta a punta** en el bar de ejemplo (26/11): un navegador anotado como el mozo de prueba
  recibió «Mesa 2 · para retirar» al mover su mesa desde la cocina.

Migraciones: `20261126182818_pos_estaciones_mozos_avisos` (estaciones con tipo y dibujo, `waiter_id`,
`pos_kitchen_move`, `pos_assign_waiter`, `pos_floor_team`, `pos_notices`, `push_subscriptions` y las
funciones de las claves), probada antes en una base local (74 comprobaciones) y con un ensayo sin guardar
en producción; y `20261126195348_pos_solo_mozos_toman_mesa` (solo un mozo toma una mesa por cargarle un pedido; 10
comprobaciones locales); y `20261126203418_pos_avisos_tambien_a_quien_movio` (el aviso llega aunque quien
atiende sea quien movió el pedido; 6 comprobaciones locales). Los permisos de las tablas nuevas se prueban
en `tests/rls/pos-avisos.test.ts`.

**El mapa no se corre en el iPhone (26/11):** la página medía `min-h-screen` (100vh) y en un iPhone con la
app instalada eso es la pantalla entera, 54 puntos más que lo que se ve debajo de la barra de estado: el
mapa se podía correr esos 54 puntos. El `<body>` ahora mide `min-h-dvh`, y con el mapa a la vista la
página no rebota (`overscroll-behavior: none`).
