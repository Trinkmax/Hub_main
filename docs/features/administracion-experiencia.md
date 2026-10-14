# Administración: rediseño de la experiencia (octubre 2026)

Pedido del dueño (13/10/2026): mejorar toda la sección Administración a nivel experiencia de usuario,
con pantallas que acompañen, gráficos, todo «como un paso a paso», y un instructivo guiado y visual
que explique qué se factura y qué no, y cómo se vincula cada cosa. La UI anterior no le gustaba; el
permiso vale **solo para `/administracion`** (no reabre el kit global rechazado el 07/10).

Idea rectora: cada pantalla tiene forma de un objeto real (el ticket del cierre, la libreta del
proveedor, la planilla de gastos fijos, la billetera, el almanaque del mes, la carátula del mes, el
papel archivado), un **número héroe** en Fraunces con una oración que lo explica y «¿Cómo se
calcula?», y **la acción del momento** grande al lado del dato. El estado vacío es el diseño: el bar
real recién arranca.

## Reglas que no se negocian

- **Alcance**: solo la sección. `components/ui/*`, `components/shell/*` y los valores de tokens
  existentes de `app/globals.css` no se tocan; los tokens nuevos son `--adm-*` y van **agregados** al
  final de `globals.css`. `components/command-palette/command-config.ts` solo suma las tres entradas de
  la guía y renombra dos rótulos de Administración («Contar la caja», «Cargar una compra que debo»).
- **La lógica contable no se toca**: motor de asientos, zod, `usePosting` / `useDocumentPosting`,
  vista previa con hash, `clientRef`, avisos confirmables, permisos, el contrato `?accion=` y las URLs
  como estado. Cada formulario manda **exactamente** lo mismo que antes (lo auditó un agente por área
  contra el código anterior, formulario por formulario).
- **Sin migraciones.** La única lectura nueva es `lib/accounting/queries/document-origin.ts` (dos
  `select` bajo las políticas existentes).
- **Un solo libro**: «sin factura» es `voucher_type = 'sin_comprobante'` y queda registrado igual.
  Nunca «en negro / en blanco», nunca «ganancia / ganaste» en un texto nuevo.
- **La contadora solo mira**: no ve ningún botón de carga. Cada control que escribe tiene su guarda
  (`readOnly` / `canWrite`) y un test de render.
- Plata con `lib/money` y `Amount`, pesos sin centavos salvo en tickets, campos y lo de la contadora.
  Tailwind v4 con `bg-(--x)`. Foco visible. Claro y oscuro a la par.

## Dónde vive

| Qué | Dónde |
|---|---|
| Piezas (número héroe, panel, píldoras, ticket, sello, paso a paso, renglón de libreta, tarjeta de caja, papel, selector de categoría, vistas, error de un bloque) | `components/administracion/kit/**` (barril `kit/index.ts`) |
| Gráficos dibujados a mano (barras por día, entró / salió, barra partida, área de saldo, tira de meses, ranking) | `components/administracion/charts/**` |
| Barra de la sección, «Más», lanzador «¿Qué querés cargar?» y botón flotante «＋ Cargar» | `components/administracion/nav/**` |
| Piezas compartidas de las hojas (`TreasuryPicker`, `sheet-parts`, `voucherStamp`) | `components/administracion/{treasury-picker.tsx,voucher-stamp.ts,acciones/sheet-parts.tsx}` |
| Cuentas puras del Resumen | `lib/accounting/home.ts` (+ `queries/home.ts`) |
| Contenido de la guía (recetas, papeles, vínculos, rótulos citados) | `lib/accounting/guides.ts`; maquetas en `components/administracion/guias/uso/` |

## Pantalla por pantalla

| Pantalla | Ruta | La forma | Qué cambia para el dueño |
|---|---|---|---|
| Resumen | `/administracion` (`?hero=crema` para la variante clara) | panel verde con la plata de hoy | cuánta plata hay y dónde; «Hoy te toca» en orden; el mes; lo que tenés que pagar; entró y salió; en qué se va la plata |
| Cierre del día | `/ventas/cierre` | el ticket que se arma en vivo | pasos numerados; con factura y sin factura siempre a la vista; cuándo entra cada cosa |
| Nuevo gasto | `?accion=gasto` | «¿Qué papel te dieron?» | cuatro tarjetas (Factura A · Factura B o C · Tique · Remito o nada) que escriben los mismos valores que antes |
| Guía | `/guias` + `dia-a-dia`, `con-y-sin-factura`, `como-se-vincula`, `como-arrancar` | mapa de cinco paradas | recetas paso a paso con la pantalla al lado, los cuatro papeles, cada vínculo y cómo se deshace |
| Ventas | `/ventas` (los siete `?tab=` viejos siguen andando) | el almanaque del mes | cuatro vistas: El mes · Plata por cobrar · Lo que llegó · Facturas; «Armar el objetivo»; «Factura aparte» |
| Compras y pagos | `/compras` (`?tab=` proveedores · comprobantes · pagos) | la libreta del proveedor | lo vencido primero; «Cargar una compra que debo» en cuatro preguntas; la hoja de cada proveedor; «Pagar» desde «¿A quién le pagás?» |
| Gastos fijos | `/gastos-fijos` (`?mes=`, `?abrir=`), `/gastos-fijos/completar` | la planilla | «Te falta de gasto fijo», «Lo que sigue», un renglón por gasto con su día; montos de corrido o pegados; «¿Era eso?» |
| Cajas y bancos | `/cajas` (`?tab=flujo`), `/cajas/[id]`, `/cajas/gasto-bancario` | la billetera | una tarjeta por caja con el color de su tipo (igual que el Resumen); «Contar la caja»; cómo se movió la plata |
| Importar | `/importar`, `/importar/{arca,mercado-pago,banco}`, `/importar/[batchId]` | las bandejas | qué falta traer de cada origen; subir en tres pasos; revisar con preguntas de a una |
| Libros y Fin de mes | `/libros`, `/libros/cierres` («Fin de mes»), `/libros/posicion-iva`, `/libros/asiento-manual?tipo=sueldos`, `/plan-de-cuentas` | la carátula del mes | cerrar en tres pasos; el IVA contado para un socio; «Sueldos del mes»; el plan abre en «Tus categorías» |
| Ficha de un comprobante | `/comprobantes/[id]` | el papel archivado con su sello | el mapa de lo que tiene unido (pago, caja, en camino, gasto fijo, foto, archivo importado, libro); «Separar» un pago de su factura |
| Ajustes y puesta en marcha | `/ajustes` (las nueve claves de `?tab=` siguen), `/configurar` | portada de seis objetos | «Medios de cobro» junta medios y plataformas; la puesta en marcha es bienvenida + cinco pasos y pregunta «¿Desde qué día querés cargar?» |

## Vocabulario de la sección

«Con factura / sin factura» (y «Con factura o sin factura, todo queda registrado en los libros») ·
los cuatro papeles · **contar la caja** (en lugar de «ajustar saldo»; la hoja se titula «¿Coincide la
caja?») · **en camino** (lo vendido con QR, tarjeta o app que todavía no entró; la plata «entra» o
«llega», nunca «se acredita») · **categoría** («¿En qué se gastó?») · «Le debés a proveedores» y sus
tramos (Vencido · Vence esta semana · Más adelante) · **Fin de mes** (antes «Cierres de mes») ·
«Otra entrada o salida» · «Sueldos del mes» · «Equipos y muebles».

## Lo que espera una decisión del dueño

- Rótulos de ⌘K que faltan: «Otro ingreso o egreso», «Clientes y plataformas», «Cierres de mes».
- Dos valores por defecto de la compra (sin plazo vence el mismo día; sin saber cómo factura se propone
  «Tique»): quedaron como antes; la alternativa está apagada a una constante de distancia en
  `compras/_lib`.
- «Pago en blanco / Pago en negro» del detalle de sueldos (`lib/accounting/party-profile.ts`):
  propuesta «Con recibo de sueldo / Sin recibo».
- El panel del Resumen en verde (por defecto) o crema; «¿Contaste el efectivo?» abierto o plegado.

## Lo que necesita migración (no se construyó)

Vincular un gasto fijo a un comprobante después de guardado y que anular devuelva el vencimiento;
cambiar el vencimiento de una compra ya cargada; que el cierre guarde el conteo de efectivo aunque
coincida; cerrar de verdad un archivo importado sin pendientes; «ya se lo mandé a la contadora»;
correr la fecha de arranque hacia atrás desde Ajustes mientras no haya meses cerrados. Detalle en
`BACKLOG.md`.

## Cómo se verificó

- `npm run typecheck`, `npm run lint`, `npm run test:ci` y `npm run build` en verde.
- Un crítico independiente por pantalla sobre capturas reales (compu 1440 y celular 390, claro y
  oscuro) con el bar de ejemplo; el estado vacío se dibujó aparte con los datos de HUB.
- Un auditor por área comparó contra el código anterior lo que cada formulario manda al guardar.

**Nadie vio en pantalla**: la vista de la contadora con su usuario, Safari de escritorio e iOS, y lo
que pasa después de apretar un botón que guarda (la base de desarrollo es la de producción).

## Smoke manual (pendiente con un socio y con la contadora)

1. **Cerrar el día** (Ventas › Cierre del día): cargar efectivo, Mercado Pago, débito, crédito y una
   app → el ticket suma lo mismo que los campos; «Con factura / Sin factura» cuadra; guardar → aparece
   en el almanaque de Ventas con su noche.
2. **Nuevo gasto** con cada papel (Factura A, B o C, Tique, Remito o nada) → el ticket chico dice el
   sello correcto; guardar → la caja baja lo que dice «hoy $ X → queda $ Y».
3. **Cargar una compra que debo** → queda en la libreta del proveedor como deuda; **Pagar** desde su
   renglón → la deuda baja y el pago queda unido a la compra (ficha del comprobante › vínculos).
4. **Pagar un gasto fijo** desde su renglón en Gastos fijos → el renglón queda tildado y el
   vencimiento pasa al mes siguiente.
5. **Mover plata** entre dos cajas y **Contar la caja** con una diferencia → el veredicto lo dice y la
   diferencia queda registrada.
6. **Importar** un archivo de ARCA y revisarlo → las preguntas se contestan de a una; «Cargar»
   carga lo que mostró el ticket.
7. **Fin de mes**: revisar los avisos y cerrar el mes → el mes queda «Cerrado» en la tira.
8. **Puesta en marcha** de un bar nuevo → un Enter no la cierra; se guarda una sola vez al final.
9. **La contadora** entra con su usuario → ve todo y ningún botón de carga.
