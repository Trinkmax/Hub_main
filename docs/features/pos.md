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
| Comanda del mozo | `/[bar]/salon/mesa/[sesión]`, `components/pos/order/*` | en construcción |
| Pantalla de cocina | `/[bar]/tele`, `components/pos/kitchen/*` | en construcción |
| Cobro, caja por turno | — | sigue |
| Tablero del dueño, carta rápida, QR del cliente | — | sigue |

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

Pruebas: `tests/lib/pos-floor.test.ts` (proyección y maqueta) y `tests/lib/pos-table-state.test.ts` (estados).
