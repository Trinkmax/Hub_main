# Ver como (mirar el panel con otro rol)

Pedido de Ignacio Baldovino del 13/11/2026: «que yo pueda tener acceso a los distintos roles, así puedo grabar tutoriales y pasar».

## Qué hace

Un **superadmin que es dueño del bar** elige, desde su menú de usuario («Ver el panel como») o desde la hoja «Tu cuenta» del salón, un rol del equipo:

- Anfitrión
- Contenido
- Contabilidad
- Cajero
- Mozo
- Cocina

Desde ese momento ve el panel **como lo ve esa persona**:

- el menú, el inicio de ese rol (Reservas, Carta, Administración, el salón…);
- las pantallas a las que entra y los botones que tiene;
- las acciones, que pasan por el mismo `requireRole`.

Los paneles que el bar tiene apagados no se le abren, aunque sea superadmin. «Dueño (vos)» vuelve a todo.

Para que el panel se vea limpio en un tutorial no hay ninguna franja. La única marca es un puntito en el avatar, y el rol figura en el menú de usuario.

## Cómo está hecho

Vive en la app, no en la base, y **solo baja permisos**:

- **La cookie.** `hub_view_as = <id del usuario>:<rol>` es httpOnly y dura 12 horas.
  - La escribe `setViewAs` (`lib/tenant/view-as-actions.ts`), que exige `access.canViewAs`: superadmin y dueño de ese bar.
  - Se borra al volver a dueño o al cerrar sesión.
  - Lleva el id del usuario para que no la herede otra persona que entre en la misma compu.
- **`requireTenantAccess`** (`lib/tenant/access.ts` → `resolveViewAs` en `lib/tenant/view-as.ts`):
  - devuelve `role` = el rol elegido y `realRole` = el de la base;
  - `isPlatformAdmin: false`;
  - Administración como la vería ese rol: la contadora lee; el resto, nada.
- **El proxy** (`routingRole`) rutea con ese rol. No puede saber si es superadmin, así que acepta la cookie de cualquier dueño. Como solo baja permisos, quien se la fabrique se manda a sí mismo a una pantalla menor, y las páginas, con la base, la ignoran si no es superadmin.
- **`actsAsPlatformAdmin`** (`lib/platform/is-admin.ts`) es la pregunta de `requireFeature`. `/admin` y sus actions siguen con `isPlatformAdmin`, que no cambia.
- **El refresco de claims** (`ClaimsRefresher`) compara el JWT con `realRole`, no con el rol que se mira.

## Lo que no cambia: la sesión sigue siendo la del dueño

La RLS lo deja leer y hacer lo de un dueño. Las pantallas de cada rol muestran lo mismo que ve esa persona porque las lecturas que dependen de la RLS ya se deciden por el rol:

- los «Deshacer» de la puerta en Ventas online (`listOrdersBetween(..., { undos })`);
- las películas de Entradas en el importador del Excel.

**Excepción conocida, el punto de venta:** la cuenta y la caja usan permisos que la base calcula con el usuario real (`pos_bill.can`, `pos_shift_snapshot.role`, `pos_approvals_inbox`). Mirando como mozo o cajero, ahí aparecen también los botones de dueño:

- descuentos y anulaciones directas;
- aprobar pedidos;
- el historial completo de la caja.

Para grabar esas pantallas como las ve un mozo hace falta un usuario de prueba con ese rol, o que esas pantallas tomen el rol de `access.role`.

## Pruebas

- `tests/lib/tenant-view-as.test.ts`: la cookie, quién puede y las opciones.
- `tests/lib/tenant-view-as-server.test.ts`: `requireTenantAccess`, `actsAsPlatformAdmin` y `setViewAs`.
- `tests/lib/proxy-view-as.test.ts`: el ruteo.
