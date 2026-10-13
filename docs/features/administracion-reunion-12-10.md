# Administración: lo que pidieron los socios en la reunión del 12/10/2026

Los pedidos ordenados están en `~/Downloads/HUB_reunion_2026-10-12.md` (fuera del repo). Acá va lo que
se construyó, las decisiones y cómo probarlo.

## Qué cambió

**Carga de un gasto o una compra**
- La cuenta sale del proveedor. Si tiene «Cuenta habitual», «Nuevo gasto» y «Nueva factura» no preguntan
  en qué se gastó: muestran «Va a «…»» con un «Cambiar» que vale solo para esa carga. Si no la tiene, se
  pregunta una vez y queda guardada («Usar siempre para …», tildado).
- «¿Se factura?» Sí o No, antes del tipo de comprobante. Sí: Tique, Factura A, Factura B o C. No: «Remito
  u otro». Arranca en lo que diga el «Comprobante habitual» de la ficha y se puede cambiar en cada carga.
- «Sin comprobante» ya no se ofrece con ese nombre: el mismo dato (`sin_comprobante`) ahora se llama
  «Remito u otro comprobante (sin factura)». No cambió nada de cómo se registra.
- Foto del comprobante: hasta 5 fotos o PDF (10 MB cada uno) al cargar un gasto o una compra, y también
  después, desde la pantalla del comprobante.

**Proveedores**
- Cada fila tiene un menú con «Cargar compra» y «Pagar».
- Columna «Cuenta» con la cuenta habitual o «Sin clasificar», «Elegir cuenta» sin abrir la ficha (con
  «Guardar y seguir») y un filtro «Sin clasificar».
- La sección se llama «Compras y pagos».

**Comprobantes**
- Filtro «Todos · Con factura · Sin factura», marca «Sin factura» en la lista y exportación filtrada.

**Pagar**
- Arranca por «¿Qué pagás?»: a un proveedor (lo de siempre), un gasto fijo u otro gasto. Los dos últimos
  pasan a «Nuevo gasto».

**Gastos fijos** (pestaña propia de Administración)
- Columna «Cuota» («2 de 6», «Quedan 3»). El formulario pregunta de cuántas cuotas es.
- Por gasto: Monto, Vencimiento, Pagado, Falta y Estado (Pago, Pago parcial, Sin pagar, Vencido, Sin
  monto, Vence el…, Salteado, Terminó, Pausado).
- Tres totales: Falta pagar, Ya pagaste, Vencido.
- «Salteado» aparece solo si se usó «Saltear». Antes lo decía de cualquier gasto fijo nuevo cuyo primer
  vencimiento era el mes siguiente.

**Ventas**
- «Proyección»: por día, Objetivo, Venta bar, Venta delivery, Comisión delivery, Comisiones posnet, Venta
  real, Venta neta, Cumplimiento y Evento, con el objetivo y la venta acumulados y el total del mes. El
  objetivo se edita en el lugar o se pega una lista del mes.
- «Ventas contra caja»: por día, la venta real del salón contra lo que entró en las cajas (cargado a
  mano, un importe por caja) y la diferencia. No registra nada en los libros.
- Se sacó el botón «Nueva factura» de venta. La ruta y lo de ARCA siguen.

**Cajas**
- Gráfico «Cómo se movió la plata»: saldo al cierre de cada día y lo que entró y salió, por caja o todas.

**Resumen**
- «Te deben» pasó a «Te falta de gasto fijo». Se suman «Vas vendiendo» y «Te falta vender».

## Decisiones

- **Sin factura no es fuera de los libros.** Todo egreso va al mismo libro. «Se factura / no se factura»
  es una marca; el filtro está en la lista de comprobantes y su exportación, no en diario, mayor ni sumas
  y saldos. El Libro IVA ya dejaba afuera lo que no tiene factura.
- **«Sin factura» es solo `sin_comprobante`.** `otro_comprobante` lleva número y entra al Libro IVA.
- **Las comisiones de la proyección son estimadas**, con los porcentajes de Ajustes. Venta real = venta
  del bar menos comisiones del posnet; venta neta = venta real más delivery menos su comisión;
  cumplimiento = venta neta sobre objetivo. Son las cuentas de la planilla de los socios.
- **«Ventas contra caja» compara contra la venta real**, como la columna «Sistema» de esa planilla.
- **El objetivo vive en Ventas**, no en el calendario de reservas: las cifras quedan detrás del acceso a
  Administración. La columna «Evento» lee los eventos programados; la contadora no los ve (ve las notas).
- **El n.º de remito** va como texto al principio del detalle: el motor no guarda número en un gasto.
- **No se hizo:** la compra por producto con precio promedio hacia la ficha técnica (faltan Stock y
  Fichas técnicas) y «a nombre de quién se factura» (no se pidió en la reunión).

## Base de datos

Cinco migraciones, todas aditivas. Van ANTES del deploy: el código nuevo lee las columnas nuevas.

| Archivo | Qué trae |
|---|---|
| `20261013120000_acc_adjuntos.sql` | `acc_document_attachments`, bucket privado `acc-comprobantes`, sus políticas y las RPC para adjuntar y quitar |
| `20261013120100_acc_gastos_fijos_cuotas_pagos.sql` | `installments_total`, `skipped_due`, `loaded_due`, un trigger, `acc_report_recurring_status` y dos funciones que conservan su firma |
| `20261013120200_acc_ventas_proyeccion.sql` | `acc_sales_targets`, `acc_daily_cash_counts` y sus RPC de guardado |
| `20261013120210_acc_ventas_proyeccion_report.sql` | `acc_report_sales_projection` |
| `20261013120300_acc_report_cash_daily.sql` | `acc_report_cash_daily` |

## Smoke manual

1. Nuevo gasto con un proveedor sin cuenta: pregunta en qué, con «Usar siempre» tildado. Cargar. Otro
   gasto al mismo proveedor: «Va a «…»», sin pregunta.
2. «¿Se factura?» No: sin número, «No entra al Libro IVA». Adjuntar una foto y cargar: el comprobante la
   muestra.
3. Proveedores › «Sin clasificar» › «Elegir cuenta» › «Guardar y seguir». Menú de una fila: «Cargar
   compra» y «Pagar».
4. Pagar: «¿Qué pagás?»; «Un gasto fijo» abre «Nuevo gasto».
5. Gastos fijos: ninguno dice «Salteado»; uno nuevo en cuotas «Faltan 5 · De cuántas 6» muestra «2 de 6».
6. Ventas › Proyección: cargar un objetivo, pegar una lista; Ventas contra caja: cargar lo que entró.
7. Cajas: el último punto del gráfico coincide con el saldo de la caja.
8. Resumen: «Te falta de gasto fijo», «Vas vendiendo», «Te falta vender».
9. Como contadora: ve todo, sin botones de carga.
