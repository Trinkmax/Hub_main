# Tex, el asistente de Administración

Pedido de Nacho (05/11/2026): un agente de IA para Administración que pueda hacer de todo, responder cualquier duda,
llevarte de una pantalla a otra, hacer cosas en el sistema y mostrarte qué hizo. Claude Haiku 5.5 con clave propia. Es
una mascota, Tex, con la identidad visual de `textOS/public/mascot`.

## Cómo se prende

Con `ANTHROPIC_API_KEY` en las variables de entorno (`.env` en local, Vercel en producción). Sin la clave, Tex no se
dibuja y la ruta contesta 404. No hace falta ningún otro flag.

## La idea de la pantalla

- **Tex en la esquina** (`tex-dock.tsx`): parpadea, sigue al puntero con los ojos, se agacha cuando la página se mueve para
  no tapar lo que se lee y se duerme si nadie lo usa. En el celular se para a la izquierda, porque «+ Cargar» está a la
  derecha, y no aparece en las pantallas de tarea, que tienen su pie fijo.
- **La charla adentro de su cara** (`tex-panel.tsx`): al tocarlo se agranda. El marco azul es su cuerpo, la crema es su cara,
  arriba va la gorra, abajo las zapatillas. Sin charla, la cara ocupa todo; al empezar, sube al encabezado. Mira al puntero,
  habla mientras escribe, se concentra mientras busca y festeja cuando algo sale bien.
- **El tique** (`tex-ticket.tsx`): lo que va a hacer sale impreso, como la comanda del bar, con el asiento a un toque. Nada
  se guarda hasta tocar el botón. Al confirmar cae el sello HECHO y quedan «Ver dónde quedó» y «Deshacer» con su cuenta
  regresiva.
- **Tex va hasta lo que quiere mostrar** (`tex-guide.tsx`): salta por la pantalla, se para al lado y lo marca. Lo encuentra
  por el texto que se lee (`tex-point.ts`), así no hace falta marcar cada pantalla. La página sigue andando abajo.
- **Se le pasan papeles**: una foto o un PDF (clip, arrastrar al panel o a Tex) se lee con visión y se prepara la compra. La
  foto queda adjunta al comprobante.
- En una pantalla de 1280 px o más, la página le hace lugar al panel en vez de quedar tapada. Con menos lugar, el panel se
  achica para mostrar lo que señala.

También se lo abre con **⌘J**, desde **⌘K** («Preguntale a Tex») y desde **+ Cargar** («O contale a Tex qué pasó»).

Los sprites salen de `scripts/tex-sprites.py`: recupera la grilla real del dibujo (40 KB contra 3,5 MB de los originales) y
le borra la cara, que dibuja `tex-face.tsx`, para que pueda hablar y parpadear.

## Cómo funciona

```
navegador ── POST /api/administracion/tex ──▶ ciclo (lib/tex/loop.ts) ──▶ Claude Haiku 5.5
          ◀────── eventos por SSE ───────────┘        │
                                                      ├─ Mirar: lib/tex/tools/read/*   (corren solas)
                                                      ├─ Mostrar: lib/tex/tools/ui.ts  (mueven la pantalla)
                                                      └─ Preparar: lib/tex/tools/actions/* (arman un tique y el ciclo se corta)
```

- **Por qué una ruta y no una server action:** responde de a poco, y Next corre las server actions de a una por navegador.
- **Lo que escribe** corre antes de abrir el stream (`lib/tex/decide.ts`), para que `revalidatePath` se aplique.
- **La charla se guarda** en `acc_tex_messages`, tal cual la devuelve la API y sin editar nunca (`content` es `json`, no
  `jsonb`): la API rechaza una historia cambiada.
- **Se corta cuando hace falta:** al preparar un tique el pedido HTTP termina; al confirmar llega otro y el ciclo sigue desde
  la base. Si se acaba el tiempo de Vercel, el navegador sigue solo (`continue`).
- **Lo que sabe:** `lib/tex/system-prompt.ts` arma el manual con el mismo contenido de la Guía, así nunca dice otra cosa que
  la pantalla. Cada mensaje suma quién habla, la fecha y el texto de la pantalla (`contextBlock`). El caché de la API
  abarata casi todo.

## Lo que lo hace seguro

1. **Nada se escribe sin el toque de una persona.** `preparar_*` valida con el motor y arma un tique; no guarda. Lo que venga
   en un dato (el nombre de un proveedor, una nota, una foto) no puede hacer que Tex escriba.
2. **Misma puerta que los formularios.** Al confirmar corre la misma server action: mismos permisos, mismas validaciones,
   mismo hash de vista previa, misma auditoría. Todo con la sesión de la persona; nunca `service_role`.
3. **Los enlaces son una lista cerrada** (`lib/tex/screens.ts`): Tex elige una pantalla y el servidor arma el link. El texto
   de Tex no acepta HTML ni imágenes, y un link solo funciona dentro de Administración de ese bar (`tex-markdown.tsx`).
4. **Lo que lee son datos.** La pantalla, los resultados y los papeles se le pasan marcados como datos, y el prompt le dice
   que no son instrucciones.
5. **Quedan afuera a propósito**, porque los decide una persona en su pantalla: dar o quitar accesos, cerrar o reabrir un
   ejercicio, borrados en bloque, plan de cuentas y conectar ARCA. Tex lleva a la pantalla.
6. **Rastro:** `acc_tex_actions` guarda qué se mostró y qué pasó, y toda ejecución va a `audit_log`.

Lo que Tex lee viaja a la API de Anthropic (nombres de proveedores, importes, lo que se ve en pantalla). No se loguea el
contenido de las charlas en el servidor.

## Datos

Migración `20261105120000_acc_tex.sql`, aditiva: `acc_tex_threads`, `acc_tex_messages`, `acc_tex_actions`. La charla la ve
solo quien la tuvo; las acciones, quien pueda leer Administración. Una charla sin uso por 12 horas, o con más de 140.000
tokens de contexto, se da por terminada. Si la API rechaza una charla (pasa cuando cambian las instrucciones o las
herramientas, porque exige la historia intacta), lo último que dijo la persona sigue solo en otra charla.

## Para sumarle algo

Una herramienta nueva es un `defineTool` en `lib/tex/tools/read/` o `lib/tex/tools/actions/` (`lib/tex/tools/types.ts` tiene
el contrato). Para un comprobante, `prepareDocument`; para lo demás, un `simpleExecutor` que llame a la server action del
formulario. Una pantalla nueva va en `lib/tex/screens.ts`; `tex-screens.test.ts` verifica que exista.
