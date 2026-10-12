# Proveedores, gastos fijos y cierre del día (pedidos de los socios, 09/10/2026)

Las correcciones que mandaron los socios de HUB después de recorrer el bar demo. Todo vive en
Administración.

## Qué cambió

**Proveedores** (`compras/proveedores/[id]`, pestaña Datos):
- La ficha suma **contactos** (hasta 10: nombre, qué hace, teléfono, email), **días de entrega**
  (lunes a domingo), **anticipación del pedido** (días) y **observaciones**.
- «Plazo de pago» pasa a llamarse **«Días de cuenta corriente»**: es lo que calcula el vencimiento de
  cada boleta (ya lo hacía).
- **Eliminar** y **desactivar**: solo con la cuenta corriente en cero (deuda y saldo a favor). Eliminar
  es para el que nunca tuvo movimientos; el que ya tiene comprobantes se desactiva (la base lo frena
  con `party_has_history`). La regla vive en la base: `private.acc_party_open_cents` usa las mismas
  cuentas que `acc_report_party_balances`.
- **Editar** queda libre aun con saldo: si se trabara, no se podría completar el CUIT de un proveedor
  cargado rápido al que ya se le debe. Es fácil de cambiar si lo piden.
- **Cargar una lista** (pestaña Proveedores): se pega un nombre por renglón y se cargan todos
  (`acc_create_parties_bulk`). Los que ya están no se repiten.

**Gastos fijos** (`compras?tab=gastos-fijos`):
- **En cuotas**: «¿Termina? · Sí, es en cuotas · Faltan N». Se guarda el último vencimiento
  (`ends_on`); cuando el próximo pasa ese mes, el trigger `acc_recurring_expenses_auto_end` lo apaga y
  la lista dice «Terminó».
- **Detalle** (pensado para los sueldos): renglones de empleado, concepto (aporte, contribución, pago
  en blanco, pago en negro o sin detallar) y monto. El monto del gasto fijo es la suma.
- **Eliminar**: si nunca se cargó, se borra; si ya tiene comprobantes, se archiva (`archived_at`): sale
  de la lista y los comprobantes quedan. El nombre se puede volver a usar.
- **Cargar una lista**: se pegan los nombres, se revisa la cuenta de cada uno (la propone por el
  nombre) y se cargan con el mismo día de vencimiento, con monto variable.

**Nuevo gasto**: «¿En qué?» trae también los gastos fijos activos (los pendientes del mes como chips;
todos en el buscador). Al elegir uno precarga monto, cuenta, proveedor, comprobante y caja, y al
guardar queda «Cargado» y avanza su vencimiento.

**Ventas › cierre del día**: «Completar con Mercado Pago» lee el reporte (Liquidaciones o Todas las
transacciones) en el navegador y completa QR y Transferencia de ese día. No se sube nada.

**Importar › Compras desde ARCA**: el aviso de «otra CUIT» muestra las dos CUIT y lleva a Ajustes ›
Datos de la SAS.

## Base de datos

- `20261009120000_acc_proveedores_gastos_fijos.sql`: columnas, trigger de cuotas,
  `acc_party_open_cents` y `acc_party_save` (misma firma).
- `20261009120010_acc_proveedores_gastos_fijos_rpc.sql`: `acc_save_recurring_expense` (misma firma),
  `acc_delete_party`, `acc_create_parties_bulk`, `acc_create_recurring_bulk`,
  `acc_delete_recurring_expense`.
- Aplicadas en producción el 09/10/2026 con el «sí» de Nacho; md5 verificado; detectores en 0.

## Para tener en cuenta

- **Sueldos**: la cuenta «Sueldos y jornales» no se puede elegir para un gasto fijo ni para «Nuevo
  gasto» (es de sistema). Los sueldos se registran con el asiento de sueldos; el gasto fijo «Sueldos
  personal» sirve de recordatorio y de detalle.
- HUB todavía no tiene Administración configurada: las listas de proveedores y gastos fijos se cargan
  con «Cargar una lista» cuando termine el Configurar.

## Smoke manual

1. Proveedores › Cargar una lista: pegar 3 nombres (uno repetido y uno que ya existe) → «se cargaron 1»
   y avisa los otros.
2. Ficha de un proveedor sin movimientos → Editar datos: contactos, días y anticipación → se ven en
   Datos. Eliminar → vuelve a la lista sin él.
3. Proveedor con deuda → Desactivar / Eliminar → explica que tiene saldo y no deja.
4. Gastos fijos › Nuevo: «Sí, es en cuotas · Faltan 3» → «quedan 3 cuotas» en la lista. Detallar el
   monto con dos empleados → el monto es la suma.
5. Nuevo gasto → «¿En qué?» → elegir un gasto fijo pendiente → guardar → en la lista queda «Cargado».
6. Ventas › Cierre del día → Completar con Mercado Pago con un reporte de Liquidaciones.

## Addendum 12/10/2026 — Puesta en marcha de HUB

Los socios configuraron Administración en HUB y pasaron tres cosas.

**Un Enter cerró la puesta en marcha a medias.** En el paso «Cajas», cargando las comisiones, un Enter
en un campo envió el formulario: la configuración quedó guardada con lo que había (sin CUIT, sin banco,
sin puntos de venta) y la pantalla pasó sola a los saldos iniciales. No se perdió nada y todo se
completa en Ajustes, pero no tenía que pasar.

- En el último paso del asistente y en los saldos iniciales, Enter en un campo ya no guarda: se guarda
  con el botón (`isImplicitSubmit`, en `configurar/_lib/wizard.ts`). El primer paso sigue igual (Enter
  pasa al siguiente y no guarda nada).

**Saldos iniciales con todos los proveedores.** En «Deudas con proveedores» hay un «Cargar una lista»:
se pega desde la planilla el proveedor y lo que se le debía (y, si están, el vencimiento y el
comprobante) y quedan como renglones del formulario, para revisarlos antes de guardar.

- La primera columna es el proveedor; de las demás, el primer número es el monto, la fecha es el
  vencimiento y el primer texto es el comprobante. Sin columnas, el monto es lo último del renglón.
- Se saltean el encabezado, los totales y los saldos en cero. Se avisan los que no tienen un monto que
  se entienda y los que vienen con saldo a favor.
- El proveedor se busca por nombre (o nombre de fantasía), sin mirar mayúsculas ni tildes. Los que no
  están se crean (`ensureSuppliers`, sobre `acc_create_parties_bulk`). El tope sigue siendo 200 deudas.
- Nada de base de datos nuevo.

**Comisiones y retenciones: qué se carga y sobre qué.** Dos confusiones de los socios, aclaradas en
Ajustes › Plataformas y organismos y en el asistente:

- Cada porcentaje (comisión, retenciones) se calcula **sobre lo cobrado**. El IVA de la comisión (21 %)
  lo calcula el sistema y no va en «Retención de IVA». Una percepción de IVA sobre la comisión se carga
  al registrar cada liquidación («Percepción de IVA de la comisión»), con el monto que diga.
- El QR de Mercado Pago tiene una comisión distinta según cómo paga el cliente (dinero en cuenta,
  débito, crédito). El porcentaje de Ajustes es solo un estimado para precargar: la comisión real de
  cada cobro sale del reporte de Mercado Pago (`MP_FEE_AMOUNT`) o del arqueo de la billetera.

### Smoke manual

1. Configurar › paso «Cajas»: escribir una comisión y apretar Enter → no pasa nada; «Guardar y seguir»
   guarda.
2. Saldos iniciales › Cargar una lista: pegar tres renglones (un proveedor cargado, uno nuevo, uno en
   cero) → «2 deudas por $ …», avisa el que se crea y el que está en cero; al cargar quedan dos
   renglones con su proveedor y su monto.
3. En un monto de los saldos, Enter → no guarda.
