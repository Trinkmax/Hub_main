# Ingreso del equipo: primera contraseña

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
