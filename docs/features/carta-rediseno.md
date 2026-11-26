# La carta nueva (rediseño de noviembre 2026)

Pedido de Nacho del 26/11/2026: un rediseño total de la carta pública (`/carta/[tenantSlug]`), con los
colores del bar (el crema y el verde), fotos protagonistas, animaciones, búsqueda fácil y los logos de
los sponsors. Que sea fácil de usar y que además se sienta «qué pro esto».

Lo que **no** cambió: es de solo lectura (no se pide desde la carta), el club y la billetera son los
mismos (`club-sheet.tsx`, `WalletShell`), la carta se sigue poniendo al día sola
(`docs/features/carta-al-dia.md`) y los rubros con horario siguen saliendo según la hora del bar
(`docs/features/carta-horarios-y-sale-primero.md`). No hay migraciones.

## Qué se ve

Dos materiales, los dos de la marca: el **papel** crema, donde se recorre la carta, y la **barra** verde,
que aparece a pantalla completa cuando se abre un plato. El verde sale del acento del bar
(`--brand-accent`): otro bar tiene su propia barra sin tocar nada. Los tokens viven en
`app/carta/[tenantSlug]/carta.css`, con alcance `.carta`.

### Inicio (`carta-home.tsx`)

- El saludo sigue el reloj **del bar** («Buen día» de 6 a 12, «Buenas tardes» hasta las 20, «Buenas
  noches» hasta las 6) y nombra a quien ya es del club en ese celular («Buenas noches, Nacho»). Sale
  escrito del servidor.
- Los rubros de arriba (Comida, Bebidas, Vinos…) son **portadas grandes** con su foto sin recuadro, su
  nombre y lo que tienen adentro. Si un rubro no tiene foto se usa la del primero de sus productos; si
  no hay ninguna, queda como un índice de carta impresa (el nombre y lo de adentro, sin recuadros vacíos).
- «Los elegidos de la casa»: una tira con los productos marcados como **recomendados** en el editor.
  Sin ninguno marcado, no aparece.
- La franja de los **sponsors** y, para quien no entró al club en ese celular, la invitación.

### Un rubro (`carta-category.tsx`)

- **Todas sus secciones en una sola página**, una debajo de la otra. Antes había que entrar a cada
  subcategoría y volver.
- Arriba, los rubros como palabras grandes: el primero es el título de la página y los demás llevan a
  la suya (se pasa de Comida a Bebidas con un toque).
- Las **pestañas** de las secciones se pegan arriba, marcan la que se está mirando (rellena, y el
  relleno se desliza) y al tocarlas bajan hasta ella.
- Cada sección se dibuja sola como **galería** (fotos cuadradas grandes) si la mayoría de sus productos
  tiene foto, o como **lista** si no (una carta de vinos con dos fotos entre quince se lee mejor como
  carta de vinos). El corte es 60 % (`GALLERY_MIN_COVERAGE` en `lib/menu/carta.ts`).
- En una galería, un producto sin foto muestra su descripción en su recuadro; un **recomendado** ocupa
  el ancho entero.
- Al final, «Seguí con …» lleva al rubro siguiente.

### La ficha del plato (`item-stage.tsx`)

- Al tocar un plato la foto **sale de su recuadro y crece** hasta ocupar la pantalla mientras todo se
  vuelve verde; al cerrar vuelve a su lugar en la lista (aunque se haya pasado a otro plato: la lista
  se corre hasta ese).
- Adentro se pasa al plato **de al lado** deslizando hacia los costados, con los botones de abajo (que
  dicen cuál viene) o con las flechas del teclado. Se cierra con la X, con «atrás», con Escape o
  **bajándola con el dedo**.
- Si el producto nombra a un sponsor («Branca y Cola»), la ficha lo muestra: «Con [logo]».
- Con video: se reproduce sin sonido y en bucle; un toque en el parlante le da sonido.

### El buscador (`carta-search.tsx` + `lib/menu/search.ts`)

- Antes de escribir muestra la carta entera como **índice** (cada rubro con sus secciones) y las
  **etiquetas** del bar para filtrar con un toque (vegetariano, sin alcohol…).
- Entiende **dónde está cada cosa** («hamburguesa» trae las hamburguesas aunque se llamen «Clásica
  simple»: antes no traía ninguna), tildes y plurales, lo que se va escribiendo («mila»), **errores de
  dedo** («hamburgesa», «capuchino») y **cómo se pide en la barra**: «birra» trae las cervezas,
  «fernet» el Branca y Cola, «celíaco» lo sin TACC. El vocabulario está en `SPOKEN`, en un solo sentido
  («stella» no trae todas las cervezas).
- Ordena: primero lo que coincide en el nombre, después etiqueta y sección, al final lo que solo lo
  menciona en la descripción. Cada resultado dice dónde está y marca qué parte del nombre coincide.
- Si lo escrito es el nombre de una sección, ofrece ir a verla entera.

### La barra de abajo (`carta-dock.tsx`)

La misma cápsula de vidrio del panel (`components/shell/dock`): **Carta** (vuelve al inicio), **Club** o
**Billetera** (según si ese celular ya entró) y, en el círculo, **Buscar**. Reemplaza al borde verde fijo
de antes, que solo abría el club. La billetera se abre desde ahí y se cierra como siempre (la X, el
fondo, o bajándola con el dedo).

## Los sponsors

Se guardan en `tenants.settings.carta_sponsors` (la misma bolsa que `capture_prompt`), como una lista
ordenada de `{ name, logo_url, ratio, density, keywords }`. Los lee el servidor con
`parseCartaSponsors` (`lib/menu/sponsors-schema.ts`): una marca mal cargada se saltea y las demás se
muestran igual.

Cada logo es un **sello**: una sola tinta sobre transparente, que la carta pinta con `mask-image` del
color que toque (crema sobre la franja verde, verde en el pie de cada página). Así siete marcas con
siete colores se ven como parte de la carta. `sponsorBox` iguala su peso visual (un logo apaisado sale
más ancho y más bajo; uno de letras gruesas, un poco más chico).

`keywords` son las palabras que vinculan una marca con un producto. Se comparan como palabras enteras
contra el nombre y la descripción («blu» no aparece adentro de «blue»), hasta dos marcas por producto.

**Cómo se cargan** (todavía no hay pantalla para el dueño; está en `BACKLOG.md`):

```bash
# ensayo: dice qué haría y deja los sellos en una carpeta para mirarlos
npx tsx scripts/carta-sponsors.ts hub lista.json --out /tmp/sellos
# sube los sellos a Storage (menu-images/<bar>/sponsors/) y guarda la lista
npx tsx scripts/carta-sponsors.ts hub lista.json --apply
# los saca de la carta
npx tsx scripts/carta-sponsors.ts hub --clear --apply
```

`lista.json`: `[{ "name": "Fernet Branca", "file": "branca.png", "keywords": ["branca"] }, …]`, en el
orden en que se muestran. El script acepta un logo con fondo transparente o con fondo liso.
`scripts/backfill-menu-media.ts --prune-orphans` ya no considera huérfanos a los sellos en uso (ni a los
logos de las marcas aliadas del club, que tampoco miraba).

HUB tiene siete desde el 26/11/2026: Carpano, Spirito Blu, Speed Unlimited, Stella Artois, Fernet
Branca, Sernova Vodka y Alpes (en el orden en que los mandó Nacho).

## El lugar y el «atrás»

El lugar (el inicio o un rubro) va en el `#` de la URL: `/carta/hub#bebidas`, y con una sección,
`#bebidas/tragos-hub`. Un QR puede abrir la carta directo ahí.

- Entrar a un rubro desde el inicio **suma un paso** al historial: el «atrás» del teléfono vuelve al
  inicio (antes sacaba de la carta).
- Pasar de un rubro a otro lo **reemplaza**: para volver al inicio alcanza un «atrás».
- La ficha, el buscador, el club y la billetera suman su propio paso y «atrás» los cierra
  (`use-dismiss-on-back.ts`).
- Si la carta se actualiza con alguien adentro de un rubro que ya no está (terminó su horario), vuelve
  al inicio.

## Movimiento

Una sola curva (`--carta-ease`) y, con «reducir movimiento», nada vuela: se funde.

- **El momento propio**: la foto que vuela a la ficha. Es un vuelo a mano (se miden los dos recuadros y
  se anima el recorte), no depende de ninguna función nueva del navegador.
- Del inicio a un rubro, donde el navegador lo permite (`document.startViewTransition`: iPhone con iOS
  18, Chrome), el nombre del rubro viaja de la portada al título. Donde no, cambia sin transición.
- Las portadas del inicio se descubren al llegar a ellas; la franja de sponsors pasa despacio solo
  mientras está a la vista (en una pantalla ancha entran todos y se quedan quietos).
- Un «tic» en el dedo al abrir un plato y al pasar al de al lado (lo mismo que la barra del panel).

## Carga

Medido el 26/11/2026 contra la carta que estaba en producción, sobre la versión compilada:

| | Antes | Ahora |
|---|---|---|
| JavaScript para abrir (gzip) | 441 KB | 356 KB |
| Logo del bar | 143 KB | 33 KB |
| Corrimiento de la página al cargar (CLS) | 0 | 0 |

- La ficha y el alta del club (con el campo de teléfono de todos los países) se bajan **aparte**,
  de fondo, cuando la página queda quieta.
- `public/hub-logo.png` se guardó de nuevo con una sola tinta (era un PNG con ruido): mismas medidas,
  se ve igual.
- Las portadas piden la variante de 800 px (`sizes` un poco menor que su ancho real): en un celular
  de pantalla densa se ve igual y pesa un tercio.
- Mientras llega la carta se ve su forma en crema (`loading.tsx`), no el «Cargando…» de la plataforma.

## Accesibilidad

- Contraste medido en pantalla: el texto secundario sobre el papel da 5,5:1, el precio 9,8:1, el texto
  sobre la barra de noche 14:1 (el suave, 8:1).
- La ficha y el buscador son diálogos: el foco entra y no sale, Escape los cierra, y lo de atrás queda
  inerte. La posición en la ficha («3 de 12») se anuncia al cambiar.
- Los rubros, las secciones y los productos son encabezados; todo lo que se toca es un botón de al
  menos 40 px.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Rubros y secciones, direcciones, saludo | `lib/menu/carta.ts` (`tests/lib/menu-carta.test.ts`) |
| Buscador | `lib/menu/search.ts` (`tests/lib/menu-search.test.ts`) |
| Sponsors | `lib/menu/sponsors.ts`, `sponsors-schema.ts` (`tests/lib/menu-sponsors.test.ts`) |
| Pantallas | `app/carta/[tenantSlug]/_components/` |
| Estilos | `app/carta/[tenantSlug]/carta.css` |

## Cómo probarla (smoke)

1. `/carta/hub`: el saludo de la hora, las seis portadas, la franja con los siete sponsors y la
   invitación al club. Abajo, la barra: Carta, Club y la lupa.
2. Tocar **Comida**: el nombre viaja al título; se ven todas las secciones seguidas. Bajar: la pestaña
   rellena va cambiando sola. Tocar «Pizza» en las pestañas: baja hasta Pizza.
3. Tocar una hamburguesa: la foto crece, todo se pone verde. Deslizar a la izquierda: pasa a la
   siguiente. Bajar la ficha con el dedo: la foto vuelve a su lugar.
4. «Atrás» del teléfono: vuelve al inicio, en el lugar donde estaba.
5. La lupa → escribir `hamburgesa` (con el error): ofrece «Hamburguesas» y lista las doce. Escribir
   `fernet`: aparece «Branca y Cola»; abrirlo: «Con Fernet Branca».
6. `/carta/hub#bebidas/tragos-hub` abre directo en los tragos.
7. **Club** en la barra: abre el alta. Con un celular que ya entró, dice **Billetera** y abre la
   billetera; el inicio saluda por el nombre.
8. `/carta/hub?club=1` sigue abriendo la carta con el formulario del club.
9. Un bar sin fotos (`/carta/demo-administracion`): el inicio es un índice y las secciones, listas.
