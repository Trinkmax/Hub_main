# Comanderas por WiFi: «HUB Impresoras»

Pedido de Nacho (27/11/2026): «va a haber 3 comanderas, una para cocina para identificar de qué mesa es,
debe tener el ticket impreso el logo de HUB y ser bien vistosa la info, solo lo necesario porque es para
que el mozo identifique a qué mesa pertenece el pedido. Las otras 2 van una en barra y otra en pizza.
Hacé la integración para que se pueda conectar a las printers térmicas lo más rápido posible». Las tres
están **conectadas por WiFi**.

## Por qué un programa aparte

Una página web no puede abrir conexiones a la red local: el navegador no le puede mandar un tique a
una impresora por su IP. Así que las comanderas por WiFi (o por cable de red) las maneja un programa
chico, **HUB Impresoras**, que corre en una compu del bar conectada al mismo WiFi (la de la caja sirve).
Las que van enchufadas por USB a una compu siguen pudiendo imprimir por el navegador, como antes
(«La comandera» en `pos.md`).

Con el programa, además, imprime **aunque no haya ninguna pantalla abierta**.

## Instalarlo (10 minutos)

Los pasos están también en la app: botón de la impresora (arriba en el mapa, la caja o la cocina) ›
«Comanderas por WiFi».

1. En la compu, instalar **Node.js** desde nodejs.org (la versión «LTS»).
2. Bajar el programa: `https://<la app>/impresoras/hub-impresoras.js` (un solo archivo) y guardarlo en
   una carpeta.
3. En esa carpeta, abrir una terminal (en Windows: escribir `cmd` en la barra de dirección) y correr
   `node hub-impresoras.js`.
4. Pide el mail y la contraseña de la **cuenta de la cocina** del bar, el bar y la sucursal.
5. **Busca solo las impresoras** en la red (todo lo que atiende en el puerto 9100) e imprime en cada una
   un tique con un número grande («IMPRESORA 1») y su IP, para saber cuál es cuál.
6. Pregunta qué estaciones imprime cada una (por número: «1,4» = Cocina y Plancha) y si van en tiques
   separados. Lo que no se elige no se usa.
7. Imprime un tique de prueba en cada una y pregunta si se ven bien las tildes; si no, imprime sin tildes.
8. Para que arranque solo al prender la compu: `node hub-impresoras.js instalar` (en Windows deja un
   acceso en «Inicio» que además lo vuelve a levantar si se cierra; en Mac, un servicio de launchd).

Otros comandos: `configurar` (volver a elegir todo), `buscar` (buscar e imprimir el número en cada una),
`probar` (un tique de prueba en cada impresora configurada).

**IP fija:** conviene que cada impresora tenga siempre la misma dirección (en el router o en la propia
impresora). Si cambia, alcanza con `configurar` de nuevo.

## Cómo trabaja

- Entra con la cuenta de la cocina (`pos_kitchen_queue` la deja leer: cocina, caja, mozo y dueño) y
  guarda la sesión en `hub-impresoras.json`, al lado del programa. La contraseña no se guarda.
- Se entera de cada pedido por el canal en vivo de la sucursal (`pos:<sucursal>`, el mismo de las
  pantallas) y, por las dudas, mira la cocina cada 15 segundos (cada 4 si el canal se cortó).
- Arma cada tique con el mismo código que la app (`lib/pos/print/station.ts` y `comanda.ts`) y lo manda
  en el idioma de las térmicas (ESC/POS, `lib/pos/print/escpos.ts`) al puerto 9100 de cada impresora.
- **No repite ni saltea:** anota lo impreso en `hub-impresoras-impresos.json` antes de mandarlo; si la
  impresora no contesta, lo desanota y lo reintenta solo (avisa en la ventana una vez por minuto). Al
  volver de un apagón imprime lo que entró mientras tanto, salvo lo de hace más de 3 horas.
- Una impresora que imprime dos estaciones (la cocina: Cocina y Plancha) puede sacar **un tique por
  estación**, para darle a cada sector el suyo.

## El tique

Lo justo para que el mozo sepa de qué mesa es (`comandaDoc`, el mismo para WiFi y para el navegador):

- el **logo del bar** (el PNG de Configuración; se pasa a puntos negros: lo de color también sale);
- la **estación** en negativo (COCINA, PLANCHA, BARRA, PIZZEROS);
- **MESA** y el número **gigante** (8 veces la letra: unos 2,5 cm de alto);
- **Mozo:** quién la atiende, la hora y la tanda si es la segunda o más;
- los avisos de salud en negativo (celíaco);
- lo pedido: la cantidad y el producto en letra alta, y debajo cada aclaración.

Ya no van: la sucursal, el sector, las personas, lo de las otras estaciones ni la cantidad de productos.

## Detalles para que ande en cualquier marca

- Letra A (48 columnas en el rollo de 80, 32 en el de 58), tamaños con `GS !`, negrita y negativo.
- Las rayas y el logo como dibujo (`GS v 0`), que sale igual en todas.
- Se apaga el «modo chino» (`FS .`) antes de imprimir: en las comanderas chinas, sin eso, las letras con
  tilde salen como ideogramas. Las tildes van en la página de códigos 850 (`ESC t 2`).
- Corte parcial al final de cada tique (`GS V 66`); las que no tienen cortador lo ignoran.
- El programa es un solo archivo (`public/impresoras/hub-impresoras.js`, ~270 KB) que corre con Node 18
  o más nuevo, sin instalar nada más (en Node 22+ usa el aviso en vivo; en versiones viejas, mira cada
  4 segundos). Se arma con `node scripts/hub-impresoras/build.mjs`; **hay que volver a armarlo y
  publicarlo cada vez que cambia el tique**.

## Probado

El 27/11 con impresoras de mentira (tres puertos en la compu de desarrollo que guardan lo que reciben y
lo dibujan): un pedido de la mesa 7 en el bar de ejemplo salió a los 3 segundos en las tres, con la
cocina partida en Cocina y Plancha. **No se probó con las impresoras de verdad del bar.**
