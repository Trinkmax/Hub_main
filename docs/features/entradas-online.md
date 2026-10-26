# Entradas online — cartelera, película y pago con Mercado Pago (`/entradas/[bar]`)

> Pedido de los socios (23/10/2026): Cine y degustación se agota y la gente igual
> manda señas por WhatsApp para fechas que ya no tienen lugar. Luz las recibe, las
> carga a mano y después hay que devolver plata. Ahora el mensaje es uno solo:
> «acá podés ver todo lo que hay y reservar». La persona elige película y fecha
> (las llenas dicen «Agotado»), paga ahí mismo con Mercado Pago (seña por persona o
> el total) y **la reserva se crea sola** cuando el pago se aprueba.

## Qué hay

| Ruta | Quién entra | Qué es |
|---|---|---|
| `/entradas/[bar]` | **cualquiera, sin sesión** | La cartelera: todas las películas publicadas con sus fechas como talones. Vista «Películas» o «Por fecha». |
| `/entradas/[bar]/[película]?fecha=` | **cualquiera** (el dueño ve también las no publicadas, como vista previa) | La película contada en actos (la función, el menú paso a paso, escenas, fotos reales) y «Tu entrada», donde se compra. |
| `/entradas/[bar]/mi-entrada/[pedido]` | quien tenga el link | La entrada: adonde vuelve desde Mercado Pago. Confirma el pago sola y muestra el comprobante (agendar, compartir, cómo llegar). |
| `/api/webhooks/mercadopago?t=[tenant_id]` | Mercado Pago | Avisos de pago. |
| `/[bar]/entradas` | `owner` | Panel: la cartelera (link para mandar), la cuenta de Mercado Pago, las películas, las ventas online y la configuración. |
| `/[bar]/entradas/[id]` | `owner` | El editor de la página de una película. |

Entra por **Marketing** en el sidebar (pestaña `Entradas`).

---

## 1. El modelo

Cada **formato del calendario** (Shrek, Ratatouille, Pizza libre…) puede tener **una**
página de venta (`event_experiences`, 1:1 con `scheduled_event_templates`). Las fechas
que se venden son los `scheduled_events` de ese formato, desde hoy en adelante, sin
grupos privados y hasta la hora de inicio. Programar una fecha nueva en el Calendario
alcanza para que aparezca en la cartelera.

| Tabla | Qué guarda | Quién la escribe |
|---|---|---|
| `event_experiences` | textos, afiche, portada, color, menú (`steps`), fotos (`gallery`: `scene` = de la película, `venue` = reales del bar), precio y seña **por persona**, máximo por compra, condiciones | el dueño (RLS owner) |
| `ticketing_settings` | la cuenta de Mercado Pago **cifrada**, el gestor de las reservas online, minutos que se guarda el lugar, textos de la cartelera, dirección, WhatsApp de consultas | el dueño (GRANT por columna) y el server para la cuenta de MP |
| `ticket_orders` | cada intento de compra, con la foto de lo comprado (película, fecha, precio) | solo el server (service_role) |

Las tres tablas tienen GRANT **explícito** a `service_role` (además de `authenticated`):
desde el 30/10/2026 Supabase deja de darlos solos en los proyectos existentes. La
configuración se guarda con update + insert (no upsert): el GRANT de UPDATE por columna
no incluye `tenant_id` y PostgREST lo pondría en el `SET` del upsert (42501).

Migraciones: `20261026120000_reservation_origin_web`, `20261026120100_ticketing_tables`,
`20261026120200_ticketing_functions`.

### La plata

Precio y seña son **por persona** (las reservas de cine de noviembre de 2026 tenían
`deposit_cents = 5000 × personas`). Con seña, hoy se paga `seña × personas` y en el
bar `(precio − seña) × personas` **en efectivo**. El panel pide pesos; la base guarda
centavos.

La reserva que se crea lleva `deposit_cents` = lo que se pagó online (seña o total),
`origin = 'web'`, `zone = 'event_floating'`, y un comentario destacado que dice qué se
pagó y cuánto resta cobrar, para que lo vea el staff en el operativo.

### Los lugares (el «Agotado»)

Una sola cuenta en la base (`ticketing_event_seats`), la misma para la cartelera y para
la compra:

```
ocupados  = Σ coalesce(actual_guests, estimated_guests) de las reservas activas de la función
guardados = Σ party_size de los pedidos pending/rejected con el lugar todavía guardado
quedan    = cupo − ocupados − guardados
```

«Últimos N» aparece desde el 20 % del cupo (techo 10). La compra
(`ticketing_create_order`) bloquea la fila del evento (`FOR NO KEY UPDATE`): dos
personas pidiendo los últimos lugares a la vez no pueden pasar las dos. Las reservas
que carga el bar a mano siguen sin bloqueo (como siempre: avisa, no bloquea).

Un rechazo de tarjeta **mantiene** el lugar mientras dura el tiempo: la persona puede
reintentar con otra tarjeta en el mismo Checkout.

Para que nadie vacíe la cartelera con pedidos sin pagar: si el mismo WhatsApp vuelve a
empezar en la misma función, su pedido anterior suelta los lugares; y hay un techo de
lugares guardados a la vez por bar: 3 pedidos por WhatsApp y 4 por IP (holgado para las
IP compartidas de celular). Además, rate limit de 8 intentos cada 10 minutos por IP.

---

## 2. El pago

1. «Pagar» → `startCheckout` (server action pública, rate limit por IP): crea el pedido
   con el lugar guardado y una preferencia de Checkout Pro con `external_reference =
   id del pedido`, la misma fecha de vencimiento que el lugar, `binary_mode` (aprobado
   o rechazado al instante) y **sin efectivo** (Rapipago/Pago Fácil se acreditan días
   después). El navegador va a Mercado Pago (o a su app).
2. El pago se aplica por **tres caminos**, todos a la misma función
   (`ticketing_settle_order`), que bloquea el pedido y crea la reserva una sola vez:
   - el **webhook** (`notification_url` de cada preferencia, con el bar en `?t=`);
   - la **vuelta del cliente** a su entrada (trae `?payment_id=`): no espera al webhook;
   - la entrada **pregunta sola** cada pocos segundos (busca los pagos del pedido en MP).
   - y una **conciliación cada 15 minutos** (tarea `reconcile_ticket_orders` del
     dispatcher, `lib/ticketing/reconcile.ts`) para los pedidos cuyo lugar venció hace
     menos de 90 minutos: atrapa lo que el webhook no aplicó si la persona además no
     volvió a su entrada.
3. Nunca se usa lo que trae el aviso: siempre se le pide el pago a la API de Mercado
   Pago con el token del bar.
4. La entrada no da por perdido un pedido «vencido» mientras pueda estar entrando un
   pago: si vuelve con `?payment_id=` primero confirma, y sigue preguntando 5 minutos
   después del vencimiento (3DS lento, la app de Mercado Pago).
5. Desconectar Mercado Pago no se puede con compras en curso, y el webhook contesta
   503 si el bar no tiene cuenta conectada (Mercado Pago reintenta).

Casos que quedan marcados para que los mire una persona (`ticket_orders.attention`,
se ven en el panel): `overbooked` (pagó cuando ya no quedaba lugar: la reserva se crea
igual), `event_missing` (borraron la fecha: no hay reserva, hay que cargarla a mano),
`amount_mismatch`, `duplicate_payment`. Una devolución o contracargo pasa el pedido a
`refunded`, pone la seña de la reserva en 0 y lo anota en el comentario (la reserva
queda: decide el bar).

### La firma del webhook

Igual que el SDK oficial (`mercadopago@3.6.1`): `HMAC-SHA256(clave, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")`.
Con la clave secreta cargada la firma es **obligatoria** (sin header o distinta → 401).
Sin clave se acepta igual, porque la API es la que manda. La `notification_url` lleva
`source_news=webhooks` para que lleguen solo avisos en formato Webhooks (firmados).

---

## 3. Conectar Mercado Pago (lo hace el dueño, una vez)

En el panel → Entradas → Mercado Pago hay una guía paso a paso. En resumen:

1. Entrar a [Mercado Pago Developers](https://www.mercadopago.com.ar/developers) con la
   cuenta del bar → **Tus integraciones** → **Crear aplicación** (pagos online, Checkout Pro).
2. **Credenciales de producción** → copiar el **Access Token** (`APP_USR-…`). Puede pedir
   activar las credenciales (rubro y sitio web).
3. Opcional pero recomendado: **Webhooks** → URL de producción
   `https://<dominio>/api/webhooks/mercadopago?t=<tenant_id>` (el panel la muestra con
   copiar), evento **Pagos**, guardar y copiar la **clave secreta**.
4. Pegar el token (y la clave) en el panel. Se valida contra Mercado Pago y se guarda
   cifrado; el token no se vuelve a mostrar nunca.

Las reservas online quedan a nombre del gestor **«Venta online»**, que no cobra
comisión (decisión de los dueños del 26/10/2026). Se puede cambiar en la configuración.

---

## 4. Diseño

La página es una noche de cine: sala a oscuras (las fotos reales de HUB son de sala con
luz roja), haz del proyector, grano de película, la cinta de marquesina, talones de
papel con troquel y el sello «Agotado». La película se cuenta en actos y el menú es una
tira de película que se enciende paso a paso al hacer scroll. La compra es un ticket de
papel en dos caras (armar la entrada / a nombre de quién) con el total que rueda.

- Estilos en `app/entradas/entradas.css`, scoped a `.ent` y dentro de
  `@layer components` (las utilidades de Tailwind le ganan cuando se combinan).
- Solo se anima `transform`/`opacity` (y `filter` en entradas cortas); todo lo que se
  mueve solo se apaga con `prefers-reduced-motion`.
- Mobile primero. En la compu la entrada acompaña la lectura en una columna fija con el
  total y el botón siempre visibles.

---

## 5. Probar

- Unit: `tests/lib/ticketing-*.test.ts`, `tests/lib/mercadopago-*.test.ts`,
  `tests/lib/entradas-panel-*.test.ts`.
- Funciones SQL: ensayo con rollback (compra, aprobado, aprobado repetido, segundo pago
  aprobado, rechazo con lugar guardado, devolución, GRANTs) — ver la sesión del 26/10.
- Smoke manual con credenciales de **prueba** de Mercado Pago (usuarios de prueba
  comprador/vendedor): conectar → publicar una película con una fecha futura → comprar
  con tarjeta de prueba aprobada → ver la reserva en Reservas/Calendario/Operativo →
  comprar con tarjeta rechazada → reintentar → dejar vencer un pedido.

Pendientes y mejoras: ver `BACKLOG.md` → «Entradas online».
