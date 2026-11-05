# Administración simple (noviembre de 2026)

Pedido de Nacho del 04/11/2026: aplicar todo lo que se habló en la reunión del 29/10 con Silvia (contadora) y los
socios, y rearmar Administración porque los socios «sienten que está complejo de usar, las cosas muy dispersas». Tiene
que parecerse a un sistema contable tradicional (Silvia usa TimeSuite, de TIME Informática) y simplificarles la
operativa. «A veces menos es más». Y después de ver un primer prototipo: «siento que hay muchas cosas en el nav bar.
Que sea simple, sin perder calidad; arrastrar comprobantes y buenas animaciones se quedan; que se vea como un
tradicional no quiere decir que debe ser feo».

- Transcripción: `~/Downloads/HUB_reunion_2026-10-29_transcripcion.md` (borrador automático).
- Prototipo aprobado («Sí, construilo»): https://claude.ai/artifact/LCu8o9ggD7NqeMrEFbAHLK. Código en
  `/private/tmp/claude-501/-Users-ignaciobaldovino-Hub-main/cf7b1c25-7cf0-4c74-9595-c0ca14adfce3/scratchpad/prototipo/index.html`:
  cada pantalla es una función `V.<nombre>` en vanilla JS (`V.semana`, `V.fijos`, `V.sumas`…) y la pantalla «Lo que
  pidieron» lista los 30 pedidos. Es la referencia de forma y de textos.

## Decisiones de Nacho (no reabrir)

- Seis palabras arriba: **Resumen · Compras y pagos · Gastos y sueldos · Ventas · Caja · Contabilidad**, engranaje
  (Ajustes) y **+ Cargar**. Lo demás son solapas de su sección.
- **Importar sale del menú**: se arrastra un archivo a cualquier pantalla y se reconoce solo.
- **Silvia reimputa y hace asientos**. No carga compras, pagos ni ventas.
- Nombres de carga, como ya tienen educado al equipo: **Compra** (me llegó y la pago después, va primera), **Compra y
  pago** (la pagué en el momento), **Pago**.

## Decisiones técnicas

- **Un solo libro.** En la reunión se habló de que lo no facturado «no le llegue» a Silvia y de cuentas de terceros
  para no facturar. No se construyen libros que oculten movimientos: la marca con/sin factura filtra listados y ventas;
  diario, mayor y sumas y saldos muestran todo. El Libro IVA solo tiene comprobantes fiscales, como siempre.
- **«Mover plata» sale del frente, no se borra.** Queda en el menú «⋯» de cada cuenta (Transferir a otra cuenta), porque
  un depósito al banco lo necesita para que el saldo cierre.
- **Leer la factura** es leer su QR de ARCA (exacto y gratis). Sin QR, se tipea. Leer con IA necesitaría una clave.
- **Impuestos automáticos** (`lib/accounting/taxes.ts`, Ajustes › Impuestos): Ingresos Brutos y Comercio e Industria van
  dentro del asiento del cierre del día (`buildSalesClose`), y el impuesto al cheque es un `bank_expense` en el mismo
  bundle del pago (`withBankTax`, marcado con `AUTO_BANK_TAX_NOTE`). Base por defecto: lo facturado sin IVA.
- **Sueldos:** cada adelanto o pago es un `cash_movement` D Sueldos a pagar [Personal] / H la caja. «Devengar el mes» es
  un asiento manual D Sueldos y jornales / H Sueldos a pagar [Personal]. El saldo de la planilla sale del sueldo menos
  lo pagado.
- **Reimputar** cambia la cuenta de un renglón de imputación con el mes abierto, con historia y auditoría
  (`acc_reimpute_line`). No toca importe, proveedor, partidas ni IVA.

## Contrato visual

Todo lo nuevo sale de `components/administracion/planilla/` y de los tokens que ya existen. **No tocar**
`components/ui/*` ni los valores de tokens existentes.

Una pantalla es: `SimplePage` › (`PlanillaBar`) › (`Totalizer`) › `Planilla`.

- **Sin** `AdmHeader` con bajada, `ViewPills`, `HeroPanel`, «¿Cómo se calcula?», tarjetas adentro de tarjetas, ni
  oraciones que expliquen lo que el número ya dice. Las solapas las dibuja `AdmNav`: una página **no** dibuja las suyas.
- El título de la pantalla es la solapa. Cada página igual lleva su `<h1 className="sr-only">`. Las pantallas de tarea
  (cargar algo, el cierre, una ficha) sí llevan `<h1 className="font-serif text-2xl font-semibold tracking-tight">`.
- **Números en la tipografía de los datos** (Inter, `tabular-nums`, ya lo trae `PTable`), nunca en Fraunces. La plata en
  columnas alineada a la derecha con `formatCentsShort`; en los libros, con centavos (`formatCents`).
- La UI **siempre** muestra y pide pesos; la base guarda centavos. La conversión va en el borde del formulario.
- Colores solo por token (`text-destructive` vencido, `text-warning-text` por vencer, `text-success` pagado): tiene que
  verse bien en claro y en oscuro.
- Acciones de fila con `ROW_ACTION` (aparecen al pasar; en táctil, siempre). En filas: `Button size="sm"
  variant="outline"`. Máximo una acción primaria por pantalla.
- Celdas que se escriben: `CELL_INPUT`, con `aria-label`, guardan al salir del campo y Enter pasa a la de abajo.
- **El total lleva la doble raya** (`PTotalRow`).
- Movimiento donde ayuda, y con `prefers-reduced-motion` respetado: `adm-rise` (ya lo trae `SimplePage`), `MoneyTicker`
  (ya lo trae `Totalizer`), `Stamp thud` al pagar, `adm-land` / `adm-scan` / `adm-flash` al llegar una foto. Con `motion`
  (`motion/react`) lo que haga falta. Nada de animaciones en filas al cargar la tabla.
- Mobile: tablas con scroll horizontal adentro de su contenedor (ya lo hace `PTable`), nunca la página. En celular,
  las celdas y botones cómodos para el pulgar.
- Vacío: una oración y un botón, adentro de la misma planilla. El bar real está casi vacío: diseñar primero ese estado.
- Errores: mensaje accionable con reintento. Copy en rioplatense, corto, sin rayas largas; igual que el prototipo.

## Qué sigue valiendo

- Las rutas viejas no se rompen: `?tab=` de Ventas, `/libros`, `/importar/*`, `?accion=` de las hojas.
- La lógica contable no se toca salvo lo que dice este documento: los formularios mandan lo mismo.
- Permisos: `requireAccountingAccess`, `canWrite`; la contadora ve todo sin botones de carga (salvo reimputar y asientos).
- Lo que ya existía y no se usa todos los días no se borra: va a un «⋯», a una fila de pie o a Ajustes.

## Backend ya aplicado en producción

Migraciones `20261104120000`–`120800`. Lo que queda disponible:

| RPC | Para qué |
|---|---|
| `acc_reimpute_line(p_tenant_id, p_line_id, p_account_id, p_reason)` | Reimputar. Dueños con acceso y contadora. Errores: `period_closed`, `line_not_reimputable`, `line_account_invalid`, `account_unchanged`, `document_voided`. |
| `acc_report_imputation_flags(p_tenant_id, p_from, p_to)` | Renglones cuya cuenta no es la habitual de su proveedor o gasto fijo. |
| `acc_save_payment_budget(p_tenant_id, p_week_start, p_items)` | Celdas del Plan de la semana: `[{party_id, amount_cents}]`. `p_week_start` es lunes. |
| `acc_report_week_plan(p_tenant_id, p_week_start)` | Por proveedor: `party_id, party_name, party_kind, default_voucher_type, debt_cents, overdue_cents, purchased_cents, paid_cents, budget_cents`. |
| `acc_save_employee(p_tenant_id, p_employee)` | `{id?, name, pay_frequency: 'monthly'\|'biweekly', active, notes}` → `{id}`. |
| `acc_save_employee_salary(p_tenant_id, p_employee_id, p_month, p_salary_cents)` | El sueldo desde ese mes. |
| `acc_payroll_prepare_movement(p_tenant_id, p_client_ref, p_employee_id, p_month, p_kind)` | Antes de postear el `cash_movement` con ese `clientRef`. `p_kind`: `advance`, `payment`. |
| `acc_payroll_prepare_accrual(p_tenant_id, p_client_ref, p_month)` | Antes de postear el asiento de «Devengar». |
| `acc_report_payroll(p_tenant_id, p_month)` | `{month, employees: [{id, name, pay_frequency, active, notes, salary_cents, advances_cents, paid_cents, movements: [{document_id, kind, date, amount_cents, treasury}]}], accrual: {document_id, date, amount_cents} \| null}`. |
| `acc_save_tax_settings(p_tenant_id, p_settings)` | `{auto, iibb_bp, municipal_bp, bank_tax_bp, base}`. Usar `taxSettingsPayload`. |
| `acc_set_treasury_bank_tax(p_tenant_id, p_treasury_id, p_value)` | Si la cuenta cobra el impuesto al cheque (`null` = según el tipo). |
| `acc_upload_link_create(p_tenant_id, p_link_id, p_token_hash, p_slots, p_expires_at)` | `p_slots`: `[{path, token}]` con URLs firmadas. Devuelve `{id, stale_paths}`. |
| `acc_upload_link_files_list(p_tenant_id, p_link_id)` | Lo que subió el celular. |
| `acc_upload_link_open(p_token)` | Público. `{ok, reason?, tenant_name, bucket, uploaded, slots}`. |
| `acc_upload_link_add(p_token, p_path, p_file_name, p_mime_type, p_size_bytes)` | Público. |
| `acc_upload_link_close(p_tenant_id, p_link_id)` | Al terminar. |

Un `payment` puede llevar `recurringExpenseId`: pagarle a Rentas o a la Municipalidad deja pagado su gasto fijo sin
cargar el gasto de nuevo (ya se devengó en cada cierre).

En `PostingContext`: `ctx.settings.taxSettings`, `ctx.treasuries.get(id).chargesBankTax`, `ctx.parties.get(id).systemKey`.
Partícipes del sistema: `personal` (Sueldos a pagar), `rentas` (IIBB a pagar), `municipalidad` (Comercio e Industria a
pagar). La contadora puede usar `postManualEntry`. Un tique ya no exige punto de venta ni número
(`voucherNumberRequired`).

## Smoke manual

Hecho el 04/11/2026 en `demo-administracion`, contra el sistema compilado (`next build` + `next start`), con clics y
teclas de verdad por CDP y verificando en la base. Compu, celular y oscuro.

**Foto por QR (compu + «celular» sin sesión)**
1. Abrir `compras/nueva`, leer el QR de la pantalla. Abrir ese link sin sesión a 390 px: «Sacar la foto».
2. Subir una imagen con un QR de ARCA. El celular dice «Listo. Ya apareció en la compu».
3. La compu muestra la foto y completa proveedor (por CUIT), letra, punto de venta, número, fecha, neto, IVA y total.
4. «Cargar compra»: queda 1 adjunto en la carpeta del comprobante y hay un QR nuevo para la siguiente.

**Arrastrar**
1. Soltar la misma imagen en Caja: aparece «Soltalo acá» y abre la compra leída.
2. Soltar `collection-…csv`: va a Importar › Mercado Pago y dice que es el reporte de Cobros y qué bajar.

**Cargas**
- Compra y pago sin proveedor (remito): gasto de contado. Con factura desde el banco: `purchase` + `payment` +
  `bank_expense` en un solo paquete, y el impuesto (0,6 %) partido en computable y gasto.
- Tique sin número: guarda y no pide punto de venta. Repetido: avisa «Ya hay un comprobante de $ X… ¿Es otro?».
- Tildar un gasto fijo: tira con Salió de, Papel, QR e impuesto al cheque; cae el sello PAGADO y el totalizador cuenta.
- Gasto fijo con cuenta de Ingresos Brutos: tildar abre el Pago a Rentas con lo devengado y la fila queda Pagado.

**Sueldos**
Agregar empleada, sueldo $ 1.000.000, adelanto $ 100.000 y pago $ 400.000 desde el banco: le debés $ 500.000 (sin
contar el impuesto) y el banco baja $ 503.000. «Devengar noviembre»: asiento y sello DEVENGADO, y la celda de sueldo
queda de solo lectura.

**Ventas y cierre**
Objetivos $ 1.000.000, $ 1.000.000, $ 2.000.000 y $ 500.000: Normal, Normal, Fuerte y Flojo solos. Cierre con $ 1.000.000
facturados: IIBB $ 24.793,39 y Comercio e Industria $ 5.785,12 dentro del asiento, contra Rentas y Municipalidad.

**La contadora** (membresía temporal, sacada al terminar)
Entra a Sumas y saldos, sin Resumen ni Cargar. Sumas › Mayor › panel del asiento: «Tostadero siempre va a Café e
infusiones», con la cuenta habitual ya elegida. «Reimputar»: se va del Mayor y queda en el historial a su nombre.
Asiento manual con el modelo de cuota: «Falta $ 10.000,00 en el Haber» y «Grabar» apagado hasta que cuadra; sin
Respaldo no graba; grabó y quedó a su nombre. Si entra a una compra, ve «Solo lectura».

**No probado en un aparato real:** la cámara de un celular y arrastrar con el mouse (se simuló el evento del navegador).
Las pruebas de `tests/rls/acc-simple.test.ts` no corren acá (sin Docker) ni en CI hasta arreglar el job (ver BACKLOG):
el aislamiento se ensayó contra la base, en una transacción revertida.
