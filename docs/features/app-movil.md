# El panel en el celular como una app (barra de vidrio estilo iOS 26)

Pedido de Nacho del 14/11/2026. Quería que toda la parte móvil se viera como las otras apps del teléfono,
con la barra de abajo de iOS 26. La referencia fue un video de WhatsApp: la lente de vidrio que se levanta,
se estira al arrastrar y agranda lo que tiene debajo. También pidió menos pestañas en la barra, con el
resto a mano desde la misma barra.

En la compu (desde 1024 px) no cambia nada: manda el menú lateral de siempre.

## Qué se ve

### La barra de abajo

Es una cápsula de vidrio flotante y lleva, aparte, un círculo a la derecha (el lugar del «Buscar» de
iOS 26).

- **En reposo**: la pestaña activa tiene una píldora suave y el ícono relleno.
- **Al apoyar el dedo**: la píldora se levanta y pasa a ser una lente transparente, más alta que la barra.
  La barra se infla un 3 %.
- **Al arrastrar**: la lente sigue al dedo y se estira como una gota según la velocidad. Agranda lo que
  tiene debajo, con el filo partido y tornasolado. En el iPhone (iOS 18 o más) y en Android da un tic
  en el dedo en cada pestaña.
- **Al soltar**: cae con un rebote y se navega. La pestaña nueva queda marcada al instante, y mientras
  carga la píldora late.
- **Al tocar otra pestaña**: la lente viaja desde la activa.
- **Al tocar la pestaña en la que ya estás**: sube arriba de todo, o vuelve a la raíz si estabas en una
  ficha.
- **Se esconde**:
  - con el teclado abierto;
  - en las pantallas con su propia barra de acciones abajo (`data-dock-hide`, ver más abajo);
  - con un chat abierto en Mensajería;
  - en la mesa del salón.

### Qué pestañas lleva

| Quién | Pestañas | Círculo |
|---|---|---|
| Dueño | Resumen · Operativo · Reservas · Clientes · **Más** | Tex |
| Anfitriona | Operativo · Reservas · Calendario · Ventas · Mis números (le entran todas, no hay «Más») | Tex |
| Contadora y quien edita la carta | Sin barra: tienen una sola sección | — |
| Salón | Sus pestañas de siempre (`salon-nav.ts`): hasta cinco, o cuatro y «Más» | — |
| Mensajería (en el celular) | Chats · Difusiones · Automático · Audiencias | «Más» de Mensajería: ajustes y salida al panel |

Las del dueño salen de lo que más se usa en HUB (`audit_log`, 15/10–14/11/2026):

| Acción | Veces | Socios |
|---|---|---|
| Reservas cargadas | 673 | 9 |
| «Llegó» marcados (Operativo) | 480 | 7 |
| Fichas de clientes tocadas | — | 9 |

**Cada socio elige sus cuatro.** «Más › Editar» pone los íconos a temblar, como en la pantalla de inicio
del iPhone, y muestra arriba cómo va a quedar la barra.

- Se elige con un toque.
- «Volver a las de siempre» recupera las del rol.
- Se guarda en la cookie `hub_dock_<slug>` (no httpOnly). El servidor la lee en el primer dibujo, así
  que no hay salto.

### «Más»

Es una hoja de vidrio que flota a 8 px de los bordes y se baja con el dedo. Adentro tiene:

1. un buscador con las mismas entradas que ⌘K en la compu y, si Tex está, «Preguntale a Tex: "…"»;
2. todas las secciones como íconos de app, agrupadas como el menú lateral, con un color por bloque;
3. tu cuenta: apariencia, «Ver como», «Usar HUB! como app», contraseña y salir.

### La barra de arriba (celular)

- Mide lo mismo que en la compu (`h-14`): hay pantallas que se pegan justo debajo (`top-14`).
- Arriba de todo es transparente. Al correr la página pasa a vidrio, con el borde de abajo desvanecido.
- La marca del bar se funde con el título de la pantalla cuando el `h1` grande se va por arriba.
- El avatar abre tu cuenta.
- No hay hamburguesa.

### Instalarla como app

El panel ya tiene `manifest` y `appleWebApp`, así que se puede agregar a la pantalla de inicio (Safari:
Compartir › Agregar a inicio) y se abre sin la barra del navegador. Antes solo el salón tenía manifiesto.

## Cómo está hecha

- **`components/shell/dock/liquid-dock.tsx`**: la barra genérica (panel, salón y Mensajería).
  - Todo lo que se mueve por cuadro se escribe directo en el DOM, desde un único `requestAnimationFrame`
    que se apaga cuando los resortes se quedan quietos.
  - Las pestañas son `<Link>` de verdad, así que el teclado y el lector de pantalla andan como siempre.
- **Por qué no usa filtros SVG**: Safari ignora `backdrop-filter: url()`.
  - **La lupa** es una copia de la fila adentro de la lente, agrandada alrededor de su centro
    (`magnifierTransform` en `dock-geometry.ts`).
  - **El filo** es una segunda copia más agrandada, en un anillo con corrimiento rojo y cian.
  - **Lo de abajo** queda tapado con una máscara sobre la fila (`--hole-l/--hole-r`).
- **`spring.ts`**: resortes propios, con pasos fijos de 1/240 s. Son puros y tienen sus tests.
- **`dock-items.ts`**: qué va en la barra (`planDock`), qué pestaña se marca y la cookie. Es puro y tiene
  sus tests.
- **`components/shell/mobile/`**: la barra del panel (`manager-dock.tsx`), la hoja (`app-sheet.tsx`, con
  Radix Dialog y motion), «Más», la cuenta, Tex en el círculo y la barra de arriba.
- **Tex en el círculo**: muestra su cabeza en píxeles y lo abre con `openTex()`. No puede leer el
  proveedor de Tex, que vive en su portal. En el celular, el Tex de la esquina se esconde
  (`mobile.css`).
- **`components/command-palette/command-entries.ts`**: reglas de ⌘K que comparten la compu y «Más».

### Tokens (`app/globals.css`)

| Token | Qué es |
|---|---|
| `--dock-h` | El alto de la barra (62 px). |
| `--dock-gap` | Lo que flota sobre el borde de abajo: `max(10px, área segura − 8px)`. |
| `--dock-space` | Lo que la página deja libre abajo. Vale 0 salvo en el celular con la barra a la vista (lo prende `dock.css` con `:has()`). Para subir algo por encima: `bottom: calc(var(--dock-space) + …)`. |
| `--salon-tabbar-h` | Lo que ocupa la barra del salón. El punto de venta, la puerta y el conteo de stock lo restan. |

### Pantallas con su propia barra abajo

Una barra de acciones pegada abajo («Crear reserva», «Cerrar la caja», «Guardar receta») lleva
`data-dock-hide=""`. Si es un componente que no deja pasar atributos, va adentro un `<HideDock />`
(`components/shell/dock/hide-dock.tsx`). Mientras esa pantalla esté abierta, la barra se va, como en iOS
al entrar a una tarea.

### Safari 26

- Tiñe su barra con el color de lo fijo que toca el borde de abajo. Por eso:
  - la barra no toca el borde;
  - el vidrio vive en un hijo absoluto (`.lg-glass`).
- Hace falta `viewport-fit=cover` (layouts del panel y del salón) para que `env(safe-area-inset-*)` no
  valga 0.

## Para probar en el celular

Se levanta `npm run dev` y se entra con la IP de la red de la casa (`ipconfig getifaddr en0`), con tu
cuenta. Next bloquea la recarga en caliente desde otra IP, pero la página anda.

**Falta mirar en un iPhone de verdad**: Safari 26 con su barra flotante, la app instalada y la háptica.

## Pendiente (post-MVP)

- Achicar la barra al correr hacia abajo, como iOS 26 (`tabBarMinimizeBehavior`).
- Arrastrar para reordenar en «Editar».
- Playwright: los recorridos de arriba (apoyar, arrastrar, soltar, tocar lejos, «Más», «Editar»).
