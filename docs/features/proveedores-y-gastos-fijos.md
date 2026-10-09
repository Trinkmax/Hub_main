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
