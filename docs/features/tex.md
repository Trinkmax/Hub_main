# Tex, el asistente del panel

Pedido de Nacho (05/11/2026): un agente de IA que pueda hacer de todo, responder cualquier duda, llevarte de una pantalla a
otra, hacer cosas en el sistema y mostrarte qué hizo. Claude Haiku 5.5 con clave propia. Es una mascota, Tex, con la
identidad visual de `textOS/public/mascot`. Nació en Administración y ese mismo día pasó a todo el panel de gestión: socios,
marketing y anfitriona en todas las secciones. Los mozos, la caja y la cocina usan el salón, que no lo tiene.

## Quién lo tiene y qué puede

| Rol | Ve y hace |
|---|---|
| `owner` | Todo el panel. En Administración, según su acceso (leer, cargar). |
| `editor` (Contenido) | Solo la carta. |
| `host` (anfitriona) | Reservas, eventos, el tablero del día y sus números. |
| `accountant` (contadora) | Solo Administración: reimputa y hace asientos; no carga compras, pagos ni ventas. |

Cada herramienta y cada pantalla declara a quién le corresponde (`need`, `roles`, `feature`). Lo que no le corresponde a esa
persona ni le llega al modelo. Si una función está apagada para el bar, Tex tampoco la ofrece.

El conocimiento va por áreas (`lib/tex/areas/*`): Administración, Clientes y Club, Mensajería y Marketing, Agenda (reservas,
eventos, entradas), Negocio (carta, estadísticas, configuración) y Compras (los pedidos a proveedores, solo si el bar la
tiene prendida; ver `docs/features/compras.md`). Cada área trae sus herramientas y su manual. Lo fijo del
pedido es chico: el modelo busca las herramientas que necesita (`tool_search`) y lee el manual del área cuando le hace falta
(`leer_manual`).

## Cómo se prende

Con `ANTHROPIC_API_KEY` en las variables de entorno (`.env` en local, Vercel en producción). Sin la clave, Tex no se
dibuja y la ruta contesta 404. No hace falta ningún otro flag.

## La idea de la pantalla

- **Tex en la esquina** (`tex-dock.tsx`): parpadea, sigue al puntero con los ojos, se agacha cuando la página se mueve para
  no tapar lo que se lee y se duerme si nadie lo usa.
- **La charla adentro de su cara** (`tex-panel.tsx`): al tocarlo se agranda. El marco azul es su cuerpo, la crema es su cara,
  arriba va la gorra, abajo las zapatillas. Sin charla, la cara ocupa todo; al empezar, sube al encabezado. Mira al puntero,
  habla mientras escribe, se concentra mientras busca y festeja cuando algo sale bien.
- **El tique** (`tex-ticket.tsx`): lo que va a hacer sale impreso, como la comanda del bar, con el asiento a un toque. Nada
  se guarda hasta tocar el botón. Al confirmar cae el sello HECHO y quedan «Ver dónde quedó» y «Deshacer» con su cuenta
  regresiva.
- **El tique que manda por WhatsApp** (un pedido o un reclamo a un proveedor, `ticket.send`): el botón es un link a wa.me
  que abre el chat en el mismo toque y a la vez confirma; sin número, copia el mensaje. «Ver el mensaje» muestra el
  WhatsApp entero. Se confirma solo con su botón: un «sí» escrito avisa que hay que tocarlo, y «Hacer los N» no lo
  incluye (`texTicketNeedsTap`). Si el toque se corta (en el celular, abrir WhatsApp puede dormir la página), el
  panel vuelve a leer los tiques de la base para no dejar el botón a mano dos veces. Decidido, el link se borra.
- **Tex va hasta lo que quiere mostrar** (`tex-guide.tsx`): salta por la pantalla, se para al lado y lo marca. Lo encuentra
  por el texto que se lee (`tex-point.ts`), así no hace falta marcar cada pantalla. La página sigue andando abajo.
- **Se le pasan papeles**: una foto o un PDF (clip, arrastrar al panel o a Tex) se lee con visión y se prepara la compra. La
  foto queda adjunta al comprobante.
- En una pantalla de 1280 px o más, la página le hace lugar al panel en vez de quedar tapada. Con menos lugar, el panel se
  achica para mostrar lo que señala.

También se lo abre con **⌘J**, desde **⌘K** («Preguntale a Tex») y desde **+ Cargar** («O contale a Tex qué pasó»).

## En el celular

Es donde más lo usan, así que se comporta como una app (`use-phone.ts`). Vale para el celular parado y acostado.

- **Asomado:** se queda abajo a la izquierda, porque «+ Cargar» está a la derecha, mostrando solo la gorra y los ojos, para no
  tapar lo que se lee. Sale entero cuando tiene algo que decir o está trabajando. Su globito se toca para abrir la charla.
- **Respeta las barras:** si la pantalla tiene una barra fija abajo (las pestañas de Mensajería, el pie de un formulario), se
  para arriba de ella. Lo mide solo (`bottomBarHeight`): una pantalla nueva no tiene que avisar nada.
- **Se aparta:** con un chat abierto, Tex no se dibuja. Una pantalla lo pide con `data-tex-away`.
- **Hoja:** el panel sube desde abajo, deja ver la gorra arriba y se cierra deslizando desde el encabezado, tocando el velo o
  con la X. La página de atrás queda quieta.
- **«Atrás»:** el botón del teléfono cierra la hoja, no se va de la pantalla. Abrirla deja una entrada en el historial; si Tex
  lleva a otra pantalla, esa pantalla ocupa el lugar de la entrada, así «atrás» vuelve a donde estaba la persona.
- **Teclado:** no se abre solo. La hoja se mide con `visualViewport`, así el campo queda arriba del teclado también en iPhone.
  La cara grande se esconde mientras está abierto. Al mandar, el teclado baja: lo que viene es para leer.
- **Dedo:** los toques miden 44 px (`pointer-coarse:`), el campo tiene 16 px para que iPhone no haga zoom, y el clip es una
  cámara. Lo que depende de pasar el mouse no corre con el dedo.

Se probó con Chrome emulando el toque (390×844, 360×640, 320×568, acostado, tablet y oscuro) y un teclado simulado. **El teclado
de un iPhone de verdad no se pudo probar:** es lo primero a mirar en un teléfono real.

Los sprites salen de `scripts/tex-sprites.py`: recupera la grilla real del dibujo (40 KB contra 3,5 MB de los originales) y
le borra la cara, que dibuja `tex-face.tsx`, para que pueda hablar y parpadear.

## Cómo funciona

```
navegador ── POST /api/tex?slug=… ─────────▶ ciclo (lib/tex/loop.ts) ──▶ Claude Haiku 5.5
          ◀────── eventos por SSE ───────────┘        │
                                                      ├─ Mirar: ver_*, buscar_*    (corren solas)
                                                      ├─ Mostrar: lib/tex/tools/ui.ts  (mueven la pantalla)
                                                      └─ Preparar: preparar_*      (arman un tique y el ciclo se corta)
```

- **Por qué una ruta y no una server action:** responde de a poco, y Next corre las server actions de a una por navegador.
- **Lo que escribe** corre antes de abrir el stream (`lib/tex/decide.ts`), para que `revalidatePath` se aplique.
- **La charla se guarda** en `acc_tex_messages`, tal cual la devuelve la API y sin editar nunca (`content` es `json`, no
  `jsonb`): la API rechaza una historia cambiada.
- **Se corta cuando hace falta:** al preparar un tique el pedido HTTP termina; al confirmar llega otro y el ciclo sigue desde
  la base. Si se acaba el tiempo de Vercel, el navegador sigue solo (`continue`).
- **Lo que sabe:** `lib/tex/system-prompt.ts` arma las instrucciones con las áreas y pantallas de esa persona. El manual de
  Administración sale del mismo contenido de la Guía, así nunca dice otra cosa que la pantalla. Cada mensaje suma quién habla,
  la fecha y el texto de la pantalla (`contextBlock`). El caché de la API abarata casi todo.

## Lo que lo hace seguro

1. **Nada se escribe sin el toque de una persona.** `preparar_*` valida con el motor y arma un tique; no guarda. Lo que venga
   en un dato (el nombre de un proveedor, una nota, una foto) no puede hacer que Tex escriba.
2. **Misma puerta que los formularios.** Al confirmar corre la misma server action: mismos permisos, mismas validaciones,
   mismo hash de vista previa, misma auditoría. Todo con la sesión de la persona; nunca `service_role`.
3. **Los enlaces son una lista cerrada** (`lib/tex/screens.ts`): Tex elige una pantalla y el servidor arma el link. El texto
   de Tex no acepta HTML ni imágenes, y un link solo funciona dentro de ese bar (`tex-markdown.tsx`).
4. **Lo que lee son datos.** La pantalla, los resultados y los papeles se le pasan marcados como datos, y el prompt le dice
   que no son instrucciones.
5. **Quedan afuera a propósito**, porque los decide una persona en su pantalla: dar o quitar accesos y roles, cerrar o reabrir
   un ejercicio, borrados en bloque, plan de cuentas, conectar ARCA, WhatsApp o Mercado Pago, devolver plata, subir fotos o
   páginas, y mandar una difusión. Tex lleva a la pantalla. Un pedido a un proveedor sí lo manda, pero con el toque del
   botón de su tique, desde el WhatsApp de quien compra, y verificando antes que el mensaje sea el que queda guardado.
6. **Rastro:** `acc_tex_actions` guarda qué se mostró y qué pasó, y toda ejecución va a `audit_log`.

Lo que Tex lee viaja a la API de Anthropic: nombres de proveedores y de clientes, importes, lo que se ve en pantalla. Las
herramientas no devuelven teléfonos ni mails completos, y fuera de Administración el texto de la pantalla sale sin ellos
(`maskPersonal`). No se loguea el contenido de las charlas en el servidor.

## Datos

Migraciones `20261105120000_acc_tex.sql` (tablas `acc_tex_threads`, `acc_tex_messages`, `acc_tex_actions`) y
`20261105120200_acc_tex_todo_el_panel.sql` (las abre a los roles del panel). La charla la ve solo quien la tuvo. Las acciones las
ve quien las hizo y, si son de un comprobante, quien lea Administración (`20261105120300_acc_tex_acciones_privadas.sql`): la
contadora no tiene acceso a los clientes, y por acá tampoco. Una vez decidido el tique, lo que se iba a hacer se vacía y solo
queda lo que se le mostró a la persona. Una charla sin uso por 12 horas, o con más de 140.000
tokens de contexto, se da por terminada. Si la API rechaza una charla (pasa cuando cambian las instrucciones o las
herramientas, porque exige la historia intacta), lo último que dijo la persona sigue solo en otra charla.

## Para sumarle algo

Una herramienta nueva es un `defineTool` en la carpeta de su área, `lib/tex/tools/<área>/` (`lib/tex/tools/types.ts` tiene el
contrato), y se suma a `lib/tex/areas/<área>.ts`. Para un comprobante, `prepareDocument`; para lo demás, un `simpleExecutor` que
llame a la server action del formulario. Una pantalla nueva va en `lib/tex/area-screens/<área>.ts`; `tex-screens.test.ts`
verifica que exista.
