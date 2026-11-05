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
| `/entradas/[bar]` | **cualquiera, sin sesión** | La cartelera: todas las películas publicadas con sus fechas como talones. Vista «Películas» o «Por fecha», y filtros por disponibilidad, mes y película (`?ver=disponibles&mes=2026-11&pelicula=shrek-2`). |
| `/entradas/[bar]/[película]?fecha=` | **cualquiera** (el dueño ve también las no publicadas, como vista previa) | La película contada en actos (la función, el menú paso a paso, escenas, fotos reales) y «Tu entrada», donde se compra. |
| `/entradas/[bar]/mi-entrada/[pedido]` | quien tenga el link | La entrada: adonde vuelve desde Mercado Pago. Confirma el pago sola y muestra la entrada con su QR y el comprobante (guardar como imagen, agendar, compartir, cómo llegar). |
| `/entradas/[bar]/muestra` | quien tenga el link | Una entrada de muestra para ver y filmar la animación sin pagar. No toca la base. Muestra la función entera: el sello, el QR que se genera y el comprobante que se imprime, con la página bajando sola (`ticket-show.ts`). `?video=1` saca los botones y sigue solo hasta cortar el talón; `?ver=puerta` muestra lo que ve quien recibe; `?pelicula=`, `?nombre=` y `?personas=` la ajustan. |
| `/e/[código]` | cualquiera | Adonde lleva el QR si lo abre la cámara del teléfono: quien recibe en ese bar va a la puerta; cualquier otra persona, a la entrada. |
| `/[bar]/salon/puerta` | `owner`, `cashier`, `waiter`, `host` | La puerta: escanear las entradas y dejar pasar. El escáner de «Sumar puntos» también las reconoce. |
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
| `event_experiences` | textos, las tres imágenes (previsualización `card_image_url`, vertical de cine `poster_url`, portada `hero_url`), el video de YouTube (`video_url`), color, menú (`steps`), fotos (`gallery`: `scene` = de la película, `venue` = reales del bar), precio y seña **por persona**, mínimo y máximo por compra, la aclaración del precio (`price_note`), condiciones | el dueño (RLS owner) |
| `ticketing_settings` | la cuenta de Mercado Pago **cifrada**, el gestor de las reservas online, minutos que se guarda el lugar, textos de la cartelera, dirección, WhatsApp de consultas | el dueño (GRANT por columna) y el server para la cuenta de MP |
| `ticket_orders` | cada intento de compra, con la foto de lo comprado (película, fecha, precio) | solo el server (service_role) |

Las tres tablas tienen GRANT **explícito** a `service_role` (además de `authenticated`):
desde el 30/10/2026 Supabase deja de darlos solos en los proyectos existentes. La
configuración se guarda con update + insert (no upsert): el GRANT de UPDATE por columna
no incluye `tenant_id` y PostgREST lo pondría en el `SET` del upsert (42501).

Migraciones: `20261026120000_reservation_origin_web`, `20261026120100_ticketing_tables`,
`20261026120200_ticketing_functions`, `20261027150000_ticketing_min_party_price_note`,
`20261027190000_ticketing_cash_price`, `20261101170000_ticketing_single_price`,
`20261102170000_ticketing_card_image_video`.

### La plata

Precio y seña son **por persona** (las reservas de cine de noviembre de 2026 tenían
`deposit_cents = 5000 × personas`). `price_cents` es el precio; `cash_price_cents`, un
precio en efectivo opcional (más bajo) que hace que el resto se pague **solo en efectivo**.
Con seña, hoy se paga `seña × personas` y el día de la función `(precio en efectivo −
seña) × personas` (sin precio en efectivo, `precio − seña`). El panel pide pesos; la base
guarda centavos.

**Desde el 01/11/2026 (pedido de los socios del 30/10), en HUB: un solo precio y solo
seña.** $45.000 por persona con cualquier medio de pago, seña de $20.000 por persona y el
resto ($25.000) el día del evento en el local, como quiera pagarlo. Para dos: hoy $40.000
y $50.000 el día del evento. `cash_price_cents` quedó vacío y `allow_full_payment` en
`false`: la entrada no ofrece pagar todo, muestra una tarjeta «Precio por persona» con la
aclaración del precio («Incluye todos los pasos de la película») y lo que se paga hoy y
después. `ticketing_create_order` rechaza el pago total donde está apagado y la columna
`allow_full_payment` exige seña (si no, la película no se podría comprar).

Hasta el 31/10: $35.000 con Mercado Pago o $30.000 en efectivo (seña de $5.000 y $25.000
en efectivo en el bar). Ese esquema sigue andando para cualquier película con precio en
efectivo cargado.

**Si el resto es en efectivo, lo dice la foto del pedido** (`ticket_orders.balance_cash_only`,
true cuando la película tenía precio en efectivo al comprar). Lo leen «Mi entrada» («En el
bar: $X en efectivo» o «El día del evento: $X, en el local») y el comentario de la reserva
para el staff («Resta cobrar $X en efectivo.» o «Resta cobrar $X.»): con un solo precio, el
staff no tiene que rechazar una tarjeta.

**Las condiciones** (`terms`, por película, editables en el panel → Condiciones) se leen
antes de pagar: en el celular, justo antes del botón; en la compu, arriba de los datos del
paso 2 (en el pie tapaban el campo del WhatsApp). En HUB dicen que las señas no tienen
devolución y qué se puede hacer si no se puede ir. Una película nueva copia precios, formas
de pago, aclaración y condiciones de la última cargada.

Con seña, la foto del pedido guarda el precio en efectivo como `full_price_cents`: así el
saldo `(full_price_cents − unit_price_cents) × personas` sale bien en el comentario de la
reserva que lee el staff y en «Mi entrada».

Con precio en efectivo, las dos formas de pago se presentan por **cómo se paga el resto**
(pedido de los socios, 27/10/2026): «¿Pagás en efectivo?» → hoy solo la seña y el resto en
efectivo en el bar; «¿Pagás con Mercado Pago?» → todo junto ahora. Con un solo precio y
pago total permitido: «Reservá con seña» o «Pagá todo ahora».

Nunca se promete «no pagás nada más», y tampoco se habla de las bebidas (pedido del
27/10). La **aclaración del precio** (`price_note`, por película, editable en el panel) va
junto al total, o en la tarjeta del precio cuando se reserva solo con seña, y en «Mi
entrada». En HUB: «Incluye todos los pasos de la película».

**Mínimo por compra** (`min_party_size`, por película, 2 en Cine y degustación): la entrada
arranca en el mínimo y no deja bajar; `startCheckout` lo explica («Se reserva desde 2
personas») y `ticketing_create_order` lo vuelve a controlar. Una función con menos lugares
que el mínimo figura «Agotado» para la venta online. Una película nueva copia mínimo,
máximo y aclaración de la última cargada. La compra ya no ofrece «avisame por WhatsApp
cuando haya nuevas películas» (los socios no contactan por ahí); la columna
`marketing_opt_in` queda en `false`.

La reserva que se crea lleva `deposit_cents` = lo que se pagó online (seña o total),
`origin = 'web'`, `zone = 'event_floating'`, y un comentario destacado que dice qué se
pagó y cuánto resta cobrar, para que lo vea el staff en el operativo.

### Las imágenes y el video

Pedido de Nacho Badra (02/11/2026): tres imágenes, cada una con su medida exacta, para que
la diseñadora las arme a medida.

| Imagen | Dónde se ve | Medida |
| --- | --- | --- |
| **Previsualización** (`card_image_url`) | Afuera de la película: la cartelera, «Por fecha», el abanico de arriba y «También en cartelera». Vacía: la vertical de cine (`previewImage`). | 1000 × 1500 px (2:3) |
| **Vertical de cine** (`poster_url`) | Adentro de la película, al lado del título; también «Mi entrada». | 1000 × 1500 px (2:3) |
| **Portada** (`hero_url`) | De fondo, arriba de la página de la película (y la imagen al compartir el link). | 1920 × 1080 px (16:9) |

Todas se muestran recortadas a su marco (`object-cover`): una imagen de otra proporción se
corta. El panel dice cuánto mide cada una y avisa si no es la proporción pedida («se recorta
como ves arriba») o si es chica («se va a ver borrosa»).

**El video** (`video_url`): un link de YouTube (Short o video) como sale de «Compartir»;
`lib/ticketing/video.ts` saca el id (shorts, watch, youtu.be, embed, live) y el panel no
deja guardar otro tipo de link. En la página va la sección «Mirá cómo es», después de las
fechas y antes del menú, con el video en un celular, y un botón «Mirá cómo es» en la portada.
Hasta que la persona toca play se muestra solo la miniatura de YouTube: el reproductor
(`youtube-nocookie.com`, sin cookies de seguimiento) se carga recién ahí.

### Los filtros de la cartelera

Pedido de los socios (27/10/2026): que quien quiere ver qué queda no tenga que mirar todas
las agotadas. Tres filtros (`lib/ticketing/catalog.ts`, puros y testeados):

- **Disponibilidad**: disponibles o agotadas. Con «Disponibles» desaparece toda película sin
  lugar, y al tocar una fecha la página de la película también esconde las agotadas
  (`?ver=disponibles`, con «Ver todas» para volver).
- **Mes**: los meses que tienen funciones («Octubre», «Noviembre»; con el año si cruza).
- **Película**: las publicadas, en el orden de la cartelera.

Viven en la URL (`replaceState`, sin sumar pasos al Atrás): el bar puede mandar el link ya
filtrado, p. ej. `/entradas/hub?ver=disponibles`. Un filtro que no está entre las opciones
(un mes que ya pasó, una película despublicada) se ignora.

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

**Devolver desde el panel** (Ventas online → «Devolver», solo en compras pagadas): pide
la devolución total a Mercado Pago (`POST /v1/payments/{id}/refunds`, clave de
idempotencia nueva en cada intento), la aplica por el mismo camino que el webhook
(compra «Devuelto», seña de la reserva en 0) y cancela la reserva si la persona todavía
no llegó (`pending`). Si ya llegó, la reserva queda. Mercado Pago pide **saldo
disponible** en la cuenta por el monto: la plata «a liquidar» no cuenta, y en ese caso
el panel avisa y no toca nada.

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
- Mobile primero. En la compu la entrada acompaña la lectura en una columna fija
  (`.ent-ticket-col`), **solo si la ventana mide 768 px de alto o más**. Una notebook de
  1440×900 tiene unos 790 px de ventana y ahí entra entera. En una más baja, la entrada
  sigue el scroll de la página y aparece la barra de «Reservar» abajo a la derecha, como
  en el celular.
- En la compu, «Señá ahora / Pagá todo» va debajo de la perforación, de a dos en un
  renglón y al lado del total. Arriba, en el cuerpo con scroll propio, quedaba escondido.
  En el celular las dos tarjetas van en el cuerpo, con la explicación de cada opción.

---

## 5. La entrada con QR y la puerta

Pedido del 03/11/2026: los clientes piden un comprobante al pagar la seña. Al pagar,
la boletería da **dos papeles**: la entrada, para la puerta, y el comprobante, para
quedarse tranquilo. En la puerta se corta el talón, como en el cine.

**Qué ve el cliente** (`mi-entrada/_components/`)

- `ticket-stub.tsx`: el talón con el QR, el número y una roseta de seguridad que sale
  del id del pedido (`guillocheFor`): no hay dos iguales.
- `receipt.tsx`: el comprobante, en papel térmico. Cuánto, cuándo, a nombre de quién
  (primer nombre e inicial), operación de Mercado Pago, cuánto falta y las condiciones.
  Lleva «Documento no válido como factura». Las condiciones son una foto de la compra
  (`ticket_orders.terms`): las compras anteriores al 01/11/2026 no las muestran.
- `paid-stamp.tsx`: el sello de la boletería.
- `lights-off.tsx`: «se apagan las luces», el QR a pantalla completa. No deja que la
  pantalla se apague (`wakeLock`). La noche de la función aparece un botón fijo.
- `lib/ticketing/ticket-image.ts`: la imagen que se guarda. Es un canvas dibujado a mano
  con los mismos trazos: pasar el DOM a imagen falla en Safari con máscaras y SVG. Se
  prepara antes del toque porque Safari no deja compartir un archivo si hay que esperar.

**El teléfono de quien compra** va en `payer.phone` de la preferencia (`mercadoPagoPhone`): es lo único que se le manda además del nombre, para ayudar a su antifraude. Si Mercado Pago responde 400 a una preferencia con teléfono, se vuelve a crear sin él: el pago no depende de ese dato. Casi todos los rechazos son `rejected_high_risk`. La guía de datos por rubro de Mercado Pago también pide `category_descriptor.event_date` en el ítem: todavía no se manda.

**Si Mercado Pago rechaza el pago** (`transfer-slip.tsx`, `RejectedTicket`): la entrada muestra primero cómo transferir, con el alias para copiar, a nombre de quién y cuánto. Se configura en Entradas › Configuración (`transfer_alias`, `transfer_holder`; lo cambia solo el dueño y queda en `audit_log`). Con «WhatsApp para consultas» cargado aparece «Ya transferí: mandar comprobante», con el mensaje armado; sin número, avisa que el bar confirma por WhatsApp al que dejó al comprar. **La transferencia no reserva sola ni da QR:** alguien del bar mira la cuenta y carga la reserva a mano. Se ve sin pagar en `/entradas/[bar]/muestra?ver=rechazado`. Si el lugar se vence mientras transfiere, la pantalla de vencido conserva el botón del comprobante.

**La función** (`ticket-show.ts`, `data-act` en `.ent-counter`): por actos y con cámara, para que nada pase fuera de la pantalla. Sello de goma que golpea, QR renglón por renglón, comprobante que se imprime mientras la página baja y, al final, las acciones. Si la persona toca la pantalla, la cámara se queda quieta y los actos siguen; con «reducir movimiento» no hay función. Por ahora solo la usa la muestra (prop `show` de `ApprovedTicket`): la compra real sigue con la animación corta hasta que los dueños la aprueben.

**El QR** (`lib/ticketing/ticket-qr.ts`) lleva `/e/<id del pedido en base64url>`, 22
caracteres en vez de 36: menos módulos, puntos más grandes. Va con corrección Q.

> **Antes de cambiar el dibujo del QR, repetir la prueba de lectura.** Los ojos con
> agujeritos adentro seguían leyéndose en la cámara del iPhone (Vision), pero ZXing, que
> es lo que usa nuestro escáner en iPhone, dejaba de leerlos. Hay que probar con los dos,
> con la imagen nítida y con borrosa, inclinada, oscura y con reflejo. OpenCV no lee ojos
> redondeados, pero ningún celular lo usa.

**La llegada no se guarda aparte.** Es la de la reserva (`arrived`, `arrived_at`,
`actual_guests`): da igual si la marcaron con el QR o con el botón «Llegó», y el tablero,
la comisión y lo que ve el cliente coinciden. Un grupo que llega de a partes va sumando en
`actual_guests`.

> `actual_guests` baja el cupo calculado mientras falta parte del grupo: una entrada de 4
> con 2 adentro cuenta 2. La venta online corta a la hora de la función, así que la ventana
> en la que eso podría liberar un lugar es chica. Se aceptó a propósito.

**Las funciones** (migración `20261103190000_ticketing_door.sql`): `ticket_orders` solo lo
lee el dueño y en la puerta hay mozos, cajeros y anfitriona, así que van por `SECURITY
DEFINER` con el rol chequeado adentro (`private.ticket_door_authorize`):

| Función | Qué hace |
|---|---|
| `ticket_door_lookup` | Mira una entrada, por id o por el número impreso. No toca nada. Otro bar: `null`. |
| `ticket_door_admit` | Deja pasar a N. Vuelve a validar todo con la fila bloqueada, y compara cuántos había adentro cuando quien recibe miró la pantalla (`p_expected_inside`): dos celulares no cuentan dos veces a los mismos, y un reintento sin señal tampoco. |
| `ticket_door_undo` | Deshace el último «Dejar pasar». |
| `ticket_door_today` | Las funciones de hoy y cuántos entraron: el cartel arriba de la cámara. |

**Deshacer** (decisión del 03/11/2026, por el toque de más: «Dejar pasar a 4» cuando
llegaron 2). Borrar una llegada permite esconder plata o hacer pasar a alguien con la
entrada de otro, así que lleva cuatro candados, todos en la base: como máximo 30 segundos,
solo quien dejó pasar, una vez por entrada, y queda en `audit_log` (las funciones lo
escriben en la misma transacción). Los dueños lo ven en Ventas online: «Deshizo Luz ·
21:05». Pasado eso, se corrige en Reservas, que desde el mismo cambio también guarda quién
hizo cada cosa.

**El veredicto** (`lib/ticketing/door.ts`, puro): `admit`, `used`, `other_day`, `not_paid`,
`refunded`, `cancelled` o `no_reservation`. La pantalla (`components/door/`) dice una sola
cosa y grande: verde pasan, óxido no, dorado es otro día o hay que preguntar. Escanear no
marca nada; dejar pasar es un toque, para ver antes cuánto falta cobrar.

**Quién la ve:** la pestaña «Puerta» del salón sale con el flag `ticket_door` (por defecto
apagado, se prende por bar desde `/admin`: el trigger `guard_feature_flags_write` solo deja a
un superadmin). La página en sí solo pide el rol, así que un QR abierto con la
cámara funciona igual. El panel «Ventas online» muestra quién entró y tiene **Mandar
entrada**: abre el WhatsApp de quien pagó con el link escrito, para los que pagaron antes
del QR o perdieron el link.

## 6. Probar

- Unit: `tests/lib/ticketing-*.test.ts`, `tests/lib/mercadopago-*.test.ts`,
  `tests/lib/entradas-panel-*.test.ts`.
- Funciones SQL: ensayo con rollback (compra, aprobado, aprobado repetido, segundo pago
  aprobado, rechazo con lugar guardado, devolución, GRANTs) — ver la sesión del 26/10.
- Smoke manual con credenciales de **prueba** de Mercado Pago (usuarios de prueba
  comprador/vendedor): conectar → publicar una película con una fecha futura → comprar
  con tarjeta de prueba aprobada → ver la reserva en Reservas/Calendario/Operativo →
  comprar con tarjeta rechazada → reintentar → dejar vencer un pedido.

Pendientes y mejoras: ver `BACKLOG.md` → «Entradas online».
