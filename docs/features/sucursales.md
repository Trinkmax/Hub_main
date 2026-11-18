# Sucursales en todo el sistema

Pedido del dueño (17/11/2026): un filtro grande por sucursal (Alta Córdoba, Cerro y las que vengan) que valga para
todo el sistema, desde la entrada hasta los paneles de mozos y cocina. Un bar es una empresa con varias sucursales,
no varios bares: la carta, el club, los clientes, Mensajería y el equipo son del bar; las reservas, los eventos, los
cupos, las entradas, el salón, las compras y la plata son de cada sucursal.

## Decisiones

Del dueño (17/11):
1. **Acceso por persona.** En Equipo se marca dónde trabaja cada uno. Dueños y contadora: todas. El resto: las que
   tenga marcadas; sin marcar, la principal (crear una sucursal nueva no le muestra nada a nadie hasta asignarla).
2. **Una empresa, un libro.** Administración se etiqueta por sucursal; no se separan los libros.
3. **Se elige una vez por equipo.** «¿A dónde entrás hoy?» la primera vez; después se cambia arriba.

Mías: «Todas» la tiene cualquiera con más de una sucursal; el salón nunca está en «Todas» (es un lugar); el cupo
nunca se suma entre sucursales (no comparten sillas); en una sucursal sin plantas la reserva no lleva planta.

## Cómo funciona

- **Base.** `branches` + `membership_branches` (quién trabaja dónde, la escribe solo un dueño con
  `set_membership_branches`). `get_tenant_access` trae `branches` (las activas que la persona ve, `my_branches`).
  En las funciones: `private.branch_for_write(bar, sucursal)` valida una escritura y `private.branch_scope(bar,
  sucursal)` recorta una lectura (vacío = las que la persona ve).
- **Cookie del dispositivo** `hub_branch_<bar>` (`lib/branches/cookie.ts`): `<id>` = esta sucursal; `all.<id>` = el
  panel mira «Todas» y el dispositivo sigue en `<id>`; `all` = «Todas» sin dispositivo. Es la misma del punto de venta.
- **Qué se mira** (`lib/branches/resolve.ts`): `?sucursal=<slug|todas>` (el proxy lo pasa en `x-hub-sucursal`) →
  la cookie, recortada a lo permitido → la única sucursal → si tiene varias y nunca eligió, la entrada pregunta.
- **En el servidor:** `getBranchScope(slug)` (una vez por pedido). En el navegador: `useBranchScope()`.
- **Dónde se crean.** «Sucursales» (`/local/sucursales`, Configuración › Salón) la tiene cualquier dueño, con o sin
  punto de venta: nombre, nombre corto, color, dirección, la principal, el orden, activa y borrar (`authorizeSetup(slug,
  { requirePos: false })`). Con el punto de venta suma la lista de apertura, el modo práctica y los ajustes de cobro.
  Una sucursal con reservas o fechas no se borra (`hasAgenda`; la base igual lo frena con `on delete restrict`): se
  desactiva, y desactivada deja de aparecer para elegirla.

## La regla para cada pantalla

1. **Leer.** La página pide `const scope = await getBranchScope(slug)` y `const branch = branchFilterOf(scope)`, y
   se lo pasa a sus consultas. Cada consulta hace `applyBranchFilter(query, branch)` (columna `branch_id`, o la que
   corresponda: `applyBranchFilter(q, branch, 'reservation.branch_id')` para lo que cuelga de una reserva). `ids: null`
   = un dueño mirando «Todas»: no se filtra. Una función de la base recibe `p_branch_id: rpcBranchId(scope)`.
2. **Lo que pide el navegador después** (tiempo real, «Actualizar», cambiar de día): manda el `filter` con el que se
   dibujó la pantalla (`useBranchScope().filter`) y la acción del servidor lo recorta con
   `clampBranchFilter(pedido, await getBranchScope(slug))`. Nunca relee la cookie: si otra pestaña cambió de
   sucursal, esta pantalla no tiene que cambiar de datos sin cambiar de título.
3. **Tiempo real.** La suscripción sigue por bar (`tenant_id=eq.`); lo que llega de otra sucursal se descarta con
   `inBranchFilter(row.branch_id, filter)`.
4. **Crear.** Toda fila nueva lleva sucursal. El formulario usa `<BranchField value onChange />` (arranca con
   `useDefaultBranchId()`: la que se mira; en «Todas» hay que elegir) y la acción la valida con
   `branchForWrite(scope, pedida)` (`BranchRequiredError` / `BranchForbiddenError`, mensaje con `branchErrorMessage`).
   La base además pone la principal si llega vacía, pero el código nuevo siempre la manda.
5. **Mostrar.** En «Todas», cada renglón lleva `<BranchTag branchId={…} />` al final de su primera línea (sin columna
   nueva). Un número grande lleva `<BranchSplit values={{ [id]: n }} />`. El cupo se muestra por sucursal.
6. **La sección.** Si la pantalla pasa a mirarse por sucursal, se suma su ruta a `PER_BRANCH` en
   `lib/branches/sections.ts` (si no, la píldora de arriba dice «Todo el bar»).
7. **Embebidos.** Nunca agregar una segunda FK entre dos tablas que el código embebe sin nombrar: PostgREST contesta
   PGRST201 y la pantalla se cae (pasó el 18/11). Para atar columnas, un disparador.

## Qué se separa (estado)

| Parte | Por sucursal | Entrega |
|---|---|---|
| Entrada, selector, fleco, ⌘K, título de la pestaña | — | 1 |
| Reservas, Operativo, Calendario, eventos, cupos | sí | 1 |
| Entradas online, ventas, puerta | sí (la función es de una sucursal; la película, del bar) | 1 |
| Comisiones, «Cómo nos fue», señas | sí (por la reserva) | 1 |
| Salón (mapa, comanda, tele, caja, escanear, stock) | sí (la del dispositivo) | 2 |
| Estadísticas, Resumen, Clientes («vinieron a»), reseñas, audiencias | sí | 2 |
| Compras (conteos, pedidos, zonas, stock deseado) | sí (catálogo y proveedores del bar) | 3 |
| Administración (cierres, cajas, gastos, objetivos, sueldos) | sí, un solo libro | 3 |
| Carta, club, Mensajería, páginas, tareas, configuración | del bar | — |

## Base de datos

| Tanda | Migración | Qué hace |
|---|---|---|
| 1 | `20261118163437_sucursales_acceso` | `membership_branches`, `my_branches`, `user_branch_ids`, `branch_for_write`, `branch_scope`, `set_membership_branches`; columnas nuevas en `branches`. |
| 1b | `20261118171857_sucursales_acceso_arreglo_relacion` | Saca la FK de `membership_branches` a `tenants` (la volvía tabla puente y rompía `memberships→tenants`). |
| 2 | `20261118170540_sucursales_agenda` | `branch_id` obligatorio en reservas, eventos, compras de entradas y cupos, sin reescribir filas; «un formato por noche» por sucursal; `ensure_scheduled_event_for_template` y `ticket_door_today` con sucursal. |
| 2b | `20261118171458_sucursales_agenda_arreglo_relacion` | Saca la FK compuesta reserva→evento (segunda relación: PGRST201). La reserva sigue al evento por disparador. |

Provisorio hasta que el código nuevo esté en producción: los cupos conservan sus restricciones viejas «una fila por
bar» (`ssc_one_per_day`, `sss_one_per_segment`, `ssco_one_per_day`); los guardados nuevos usan las nuevas por
sucursal (`…_branch`). Se sacan en la tanda 6.
