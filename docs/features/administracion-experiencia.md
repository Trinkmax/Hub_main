# Administración: la experiencia rediseñada (octubre 2026)

> Toda la sección `/[slug]/administracion` se rediseñó para dueños de bar que no son contadores: cada
> pantalla tiene la forma de un objeto real, un número que se entiende sin leer y la acción del momento
> al lado. La lógica contable es la misma de antes: cambió la presentación y el recorrido, no lo que se
> guarda.

**Estado.** La tanda 1 (Resumen, Cierre del día, Nuevo gasto, Guía, barra y lanzador) y la tanda 2
(Gastos fijos, Compras y pagos, Ventas, Cajas, Importar, Libros y Fin de mes, la ficha de un comprobante,
Ajustes y la puesta en marcha) están en producción desde el 14/10/2026 (merge `ea1b9a6`). El pulido de la
tanda 2 sobre capturas reales y el estado vacío de un bar recién arrancado llegaron a producción el mismo
día, con el sí del dueño sobre las capturas.

Abreviaturas: `ADM` = `app/(manager)/[tenantSlug]/administracion` · `CA` = `components/administracion`.

---

## 1. Qué es y por qué

**El pedido del dueño (13/10/2026).** Mejorar toda Administración a nivel experiencia: pantallas que
acompañen, gráficos, todo simple, «como un paso a paso», y un instructivo guiado y visual que explique qué
se factura y qué no, y cómo se vincula cada cosa. La UI anterior no le gustaba. El permiso vale **solo
para `/administracion`**: no reabre el kit global que se rechazó y revirtió el 07/10 (`fd044a0`).

**Lo que había que evitar.** Una semana antes se rechazó un rediseño «correcto y quieto»: sin sombras ni
movimiento, campos con borde oscuro, chips activos en contorno, pestañas subrayadas, formularios en
secciones planas, y chips con dos números pegados («2 6»). «Parece del año 2010».

**La idea rectora.**

- **Cada pantalla tiene la forma de un objeto real** que los socios ya usan: el ticket del cierre, el
  papel que te dieron, la planilla de gastos fijos, la libreta del proveedor, el almanaque de pared, la
  billetera, las bandejas del escritorio, la carátula del mes, la factura archivada con su sello, la
  trastienda.
- **Un número héroe con su oración y «¿Cómo se calcula?».** El número va en Fraunces grande con el «$»
  chico; debajo, UNA oración que lo explica; al lado, un `<details>` con la cuenta.
- **La acción del momento, grande, al lado del dato.** Un solo botón primario por vista.
- **El estado vacío es el diseño.** El bar real recién arranca: lo primero que ven los socios es una
  pantalla casi vacía, y tiene que enseñar el paso siguiente («Para arrancar» con tres pasos numerados,
  nunca un «$ 0» por un dato que falta).
- **Casi sin `Select` ni tablas** en lo del dueño: píldoras con la elegida RELLENA, tarjetas de elección,
  listas con margen de cuaderno. Las tablas densas quedan para la contadora.
- **Dos públicos, dos registros.** El dueño ve tarjetas, frases y dibujos; la contadora, libros densos,
  sobrios y exportables. Los Libros no se convirtieron en tarjetas.

---

## 2. Las reglas que no se negocian

1. **Alcance: solo `/administracion`.** No se tocan `components/ui/*`, `components/shell/*`,
   `components/command-palette/*`, `supabase/**`, `lib/accounting/{actions,posting,server,schemas*}` ni
   los valores de tokens existentes de `app/globals.css`. Lo nuevo vive en `CA/**`, `ADM/**`,
   `lib/accounting/**` (lo puro y las lecturas) y `lib/imports/ui/**`. Los tokens nuevos son `--adm-*` y
   van **agregados** en bloques delimitados al final de `globals.css`.
2. **La lógica contable no se toca**: motor de asientos, zod, `usePosting` / `useDocumentPosting`, la
   vista previa con hash, la idempotencia (`clientRef`), los avisos confirmables, los permisos
   (`requireAccountingAccess`, `readOnly`), el contrato `?accion=` de las hojas y las URLs como estado
   (`?tab=`, `?mes=`, `?periodo=`, `#paso-N`). **Cada formulario manda exactamente lo mismo que antes**:
   lo auditó un agente por área, formulario por formulario, contra el código anterior.
3. **Sin migraciones.** La única lectura nueva de la tanda 2 es `lib/accounting/queries/document-origin.ts`
   (dos `select` bajo las políticas de lectura que ya existen) y el único gesto nuevo, «Separar», usa una
   acción que ya existía (`unallocateItem`).
4. **Un solo libro.** «Sin factura» es `voucher_type = 'sin_comprobante'` y queda registrado igual, en el
   mismo libro; lo único que cambia es que no entra al Libro IVA. Ningún texto dice «en negro / en
   blanco», ni sugiere que algo queda «afuera» de los libros. Nunca «ganancia» ni «ganaste» (ventas menos
   compras no es ganancia). Lo estimado se rotula «estimado» o «aprox.». La frase fija es «Con factura o
   sin factura, todo queda registrado en los libros.».
5. **La contadora solo mira.** No ve NINGÚN botón de carga. Cada control que escribe tiene su guarda
   (`readOnly` / `canWrite`) y cada área lo prueba con un test de render. En el encabezado lleva
   `badge={<ReadOnlyBadge />}`; en una pantalla de carga, `ReadOnlyNotice` con la vuelta a donde se mira.
6. **Plata.** La base guarda centavos; la pantalla muestra y pide pesos. Se usa `lib/money`
   (`formatCents`, `formatCentsShort`) y `Amount`; nunca `Intl` ni `toLocaleString`. Sin centavos en
   títulos, tarjetas, listas y globitos; con centavos solo en un ticket, en un campo que se tipea y en lo
   que mira la contadora. `null` no es cero: se muestra «—» o el vacío.
7. **Tailwind v4**: `bg-(--x)` sí, `bg-[--x]` no pinta. Foco visible en todo control
   (`focus-visible:ring-2 focus-visible:ring-ring`). Claro y oscuro a la par. `prefers-reduced-motion`
   respetado. Sin `any` ni `@ts-ignore`.
8. **Español rioplatense**, de vos, frases cortas, palabras de dueño de bar. Las guías no nombran al bar,
   su CUIT ni su sistema de caja.

---

## 3. El contrato de diseño

### 3.1 Tokens `--adm-*` (`app/globals.css`, agregados)

| Token | Qué es |
|---|---|
| `--adm-s1` … `--adm-s6` | La paleta de datos: bosque, dorado, ciruela, azul noche, terracota, petróleo. Validada para daltonismo contra la tarjeta clara y la oscura. **El orden es fijo y nunca se cicla**: un 7.º va a «Otros». El color sigue a la cosa, no a su posición. El dorado (`s2`) va siempre con etiqueta al lado. |
| `--adm-in` / `--adm-out` | Entró (= `s1`) y salió (= `s5`). No alcanzan solos por color: siempre con flecha, signo o palabra. |
| `--adm-neutral` | «Otros», «Más adelante», «Sin definir». |
| `--adm-track` | El riel de una barra o un medidor. |
| `--adm-hero`, `--adm-hero-2` | El panel verde bosque del Resumen (degradé, como una pizarra). Adentro es una isla oscura también en modo claro. |
| `--adm-hero-fg`, `--adm-hero-muted`, `--adm-gold` | Texto, texto secundario (AA) y acento dorado sobre el héroe. |
| `--adm-paper`, `--adm-paper-ink`, `--adm-paper-rule` | El papel de los tickets: claro también en oscuro, tinta y reglas punteadas. |
| `--adm-k-bank-1..3`, `--adm-k-cash-1..3`, `--adm-k-wallet-1..3` | El color de una CAJA por su tipo: banco bosque (crema en el héroe y en oscuro), efectivo dorado, billetera celeste; el escalón 1–3 distingue cuentas del mismo tipo. No están en `@theme`: se usan con paréntesis y con la clase escrita entera. |
| `--adm-hatch-missing` | La tinta del rayado «falta cargar» en oscuro. |
| `--adm-nav-h` | La altura de la barra de la sección cuando está pegada (para pegar algo debajo). |

`success / warning / destructive / info` quedan reservados a estados (al día / por vencer / vencido /
aviso), siempre con palabra o ícono. El texto nunca lleva el color de la serie: la identidad la da un
punto o un trazo al lado. Clases propias: `adm-hero`, `adm-ticket`, `adm-stamp-in` (el sellazo),
`adm-tick` + `adm-tick-draw` (el tilde que se dibuja), `adm-status[data-tone]`.

### 3.2 Piezas del kit (`CA/kit/**`, barril `CA/kit/index.ts`)

Server-safe salvo lo marcado (cliente). Las firmas están en el código.

| Pieza | Archivo | Para qué | Cuándo NO |
|---|---|---|---|
| `AdmPage`, `AdmHeader` | `adm-page.tsx` | El marco de toda pantalla y su único `h1` (Fraunces, sin eyebrow, `back` chico arriba). | Dentro de hojas o diálogos. |
| `Panel`, `PanelSection` | `panel.tsx` | La superficie estándar y sus bloques internos separados por una raya suave. | Tarjetas dentro de tarjetas. |
| `HeroPanel`, `MoneyHero` | `hero.tsx` | El panel verde (uno por pantalla) y el número héroe con su oración. | Más de un héroe por pantalla. |
| `MoneyTicker` (cliente) | `money-ticker.tsx` | El número que cuenta al montar o al cambiar (el total de un ticket que se arma). | Listas y tablas (ahí `Amount`). |
| `Pill`, `PillLink`, `LegendPill` | `pill.tsx` | Píldoras con la elegida rellena (tinta para filtros, verde para navegar); leyenda que filtra o navega. | Un estado (eso es `StatusPill`). |
| `StatusPill` | `status-pill.tsx` | Un estado en una palabra con su punto (al día, por vencer, vencido, aviso, neutro). | Series de un gráfico; nunca color solo. |
| `Explain`, `MathRow` | `explain.tsx` | «¿Cómo se calcula?» al lado de un número, con la cuenta renglón por renglón. | — |
| `EmptyTeach` | `empty-teach.tsx` | El vacío que enseña: qué va a aparecer, para qué sirve y EL botón del paso siguiente. | Pasarle el botón a la contadora. |
| `ChoiceCard` | `choice-card.tsx` | Tarjeta de elección (radio de verdad), por ejemplo los cuatro papeles. | Más de 4–5 opciones. |
| `Ticket`, `TicketHeader`, `TicketRow`, `TicketRule`, `TicketTotal`, `TicketStamp`, `TicketNote`, `TicketLabel` | `ticket.tsx` | El papel de lo que se cobra, se paga o se cierra, con su sello. | Un documento que no es un tique (`PaperSheet`). |
| `StepCard`, `StepRail` | `step.tsx` | El paso a paso: hecho plegado con «Cambiar», actual abierto, pendiente atenuado. | — |
| `Term` | `term.tsx` | La palabra de contadora con la idea primero («lo que recuperás de IVA (IVA crédito fiscal)»). | En Libros. |
| `ActionTile` | `action-tile.tsx` | Tarjeta-acción grande de las recetas de la guía. | El lanzador (tiene sus puertas propias). |
| `LedgerList`, `LedgerGroup`, `LedgerRow`, `LedgerRail` | `ledger.tsx` | Toda lista del dueño que antes era tabla: el renglón con margen de cuaderno que dice desde cuándo o para cuándo (nunca un importe). Se acomoda al ancho de su hoja. | Los libros de la contadora, un ticket, más de ~60 renglones sin agrupar. |
| `ViewPills` | `view-pills.tsx` | El segundo nivel de una pantalla, una vista por vez, en la URL; la activa rellena en tinta. | Filtros (`PillLink` sueltos), pasos, moverse entre secciones. |
| `CategoryPicker` (cliente) + `category.ts` | `category-picker.tsx` | Elegir la categoría («¿En qué se gastó?»): sugerida, mercadería, las que más usás, «Otra cosa». La sugerida **nunca se elige sola**. | Una contrapartida que no es un gasto (sigue `AccountCombobox`); lo de la contadora. |
| `WalletCard` | `wallet-card.tsx` | Que una caja se vea igual, con su color de tipo, donde aparezca. | Para ELEGIR una caja (`TreasuryPicker`). |
| `PaperSheet` | `paper.tsx` | Un documento: la constancia de la SAS, una factura que se llena sola. | Lo que se cobra, paga o cierra (`Ticket`). |
| `PanelError`, `PanelLink`, `RetryButton` (cliente) | `panel-states.tsx`, `retry-button.tsx` | Un bloque que no se pudo leer conserva su lugar y su título y ofrece reintentar. | Errores de formulario; un bloque vacío. |

### 3.3 Gráficos (`CA/charts/**`, dibujados a mano, sin librería)

Reglas: un solo eje por gráfico; barras de 24 px como mucho con extremo redondeado; **un día sin cargar
no es cero** (hueco punteado ámbar rotulado «falta»); etiquetas solo en el extremo, el máximo y hoy; la
leyenda es la tabla; siempre hay «Ver como tabla»; sin datos no dibujan ceros (muestran `EmptyTeach` con
su silueta). Los globitos van sin centavos.

| Gráfico | Archivo | Qué dibuja |
|---|---|---|
| `ChartFrame` (cliente) | `chart-frame.tsx` | Título que afirma + oración + dibujo, con «Ver como tabla». |
| `SplitBar` | `split-bar.tsx` | Barra partida con leyenda-tabla (cajas, con / sin factura, tramos de deuda). |
| `RankBars` | `rank-bars.tsx` | Barras horizontales ordenadas (categorías, proveedores). |
| `DayBars` | `day-bars.tsx` | Una columna por día con la marca del objetivo. |
| `TargetRace` | `target-race.tsx` | Vendido acumulado contra objetivo acumulado. |
| `CloseStrip` | `close-strip.tsx` | El almanaque de cierres del mes. |
| `BalanceArea` | `balance-area.tsx` | El saldo en el tiempo, escalonado, con la marca de hoy. |
| `InOutBars` | `in-out-bars.tsx` | Entró hacia arriba, salió hacia abajo. |
| `DueStrip` | `due-strip.tsx` | Lo que vence en los próximos 14 días. |
| `Meter` | `meter.tsx` | Avance contra un total, con marca de objetivo. |
| `MonthStrip` | `month-strip.tsx` | Los meses de un ejercicio como pestañas con estado (Cerrado con candado, Falta cerrar, En curso). |
| `palette.ts`, `scale.ts`, `chart-parts.tsx`, `chart-tip.tsx` | — | Colores con nombre (`INVOICED_SWATCH`, `NOT_INVOICED_SWATCH`, `DUE_SWATCHES`, `treasuryToneSwatch`), escalas y ejes, piezas para armar un dibujo propio y el globito. |

### 3.4 La navegación y el lanzador (`CA/nav/**`)

- **La barra de la sección** (`adm-nav.tsx`, modelo puro en `adm-nav-model.ts`) reemplaza a las pestañas
  genéricas solo en `ADM/layout.tsx`. Compu: Resumen · Ventas · Compras y pagos · Gastos fijos · Cajas
  como píldoras con ícono (la activa rellena en verde), después Importar y «Contadora ▾» (Fin de mes,
  Libros, Plan de cuentas), y a la derecha Guía, Ajustes (⚙) y «＋ Cargar». Celular: la misma fila,
  deslizable, y «··· Más» con el resto. Para la contadora, Libros, Fin de mes y Plan de cuentas son
  píldoras directas y no hay «Cargar».
- La barra se pega bajo el topbar solo en las pantallas de primer nivel; en sub-rutas se va con la página.
- **El lanzador «¿Qué querés cargar?»** (`launcher.tsx`, textos en `launcher-items.ts`; diálogo en compu,
  hoja desde abajo en celular con `nav-dialog.tsx`) entra por la SITUACIÓN, no por el nombre contable:
  arriba, grandes, «Cerrar el día» y «Pagué algo recién»; en la bandeja, «Me llegó una factura o un remito
  y lo pago después», «Pago algo que debía», «Me entró plata», «Pasé plata de un lado a otro», «Conté la
  caja» y «Otra cosa». Al pie: «¿No sabés dónde va? Mirá la guía».
- **El flotante «＋ Cargar» del celular** (`launcher-fab.tsx`) lo pone el layout en las pantallas de
  primer nivel (`FAB_FRAME_SCREENS`), nunca en solo lectura, ni en Ajustes ni en la Guía.

### 3.5 Piezas compartidas de la tanda 2 (fuera del kit)

| Pieza | Archivo | Para qué | Cuándo NO |
|---|---|---|---|
| `TreasuryPicker` (cliente) | `CA/treasury-picker.tsx` | Elegir una caja en una carga: píldoras con nombre y saldo sin centavos; con más de cuatro, el desplegable de siempre. `suggestedId` dice «Te sugiero», pero no elige. | Mostrar una caja (`WalletCard`); cuando hace falta «ninguna» («Lo elijo cada vez»). |
| `voucherStamp()` | `CA/voucher-stamp.ts` | El MISMO sello del papel antes y después de guardar («Con factura A», «Sin factura», «Con tique»…; la M sella «A»). | Un estado de pago (eso es `StatusPill`); un acto terminado (`TicketStamp tone="ok"`: «CARGADO», «CERRADO»). |
| `SheetQuestion`, `BIG_MONEY_FIELD`, `ADD_LINK`, `TEXT_LINK` | `CA/acciones/sheet-parts.tsx` | Que las seis hojas de carga hablen igual que «Nuevo gasto» (la pregunta en Fraunces, el importe grande). | Un campo común («Fecha», «Detalle»). |
| `PaperChoices`, `TreasuryAfterLine` | `CA/acciones/gasto-piezas.tsx`, `gasto-papel.ts` | Los cuatro papeles (ninguno marcado cuando no se sabe) y el «Caja: hoy $ X → queda $ Y» (con `direction` para plata que entra). | Un papel ya guardado (eso es el sello). |
| `closeTicketProps` + `CloseTicket` | `ADM/ventas/cierre/_lib/close-ticket-props.ts`, `…/_components/close-ticket.tsx` | Que un cierre guardado se vea como el ticket que se armó al cargarlo (la noche en Ventas, la ficha del comprobante). | Mientras se carga un cierre. |
| `MonthStepper`, `RangeFilter` | `CA/cajas-ventas/period-filters.tsx` | El período de una lista en la URL, con aspecto de píldora. | Meses de un ejercicio (`MonthStrip`). |

**La regla de los sellos.** Un sello dice qué papel es o un acto terminado. Nunca un estado de pago
(«Pagada», «A cobrar» van en `StatusPill`). «ANULADO» es la banda de la ficha. No hay sello rojo.

### 3.6 Estado en la URL (contratos: no cambiar sin avisar)

| Dónde | Parámetro | Qué hace |
|---|---|---|
| Cualquier pantalla | `?accion=gasto\|pagar\|cobrar\|mover\|ajustar\|movimiento` | Abre esa hoja encima; se cierra sacando el parámetro. |
| Junto a `?accion=` | `proveedor`, `cliente`, `caja`, `partida`, `gasto-fijo` (uuid) | Precarga la hoja. `gasto-fijo` abre «Nuevo gasto» con ese gasto fijo elegido; `partida` tilda solo esa partida en «Pagar». |
| `/ventas/cierre` | `?fecha=yyyy-MM-dd` | El día a cargar; sin fecha abre el primero que falta. |
| `/guias/dia-a-dia` y vecinas | `#receta-<id>`, `#vinculo-…`, `#casos` | Abren una receta o saltan a una unión. |
| Resumen | cookie `hub_acc_pasos_<slug>` | La franja «Puesta en marcha» abierta o en un renglón. |

Las claves internas (`sin_comprobante`, `otro_comprobante`, ids de guía, anclas, las siete `?tab=` de
Ventas y las nueve de Ajustes) no cambiaron: los links viejos siguen andando.

---

## 4. Pantalla por pantalla

Todas las rutas son bajo `/[slug]/administracion`. «→ `acción`» es la acción de servidor que corre al
confirmar el gesto; donde no dice nada, el gesto solo navega o abre una hoja.

### Las seis hojas de carga (`CA/acciones/*-sheet.tsx`, abiertas con `?accion=`)

| Hoja | Título | La forma | Guarda con |
|---|---|---|---|
| `gasto` | Nuevo gasto | «¿Qué papel te dieron?» con cuatro tarjetas (Factura A · Factura B o C · Tique · Remito o nada) y un ticket chico con su sello | `postQuickExpense` (la foto: `prepareAttachmentUploads` + `registerDocumentAttachments`) |
| `pagar` | Pagar | a quién (lo más urgente arriba) → qué → cuánto → con qué → «Le quedás debiendo $ Y» | `postPayment`; «Usar $ X a favor» → `allocateItems` |
| `cobrar` | Registrar un cobro | la liquidación en tres pasos con su ticket | `postCollection` |
| `mover` | Mover plata | el pase: dos tarjetas y una flecha con cómo queda cada una | `postTransfer` |
| `ajustar` | Contar la caja (la hoja se titula «¿Coincide la caja?») | la cuenta del conteo: el sistema dice · contaste · «Coincide» o «Faltan $ X» | con diferencia `postTreasuryAdjustment` (billeteras: `postWalletCheck`); «Sí, coincide» → `markTreasuryChecked` |
| `movimiento` | Otra entrada o salida | el vale de caja («Un socio sacó plata») | `postCashMovement` |

Todas dejan el aviso con «Deshacer» de 6 segundos (`toastUndo` → `undoDocument`). Después, se anula
desde la ficha del comprobante.

### Tanda 1

**Resumen** — `/` (`ADM/page.tsx` + `ADM/_resumen/*`; cuentas puras en `lib/accounting/home.ts`)
- *Metáfora:* la plata hoy, en un panel verde como una pizarra.
- *Muestra, en este orden:* cuánta plata hay y dónde (número héroe + barra por caja con el color de su
  tipo + el saldo de los últimos 30 días) → «Hoy te toca» (de 3 a 5 tarjetas numeradas: el cierre de
  ayer, lo que compraste hoy, lo que vence, y lo que toque) con la franja «Puesta en marcha · N de M» →
  el mes contra el objetivo (barras por día, carrera contra el objetivo, almanaque de cierres) → lo que
  tenés que pagar (tramos Vencido · Vence esta semana · Más adelante y los gastos fijos del mes) →
  entró y salió → en qué se va la plata (categorías y con / sin factura) → avisos → IVA del mes.
- *Sin saldos iniciales:* «Todavía no sé cuánta plata hay» y «Cargar lo que había» → `/configurar`.
- *Gestos:* cada tarjeta abre su pantalla u hoja; «Este mes no se paga» en un gasto fijo →
  `skipRecurringDue`.
- *URL:* `?hero=crema` (temporal, de revisión: la variante clara del panel).
- *Contadora:* el mismo héroe y gráficos, sin acciones, con «Estado de los libros» arriba.

**Cierre del día** — `/ventas/cierre?fecha=` (`ADM/ventas/cierre/**`)
- *Metáfora:* el ticket de cierre que se arma en vivo.
- *Muestra:* cuatro pasos numerados, todos abiertos: ¿Cuánto se vendió y cómo te pagaron? · ¿Contaste el
  efectivo? · ¿Qué facturaste? · Revisá y guardá. A la derecha (desde 1280 px), el ticket: renglón por
  medio, total, con factura / sin factura, efectivo esperado · contado · diferencia, «Cuándo entra» cada
  cosa y el objetivo del día. En el celular, una barra «Total vendido · Ver ticket».
- *Gestos:* «Completar con el reporte de Mercado Pago» lee el archivo en el navegador (no sube nada);
  «Guardar cierre del <día>» → `postSalesClose`. Después sigue sola con el próximo día que falta.

**Nuevo gasto** — hoja `?accion=gasto` (`CA/acciones/gasto-sheet.tsx`, `gasto-piezas.tsx`, `gasto-papel.ts`)
- *Metáfora:* el papel que te dieron.
- *Orden:* ¿Cuánto? → ¿En qué se gastó? → ¿Con qué pagaste? (con «hoy $ X → queda $ Y») → ¿Qué papel te
  dieron? → ticket con su sello → foto → fecha → detalle → «Ver cómo queda en los libros» (plegado).
- Los cuatro papeles escriben exactamente los valores de antes. `gasto-fijo=<uuid>` abre la hoja con ese
  gasto fijo elegido (monto, categoría, caja y papel de siempre).

**Guía** — `/guias` (`ADM/guias/**`, `CA/guias/**`; contenido en `lib/accounting/guides.ts`)
- *Metáfora:* un mapa de cinco paradas unidas por una línea: Vendés → Comprás y gastás → Pagás →
  Controlás la plata → Fin de mes. Cada parada dice qué mueve en la plata, con «Ver cómo» y «Hacerlo
  ahora».
- *Páginas:* `/guias/dia-a-dia` (doce recetas «¿Qué pasó?», de 3 a 5 pasos con la pantalla simulada al
  lado, «Chequeá que…» y «Si algo sale mal») · `/guias/con-y-sin-factura` (los cuatro papeles lado a lado
  y los casos reales) · `/guias/como-se-vincula` (cada unión: qué es, dónde se hace, qué pasa si no, cómo
  se deshace, y lo que hoy no se puede) · `/guias/como-arrancar` (la puesta en marcha y la rutina, con «Ya
  lo hice» → `markOnboardingStep`).
- *El test que la cuida:* `tests/lib/accounting-guides.test.ts` comprueba que cada rótulo que cita la
  guía (`SCREEN_LABELS`) siga escrito en el código de su pantalla (`SCREEN_SOURCES`). Quien renombra un
  rótulo lo cambia en los dos lados.

### Tanda 2

**Gastos fijos** — `/gastos-fijos` (`ADM/gastos-fijos/**`; la ficha en `ADM/compras/gastos-fijos/[id]`)
- *Metáfora:* la planilla mensual que los socios ya llevan, pero viva.
- *Muestra:* arriba «Te falta de gasto fijo» con la barra pagado / vencido / por vencer y «Lo que sigue»
  con su botón «Pagar $ X»; abajo, los renglones colgados del día en que vencen (`LedgerRail`), cada uno
  con su casillero, sus cuotas en puntitos y su papel de siempre; al pie, la suma y dos dibujos (por día y
  con qué papel pagás lo fijo). El renglón no se mueve cuando lo pagás: se tilda en su lugar.
- *Gestos:* «Pagar» (renglón o «Lo que sigue») → hoja `gasto` con `gasto-fijo` → `postQuickExpense`; «¿Era
  eso?» / «Sí, dejar $ X», cambiar monto o día en el renglón, «Pausar», «Reanudar» →
  `saveRecurringExpense`; «Este mes no se paga» → `skipRecurringDue`; «Eliminar» (con `AlertDialog`) →
  `deleteRecurringExpense`; «Me llegó la factura y la pago después» → `/compras/nueva?gasto-fijo=`;
  «Completar la planilla» (`/gastos-fijos/completar`: montos y días de corrido, o pegados desde la
  planilla) → `saveRecurringExpense` por renglón; «Pegar una lista» → `createRecurringBulk`.
- *URL:* `?mes=` (Octubre · Noviembre), `?abrir=<uuid>` (abre ese renglón), `?ver=vencido|por-vencer|
  pagado|sin-monto|en-cuotas`, `?factura=con|sin|nose`, `?categoria=`.

**Compras y pagos** — `/compras` (`ADM/compras/**`)
- *Metáfora:* la libreta del fiado, del lado del que debe.
- *Muestra:* «Le debés a proveedores $ X» con sus tramos, la puerta de tres situaciones, y un renglón por
  proveedor ordenado por lo que más apura, con el «desde cuándo» en el margen y la deuda dibujada. Vistas
  (`?tab=`): Proveedores · Comprobantes (con el reparto con / sin factura) · Pagos. La hoja de un proveedor
  (`/compras/proveedores/[id]`, `?tab=estado|pendientes|datos`) tiene su tapa con «Le debés $ X» y
  [Pagarle], y te dejó / le pagaste / le debés.
- *Gestos:* «Cargar una compra que debo» (`/compras/nueva`, cuatro preguntas: proveedor, papel, total,
  cuándo vence; el ticket dice «Le vas a deber $ X») → `postPurchase`; «Me hizo una nota de crédito» →
  `postPurchaseCreditNote`; «¿Cómo te factura?», «Pagarle siempre a N días», clasificar proveedores sin
  categoría, «Editar datos» → `saveParty`; «Cargar una lista» → `createPartiesBulk`; eliminar →
  `deleteParty`; «Pagar» → hoja `pagar`; «Usarlo ahora» (saldo a favor) → `allocateItems`.
- *URL:* `?tab=`, `?filtro=sin-clasificar`, `?vista=lista`; `/compras/nueva?proveedor=&gasto-fijo=&tipo=`.

**Ventas** — `/ventas` (`ADM/ventas/**`)
- *Metáfora:* el almanaque de pared del bar. Cada noche es un casillero que se llena hasta donde se
  vendió; la noche que falta es un hueco punteado; al tocarla aparece su ticket al lado (el mismo papel
  que se armó al cerrar).
- *Vistas:* **El mes** (la hoja de arriba con «Vas vendiendo», el almanaque, los bloques «Proyección» y
  «Ventas contra caja») · **Plata por cobrar** (cada plata con su día de llegada; «Ya tendría que haber
  llegado» · «Llega esta semana» · «Más adelante») · **Lo que llegó** (de cada cien pesos, cuánto se queda
  cada medio) · **Facturas** (el ticket del mes con el mismo sello que cada noche).
- *Gestos:* «Cargar el cierre del <día>» → Cierre del día; «Ya entró» en un renglón por cobrar → hoja
  `cobrar` → `postCollection` (si es Mercado Pago, «Contar Mercado Pago» abre la hoja `ajustar`); «Armar el
  objetivo» (asistente de tres pasos), «Cargar una lista» o tocar un día → `saveSalesTargets`; «Anotar lo
  que entró» (Ventas contra caja, no toca los libros) → `saveDailyCash`; «Factura aparte»
  (`/ventas/nueva-factura`) → `postSalesInvoice` (con ARCA prendido, emite por `use-arca-emission`).
- *URL:* las siete `?tab=` de siempre (`cierres`, `proyeccion`, `caja`, `clientes`, `cobros`,
  `neto-por-medio`, `facturas`) caen en las cuatro vistas; `?mes=`, `?dia=`; anclas `#proyeccion`, `#caja`,
  `#cobros`. La ficha de quien te debe: `/ventas/clientes/[id]?ver=pendiente|cuenta|datos`.

**Cajas y bancos** — `/cajas` (`ADM/cajas/**`)
- *Metáfora:* la billetera del teléfono: total arriba, una fila de acciones redondas, una tarjeta por caja
  con su color (el mismo del Resumen), lo que hay y si ya la contaste, y la actividad.
- *Vistas:* **Lo que hay** · **Entró y salió** (`?tab=flujo`). La ficha de una caja (`/cajas/[id]`) es la
  tarjeta abierta con lo que pasó día por día («Al cierre del día quedó en $ X») y «Ver como tabla».
- *Gestos:* «Contar» → hoja `ajustar`; «Mover plata» → hoja `mover`; «Un socio puso o sacó plata» → hoja
  `movimiento`; «Ya me entró» (lo en camino de Mercado Pago) → hoja `ajustar` de la billetera; «Pagar el
  resumen» de la tarjeta de la empresa → hoja `mover`; «Gastos del banco» (`/cajas/gasto-bancario`: los
  renglones como figuran en el resumen y el total que tiene que dar) → `postBankExpense`.
- *URL:* `?tab=flujo`, `?grafico=<id|todas>` (qué caja dibuja el gráfico).

**Importar** — `/importar` (`ADM/importar/**`, `CA/importar/**`, `lib/imports/ui/**`)
- *Metáfora:* las tres bandejas del escritorio (ARCA, Mercado Pago, banco): cada una dice qué falta traer,
  cuándo fue la última vez y qué quedó esperando.
- *Subir* (`/importar/arca`, `/importar/mercado-pago`, `/importar/banco`): tres pasos a la vista (bajalo de
  allá → subilo acá → revisá) que terminan en el ticket «Llegó esto». → `createImportBatch` +
  `addImportItems` + `buildImportProposals`. La primera vez de Mercado Pago → `saveMercadoPagoImportSettings`;
  la primera vez de un banco («Contame qué es cada columna») → `saveImportLayout`.
- *Revisar* (`/importar/[batchId]`): la pila dibujada hoja por hoja, la ruta corta de lo que falta y, a
  la derecha, el papel en la mano con una pregunta en criollo. «¿Los tenés de antes?» («Sí: es
  {proveedor}» le guarda el CUIT → `saveParty`; «No, es nuevo» → `createImportSuppliers`); las preguntas de
  a una → `resolveImportNeeds`; «Enseñame a reconocerlo» → `saveImportRule` / `deleteImportRule`;
  «Cargar N comprobantes» (de a 15, con su vista previa) → `previewImportProposal` + `postImportProposals`;
  «Descartar este archivo» → `cancelImportBatch`.
- *URL:* `?ver=revisar|listas|cargadas|no-se-cargan|todos`, `?falta=<necesidad>`, `?pagina=`.

**Libros, Plan de cuentas y Fin de mes** — `/libros`, `/libros/cierres`, `/plan-de-cuentas` (`ADM/libros/**`, `ADM/plan-de-cuentas/**`)
- *Metáfora:* cada mes tiene su carátula: se llena sola con lo que cargás, a fin de mes la revisás, le
  ponés el sello «CERRADO» y le mandás los libros a la contadora. Adentro, los libros son la herramienta
  de ella: un índice y hojas densas, sin adornos ni gráficos.
- *Libros* (`/libros?mes=`): la fila de meses (`MonthStrip`) con candado y el mes elegido abierto abajo
  con un título que afirma y un botón; entre libros, el `BookSwitcher` (Diario · Mayor · Sumas y saldos ·
  Subdiarios · IVA compras · IVA ventas · Posición de IVA · Historia) sin perder el mes; «Descargar el
  paquete del mes».
- *Fin de mes* (`/libros/cierres?mes=`): tres pasos a la izquierda (revisar los avisos con su botón cada
  uno · cerrar · mandárselo a la contadora) y la carátula a la derecha. «Cerrar <mes>» → `closePeriod`;
  «⋯ › Reabrir» con motivo → `reopenPeriod`; el ejercicio → `closeFiscalYear` / `reopenFiscalYear`.
- *El IVA del mes* (`/libros/posicion-iva`): un número, una oración y una barra; «Registrar» →
  `generateIvaSettlement`.
- *Sueldos del mes* (`/libros/asiento-manual?tipo=sueldos`) y el asiento manual (`?corrige=<id>` para un
  ajuste) → `postManualEntry`.
- *Plan de cuentas* (`?tab=categorias|plan|sistema`): para el dueño, «Tus categorías» (la lista de «¿En
  qué se gastó?»); para la contadora, el árbol. Agregar, editar, mover o desactivar → `saveAccount`;
  `/plan-de-cuentas/importar` → `importAccounts`; reasignar una cuenta del sistema → `remapSystemAccount`.

**Ficha de un comprobante** — `/comprobantes/[id]` (`ADM/comprobantes/**`)
- *Metáfora:* la factura archivada en el bibliorato, con su sello y lo que tiene abrochado.
- *Muestra, en el orden de las cuatro preguntas:* ¿qué es? (titulado por lo que es: «Compra a …»,
  «Cierre del día martes 06/10») → ¿qué pasó con la plata? (un número, una oración y el botón del
  momento) → ¿con qué está unido y qué le falta? (los hilos: pago, caja, en camino, gasto fijo, foto,
  archivo importado, libros; «Le falta la foto») → ¿cómo lo arreglo? El ticket con su sello a la derecha;
  un cierre del día se ve con `CloseTicket`.
- *Gestos:* «Pagar» → hoja `pagar` con `proveedor` y `partida` (tilda solo esa factura); «Ya llegó» en un
  medio de un cierre → hoja `cobrar`; «Agregar foto o PDF» / «Quitar» → `prepareAttachmentUploads`,
  `registerDocumentAttachments`, `removeDocumentAttachment`; **«Separar»** un pago de su factura (solo
  compras, con motivo; el pago queda a cuenta como saldo a favor) → `unallocateItem`; «Anular» con motivo
  → `voidDocument`; con el mes cerrado, la corrección con fecha de hoy → `reverseDocument` o el asiento de
  ajuste (`/libros/asiento-manual?corrige=`); ARCA: «Verificar con ARCA» → `reconcileArcaVoucher`.
- *Anclas:* `#vinculos`, `#foto`, `#arca`, `#libros`.

**Ajustes y la puesta en marcha** — `/ajustes`, `/configurar` (`ADM/ajustes/**`, `ADM/configurar/**`)
- *Metáfora:* la trastienda del bar: una portada con seis objetos que el dueño reconoce (las llaves, la
  billetera, la columna del cierre, la constancia, el número de la factura y el cable a ARCA) y, aparte,
  el cajón de la contadora (Ejercicio, Integridad).
- *Habitaciones* (`?tab=`): Accesos (`accesos`) · Cajas y cuentas (`cajas`) · Medios de cobro (`medios`;
  `participes` también abre acá) · Datos de la SAS (`sas`) · Puntos de venta (`puntos-de-venta`) · ARCA
  (`arca`; la guía en `/ajustes/arca`) · Ejercicio (`ejercicio`) · Integridad (`integridad`).
- *Gestos:* Datos de la SAS y Ejercicio → `saveSettings`; una caja → `saveTreasuryAccount`; un medio, su
  comisión o el orden de la columna del cierre → `saveSalesMethod`; un partícipe → `saveParty`; un punto de
  venta → `saveSalesPoint`; Accesos → `grantAccountingAccess`, `revokeAccountingAccess`,
  `claimAccountingAdmin`; ARCA → las acciones de `lib/arca/actions.ts` (sin cambios).
- *Puesta en marcha* (`/configurar`): bienvenida + pasos con riel (la SAS, las cajas, los cobros, los
  puntos de venta, revisá y arrancá) que preguntan «¿Desde qué día querés cargar?» («Todo lo anterior a
  ese día no se carga acá»), un solo guardado → `bootstrapAccounting`; después, los saldos iniciales («lo
  que había en cada caja al arrancar» y lo que se debía, con «Pegar la lista de mi planilla») →
  `postOpening` (los proveedores que faltan → `ensureSuppliers`) o «Arrancar en cero» → `skipOpening`.
  Enter en un campo no guarda.
- *La puerta* (`ADM/_components/gate-screens.tsx`): quien no tiene acceso ve un cartel con «Copiar el
  mensaje para pedirlo».

---

## 5. El vocabulario de la sección

El mismo concepto se ve y se llama igual en todas las pantallas:

| Concepto | Cómo se dice y se ve |
|---|---|
| Con factura / sin factura | Las dos palabras de siempre y «Con factura o sin factura, todo queda registrado en los libros.». Con factura `bg-adm-s1`, sin factura `bg-adm-s4`, sin definir `bg-adm-neutral` (constantes en `palette.ts`). Ninguno es alarma. |
| Los cuatro papeles | «Factura A · Factura B o C · Tique · Remito o nada», con `PaperChoices`; ninguno marcado cuando no se sabe. |
| Los sellos | Qué papel es (`voucherStamp()`) o un acto terminado («CARGADO», «CERRADO»). Nunca un estado de pago. |
| Lo que debés | «Le debés a proveedores». Tramos: «Vencido» · «Vence esta semana» · «Más adelante», siempre con palabra. |
| Lo que te deben | «Ya tendría que haber llegado» · «Llega esta semana» · «Más adelante» · «En Mercado Pago, falta contarla». |
| En camino | Lo vendido con QR, tarjeta o app que todavía no entró. La plata «entra», «llega», «te la depositan»; nunca «se acredita». |
| Contar la caja | Una sola palabra para efectivo, banco, billetera y tarjeta. Hoja «¿Coincide la caja?»; en listas, «Conteo de {caja}». |
| Otra entrada o salida | La hoja `movimiento`; en listas, «Otra salida» / «Otra entrada». |
| El margen de un renglón | `LedgerRail`: desde cuándo o para cuándo, nunca un importe. |
| Elegir una caja | `TreasuryPicker` y «Caja: hoy $ X → queda $ Y». |
| La categoría | «¿En qué se gastó?» (un gasto que ya pasó) · «¿En qué le comprás a {proveedor}?» · «¿En qué se gasta?» (un gasto fijo). El grupo de bienes es «Equipos y muebles». |
| Una caja | `WalletCard`, con el color de su tipo. Una caja que se agrega después de arrancar «Arranca en $ 0.». |
| Los meses | `MonthStrip`: «Cerrado» con candado, «Falta cerrar», «En curso», «Abierto», «No empezó». |
| El papel | `Ticket` = lo que se cobra, se paga o se cierra (también la carátula del mes). `PaperSheet` = un documento. |
| La fecha de arranque | Un piso: nada anterior se carga. «¿Desde qué día querés cargar?». |
| Sueldos | «Sueldos del mes», en Libros. |

**Nombres que cambiaron** (los ids, claves de URL y anclas internas no cambiaron):

| Antes | Ahora |
|---|---|
| Ajustar saldo | Contar la caja (hoja «¿Coincide la caja?») |
| Por acreditar / a acreditar · «te acreditaron» | En camino · «te entró» |
| Ver asiento · Asiento que se va a generar | Ver cómo queda en los libros (abierto: «Ocultar cómo queda en los libros») |
| ¿Se factura? Sí / No | ¿Qué papel te dieron? (los cuatro papeles) |
| Sin comprobante / Remito u otro | Sin factura (remito o nada) |
| Cuenta / imputación / ¿En qué gastaste? | ¿En qué se gastó? (la categoría; el nombre contable va en gris) |
| Nueva factura · Cargar factura · Factura de proveedor · Nueva compra | Cargar una compra que debo |
| Clientes y plataformas | Plata por cobrar |
| Salteado (gasto fijo) | Este mes no se paga |
| Necesita atención | Avisos |
| Cierres de mes · Libros › Cierres | Fin de mes |
| Otro ingreso o egreso | Otra entrada o salida |
| Ajustes › Plataformas · Ajustes › Partícipes | Ajustes › Medios de cobro |
| Ajustes › Cajas y bancos | Ajustes › Cajas y cuentas |
| Libros › Asiento manual (para sueldos) | Libros › Sueldos del mes |
| Cosas que quedan en el bar | Equipos y muebles |
| Llega en los próximos 7 días | Llega esta semana |
| Aplicar ahora (saldo a favor) | Usarlo ahora |
| Tiene pagos aplicados | Tiene pagos unidos |
| ¿Desde qué fecha llevás las cuentas acá? | ¿Desde qué día querés cargar? |
| Cargar lo que hay | Cargar lo que había |
| Sello «COBRADA / A COBRAR» | Un `StatusPill` (el sello dice qué papel es) |
| Sin importes (vista previa del asiento) | Falta algo |

Restos conocidos con la palabra vieja, fuera de alcance: el mensaje de zod «…registrala con «Ajustar
saldo».» (`lib/accounting/schemas.ts`), las descripciones del plan estándar en `lib/accounting/chart.ts`
y tres rótulos de ⌘K (ver §7).

---

## 6. Smoke manual

**Cómo se ejecutó en esta sesión.** La base de desarrollo es la de producción: se navegó el bar de ejemplo
(`/demo-administracion/administracion`) con Chrome sin interfaz, se abrieron las hojas y se tipeó en los
campos, **sin tocar nunca un botón que guarde**. Lo de «después de guardar» queda para ejecutar con un
socio y con la contadora, cada uno con su usuario. Leyenda: **Navegado** = se abrió y se llenó hasta el
botón final; **Pendiente** = no se ejecutó.

1. **Cerrar el día.** *(Navegado hasta guardar.)* Ventas › «Cargar el cierre del <día>» (o el casillero
   punteado del almanaque) → cargar efectivo, Mercado Pago, débito, crédito y una app → el ticket suma lo
   mismo que los campos; «Con factura / Sin factura» cuadra; «¿Contaste el efectivo?» dice «Coincide» o
   la diferencia. *Pendiente:* «Guardar cierre del <día>» → el casillero de esa noche se llena con su
   importe, «Faltan N cierres» baja y al tocar la noche aparece su ticket, igual al que se armó.
2. **Cargar un gasto con cada papel.** *(Navegado con Factura A y con Remito o nada; Factura B o C y Tique,
   pendientes.)* «＋ Cargar» › «Pagué algo recién» → importe, categoría, caja → cada uno de los cuatro
   papeles → el ticket chico muestra el sello correcto y «hoy $ X → queda $ Y». *Pendiente:* guardar con
   cada papel → la caja baja lo que decía el ticket; la ficha del comprobante tiene el mismo sello.
3. **Cargar una compra que debo y pagarla.** *(Navegado: la compra con el ticket lleno, la hoja «Pagar»
   paso 1 y 2, «Pagar» desde la ficha con una sola factura tildada.)* `/compras/nueva` → proveedor, papel,
   total, «En 7 días» → el ticket dice «Le vas a deber $ X · vence el …». *Pendiente:* «Cargar compra» →
   el proveedor aparece en la libreta con «vence en 7 días»; [Pagar] en su renglón → «Pagar $ X» → la
   deuda baja y la ficha de la compra muestra el pago unido; «Separar» lo devuelve a «Le debés».
4. **Pagar un gasto fijo.** *(Navegado: «Pagar» abre «Nuevo gasto» con el gasto fijo, el monto, la
   categoría, la caja y el papel puestos.)* *Pendiente:* guardar → el casillero se tilda dibujándose, el
   renglón dice «Pagado el …», «Te falta de gasto fijo» baja y «Lo que sigue» nombra el próximo; pagar por
   otro monto → «¿Era eso?».
5. **Mover plata y contar la caja.** *(Navegado: «Mover plata» llena, «¿Coincide la caja?» con un faltante,
   «Otra entrada o salida».)* *Pendiente:* «Mover $ X» → cambian las dos tarjetas y aparece en «Últimos
   movimientos»; contar con diferencia → «Guardar la diferencia» → la tarjeta dice «Contada hoy» y la
   ficha «Faltaron $ X al contar»; «Sí, coincide» solo guarda la fecha.
6. **Importar de ARCA y revisar.** *(Navegado: las bandejas, la pantalla de subir de ARCA, Mercado Pago y
   banco sin subir nada, y la revisión de archivos ya subidos en el bar de ejemplo, con el selector de
   categoría y un comprobante con otros impuestos.)* *Pendiente:* subir el ZIP de Mis Comprobantes → el
   ticket «Llegó esto» → «¿Los tenés de antes?» → «Guardar las respuestas» → las preguntas de a una →
   «Cargar N comprobantes» → sello «CARGADO»; cada compra cargada tiene su ficha.
7. **Cerrar el mes.** *(Navegado: Fin de mes de septiembre con sus tres pasos, en claro y en oscuro.)*
   *Pendiente:* resolver los avisos del paso 1 → «Cerrar <mes>» → confirmar → la carátula recibe el sello
   «CERRADO» y la pestaña del mes el candado; «⋯ › Reabrir» con motivo lo deshace; «Descargar el paquete».
8. **Puesta en marcha de un bar nuevo.** *(Pendiente. El bar de ejemplo ya está configurado; los saldos
   iniciales de un bar recién arrancado se vieron solo dibujados con los datos de HUB.)* Bar sin
   configurar → bienvenida → los pasos con «¿Desde qué día querés cargar?» → Enter en un campo no guarda →
   «Revisá y arrancá» guarda una sola vez → saldos iniciales con «Pegar la lista de mi planilla» →
   «Guardar los saldos iniciales» → el Resumen deja de decir «Todavía no sé cuánta plata hay».
9. **La vista de la contadora.** *(Pendiente: no hay usuario de prueba de solo lectura; lo cubren los
   tests de render de cada área.)* Entra con su usuario → ve Resumen, Ventas, Compras, Gastos fijos, Cajas,
   Libros, Fin de mes y Plan de cuentas → ningún «＋ Cargar», ningún botón que guarde, el `ReadOnlyBadge` en
   cada encabezado; en Libros descarga el paquete de un mes y cambia de libro sin perder el mes.

Los happy paths quedan listados para Playwright cuando se sume (CLAUDE.md §10).

---

## 7. Lo que espera una decisión del dueño

Mientras no conteste, queda lo que dice «hoy». Cada una dice dónde se cambia.

| Duda | Hoy | La alternativa y dónde se prende |
|---|---|---|
| Rótulos de ⌘K | «Otro ingreso o egreso», «Clientes y plataformas», «Cierres de mes» | «Otra entrada o salida», «Plata por cobrar», «Fin de mes»: tres `label` en `components/command-palette/command-config.ts` (fuera de la sección: necesita su sí). |
| Valores por defecto de la compra | Sin plazo vence el mismo día (figura vencida al otro día); sin saber cómo factura se propone «Tique» | Que no venga ninguna fecha ni papel marcado y se pregunte «¿Cómo te factura?» una vez: `ASK_WHEN_UNKNOWN = true` en `ADM/compras/_lib/purchase-paper.ts` (único lugar). |
| «Sí: es {proveedor}» al importar | Prendido: le guarda el CUIT a un proveedor ya cargado | `LINK_KNOWN_SUPPLIERS = false` en `lib/imports/ui/similar.ts` lo apaga. |
| La categoría sugerida al importar | Sugerida, pero no viene elegida: hay que tocarla | Regla del `CategoryPicker` (la sugerida nunca se elige sola). Cambiarla es tocar la pieza del kit. |
| «Pago en blanco / Pago en negro» en el detalle de sueldos | Así lo pidieron los socios el 09/10; choca con la regla de vocabulario | «Con recibo de sueldo / Sin recibo»: dos rótulos en `lib/accounting/party-profile.ts`. |
| El panel del Resumen | Verde bosque | Crema: `?hero=crema` para verlo (`ADM/page.tsx`); se saca el parámetro cuando elija. La tapa del proveedor igual con `?tapa=crema` (`ADM/compras/proveedores/[id]/page.tsx`). |
| «¿Contaste el efectivo?» en el cierre | A la vista (antes, escondido) | Plegarlo es un cambio en `ADM/ventas/cierre/_components/sales-close-form.tsx`. |
| «Descubierto» para una caja de efectivo en negativo | La misma palabra en toda la sección | Otra palabra: `treasuryMoneyText` en `CA/acciones/gasto-papel.ts` y los textos que la repiten (buscar «Descubierto»). |
| El botón de los saldos iniciales | «Cargar lo que había» (antes «lo que hay hoy», que contradecía a `/configurar`) | Los textos viven en `lib/accounting/home.ts` y en las pantallas de Cajas. |
| La tapa de Compras y pagos en el celular | Muestra los tres tramos y el primer proveedor queda abajo del pliegue | Plegar los tramos detrás de «¿Cómo se calcula?» (`ADM/compras/_components/libreta-hero.tsx`). |
| «Separar» con el mes cerrado | Se puede | Bloquearlo en `canSeparate` (`ADM/comprobantes/_lib/document-story.ts`). |
| Las cajas con «$ 0» mientras faltan los saldos iniciales | `TreasuryPicker` muestra el saldo de cada caja | No mostrar número: el catálogo de cajas tendría que traer el estado de los saldos iniciales. |
| «Gastos del banco» cuando el total no coincide con el resumen | No deja guardar | Avisar y dejar guardar (`ADM/cajas/gasto-bancario/_lib/bank-rows.ts` y `bank-expense-form.tsx`). |
| El subdiario de ventas | Diez columnas: no entra entero a 1440 px | Preguntarle a la contadora si le sirve la fecha sin el año o sacar la referencia interna. |
| El mes de Ventas con objetivo | Nadie lo vio con datos reales | Cargar el objetivo de un mes y mirarlo juntos. |
| Sueldos | La planilla de gastos fijos los lista; los números del mes van en «Sueldos del mes» | No pagar sueldos desde la planilla hasta que la contadora diga por dónde. |
| El resultado del ejercicio | La descripción de la cuenta dice «ganancia (o la pérdida)» (`lib/accounting/chart.ts`, espejo de una migración del seed) | «Resultado del ejercicio (positivo / negativo)»: necesita migración del seed. |
| Cuánto se muestra de «sin factura» | El porcentaje grande arriba de Comprobantes, «Le falta la foto» como título, «¿Era «Alquiler»?» | Si molesta, el porcentaje queda solo como filtro. |
| La fecha de arranque del bar real | Trabada en Ajustes porque ya hay comprobantes | Decidir con la contadora si queda o se corre al 1 del mes: correrla hacia atrás necesita tocar la base (§8). |
| Los dibujos más jugados | Los anillos del almanaque, las tapas, las llaves, la constancia, el cartel de la puerta, el cable de ARCA | Si alguno no se entiende en tres segundos, se cambia por su ícono y la pantalla funciona igual. |

---

## 8. Lo que no se construyó (necesita migración o lógica nueva)

Se construyó la versión sin migración de cada idea. El detalle está en `BACKLOG.md`.

- **Gasto fijo ↔ comprobante:** vincular DESPUÉS de guardado; que anular o deshacer el pago devuelva el
  vencimiento; el historial por mes y el papel de cada pago; la marca de monto «estimado»; guardar varios
  de una vez; «a nombre de quién se factura»; una categoría de sueldos elegible.
- **Compras:** cambiar el vencimiento de una compra ya cargada; los vencimientos por día de todos los
  proveedores; el clip «sin foto» en la lista. (Abrir «Pagar» con esa factura tildada quedó resuelto con
  `?partida=`.)
- **Ventas y Cajas:** lo facturado por noche; que el cierre guarde el conteo de efectivo aunque coincida;
  todas las partidas por cobrar en una lectura; la racha y los billetes del conteo; la proyección con lo
  que se espera vender; abrir los movimientos de una categoría.
- **Importar:** cerrar de verdad un archivo sin pendientes; «es este comprobante» (unir a mano); buscar
  adentro de un archivo.
- **Libros:** «ya se lo mandé a la contadora»; el paquete del mes en un .zip; «ese día no abrimos»; saber
  si los sueldos se cargaron; notas para la contadora.
- **Ajustes:** correr la fecha de arranque hacia atrás mientras no haya meses cerrados ni saldos iniciales
  asentados; el borrador de la puesta en marcha en la base; reabrir los saldos iniciales; reordenar los
  medios en un solo guardado; un interruptor único para una app de delivery; una comisión distinta para
  QR y transferencia; decir «no facturamos».

---

## 9. Cómo se verificó

- **En verde** al cerrar el pulido: `npm run typecheck`, `npm run lint` (Biome) y `npm run test:ci`.
- **Un constructor por área** con su pantalla, sus tests y su tabla de rótulos; **un auditor por área**
  que no la escribió comparó, formulario por formulario, lo que se manda al servidor contra el código
  anterior, y revisó los permisos de la contadora y las reglas de §2.
- **Un crítico independiente por área** sobre capturas reales del bar de ejemplo (compu 1440 y celular
  390, claro y oscuro, hojas y diálogos abiertos, y la primera pantalla de cada vista), y una ronda de
  arreglos con nuevas capturas.
- **El estado vacío** se dibujó con los datos de HUB (un bar recién arrancado), en arneses aparte con el
  CSS real, porque la base es producción y no se puede vaciar un bar.
- **Cierre técnico:** auditoría de lo agregado contra `main` (ningún `any`, `@ts-ignore`, `bg-[--`,
  `Intl.NumberFormat`, `toLocaleString`, `service_role`, «ganancia» ni «ganaste»; `components/ui`,
  `components/shell`, `supabase/**` y los valores de `globals.css` sin cambios), los 120 rótulos que cita
  la guía comprobados contra el código, y una tanda final de capturas sin errores de consola.

**Lo que nadie vio en pantalla:**

- La sesión de la contadora (no hay usuario de prueba de solo lectura).
- Safari de escritorio e iOS real: el globito de costado, los cortes por `@container`, las máscaras de la
  barra y de los diálogos, el área segura del flotante y el teclado sobre la barra del cierre.
- Las animaciones (las capturas van con movimiento reducido): el número que cuenta, el sellazo, el tilde
  que se dibuja.
- Todo lo que pasa después de guardar: errores del servidor, avisos confirmables, «Deshacer», «Cargado».
- Un mes CERRADO, un mes de Ventas CON objetivos en la base real, y el estado real de HUB con la sesión de
  un socio (solo se vio en los arneses del vacío).

**Pendientes chicos conocidos** (anotados en `BACKLOG.md`): la leyenda de `SplitBar` no sigue el ancho de
la barra; el flotante tapa lo que queda abajo a la derecha en el celular; la etiqueta «Más bajo» de
`BalanceArea` pisa la línea en el celular; un renglón compacto de `LedgerRow` para el celular; la barra sin
píldora marcada en `/comprobantes/[id]`, `/asientos/[id]` y `/configurar`; el foco de teclado dentro de la
ficha de un comprobante; «useAccounting: falta <AccountingProvider>» tras una recarga en caliente; un
timeout en `acc_report_open_items`; y otros de aspecto, listados ahí.
