# La app se pone al día sola

**Pedido (25/11/2026, Nacho):** «Para la app PWA es importante que se refresque en tiempo real… lo que no quiero
que pase es que para que las cosas impacten sí o sí debas recargar la pantalla, debe ser todo super rápido para
la operativa diaria».

## Qué pasaba

Producción tiene la protección de versiones de Vercel (*Skew Protection*): cada página sale con el id de su
deployment (`data-dpl-id="dpl_…"`) y, desde ahí, todo lo que esa pantalla le pide al servidor (cambiar de
pantalla, cada acción) va atado a ESE deployment. Sirve para que una app abierta no se rompa mientras se publica
otra versión, pero tiene una contracara: **una app abierta sigue usando la versión con la que se cargó**, y Next
nunca ve «otra versión», así que no recarga solo.

Un arreglo publicado no le llegaba a un celular hasta que la app se recargaba entera. Una app instalada no tiene
botón de recargar: había que cerrarla desde el sistema. Por eso «tengo que recargar para que impacte».

## Qué hace ahora

Cada pantalla abierta del salón y del panel pregunta qué versión está publicada y, si es otra que la suya, **se
recarga sola en un momento en que no le saca nada de las manos a nadie**.

| Pieza | Dónde |
| --- | --- |
| Qué versión está publicada | `GET /api/version` → `{ id }` (`app/api/version/route.ts`, `lib/app-version/deployment.ts`) |
| Cuándo recargar (pura, con pruebas) | `lib/app-version/decide.ts` · `tests/lib/app-version.test.ts` |
| Quien pregunta y obedece | `components/shell/app-version-watcher.tsx`, montado en los dos layouts (salón y panel) |
| «Ahora no» | `lib/app-version/hold.ts` · `components/shell/hold-reload.tsx` · o `data-no-reload` en cualquier elemento |

### Cuándo pregunta

A los 5 s de cargar, una vez por minuto con la pantalla a la vista, al volver a la app, al volver la red y al
cambiar de pantalla (si la última respuesta tiene más de 15 s). Escondida no pregunta. El pedido es mínimo, sin
cookies, y no pasa por el proxy.

### Cuándo recarga

- **En el salón y en el panel: apenas se cambia de pantalla.** Lo de la pantalla anterior ya se dejó y en la
  nueva todavía no se tocó nada.
- **Solo en el salón**, además:
  - al volver a la app (el celular desbloqueado), antes de que se toque nada;
  - con la pantalla escondida 20 s (otra pestaña de la compu);
  - tras 30 s sin tocar nada (la tele de la cocina y la tablet de las reservas no cambian nunca de pantalla).
- **En el panel nunca por quietud ni al volver**: ahí hay formularios largos (Administración) y la gente va a
  otra pestaña a copiar datos; recargar les borraría lo escrito.

### Cuándo NO recarga

- Sin conexión, o sin una respuesta del servidor de los últimos 15 s (una recarga sin red, en una app
  instalada, puede dejar una página en blanco sin botón para volver).
- Con un diálogo u hoja abiertos, un campo en uso, o cualquier campo de texto con algo escrito en la pantalla.
- Con una pantalla que pidió «ahora no»:
  - **la cuenta**, siempre (un cobro viajando lleva la clave que evita cobrar dos veces; y quien cobra con el
    posnet sale de la app y vuelve);
  - **la comanda** con cosas cargadas sin enviar o una tanda viajando (lo cargado está guardado en el celular y
    no se perdería, pero la pantalla no tiene que parpadear con el cliente dictando);
  - **la cocina con la alarma armada** (el navegador deja sonar recién después de un toque: una recarga la
    dejaría sin alarma hasta que alguien toque la pantalla);
  - **Sumar puntos, Puerta y el QR del club** (la cámara prendida, un socio o una entrada en mano, o el cliente
    apuntando su cámara a la pantalla);
  - **la comandera**, desde que anota qué imprime hasta que el papel salió (si no, una comanda podía quedar
    anotada como impresa sin haber salido).
- Dos veces por la misma versión en menos de 10 minutos: si después de recargar sigue viendo otra versión, no
  entra en un bucle (queda anotado en `sessionStorage`; sin almacenamiento, se cuida con la edad de la página).

Todo lo que pidió «ahora no» se pone al día igual al cambiar de pantalla.

### Si la versión propia deja de contestar

Vercel mantiene la versión vieja un tiempo. Cuando deja de contestar, nada de lo que haga esa pantalla llega
(las acciones fallan). Con una versión nueva esperando, la pantalla pregunta cada 5 minutos por SU versión
(`x-deployment-id`); si ya no es ella la que contesta, **en el salón recarga aunque una pantalla haya pedido que
no** (lo único que la frena es algo abierto o escrito).

## Para apagarlo

`APP_VERSION_WATCH=off` en las variables de Vercel y volver a publicar. Desde ese deployment `/api/version`
contesta `{ id: null }` y ninguna pantalla se recarga sola. No hace falta tocar código.

## Para una pantalla nueva

Si una pantalla tiene algo a medio hacer que no está en un campo de texto ni en un diálogo (una selección, una
cámara, un trabajo en curso), pide «ahora no»:

```tsx
useHoldReload(hayAlgoAMedioHacer)          // en un componente de cliente
<HoldReload />                             // en una página de servidor
const release = holdReload(); try { … } finally { release() }   // una tarea sin pantalla
```

## Lo que NO resuelve

Las apps que ya estaban abiertas con una versión anterior a esta no tienen quién pregunte: toman esta versión la
próxima vez que se carguen enteras (cerrar y abrir la app una vez). Desde ahí se actualizan solas.

## Medido (26/11/2026)

Con el ensayo de abajo, en una Mac, contra la base real (bar de ejemplo). «Publicar» es el instante en que la
versión nueva pasa a ser la publicada.

| Caso | Resultado |
| --- | --- |
| Salón, al volver a la app (publicado con la app escondida) | recargó a los 0,3 s de volver |
| Salón, al cambiar de pantalla (usándola) | recargó a los 0,1 s del toque |
| Salón, nadie toca nada (la tele, la tablet) | recargó sola a los 25 s de publicar (el tope es ~60 s: pregunta una vez por minuto) y después quedó quieta |
| Salón, usándola y después escondida | se enteró a los 54 s y no recargó mientras se usaba; escondida, recargó a los 20,3 s |
| Salón, sin conexión | 90 s sin recargar; al volver la red, recargó en el momento |
| Salón, con un diálogo abierto | 100 s sin recargar; al cerrarlo, recargó a los 30,3 s (la quietud) |
| La cuenta (pide «ahora no») | 100 s quieta sin recargar; escondida y de vuelta, sin recargar; al salir de la cuenta, recargó en el momento |
| La cuenta, con la versión propia caída | recargó igual, a los 55 s de publicar |
| Panel | 100 s quieto sin recargar; escondido y de vuelta, sin recargar; al cambiar de pantalla, recargó a los 0,1 s |
| Recargó y sigue viendo otra versión | una sola recarga en 3 minutos y medio (sin bucle) |

En esos minutos cada pantalla le hizo entre 3 y 9 preguntas al servidor.

Lo que el ensayo NO prueba: el reparto real de Vercel (se imita con un proxy) y un celular de verdad. La primera
prueba real es la publicación SIGUIENTE a la que lleve esto: las apps que ya tengan esta versión tienen que
pasar solas a la nueva.

## El ensayo

Dos copias de la app (`next start`) con ids distintos detrás de un proxy que reparte como Vercel: lo atado a una
versión va a esa versión mientras siga «protegida»; el resto, a la publicada. Un Chrome real carga una pantalla
con la A publicada, se publica la B y se mide cuándo se recarga sola (o se comprueba que no). Los guiones viven
en el scratchpad de la sesión (`qa/pwa/skew-proxy.mjs`, `browser.mjs`, `essay.mjs`) y se rearman con esta
descripción.
