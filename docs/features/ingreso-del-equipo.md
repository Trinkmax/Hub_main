# Ingreso del equipo: primera contraseña y PIN

Pedido de Nacho (26/11/2026): «para las contraseñas de los chicos poneles como primera contraseña
[una de arranque] y luego de que entren por primera vez ellos pongan la contraseña que quieran».

## La regla

**La contraseña que le pone otra persona es para arrancar.** Apenas entra con ella, la persona tiene
que elegir la suya, y hasta que lo haga no pasa a ninguna otra pantalla.

Vale cuando:

- el dueño crea a alguien desde Configuración › Equipo con una contraseña;
- el dueño le cambia la contraseña a alguien desde Equipo (porque se la olvidó, por ejemplo);
- se le pone una primera contraseña al equipo entero con el script (más abajo).

No vale para:

- **la cuenta de la cocina**: es la de una pantalla, no la de una persona, y la contraseña que le pone
  el dueño es la que queda;
- quien se cambia su propia contraseña;
- alguien que ya tenía cuenta y se suma al bar (no se le toca la contraseña, así que no se lo marca).

## Cómo está hecho

- La marca vive en la cuenta: `app_metadata.must_change_password` (con `must_change_since`, cuándo se
  la pusieron). `app_metadata` solo se escribe con la clave de servicio, así que nadie se la saca
  desde el navegador. Viaja en el JWT: el proxy la lee sin ir a la base.
- **El proxy** (`lib/supabase/middleware.ts`): a una cuenta marcada, cualquier dirección de la app la
  manda a `/auth/update-password`. Lo público (la carta, los íconos) sigue público.
- **La pantalla** (`app/auth/update-password`): en ese modo se llama «Elegí tu contraseña», no vuelve a
  pedir la que le dieron (la acaba de tipear: se comprueba con el `amr` del JWT que esta sesión entró
  con contraseña después de que se la pusieran) y tiene un «Salir», porque no puede ir a ningún otro
  lado.
- No se puede «elegir» la misma que le dieron: la rechaza el servicio de autenticación
  (`same_password`) y la pantalla lo dice.
- Al guardarla se le saca la marca y se le renueva la sesión (que es la que le lleva la marca al
  proxy). Si sacar la marca fallara, queda una cookie corta (`hub_first_password_done`) y la pantalla
  ofrece «Reintentar» sin volver a pedirle nada.
- Las reglas puras están en `lib/auth/first-password.ts` (`tests/lib/auth-first-password.test.ts`);
  marcar y desmarcar, en `lib/auth/first-password-server.ts`.

## Ponerle una primera contraseña a todo el equipo

```bash
INITIAL_PASSWORD='…' npx tsx scripts/staff-initial-password.ts <slug-del-bar>            # ensayo
INITIAL_PASSWORD='…' npx tsx scripts/staff-initial-password.ts <slug-del-bar> --aplicar  # de verdad
```

- Por defecto toca a mozos y cajeros (`--roles=waiter,cashier`) que **nunca entraron**. A quien ya
  eligió su contraseña no se le pisa (salvo con `--incluir-los-que-ya-entraron`).
- No toca a dueños, ni a una cuenta que también está en otro bar.
- La contraseña no se escribe en el repo ni se imprime; el script no muestra mails.
- Cada cuenta queda en `audit_log` como `membership.initial_password_set`.

En HUB se corrió el 26/11 para los 9 mozos y los 2 cajeros (ninguno había entrado).

## Probado

En el bar de ejemplo, con las cuentas de prueba del mozo y del cajero, en un celular simulado: entrar
con la contraseña de arranque lleva directo a «Elegí tu contraseña»; ir a mano al mapa del salón
vuelve a esa pantalla; repetir la misma contraseña o una corta se rechaza; con una válida entra al
salón y ya puede ir a donde quiera.

## El PIN por equipo

Pedido de Nacho (26/11/2026): «estaría bueno que tengan un PIN para entrar luego más fácil», y «debes
asegurarte que ande bien y rápido en cualquier dispositivo, así sea un Android de gama media baja».

### Cómo se usa

- **La primera vez en un equipo** (un celular, la compu de la caja) se entra con mail y contraseña.
  Apenas la persona elige su contraseña se le ofrece el PIN (`/auth/pin?primera=1`); lo puede dejar
  para después y ponerlo cuando quiera desde **Tu cuenta › PIN de este equipo**.
- El PIN son **4 números**. Se tipea y se repite. No se aceptan los que cualquiera prueba primero:
  cuatro iguales o una escalera (1234, 9876).
- **Desde entonces, en ese equipo se entra con el PIN.** La pantalla de ingreso muestra «Hola, Juan» y
  el teclado. Si en el equipo hay varias personas (la compu de la caja), primero pregunta «¿Quién
  sos?». Siempre queda «Entrar con mi contraseña».
- **A los 5 errores seguidos el PIN se bloquea** en ese equipo: hay que entrar con la contraseña y
  elegir uno nuevo.
- El PIN es **de cada equipo**: tenerlo en el celular no sirve en la compu de la caja hasta entrar ahí
  una vez con la contraseña.

### Por qué alcanza con 4 números

- El PIN **solo no abre nada**. Cada equipo guarda un secreto largo y al azar en una cookie que las
  páginas no pueden leer (`hub_device`, `httpOnly`); en la base queda su huella (sha256), nunca el
  secreto. La base le cree a un PIN solo si llega con el secreto de ese equipo.
- Los errores se cuentan en la base, en la misma operación que comprueba el PIN: no hay forma de
  probar de más.
- Se borra solo cuando a la persona la sacan del bar, y cuando el dueño le cambia la contraseña desde
  Equipo. Con la contraseña de arranque todavía puesta, el PIN no vale.

### Cómo está hecho

- **Base** (`20261126213014_ingreso_pin_por_equipo`): la tabla `device_pins` (una fila por persona y
  por equipo; RLS prendida, sin políticas y sin permisos para ningún rol del navegador) y cinco
  funciones. `device_pin_set`, `device_pin_status` y `device_pin_remove` las llama la persona con su
  sesión; `device_pin_accounts` y `device_pin_verify` son solo para la clave de servicio.
- **Entrar con PIN** (`signInWithPinAction` en `lib/auth/pin-actions.ts`) es lo único que usa la clave
  de servicio fuera de lo de siempre: todavía no hay sesión, así que la app comprueba el PIN contra la
  base y, si es de esa persona y de ese equipo, le abre la sesión con un enlace de un solo uso que
  nunca sale del servidor (`generateLink` + `verifyOtp`). Es el mismo camino que ya usa Equipo para
  crear cuentas: una operación de administración después de comprobar un secreto.
- Las reglas puras están en `lib/auth/pin.ts` (`tests/lib/auth-pin.test.ts`); la cookie del equipo, en
  `lib/auth/pin-server.ts`; los permisos se prueban en `tests/rls/device-pins.test.ts`.

### Que ande en un teléfono modesto

- El teclado del PIN (`components/auth/pin-pad.tsx`) **no abre el teclado del teléfono**, que es lo
  más lento de toda la pantalla: son doce botones propios.
- Cada tecla responde **cuando el dedo apoya** (`pointerdown`), sin esperar a que se levante.
- Sin animaciones ni desenfoques. Las pantallas de ingreso, en el celular, van sin el manchón de fondo
  ni el vidrio esmerilado de la tarjeta, que es lo más caro de dibujar en un teléfono de gama baja.
- Entrar con PIN es un solo viaje al servidor.

### Lo que queda

- Cada ingreso con PIN gasta una «verificación» del servicio de autenticación, que tiene un tope por
  minuto compartido por toda la app. Con el equipo de un bar entrando a la vez no se llega; si algún
  día pasa, la pantalla dice «hay muchos entrando a la vez» y queda la contraseña.
- No hay «olvidar este equipo» ni una lista de equipos con PIN para el dueño.
- El PIN se ofrece en el salón (Tu cuenta). En el panel del dueño todavía no hay acceso directo:
  se entra a mano a `/auth/pin`.
