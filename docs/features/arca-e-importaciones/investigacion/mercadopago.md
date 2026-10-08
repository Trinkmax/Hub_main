# Tópico D — Conciliación de Mercado Pago para HUB (investigación)

> **Fecha:** 07–08/10/2026 · **Para:** el diseño del import de Mercado Pago en Administración y sus instructivos.
> **Cómo leer las marcas:**
> - **A CONFIRMAR**: no lo pude verificar en una fuente oficial, o las fuentes se contradicen. Hay que validarlo con el primer reporte real de HUB o con la contadora.
> - **(obs.)**: lo vi en datos reales que terceros publicaron en repos públicos de 2025–2026. No está documentado por Mercado Pago.
> - Las citas van entre corchetes (por ejemplo, [MP-LIQ-CAMPOS]). Las URLs están en §7.

---

## 0. Resumen

1. **Hay una trampa con los nombres.** En Argentina, el **«Reporte de Liquidaciones»** es el `release_report` (el dinero liberado). El `settlement_report` se llama **«Todas las transacciones»**, y también aparece como «Dinero en cuenta». Es al revés de lo que sugiere la palabra. [MP-REP-INTRO] [MP-LIQ-INTRO] [MP-TT-INTRO]
2. **Liquidaciones es la fuente de verdad del saldo de Mercado Pago.** Funciona como un extracto bancario:
   - trae saldo inicial, movimiento por movimiento y total;
   - cada fila tiene bruto, comisión, impuestos y neto, más el saldo corrido `BALANCE_AMOUNT`;
   - incluye retiros, rendimientos, retenciones, débitos de percepciones y bloqueos.
3. **La comisión viene con IVA incluido** (`MP_FEE_AMOUNT`, «Incluye IVA»). El IVA discriminado sale de dos lugares: la **factura mensual (A) de Mercado Pago** y el **«Reporte de Facturación de Mercado Pago»**, que lista cargo por cargo. [MP-LIQ-CAMPOS] [MELI-NOTE-FACT-CONC]
4. **Impuestos que va a ver HUB** (SAS, responsable inscripto, Córdoba):
   - retención de IIBB **SIRTAC** en los cobros con QR, Point o link;
   - retención de IIBB **SIRCUPA** en las transferencias e ingresos de terceros;
   - **impuesto a los créditos y débitos (Ley 25.413)** en cobros, pagos y retiros a terceros, del 0,6 % (obs.); las transferencias entre cuentas propias están exentas;
   - **percepciones de IVA y de IIBB** en la factura mensual.

   Las retenciones de IVA y Ganancias **no se cobran desde el 01/09/2024** (RG 5554/2024). [MELI-NOTE-RI] [MELI-NOTE-IIBB-RET] [MELI-NOTE-ICD] [MELI-NOTE-IVA]
5. **Los reportes por API son asincrónicos.** El ciclo es: `POST` para crearlo, `task` para seguirlo, `list/search` para encontrarlo y descarga del CSV o XLSX.
   - Cada reporte cubre **60 días como máximo**.
   - Las fechas del pedido van en **UTC**.
   - Se pueden programar para que se generen solos cada día.

   [MP-LIQ-API] [MP-LIQ-GEN] [MP-TT-API]
6. **`/v1/payments/search` complementa, pero no reemplaza el extracto.**
   - Sirve para ver los cobros casi en vivo, con canal (QR o Point), comisión y neto.
   - **No** trae retiros, rendimientos ni débitos mensuales de impuestos.
   - Su `taxes_amount` llegó en 0 aunque había retención (obs.).
   - También devuelve pagos donde la cuenta es la que paga, así que hay que filtrar por `collector.id`.

   [MP-PAY-MGMT] [GH-GRANJA-V2]
7. **El token se saca desde la cuenta de la SAS.** El dueño entra a «Tus integraciones», crea una aplicación, activa las «Credenciales de producción» y copia el **Access Token** (`APP_USR-…`).
   - Ese token da acceso a toda la cuenta, así que se guarda cifrado igual que los tokens de Meta.
   - Para una plataforma con muchos bares conviene **OAuth con authorization code**: el token dura 180 días y se renueva con el refresh token.

   [MP-CRED] [MP-OAUTH-CREATE] [MP-OAUTH-RENEW]
8. **Diseño propuesto: un solo normalizador con dos entradas.**
   - **Subir el CSV**: siempre disponible.
   - **Sync diario por API**: con un cron.

   Las dos producen la misma «acreditación» que hoy se carga a mano en «Ajustar saldo de Mercado Pago». No hace falta un motor contable nuevo.
9. **Huecos del módulo actual que el import va a necesitar:**
   - la acreditación no tiene un tipo de descuento «Ley 25.413»: hoy existe solo en el gasto bancario;
   - no hay cuenta de **propinas cobradas por QR**;
   - hay que mandar SIRTAC a `iibb_withholdings` y SIRCUPA a `iibb_sircupa`.
10. **Lo más incierto, a resolver con el primer reporte real de HUB:**
    - los valores de `SUB_UNIT` para Point y para link;
    - cómo vienen SIRTAC y SIRCUPA de Córdoba dentro de `TAXES_DISAGGREGATED`;
    - si una aplicación sin permiso `write` puede generar reportes.

---

## 1. Los reportes de Mercado Pago

### 1.1 Qué es cada reporte

| Panel (Argentina) | Doc / API | Ruta en el panel | Para qué sirve |
|---|---|---|---|
| **Liquidaciones** | Released money · `/v1/account/release_report` | Informes y facturación › Reportes de ventas y extractos de cuenta › **Liquidaciones** › Crear reporte (`/balance/reports/release`) | Cómo se compone el **saldo disponible**: lo liberado, retirado, retenido y desbloqueado. Es un extracto con saldo corrido. |
| **Todas las transacciones** (en la tabla de la doc, «Dinero en cuenta») | Account money · `/v1/account/settlement_report` | … › **Todas las transacciones** › Crear reporte (`/balance/reports/settlement_v2`) | Cada movimiento **aprobado** que afectó la plata de la cuenta, esté disponible, por liberar o retenido. |
| **Otras operaciones** (Reportes de Actividades) | `/v1/reporting/operations/{reportId}` | Tus integraciones › Ver mis cobros y movimientos | Cobros, poscobros y retiros. Admite hasta **1 año** por pedido. Es nuevo. |
| **Facturación de Mercado Pago** | API de facturación de Mercado Libre (`group=MP`) | Facturación › mes › Ir al detalle › Reportes › Facturación de Mercado Pago | Cada **cargo facturado** (comisión) con su Nº de factura, la operación relacionada y las percepciones. |

Fuentes: [MP-REP-INTRO], [MP-LIQ-INTRO], [MP-TT-INTRO], [MP-ACT-INTRO], [MELI-NOTE-FACT].

Cómo los presenta Mercado Pago [MELI-NOTE-LIQ]:
- «Todas las transacciones: ideal para llevar el control de todo el dinero que tenés en tu cuenta, independientemente del estado en el que se encuentre: disponible, retenido o por liquidar.»
- «Liquidaciones: ideal para llevar el control del dinero que se liberó en tu cuenta y que tenés disponible para usar.»

**Liquidaciones solo se genera desde la computadora.** La doc en español dice: «Ten presente que actualmente este reporte solo se genera a través de tu computadora». Hay que avisarlo en el instructivo. [MP-LIQ-INTRO]

### 1.2 Reporte de Liquidaciones (`release_report`)

#### Tipos de fila (`RECORD_TYPE`) [MP-LIQ-CAMPOS]

| Valor | Qué es |
|---|---|
| `initial_available_balance` | El dinero disponible del período anterior: el saldo inicial. |
| `release` | Cada movimiento que afectó el disponible. |
| `total` | Crédito total menos débito total: el saldo final. |
| `available_balance` | Saldo previo y posterior a un retiro. La `DESCRIPTION` lleva `pre_payout_<SOURCE_ID>` o `pos_payout_<SOURCE_ID>`. Solo aparece si se activa `check_available_balance`. |

#### Signos y formato

Este es el ejemplo de la doc oficial, con el set de 15 columnas por defecto [MP-LIQ-API]:

```csv
DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,MP_FEE_AMOUNT,FINANCING_FEE_AMOUNT,SHIPPING_FEE_AMOUNT,TAXES_AMOUNT,COUPON_AMOUNT,INSTALLMENTS,PAYMENT_METHOD
2018-04-17T15:07:53.000-04:00,,,initial_available_balance,,813439.19,0.00,813439.19,0.00,0.00,0.00,0.00,0.00,1,
2018-04-17T15:07:53.000-04:00,,,release,withdrawal,0.00,813363.45,-813360.45,-3.00,0.00,0.00,0.00,0.00,1,
2018-04-17T15:11:12.000-04:00,,,release,payment,225.96,0.00,269.00,-43.04,0.00,0.00,0.00,0.00,1,account_money
```

- `NET_CREDIT_AMOUNT` y `NET_DEBIT_AMOUNT` van **en positivo**. `GROSS_AMOUNT` lleva signo. La comisión y los impuestos van **en negativo**.
- El separador decimal es `.`, no hay separador de miles y el negativo lleva `-` adelante. Lo confirma un export real de 2026 (obs.). [GH-GRANJA-V3]
- **Control por fila:** `NET_CREDIT_AMOUNT − NET_DEBIT_AMOUNT = GROSS_AMOUNT + MP_FEE_AMOUNT + FINANCING_FEE_AMOUNT + SHIPPING_FEE_AMOUNT + TAXES_AMOUNT`.
  - Se cumple en el ejemplo: 269,00 − 43,04 = 225,96.
  - Cómo entra `COUPON_AMOUNT`: **A CONFIRMAR**.
- **Control del archivo:** `initial_available_balance + Σ(crédito − débito) = total`. Además, `BALANCE_AMOUNT` da el saldo después de cada fila.
- Esas **15 columnas** parecen ser el set por defecto: son las del ejemplo de la API, y un Liquidaciones real que bajó un tercero en septiembre de 2026 tenía exactamente 15 (obs.). [GH-GRANJA-V3 §16] Que sea el default del panel está **A CONFIRMAR**. Para conciliar hay que agregar columnas: ver §2.2.
- `withdrawal` es la etiqueta vieja. Desde octubre de 2022 los retiros y transferencias salientes aparecen como **`payout`**, y los bloqueos llevan el prefijo **`reserve_`**. El parser tiene que aceptar las dos. [MP-LIQ-INTRO]

#### Valores de `DESCRIPTION` y qué hacer con cada uno

Los textos de la doc son [MP-LIQ-CAMPOS]. Lo marcado **(obs.)** viene de [GH-GRANJA-V3] y [GH-BINDERPLUS].

| `DESCRIPTION` | Qué es | Tratamiento propuesto |
|---|---|---|
| `payment` | Un cobro liberado: QR, Point, link o **transferencia recibida**. [GH-BINDERPLUS] lo traduce así: `payment` = «Transferencia recibida». | Va a la acreditación del día (§4.6). El canal se clasifica según §1.6. |
| `refund` | Devolución asociada a un pago. | Revierte el cobro. Va a revisión. |
| `chargeback` / `dispute` | Contracargo / reclamo o mediación. | Va a revisión. Se alerta. |
| `payout` | Retiros y transferencias desde el saldo disponible. **Mezcla retiros a una cuenta propia y pagos a proveedores** (obs.: 2 y 2, verificado por el dueño de esa cuenta). | Si la cuenta destino (`PAYOUT_BANK_ACCOUNT_NUMBER`) es de HUB, es una transferencia de Mercado Pago al banco. Si no, es un pago a un tercero y va a revisión. |
| `reserve_for_payment`, `reserve_for_payout`, `reserve_for_refund`, `reserve_for_debt_payment`, `reserve_for_cbk_cross_recovery`, `reserve_for_embargo_invested`, `reserve_for_bpp_shipping_return` | Retenciones o bloqueos temporales. **Vienen en pares −X / +X con el mismo `SOURCE_ID`** (obs.: 4 de 4 retiros tenían su par `reserve_for_payout`). | Se ignoran cuando el par se compensa. Si al cierre queda abierto, es dinero retenido: se informa. |
| `tax_withdholding` / `tax_withdholding_cancel` (así, con la errata de MP) | El cobro de retenciones que **no se pudieron aplicar en el pago**. En Argentina son solo de Ingresos Brutos. | Crédito fiscal de IIBB (SIRTAC o SIRCUPA, ver §1.7). |
| `tax_withholding_collector` / `tax_withholding_payer` / `tax_withholding_payout` / `tax_withholding_shipping` | Impuesto a los créditos y débitos en cobros, pagos, retiros y envíos. | Ley 25.413: la parte computable en Ganancias más el resto a gasto. |
| `tax_credit_debit` | Impuesto a los créditos y débitos, que rige para personas jurídicas desde el 01/08/2021. | Igual que la fila anterior. |
| `tax_iva`, `tax_iva_cre` | Percepción de IVA del régimen general (y la de «Cuotas sin Tarjeta»). | Percepción de IVA sufrida. Va con la factura mensual (§1.5). |
| `tax_payment_iibb(_cancel)`, `tax_payment_ibcf(_cancel)`, `tax_payment_ibex`, `tax_iibb_[jurisdicción]`, `tax_payment_iibb_cre_[jurisdicción]` | Percepciones de IIBB, mensuales. | Percepción de IIBB sufrida. |
| `asset_management_gain` / `_loss`. **Obs.: llega `asset_management` a secas, una fila por día.** | Rendimientos del dinero en cuenta (fondo común de inversión). | Rendimiento de Mercado Pago, que ya existe como atajo `mp_yield`. |
| `fee_release_in_advance` | Comisión por adelantar dinero. | Comisión de Mercado Pago. |
| `credit_payment` | Débito de la cuota de un préstamo. | Pago del préstamo. |
| `restriction` | Restricción por comportamiento fraudulento. | Revisión y alerta. |
| `tip` | «Monto que corresponde a la propina que se pagó a través de un código QR». | **No es una venta.** Va a un pasivo de propinas a distribuir. **A CONFIRMAR con la contadora.** |
| `digitalchange_transaction` | Vueltos digitales: el bar le da el vuelto en dinero digital a quien pagó en efectivo. | Movimiento entre la caja y Mercado Pago. |
| `shipping`, `shipping_cancel`, `shipping_return`, `shipping_refund` | Envíos de Mercado Libre. | No aplica a HUB. Si aparece, va a revisión. |

#### Todas las columnas (glosario oficial de Argentina) [MP-LIQ-CAMPOS]

| Grupo | Columnas |
|---|---|
| Núcleo | `DATE` (fecha de liberación), `SOURCE_ID`, `EXTERNAL_REFERENCE` (en retiros, el ID de Coelsa), `RECORD_TYPE`, `DESCRIPTION`, `NET_CREDIT_AMOUNT`, `NET_DEBIT_AMOUNT`, `GROSS_AMOUNT`, `BALANCE_AMOUNT`, `CURRENCY` |
| Comisiones | `MP_FEE_AMOUNT` («Incluye IVA»), `FINANCING_FEE_AMOUNT`, `SHIPPING_FEE_AMOUNT`, `COUPON_AMOUNT`, `EFFECTIVE_COUPON_AMOUNT`, `SELLER_AMOUNT` |
| Impuestos | `TAXES_AMOUNT` («retenciones de IIBB, IVA, Ganancias; e impuestos sobre los Créditos y Débitos»), `TAX_DETAIL`, `TAXES_DISAGGREGATED` («formato JSON»), `TAX_AMOUNT_TELCO` |
| Fechas | `TRANSACTION_DATE`, `TRANSACTION_DATE_SHORT`, `TRANSACTION_APPROVAL_DATE`, `TRANSACTION_APPROVAL_DATE_SHORT`, `DATE_SHORT` |
| Canal y medio | `PAYMENT_METHOD`, `PAYMENT_METHOD_TYPE`, `INSTALLMENTS`, `OPERATION_TAGS` (`WHATSAPP_PAY`, `QR`, `PO` = Point, `MARKETPLACE`), `BUSINESS_UNIT` (Mercado Pago, Mercado Libre, Mercado Shops, Delivery), `SUB_UNIT` («Plataforma de cobro»), `SEGMENT_DETAIL`, `APPLICATION_ID`, `CARD_ENTRY_MODE`, `FRANCHISE`, `ISSUER_NAME`, `AUTHORIZATION_CODE` |
| Local físico | `POS_ID`, `POS_NAME`, `EXTERNAL_POS_ID`, `STORE_ID`, `STORE_NAME`, `EXTERNAL_STORE_ID`, `POI_ID` (número de serie del lector Point), `POI_WALLET_NAME`, `POI_BANK_NAME` (billetera y banco cuando el QR es interoperable) |
| Retiros | `PAYOUT_BANK_ACCOUNT_NUMBER` («el número completo de la cuenta a la que se envió dinero») |
| Órdenes | `ORDER_ID`, `ORDER_MP`, `PURCHASE_ID`, `TRANSACTION_INTENT_ID`, `PACK_ID`, `SHIPPING_ID`, `SHIPMENT_MODE`, `SHIPPING_ORDER_ID`, `IS_RELEASED`, `ITEM_ID`, `PRODUCT_SKU`, `SALE_DETAIL`, `METADATA` |
| Datos personales | `PAYER_NAME`, `PAYER_ID_TYPE`, `PAYER_ID_NUMBER` («solo se podrá usar para conciliar… disponible cuando se reciban pagos con código QR, transferencias»), `CARD_INITIAL_NUMBER`, `LAST_FOUR_DIGITS`, `AUTHENTICATED_PAYER` |

#### Características técnicas [MP-LIQ-GEN] [MP-LIQ-API]

- **Período máximo:** 60 días por reporte. El orden de las columnas es fijo y la moneda es la local.
- **Zona horaria de las fechas:** GMT-4 por defecto. Se configura con `display_timezone`.
  - Si se elige una zona con horario de verano, hay que ajustarla a mano. Argentina no tiene, así que `GMT-03` sirve.
  - Los exports reales del panel venían con offset `-03:00` (obs.).
- **Formatos:** `.csv` (para importar) y `.xlsx`. Los reportes quedan guardados en la cuenta.
- **Nombre del archivo:** prefijo configurable más la fecha. Visto en la realidad: `reserve-release-<cuenta>-manual-2026-09-28-162005.csv` (obs.). [GH-GRANJA-V3]
- **Cuentas de prueba:** «los reportes generados para cuentas de prueba se mostrarán sin información». Se prueba con la cuenta real.
- **Generar al retirar:** el panel permite que el reporte se genere solo cada vez que se retira plata (`execute_after_withdrawal`). [MP-LIQ-PANEL]
- **Aviso por webhook:** Mercado Pago puede avisar cuando el reporte está listo. Manda `transaction_id`, `generation_date`, `files[]` (con `url`), `status`, `creation_type`, `report_type` y `signature`.
  - La firma es `BCrypt(transaction_id + '-' + password_for_encryption + '-' + generation_date)`.
  - Dónde se configura ese webhook para Liquidaciones: **A CONFIRMAR**.

#### Lo que pasa en archivos reales (obs.) [GH-GRANJA-V3] [GH-BINDERPLUS]

- **`TAXES_DISAGGREGATED` no es JSON válido:** las claves y los valores van sin comillas, por ejemplo `[{financial_entity:debitos_creditos,amount:-90.00,detail:tax_withholding_collector}]`.
  - Otro repo muestra la variante con comillas.
  - El parser tiene que intentar `JSON.parse` y, si falla, leerlo de forma tolerante (§4.5).
  - Control observado: `Σ amount = TAXES_AMOUNT` en todas las filas (294 de 294).
- **`TAX_DETAIL`** traía `tax_debitos_creditos`, no una provincia como dice el glosario. Como una fila puede tener varios impuestos (créditos y débitos más IIBB), **no hay que depender de `TAX_DETAIL`: se usa `TAXES_DISAGGREGATED`**.
- **`SOURCE_ID` es estable entre reportes** e igual al `payment.id` de la API. Para los cobros, el bruto y el neto coincidieron al centavo (11 de 11). Los pares `(DESCRIPTION, SOURCE_ID)` repetidos en reexportaciones traían el mismo contenido.
- **Aparecieron valores no documentados**, como `asset_management`, `available_money` (como medio de pago) y `PAYOUTS` (en Todas las transacciones). Lo desconocido va a revisión, nunca se descarta.

### 1.3 Reporte de Todas las transacciones (`settlement_report`)

- **Qué trae:** «los movimientos que afectaron el balance de tu dinero», con «su desglose en bruto y neto». Los movimientos entran **cuando se aprueban**; los pendientes y rechazados no aparecen. [MP-TT-INTRO]
- **`TRANSACTION_TYPE`:** `SETTLEMENT`, `REFUND`, `CHARGEBACK`, `DISPUTE`, `WITHDRAWAL`, `WITHDRAWAL_CANCEL`, `PAYOUT`, `CASHBACK`, `SETTLEMENT_SHIPPING`, `REFUND_SHIPPING`, `CHARGEBACK_SHIPPING`, `DISPUTE_SHIPPING`.
  - `SETTLEMENT_NET_AMOUNT` es el impacto real en el saldo. [MP-TT-USO] [MP-TT-CAMPOS]
  - **Obs.:** en un export real las transferencias salientes venían como **`PAYOUTS`** (en plural, no documentado). Retiros a cuenta propia y pagos a proveedores compartían ese tipo. [GH-GRANJA-V3]
- **Columnas** según el glosario de Argentina:
  - identificación: `EXTERNAL_REFERENCE`, `SOURCE_ID`, `USER_ID`, `SITE`, `DESCRIPTION` («INSTALLMENT» en cuotas);
  - medio de pago: `PAYMENT_METHOD`, `PAYMENT_METHOD_TYPE` (`credit_card`, `debit_card`, `bank_transfer`, `atm`, `ticket`, `account_money`, `prepaid_card`);
  - importes: `TRANSACTION_TYPE`, `TRANSACTION_AMOUNT`, `TRANSACTION_CURRENCY`, `SELLER_AMOUNT`, `FEE_AMOUNT` (comisiones con IVA), `SETTLEMENT_NET_AMOUNT`, `SETTLEMENT_CURRENCY`, `REAL_AMOUNT`, `COUPON_AMOUNT`, `METADATA`, `MKP_FEE_AMOUNT`, `FINANCING_FEE_AMOUNT`, `SHIPPING_FEE_AMOUNT`, `TIP_AMOUNT`;
  - fechas: `TRANSACTION_DATE`, `SETTLEMENT_DATE` (fecha de aprobación), `MONEY_RELEASE_DATE` (cuándo se libera), `IS_RELEASED`, `INVOICING_PERIOD`;
  - impuestos: `TAXES_AMOUNT`, `INSTALLMENTS`, `TAX_DETAIL`, `TAXES_DISAGGREGATED`;
  - local físico y QR: `POS_*`, `STORE_*`, `POI_ID`, `POI_WALLET_NAME`, `POI_BANK_NAME`;
  - datos de la tarjeta y de quien paga: `CARD_INITIAL_NUMBER`, `PAYER_*`;
  - canal: `OPERATION_TAGS`, `BUSINESS_UNIT`, `SUB_UNIT`;
  - transferencias: `PAY_BANK_TRANSFER_ID` (identificador de cada transferencia bancaria);
  - versiones cortas de las fechas: `*_SHORT`.

  [MP-TT-CAMPOS]
- **Control que se verificó en 294 filas de 294 (obs.):** `TRANSACTION_AMOUNT + FEE_AMOUNT + MKP_FEE_AMOUNT + TAXES_AMOUNT = SETTLEMENT_NET_AMOUNT`, y `REAL_AMOUNT = SETTLEMENT_NET_AMOUNT`. [GH-GRANJA-V3]
- **Cómo es un export real del panel (obs.):** 60 columnas, separador `;`, UTF-8 sin BOM, fechas `yyyy-MM-ddTHH:mm:ss.SSS-03:00`. **No tiene columna de saldo**, así que no sirve para controlar saldos. [GH-GRANJA-V3]
- **Opciones que se configuran por API:** `coupon_detailed`, `include_withdraw`, `refund_detailed`, `shipping_detail`, `show_chargeback_cancel`, `show_fee_prevision`, `header_language`, `report_translation`, `separator`, `sftp_info`, `display_timezone`, `frequency`, `columns`, `file_name_prefix`. [MP-TT-API]
- **Cuándo usarlo en HUB:** para cruzar las ventas **por fecha de aprobación** cuando el dinero se libera días después (§2.6). Si HUB cobra con liberación al instante, Liquidaciones alcanza.

### 1.4 Reportes de «Otras operaciones» (API nueva)

- **`reportId` disponibles:**
  - `activities_collection`: cobros por checkout, QR, Point y otros canales;
  - `activities_after_collection`: devoluciones, contracargos, reclamos y ajustes;
  - `activities_withdraw`: retiros y transferencias.
- **Período:** hasta 1 año por pedido.
- **Archivo:** CSV o XLSX; los grandes vienen en `.zip`.
- **Estados:** `pending`, `available`, `failed`, `empty`.
- **Avisos:** por webhook, FTP o SFTP. [MP-ACT-INTRO] [MP-ACT-GEN] [MP-ACT-API]
- **Columnas:** `date_created`, `date_approved`, `date_released`, `operation_id`, `external_reference`, `status`, `status_detail`, `operation_type`, `transaction_amount`, `net_received_amount`, `mercadopago_fee` («se devuelve como valor negativo»), `payment_type`, `installments`, `amount_refunded`, `chargeback_id`, `claim_id`, `store_id`, `pos_id`, `rejection_causes`, `counterpart_name/email`, `buyer_document`, `bank_account`, `provider_id` (identificador de Coelsa del retiro). [MP-ACT-CAMPOS]
- **Para qué sirve:** **no trae el desglose de impuestos**, así que no alcanza para la contabilidad. Es útil para cargar de una vez un año de cobros y retiros.
- **Desde cuándo existe para cuentas de Argentina: A CONFIRMAR.** Los ejemplos de la doc usan marzo de 2026.

### 1.5 Comisiones con IVA, la factura mensual y las percepciones

- **La factura mensual.** Para un responsable inscripto, Mercado Pago agrega la **percepción general de IVA** a «la factura mensual que te generamos por el uso de Mercado Pago».
  - Si no se paga antes del vencimiento, **«el día del vencimiento descontaremos el monto de la factura del dinero en tu cuenta»**.
  - La factura descargada «te sirve como certificado de percepción».
  - Las percepciones se ven en «Información fiscal › Cálculos fiscales › Percepciones».
  - La **percepción de IIBB del régimen general** va a la misma factura, con la alícuota de la jurisdicción. [MELI-NOTE-IVA] [MELI-NOTE-IIBB-PERC]
- **El reporte «Facturación de Mercado Pago».** Se baja en `.xlsx` o `.csv`; para importar conviene `.csv`. Trae:
  - Nº de factura fiscal, número de movimiento, detalle, fecha del cargo y **valor del cargo**;
  - tipo de operación, **operación relacionada** (el número de la operación de Mercado Pago), **tipo de pago** (Checkout, Link de pago, Point, QR o billetera), referencia externa, cliente y valor de la operación;
  - alícuota y base imponible de las percepciones. [MELI-NOTE-FACT]
- **Con factura A, el «Valor del cargo» ya incluye el 21 % de IVA.** Sumando los cargos del servicio, sin percepciones ni bonificaciones, y dividiendo por 1,21 da el **subtotal de la factura**. [MELI-NOTE-FACT-CONC]
  - Consecuencia: el import puede calcular el IVA de cada comisión (`MP_FEE_AMOUNT − MP_FEE_AMOUNT/1,21`) y dejarlo como **IVA crédito fiscal a documentar** hasta que llegue la factura (§4.6).
- **La misma información por API**, con la API de facturación de Mercado Libre y `group=MP` [ML-BILLING] [ML-BILLING-DL] [ML-BILLING-PERC] [ML-BILLING-PAY]:

| Paso | Endpoint |
|---|---|
| Períodos | `GET https://api.mercadolibre.com/billing/integration/monthly/periods?group=MP&document_type=BILL` (devuelve `key` = día 1 del mes, `amount`, `unpaid_amount`, `period_status`) |
| Facturas del período | `GET …/billing/integration/periods/key/{KEY}/documents?group=MP&document_type=BILL` (`files[].file_id` en PDF o XML) |
| Bajar la factura en PDF | `GET …/billing/integration/legal_document/{FILE_ID}` |
| Reporte de conciliación (CSV o XLSX) | `POST …/billing/integration/periods/key/{KEY}/reports` con `{"group":"MP","document_type":"BILL","report_format":"CSV"}`, después `GET …/reports/{fileId}/status`, después `GET …/reports/{fileId}` |
| Percepciones (solo Argentina) | `GET …/periods/key/{KEY}/perceptions/summary?group=MP` y `GET …/billing/integration/group/MP/perceptions/details?document_id=…&tax_type=…&tax_id=…` |
| Resumen | `GET …/periods/key/{KEY}/summary/details`. Hay que llamarlo de a uno («No recomendamos utilizar este endpoint dentro de un procesamiento batch»). Si se abusa, responde **429 por IP**. |

- **Si estos endpoints aceptan el Access Token de una aplicación de Mercado Pago: A CONFIRMAR.** La doc de Mercado Pago usa ese mismo token contra `https://api.mercadolibre.com/users/me` [MP-CRED], así que la identidad es la misma. El permiso para facturación está por ver.
- **Quién la emite:** las páginas de Mercado Pago en Argentina dicen «MercadoLibre S.R.L.». **El CUIT del emisor se toma de la factura: A CONFIRMAR.**
- **ARCA:** como es una factura electrónica, debería aparecer en «Mis Comprobantes Recibidos» de HUB. **A CONFIRMAR** (tema del agente de ARCA).

### 1.6 Cómo distinguir QR, Point, link y transferencia

| Señal | QR | Point (lector) | Link de pago | Transferencia recibida | Retiro o transferencia saliente |
|---|---|---|---|---|---|
| Liquidaciones `DESCRIPTION` | `payment` | `payment` | `payment` | `payment` (obs.) | `payout` |
| `OPERATION_TAGS` [MP-LIQ-CAMPOS] | `QR` | `PO` | A CONFIRMAR | vacío (obs.) | — |
| `BUSINESS_UNIT` / `SUB_UNIT` | `Mercado Pago` / `QR` (obs., pagos con QR) | A CONFIRMAR (¿«Point»?) | A CONFIRMAR (¿«Link de pago»?) | vacíos (obs.) | vacíos (obs.) |
| `POS_ID` / `STORE_ID` | sí: la caja y la sucursal del QR | puede venir | no | no | no |
| `POI_ID` | no | **sí: el número de serie del lector** | no | no | no |
| `PAYMENT_METHOD_TYPE` / `PAYMENT_METHOD` | `account_money` (`available_money` en Todas las transacciones, obs.), `credit_card`, `debit_card`… | `credit_card`, `debit_card`, `prepaid_card` | varios | **`bank_transfer` con `cvu`** (del banco al CVU) o con `debin_transfer`; o `account_money` / `available_money` (desde otra cuenta de Mercado Pago) (obs.) | vacío |
| `POI_WALLET_NAME` / `POI_BANK_NAME` | se completan cuando el QR es **interoperable** (pagan con otra billetera o banco) | — | — | — | — |
| `PAYOUT_BANK_ACCOUNT_NUMBER` | — | — | — | — | **la cuenta destino** |
| API `point_of_interaction.type` | `INSTORE` (obs.) | `POINT` (obs.), con `device.serial_number` | A CONFIRMAR (¿`CHECKOUT`?) | — | no aparece en payments |
| API `point_of_interaction.business_info` | `unit: wallet`, `sub_unit: qr`, `branch: QR` (obs.) | A CONFIRMAR | A CONFIRMAR (el SDK pone de ejemplo `online_payments` / `checkout_pro`) | — | — |
| API `operation_type` | `regular_payment` (obs.) | A CONFIRMAR (`regular_payment` o `pos_payment`) | `regular_payment` | `money_transfer` o **`account_fund`** (`bank_transfer` / `cvu`) (obs.) | — |

Fuentes: [MP-LIQ-CAMPOS], [MP-TT-CAMPOS], [GH-GRANJA-V2], [GH-GRANJA-V3], [GH-ARIAN-QR], [GH-ARIAN-PLAN], [MP-SDK-TYPES].

La ayuda de Mercado Pago de México define `SUB_UNIT` como «Point, QR, Link de pago, etc.». Eso viene del resumen del buscador; los valores exactos en Argentina están **A CONFIRMAR**.

**Regla práctica para el clasificador:** se aplica una tabla de reglas en orden.
1. `OPERATION_TAGS` o `SUB_UNIT`.
2. `POI_ID` (Point).
3. `POS_ID` o `STORE_ID` (QR).
4. `PAYMENT_METHOD_TYPE = bank_transfer` (transferencia).

Si nada coincide, la fila queda «sin clasificar» y se pide revisión. Las reglas son **editables** y se ajustan con el primer reporte real de HUB.

### 1.7 Impuestos que va a ver HUB (SAS responsable inscripta en Córdoba)

| Concepto | Cuándo lo aplica Mercado Pago | Alícuota | Cómo aparece | Comprobante | Cuenta actual (`system_key`) |
|---|---|---|---|---|---|
| **IIBB SIRTAC** (retención) | «cada vez que cobrás con Mercado Pago». En cobros presenciales (Point o QR), **la jurisdicción es la dirección del negocio registrada en Mercado Pago**. Córdoba está adherida a SIRTAC. [MELI-NOTE-IIBB-RET] | Según el padrón de COMARB: **0 % a 5 %**. Si no está inscripto, puede haber una adicional. | Liquidaciones: dentro de `TAXES_AMOUNT` y como ítem de `TAXES_DISAGGREGATED` (formato para Córdoba **A CONFIRMAR**). Si no se pudo aplicar en el pago, como fila `tax_withdholding`. API: `charges_details[type=tax]`; obs. en Neuquén: `tax_withholding_sirtac_noinsc-neuquen`. [GH-ARIAN-PLAN] | Certificados en Información fiscal › Cálculos fiscales › Retenciones, durante los primeros 5 días hábiles del mes siguiente. [MELI-NOTE-IIBB-RET] | `iibb_withholdings` (Retenciones de IIBB sufridas, tarjetas y plataformas) |
| **IIBB SIRCUPA** (recaudación) | «solo en las transferencias de terceros e ingresos de dinero que recibas en Mercado Pago si te encontrás dentro del padrón de SIRCUPA». Córdoba está adherida. [MELI-NOTE-IIBB-RET] | **0,01 % a 5 %** según el padrón, en letras de la A a la Z. [CA-RG9-2022] | Lo mismo que SIRTAC, pero en las filas de transferencias recibidas. Formato **A CONFIRMAR**. | Según la RG CA 9/2022, «el detalle de las retenciones sufridas en los resúmenes o extractos emitidos por los agentes de recaudación… les servirán como comprobante suficiente». También están en SIFERE › Módulo Consultas para los contribuyentes de Convenio Multilateral. | `iibb_sircupa` (Recaudaciones IIBB SIRCUPA, billeteras) |
| **Créditos y débitos (Ley 25.413)** | Solo personas jurídicas (HUB es una SAS). Lo cobra en ventas y cobros, en compras, pagos y envíos con dinero en cuenta, en la recepción e ingreso de dinero y en los retiros en efectivo. **«No son alcanzadas… las transferencias… entre cuentas… de la misma persona jurídica»**. Si se paga con tarjeta, lo aplica el banco emisor. [MELI-NOTE-ICD] | **0,6 %** (obs.: 0,60 % en 283 filas de 283). [GH-GRANJA-V3] La tabla oficial es una imagen. | Liquidaciones: ítem `debitos_creditos` / `tax_withholding_collector` en cobros. En pagos con saldo: `tax_withholding_payer`. En retiros a terceros: `tax_withholding_payout` (obs.). API: `tax_withholding_collector-debitos_creditos`, con `rate` 0.6 (obs.). | Certificado para Ganancias en Información fiscal › Cálculos fiscales › Retenciones, los primeros días hábiles de cada mes. | `bank_tax_credit` (la parte computable) + `bank_tax_expense` (el resto) |
| **Cuánto de ese impuesto se computa en Ganancias** | — | Micro y pequeñas empresas: **100 %**. Medianas industriales del tramo 1: **60 %**. Grandes y medianas: **33 %**. [MELI-NOTE-ICD] | — | — | Hoy el módulo usa 33 % por defecto (`bankTaxCreditComputableBp`). **A CONFIRMAR con la contadora** si HUB tiene certificado MiPyME micro o pequeña: en ese caso es 100 %. |
| **Percepción de IVA** | Se agrega a la factura mensual. Se calcula **solo sobre los cargos**. [MELI-NOTE-IVA] | La tabla oficial es una imagen: A CONFIRMAR. | Factura mensual. Si se descuenta del saldo, como débito `tax_iva` u otro similar (**A CONFIRMAR**). | La factura (sirve como certificado). | `vat_perceptions` |
| **Percepción de IIBB** | Régimen general, en la factura mensual. [MELI-NOTE-IIBB-PERC] | Según la jurisdicción. Si está inscripto pero no figura en el padrón: 6 %. | Igual que la anterior. | La factura. | `iibb_perceptions` |
| **Retenciones de IVA y Ganancias** | **Eliminadas desde el 01/09/2024** por la RG 5554/2024. [MELI-NOTE-IVA] | — | No deberían aparecer. Si aparecen, se alerta. | — | `vat_withholdings` / `income_tax_withholdings` |

Hay un aviso de Mercado Pago que conviene incluir en el instructivo. Las inscripciones de IIBB tienen que estar al día. «Algunas las leemos directamente del fisco, pero te solicitaremos que otras las cargues manualmente… desde Facturación › Información fiscal». La condición de responsable inscripto Mercado Pago la toma sola de ARCA, en unos 4 días hábiles; se ve en «Mi perfil › Mis datos». [MELI-NOTE-RI]

**A CONFIRMAR con la contadora:** si HUB es contribuyente local de Córdoba o de Convenio Multilateral. Eso cambia cómo se descuentan SIRCUPA y SIRTAC en la declaración jurada: SIFERE para Convenio Multilateral, o el sistema de Rentas Córdoba para contribuyentes locales.

### 1.8 Retiros al banco y transferencias salientes

- **En Liquidaciones:**
  - la fila es `DESCRIPTION = payout` con `NET_DEBIT_AMOUNT`;
  - `EXTERNAL_REFERENCE` trae el «ID generado por Coelsa, entidad que procesa el retiro hacia otra cuenta» y `PAYOUT_BANK_ACCOUNT_NUMBER` la cuenta destino completa [MP-LIQ-CAMPOS];
  - antes del retiro aparecen dos filas `reserve_for_payout` que suman 0 (obs.);
  - si el destino es un tercero, aparece el impuesto en `tax_withholding_payout`; los retiros a cuenta propia no lo tuvieron (obs.). [GH-GRANJA-V3]
- **En Todas las transacciones:** la doc dice `WITHDRAWAL`, `WITHDRAWAL_CANCEL` o `PAYOUT`; en la realidad apareció **`PAYOUTS`** (obs.).
- **En Otras operaciones:** `activities_withdraw`, con `bank_account` y `provider_id` (Coelsa). [MP-ACT-CAMPOS]
- **Para el import:** HUB carga una vez sus CBU y CVU propios. Si `PAYOUT_BANK_ACCOUNT_NUMBER` coincide, es una **transferencia de Mercado Pago al banco**. Si no, es un **pago a un tercero** que hay que asignar a un proveedor (va a revisión).

### 1.9 Transferencias recibidas al CVU

- **En Liquidaciones:** `payment`.
- **En Todas las transacciones** (obs.): `SETTLEMENT` con:
  - `PAYMENT_METHOD_TYPE = bank_transfer` y `PAYMENT_METHOD = cvu` (49 filas) o `debin_transfer` (10 filas);
  - `PAY_BANK_TRANSFER_ID` completo y `SALE_DETAIL = "Bank Transfer"`;
  - el dinero que llega desde otra cuenta de Mercado Pago figura como `available_money`. [GH-GRANJA-V3]
- **En la API** (obs., 960 cobros): `operation_type` `money_transfer` (con `account_money`, `bank_transfer/debin_transfer`, `credit_card` o `digital_currency`) o **`account_fund`** (`bank_transfer` / `cvu`). [GH-GRANJA-V2]
- **Costo:** en esos datos no hubo **comisión**; solo el 0,6 % de créditos y débitos (obs.). Si HUB figura en el padrón, se suma SIRCUPA. **A CONFIRMAR para HUB.**
- **Riesgo para la conciliación.** No toda transferencia recibida es una venta. Puede ser:
  - un aporte de un socio;
  - plata que la SAS mueve desde su propio banco;
  - un reintegro de un proveedor.

  La señal más limpia de una cuenta propia es que `PAYER_ID_NUMBER` sea el CUIT de HUB. Esa columna es un dato personal: se compara **en memoria** y se guarda solo un booleano (§4.5). Hay otra señal posible: un `account_fund` sin impuesto de créditos y débitos (obs.: un caso de 200.000 sin cargos). Como heurística, **A CONFIRMAR**.

### 1.10 Otros movimientos típicos de un bar

- **Propinas por QR:** fila `tip` en Liquidaciones y `TIP_AMOUNT` en Todas las transacciones. No son ventas. El plan de cuentas actual **no tiene una cuenta de propinas** (§4.9).
- **Vueltos digitales:** `digitalchange_transaction`.
- **Rendimientos:** `asset_management`, con una fila por día (obs.). Hoy se cargan con el atajo `mp_yield`.
- **Adelantos y préstamos de Mercado Pago:** `fee_release_in_advance` y `credit_payment`.
- **Plazos de liberación:** las tasas y plazos que elige HUB en `https://www.mercadopago.com.ar/settings/release-options` definen **cuándo se libera** cada cobro. [MP-LIQ-INTRO] **A CONFIRMAR si HUB cobra con liberación al instante.**

---

## 2. API

### 2.1 Base

- Las llamadas van a `https://api.mercadopago.com`, con el header `Authorization: Bearer <ACCESS_TOKEN>`. Mercado Pago recomienda **mandar el token en el header y no en la URL**. [MP-CRED]
- Para saber de qué cuenta es el token y validarlo: `GET https://api.mercadolibre.com/users/me` (ejemplo de la doc de Mercado Pago). Se guarda el `id` (lo que la API llama `collector_id`) y se verifica `site_id = MLA`. [MP-CRED]

### 2.2 Liquidaciones (`release_report`): endpoints y configuración

| Acción | Método y ruta | Notas |
|---|---|---|
| Crear la configuración | `POST /v1/account/release_report/config` | Devuelve 201. |
| Ver la configuración | `GET /v1/account/release_report/config` | |
| Cambiar la configuración | `PUT /v1/account/release_report/config` | Si cambia `frequency` con la programación activa, primero se desactiva, después se cambia y al final se reactiva. |
| **Generar un reporte** | `POST /v1/account/release_report` con `{"begin_date":"…Z","end_date":"…Z"}` en **UTC** | **202 Accepted** (`status: pending`, `id`). **203** quiere decir que «no fue posible crear tu reporte» y hay que pedirlo de nuevo con las fechas que indica el sistema. Errores: `invalid_begin_date`, `invalid_end_date`, `end_date_before_begin_date`. |
| Estado de la tarea | `GET /v1/account/release_report/task/{task_id}` | `status` (ejemplo: `processing`). `file_name` está en `null` hasta que termina. |
| Listar | `GET /v1/account/release_report/list` | Cada ítem trae `id`, `begin_date`, `end_date`, `created_from` (`manual` o `schedule`), `status` (ejemplo: `processed`, `deleted`), `format` y `file_name`. |
| Buscar | `GET /v1/account/release_report/search?…` | Filtros: `id`, `file_name`, `begin_date`, `end_date`, `created_from`, `range=date_created` y otros. `limit` hasta **500** y `offset` hasta **10000**. |
| **Bajar** | `GET /v1/account/release_report/{file_name}` | 200 con el archivo `.csv` o `.xlsx`. 404 `not_found`. |
| Programar | `POST /v1/account/release_report/schedule` | Pone `scheduled=true`. Usa la `frequency` de la configuración. |
| Desprogramar | `DELETE /v1/account/release_report/schedule` | |

Fuentes: [MP-LIQ-API] [MP-REF-REL-CREATE] [MP-REF-REL-TASK] [MP-REF-REL-SEARCH] [MP-REF-REL-DL].

**Campos de la configuración** [MP-LIQ-API]:
- `columns` (`[{key}]`) y `file_name_prefix`;
- `frequency` (`{hour, type: daily|weekly|monthly, value}`). Configurarla **no** activa nada: hace falta llamar a `/schedule`;
- `sftp_info` y `separator` (por defecto `,`);
- `display_timezone` (por defecto `GMT-04`);
- `report_translation` (`en`, `es` o `pt`; **cambia los encabezados**) y `notification_email_list`;
- `include_withdrawal_at_end`, `execute_after_withdrawal` y `scheduled` (solo lectura);
- `check_available_balance` (agrega las filas de saldo antes y después de cada retiro, «puramente informativo»);
- `compensate_detail` (los bloqueos y desbloqueos que se compensan).

**Configuración propuesta para HUB.** Si el bar conecta el token, la app la deja aplicada sola. Que también valga para los reportes que se bajan a mano desde el panel está **A CONFIRMAR**, aunque es la misma configuración de la cuenta.

```json
{
  "file_name_prefix": "hub-liquidaciones",
  "display_timezone": "GMT-03",
  "separator": ",",
  "include_withdrawal_at_end": true,
  "execute_after_withdrawal": false,
  "check_available_balance": false,
  "notification_email_list": ["<mail de administración de HUB>"],
  "frequency": { "hour": 6, "type": "daily", "value": 1 },
  "columns": [
    {"key":"DATE"},{"key":"SOURCE_ID"},{"key":"EXTERNAL_REFERENCE"},{"key":"RECORD_TYPE"},{"key":"DESCRIPTION"},
    {"key":"NET_CREDIT_AMOUNT"},{"key":"NET_DEBIT_AMOUNT"},{"key":"GROSS_AMOUNT"},{"key":"BALANCE_AMOUNT"},
    {"key":"MP_FEE_AMOUNT"},{"key":"FINANCING_FEE_AMOUNT"},{"key":"SHIPPING_FEE_AMOUNT"},{"key":"COUPON_AMOUNT"},{"key":"EFFECTIVE_COUPON_AMOUNT"},
    {"key":"TAXES_AMOUNT"},{"key":"TAX_DETAIL"},{"key":"TAXES_DISAGGREGATED"},
    {"key":"TRANSACTION_DATE"},{"key":"TRANSACTION_APPROVAL_DATE"},
    {"key":"PAYMENT_METHOD"},{"key":"PAYMENT_METHOD_TYPE"},{"key":"INSTALLMENTS"},
    {"key":"OPERATION_TAGS"},{"key":"BUSINESS_UNIT"},{"key":"SUB_UNIT"},{"key":"SEGMENT_DETAIL"},
    {"key":"POS_ID"},{"key":"POS_NAME"},{"key":"EXTERNAL_POS_ID"},{"key":"STORE_ID"},{"key":"STORE_NAME"},{"key":"EXTERNAL_STORE_ID"},
    {"key":"POI_ID"},{"key":"POI_WALLET_NAME"},{"key":"POI_BANK_NAME"},
    {"key":"PAYOUT_BANK_ACCOUNT_NUMBER"},{"key":"CURRENCY"},
    {"key":"ORDER_ID"},{"key":"ORDER_MP"},{"key":"TRANSACTION_INTENT_ID"},{"key":"METADATA"},
    {"key":"PAYER_ID_TYPE"},{"key":"PAYER_ID_NUMBER"}
  ]
}
```

- **No se agregan** `PAYER_NAME`, `CARD_INITIAL_NUMBER`, `LAST_FOUR_DIGITS` ni `SALE_DETAIL`: son datos personales o no hacen falta.
- `PAYER_ID_TYPE` y `PAYER_ID_NUMBER` entran **solo** para detectar transferencias desde cuentas propias, con la regla de comparar y descartar de §4.5. Si no se quiere tocar nada personal, se sacan y esas transferencias se clasifican a mano.
- **`compensate_detail`:** queda afuera porque su efecto es ambiguo. La doc lo describe como «Blocking and unblocking of money that offset each other… recommended setting if you have a large volume of transactions». Un tercero recomienda activar en el panel «Ocultar movimientos de reserva compensados» para que no aparezcan los `reserve_for_payout`. [GH-BINDERPLUS] **Qué hace exactamente cada valor: A CONFIRMAR.** El parser ignora los pares `reserve_*` igual.
- **El `value` de `frequency` cuando el tipo es `daily`: A CONFIRMAR.**

### 2.3 Todas las transacciones (`settlement_report`)

Usa las mismas rutas cambiando `release_report` por `settlement_report`: `/config` (POST, GET y PUT), `POST /v1/account/settlement_report` (202), `GET /task/{task-id}`, `GET /list`, `GET /search` (`limit` hasta 500, `offset` hasta 10000), `GET /{file_name}` y `/schedule` (POST y DELETE).
- La respuesta de `list` y `search` trae `file_name` con este formato: `settlement-report-USER_ID-2022-10-12-104118.csv`.
- «Selección de fechas vía API: UTC».

[MP-TT-API] [MP-TT-GEN] [MP-REF-SET-CREATE] [MP-REF-SET-TASK] [MP-REF-SET-SEARCH]

### 2.4 Otras operaciones (`/v1/reporting/operations/{reportId}`)

- **Configuración:** `POST /config` con `structure` (`name`, `columns[].key`, `file_format` con separadores de columna y de decimales, formato de fecha, nombre y prefijo, `display_timezone`) y `notifiers[]` (`webhook` con `url` y `key`, `ftp`, `ftp_pkey`, `internal_sftp`). También `GET /config` y `PUT /config/{structureId}`.
- **Generar:** `POST /statements` con `{"filters":{"creation_date":{"range":{"gte":"2026-03-01T00:00:00-03:00","lte":"2026-03-31T23:59:59-03:00"}}}}`, que devuelve `record_id`. Errores: **409** `export_already_requested` y **400** `invalid_date_range`.
- **Seguir y bajar:** `GET /statements/{uid}` para el estado, `GET /statements` para el listado y `GET /statements/{uid}/download` para el archivo.
- **Programar:** `POST /schedule` y `DELETE /schedule/{scheduleId}`.
- **Aviso:** el webhook manda `report_id`, `statement_id`, `status` y `files[]`. La firma se valida con la `key` del notificador; **el algoritmo y el header de esa firma: A CONFIRMAR**.

[MP-ACT-API] [MP-REF-ACT-CREATE] [MP-REF-ACT-CONFIG]

### 2.5 `/v1/payments/search` (y `GET /v1/payments/{id}`)

**Parámetros** [MP-REF-PAY-SEARCH] [MP-PAY-MGMT] [MP-SDK-TYPES]:
- `sort` (`date_approved`, `date_created`, `date_last_updated`, `id`, `money_release_date`) y `criteria` (`asc` o `desc`);
- `range` (`date_created`, `date_last_updated`, `date_approved`, `money_release_date`), con `begin_date` y `end_date` en ISO o `NOW-30DAYS` (también `MINUTES`, `HOURS`, `WEEKS` y `DAYS` hasta 365);
- filtros: `external_reference`, `store_id`, `pos_id`, `collector.id`, `payer.id`, `status`, `operation_type`, `payment_type_id`, `payment_method_id`.

**Límites:**
- Busca solo en los **últimos 12 meses**, y cada rango tiene que ser **menor a 365 días** (error 9062).
- `limit`: 30 por defecto y **50 como máximo según la doc**. Un tercero paginó de a 100 sin errores (obs.), así que el máximo real está **A CONFIRMAR**.
- `offset`: **hasta 10000**. Si un rango tiene más resultados, se parte en rangos más chicos.

**Campos útiles:**

| Campo | Para qué sirve | Ojo con |
|---|---|---|
| `id` | Es el mismo `SOURCE_ID` de los reportes (obs., verificado). | |
| `status`, `status_detail` | Distinguir `approved/accredited` de `refunded`, `charged_back`, `in_mediation` y demás. | |
| `operation_type` | `regular_payment`, `money_transfer`, `account_fund`, `pos_payment`, `recurring_payment`, `investment`, `payment_addition`, `cellphone_recharge`, `money_exchange`. | |
| `payment_type_id`, `payment_method_id` | Medio de pago. | |
| `date_created`, `date_approved` | Fechas de creación y de aprobación. | La API devuelve offset `-04:00` (obs.). Hay que convertir a la hora de Córdoba. |
| `money_release_date`, `money_release_status` (`pending` o `released`) | Cuándo se libera el cobro. | |
| `transaction_amount` | Bruto. | |
| `transaction_details.net_received_amount` | Neto. | Vale 0 si el pago fue rechazado. |
| `transaction_details.total_paid_amount` | Lo que pagó el cliente, incluidos los cargos que absorbe él. | |
| `fee_details[]` (`type`: `mercadopago_fee`, `financing_fee`, `coupon_fee`, `shipping_fee`, `application_fee`, `discount_fee`; `fee_payer`: `collector` o `payer`) | La comisión. | En transferencias vino **vacío** (obs.). |
| `charges_details[]` (`type` fee o tax, `name`, `rate`, `base_amount`, `accounts.from` y `.to`, `amounts.original` y `.refunded`) | **El desglose más completo.** Ejemplo de QR (obs.): `mercadopago_fee` con rate 0.97 sobre 67.800 = 657,66, y `tax_withholding_collector-debitos_creditos` con rate 0.6 = 406,80. | **No está documentado.** [GH-GRANJA-V2] [GH-ARIAN-QR] |
| `taxes_amount` | Total de impuestos según la doc. | **Llegó en 0 con una retención del 0,6 % aplicada** (obs.). No usarlo. |
| `point_of_interaction` (`type`, `business_info.unit/sub_unit/branch`, `device.serial_number`), `pos_id`, `store_id` | El canal (§1.6). | |
| `collector_id` | Separar cobros de pagos. | **search también devuelve pagos donde la cuenta es la que paga** (obs.: 40 de 1000), así que hay que filtrar por `collector.id`. |

**Qué no trae `/v1/payments/search`:**
- retiros y transferencias salientes (`payout`);
- rendimientos;
- débitos de percepciones y de la factura;
- bloqueos y desbloqueos (`reserve_*`);
- `tax_withdholding` cobrados después;
- el saldo.

Sí incluye los pagos que HUB hace con su saldo (como pagador).

### 2.6 Qué conviene para la conciliación diaria

| Criterio | Liquidaciones (API o CSV) | Todas las transacciones | `/v1/payments/search` |
|---|---|---|---|
| ¿Explica el saldo de Mercado Pago? | **Sí**: saldo inicial, total y `BALANCE_AMOUNT`. | Parcial: no tiene columna de saldo. | No. |
| Retiros, rendimientos, impuestos mensuales, bloqueos | **Sí** | Retiros sí (`PAYOUTS`); lo demás, parcial. | No |
| Comisión e impuestos por cobro | Sí, con `TAXES_DISAGGREGATED`. | Sí | Solo con `charges_details` (no documentado). |
| ¿Qué tan rápido llega? | Tarda minutos en generarse; diario. | Igual | Casi en vivo |
| Fecha que manda | La de **liberación** (`DATE`). | La de **aprobación** (`SETTLEMENT_DATE`). | La que se elija con `range`. |
| Período por pedido | 60 días | 60 días | Menos de 365 días, dentro de los últimos 12 meses. |

**Recomendación:**
- **Contabilidad:** Liquidaciones, una vez por día, para el día anterior.
- **«Lo cobrado hoy» por canal en el panel:** `payments/search` con `range=date_last_updated`, que además detecta devoluciones y contracargos al cambiar el estado.
- **Ventas con liberación diferida:** cruzarlas con Todas las transacciones o con `money_release_date`.
- **Una vez por mes:** la factura de Mercado Pago, el reporte «Facturación de Mercado Pago» y los certificados de retención.

### 2.7 Webhooks (opcional, para tiempo casi real)

- Se configuran en «Tus integraciones › Webhooks › Configurar notificaciones».
- Para cobros sirve el tema **`payment`** (Pagos). Para aplicaciones con OAuth está el tema **`mp-connect`** (Vinculación de aplicaciones), que avisa cuando un bar vincula o desvincula la aplicación.
- **Firma:**
  - el header `x-signature` trae `ts=…,v1=…`;
  - el manifiesto es `id:[data.id];request-id:[x-request-id];ts:[ts];`;
  - se calcula un HMAC-SHA256 en hexadecimal con la clave secreta de la aplicación.
- La configuración desde «Tus integraciones» **no está disponible para integraciones de QR**. Las notificaciones de QR no se pueden verificar con la firma.

[MP-WEBHOOKS]

**A CONFIRMAR:** si llegan webhooks de cobros que **no** creó la aplicación, como QR estático, Point sin integrar o transferencias. Si no llegan, el sync diario sigue siendo la base.

### 2.8 Trampas técnicas

1. **Las fechas usan zonas distintas.**
   - El pedido de reporte va en UTC. Un día de Argentina D se pide como `D 03:00:00Z` a `D+1 02:59:59Z`.
   - Las columnas vienen en GMT-4 por defecto, o en `-03:00` en los exports del panel (obs.).
   - La API de pagos devuelve `-04:00` (obs.).
   - Regla: **siempre se lee el offset del string** y se pasa a `America/Argentina/Cordoba`.
2. **Día calendario o día de servicio.** El bar cobra después de medianoche. Si el cierre de ventas usa «día de servicio» (corte a las 05:00, como el tablero operativo), hay que agrupar Mercado Pago con el mismo corte. **A CONFIRMAR con la contadora** qué fecha contable usar.
3. **Los encabezados pueden cambiar de idioma** con `report_translation` o `header_language`. El parser trabaja con las claves en inglés y, si no las encuentra, con un diccionario de equivalencias. **Los textos exactos de los encabezados en español: A CONFIRMAR.**
4. **Separador y comillas.**
   - El separador es `,` por defecto en la API y `;` en exports reales del panel (obs.): hay que detectarlo solo.
   - Las comillas son `"` (por ejemplo en `SALE_DETAIL`).
   - Viene en UTF-8 sin BOM.
5. **Los montos no son centavos.** Vienen con 2 decimales y punto. Se convierten a **centavos (`bigint`) desde el texto, nunca con `float`**.
6. **`TAXES_DISAGGREGATED` y `METADATA` pueden no ser JSON**: se leen de forma tolerante (§4.5).
7. **Las cuentas de prueba devuelven reportes vacíos.** Las pruebas se hacen con la cuenta real de HUB.
8. **Límites de pedidos.** No encontré límites de pedidos por minuto documentados para estos endpoints: **A CONFIRMAR**.
   - `payments/search` documenta el error «Already posted the same request in the last minute».
   - La API de facturación responde 429 por IP.
   - Se reintenta con backoff exponencial.
9. **Región de Vercel.** No encontré restricciones geográficas para la API de Mercado Pago, así que llamarla desde Vercel `iad1` debería funcionar. **A CONFIRMAR** con una llamada de prueba.
10. **No usar endpoints sin documentar**, como el viejo `/mercadopago_account/movements/search`. El reporte «Available money» se dio de baja el 01/03/2022 (resumen del buscador). La vía oficial son los reportes.

---

## 3. El Access Token

### 3.1 Paso a paso para el dueño (desde la computadora)

1. Entrar a **https://www.mercadopago.com.ar/developers/panel/app** con la cuenta de Mercado Pago **de la SAS**, la que cobra con QR y Point. «Tus integraciones» no está disponible para menores de edad. [MP-YI-INTRO]
2. Tocar **«Crear aplicación»**; si es la primera, aparece como «Crear en el panel de integraciones». [MP-DASH]
   - En «Elegí una solución» marcar **Código QR** o **Mercado Pago Point**. Para los reportes da lo mismo cuál: **A CONFIRMAR**.
   - Ponerle un nombre, por ejemplo «HUB Administración (conciliación)».
   - Aceptar la Declaración de Privacidad y los Términos, y tocar «Crear aplicación».
3. En el menú de la izquierda ir a **Producción › Credenciales de producción** y completar los datos del negocio. [MP-CRED]
   - **Industria**: Gastronomía.
   - **Sitio web (obligatorio)**: la web o el Instagram del bar. Qué URL acepta: **A CONFIRMAR**.
   - Aceptar los términos, completar el reCAPTCHA y tocar **«Activar credenciales de producción»**.
4. Aparecen cuatro datos: **Public Key, Access Token, Client ID y Client Secret**. Se copia el **Access Token** (empieza con `APP_USR-`) y se pega en Administración › Mercado Pago › Conectar. [MP-CRED]
   - La app lo valida con `/users/me` y lo guarda cifrado.
   - Client ID y Client Secret solo se usan para OAuth.
5. **Opcional:** en «Editar datos › Configuración avanzada › Permisos de la aplicación» aparecen **read**, **offline access** y **write**, todos marcados por defecto. [MP-APPDET] **A CONFIRMAR** si quitando `write` se pueden seguir generando reportes. Si se puede, conviene desmarcarlo.

Alternativa sin copiar y pegar el token: compartir las credenciales con la cuenta de Mercado Pago del desarrollador, hasta 10 veces. Sirve para la puesta en marcha, no como mecanismo permanente. [MP-CRED]

### 3.2 Qué permite el token

- **Es la clave privada de la aplicación.** Se usa «en el backend para generar pagos». Da acceso a la API **como si fuera la cuenta**: cobros, devoluciones, reportes y datos. Por eso se trata como una contraseña bancaria. [MP-CRED]
- **Permisos.** Las aplicaciones tienen `read`, `write` y `offline_access`. En OAuth, el token recibido declara su `scope` con esos valores. [MP-APPDET] [MP-OAUTH-REF]
- **Vencimiento del token propio de producción.** No hay vencimiento documentado: deja de servir cuando se lo **renueva**. **A CONFIRMAR** que no vence.
- **Cuándo se invalida.** Mercado Pago lista estos casos para los tokens: [MP-CRED] [MP-OAUTH-MGMT]
  - vencimiento;
  - **cambio de contraseña** del dueño;
  - revocación de la autorización;
  - un «lavado de credenciales» que hace el equipo de fraude;
  - limpieza de sesiones;
  - **borrado de la aplicación**.
- Consecuencia de diseño: cualquier 401 marca la conexión como «Reconectar Mercado Pago» y avisa por la UI.

### 3.3 Recomendaciones de seguridad

- Cifrarlo en la base con `pgp_sym_encrypt`, con una clave propia del entorno, como se hace con los tokens de Meta (CLAUDE.md §8).
- Usarlo **solo** del lado del servidor: cron o route handler con `service_role` y `tenant_id` explícito (CLAUDE.md §4). Nunca llega al navegador ni a los logs.
- Siempre en el header `Authorization`, nunca en la URL. [MP-CRED]
- Una **aplicación dedicada** a la conciliación. Si se filtra el token, se usa la opción **«Renovar»** en Credenciales de producción. Hay que tener en cuenta que renovar invalida el token anterior, también para otras integraciones de esa aplicación. [MP-CRED]
- En la UI mostrar solo los últimos 4 caracteres. Que conectar y desconectar sea solo para quien configura Administración, y que quede en `audit_log`.
- Los datos personales de `PAYER_*` no se guardan ni se loguean (CLAUDE.md §9). Mercado Pago aclara que esos datos «solo se podrá usar para conciliar». [MP-LIQ-CAMPOS]

### 3.4 Plataforma con muchos bares: ¿hace falta OAuth?

**Para HUB hoy alcanza con el token propio.** Si la plataforma va a conectar muchos bares, **conviene OAuth**, el mismo criterio que con Meta: cada tenant conecta su cuenta. Así el bar no tiene que crear una aplicación y puede revocar el acceso.

**Cómo funciona el flujo authorization code** [MP-OAUTH] [MP-OAUTH-CREATE] [MP-OAUTH-RENEW] [MP-OAUTH-REF]:
1. **La aplicación de la plataforma**, de studiOS, carga una **Redirect URL estática** con `https`, por ejemplo `https://<app>/api/mercadopago/oauth/callback`. Conviene activar **PKCE** (`code_challenge` y `code_challenge_method=S256`).
2. **El bar autoriza.** Se lo lleva a `https://auth.mercadopago.com/authorization?client_id=APP_ID&response_type=code&platform_id=mp&state=RANDOM_ID&redirect_uri=…`.
   - `state` es un valor único por intento, que sirve contra CSRF y para saber qué tenant inició el pedido.
   - La `redirect_uri` tiene que coincidir exactamente con la cargada en la aplicación.
3. **Se canjea el código.** Llega `code` (dura **10 minutos** y se usa una sola vez). Se canjea con `POST https://api.mercadopago.com/oauth/token`, mandando `client_id`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri` y, si hay PKCE, `code_verifier`.
   - La respuesta trae `access_token` (`APP_USR-…`), `token_type: bearer`, `expires_in: 15552000` (**180 días**), `scope`, `user_id`, `refresh_token`, `public_key` y `live_mode`.
4. **Renovación.** Se renueva antes de vencer con `grant_type=refresh_token`. **Cada renovación devuelve un refresh token nuevo, que hay que guardar.** Solo funciona si el `scope` incluye `offline_access`.
   - Propuesta: un cron que renueve a los 150 días.
   - Si la renovación falla con `invalid_grant`, la conexión pasa a «Reconectar».
5. **Bajas.** El tema de webhook **`mp-connect`** avisa cuando un bar vincula o desvincula la aplicación. [MP-WEBHOOKS]

- **Otro flujo, `client_credentials`:** da un token de **6 horas** para la propia cuenta de la aplicación. No sirve para cuentas de terceros. Para HUB solo cambiaría guardar el token por guardar el Client Secret, que es igual de sensible. [MP-OAUTH-CREATE]
- **A CONFIRMAR:** que los endpoints de reportes (`/v1/account/release_report` y demás) acepten tokens obtenidos por OAuth. No hay documentación explícita. Para pagos es el uso normal de los marketplaces.

---

## 4. Diseño recomendado del import

### 4.1 Principios

1. **Un solo normalizador.** El CSV subido y el CSV bajado por API pasan por el **mismo parser**. Los dos generan las mismas filas normalizadas y los mismos asientos.
2. **Idempotente.** Volver a importar no duplica: las filas iguales se ignoran y las que cambiaron van a revisión (§4.5).
3. **Lo desconocido va a revisión**, nunca se descarta. Mercado Pago agrega columnas y valores sin avisar (§1.2).
4. **Reutiliza el motor contable actual.** El import propone la misma «acreditación» de Mercado Pago que hoy se carga a mano (`collection` y «Ajustar saldo de Mercado Pago», E.5.7 y E.5.8), con descuentos por tipo y su `salesMethodId` (QR o transferencia). También usa `transfer`, `bank_expense` y `cash_movement` (`mp_yield`) para el resto de los movimientos.
5. **Sin datos personales en la base ni en los logs.** Todo en centavos (`bigint`). Cada tabla lleva `tenant_id`, RLS y GRANT (CLAUDE.md §4 y §5).

### 4.2 De dónde sale cada dato

| Dato | Fuente principal | Respaldo |
|---|---|---|
| Saldo de Mercado Pago y sus movimientos | **Liquidaciones** | Todas las transacciones |
| Bruto, comisión, impuestos y neto de cada cobro | Liquidaciones (`GROSS`, `MP_FEE`, `TAXES_DISAGGREGATED`) | `payments` (`charges_details`) |
| Canal (QR, Point, link o transferencia) | Liquidaciones (`OPERATION_TAGS`, `SUB_UNIT`, `POI_ID`, `POS_ID`, `PAYMENT_METHOD_TYPE`) | `payments.point_of_interaction` |
| IVA de las comisiones (el comprobante) | **Factura mensual** y reporte «Facturación de Mercado Pago» | Cálculo `fee/1,21` mientras tanto |
| Percepciones de IVA e IIBB | Factura mensual y resumen de percepciones | — |
| Certificados de SIRTAC, SIRCUPA y créditos y débitos | Información fiscal › Cálculos fiscales › Retenciones | Los propios resúmenes de Mercado Pago (RG CA 9/2022) |
| Ventas del día por medio (lo que dice Thinkeon) | Cierre de ventas manual (sprint 1) | Futuro POS propio |

### 4.3 Camino A: subir el CSV (siempre disponible)

1. **Configuración, una sola vez.** Si el bar no conectó el token, la configura a mano. En **Liquidaciones › Configuración** (`/balance/reports/release/settings`) se eligen:
   - las columnas de §2.2;
   - zona horaria GMT-3;
   - encabezados en inglés;
   - separador coma.

   Los nombres exactos de los botones del panel están **A CONFIRMAR**. Si el token está conectado, la app hace el `PUT /config` sola. [MP-LIQ-GEN]
2. **Bajar el reporte.** Informes y facturación › Reportes de ventas y extractos de cuenta › **Liquidaciones › Crear reporte**.
   - Elegir las fechas: **60 días como máximo**.
   - Tocar «Generar» y esperar el mail («En preparación»).
   - **Descargar en .csv.** [MP-LIQ-PANEL] [MELI-NOTE-LIQ]
3. **Subirlo en Administración › Mercado Pago › Importar.** El parser:
   - detecta el tipo de reporte por los encabezados;
   - detecta el separador;
   - valida el control de cada fila y del archivo (§1.2).
4. **Vista previa (sin grabar nada):**
   - período cubierto, saldo inicial y saldo final;
   - cantidad de filas nuevas, repetidas y para revisión;
   - totales por canal, comisiones, impuestos por tipo, retiros y rendimientos;
   - valores desconocidos.
5. **Confirmar.** Se graban las filas y se proponen los comprobantes. Lo que no se clasifica queda en una **bandeja de revisión**.
6. **Además, una vez por mes:**
   - subir la factura de Mercado Pago en PDF o cargar sus totales;
   - subir el reporte «Facturación de Mercado Pago»;
   - subir los certificados de retención, para el número de certificado y como respaldo.

### 4.4 Camino B: sync automático por API (cron de Vercel)

- **Job diario** `/api/cron/mp-sync`, con `CRON_SECRET` como los otros. Corre a las 06:30 de Argentina (09:30 UTC) y hace esto para cada tenant conectado:
  1. `POST /v1/account/release_report` con el **día anterior** en UTC. Si se usa día de servicio, el rango va de 05:00 a 05:00.
  2. Guarda el `id` del pedido y le pregunta a `task/{id}` o a `search?id=…` cada pocos minutos, con backoff, hasta que el estado sea `processed`. Dentro de un mismo job o con un job de reintento.
  3. Baja el archivo con `GET /v1/account/release_report/{file_name}` y lo pasa por **el mismo parser del camino A**.
  4. **Opcional:** `payments/search` con `range=date_last_updated` desde la última corrida menos 1 hora de solapamiento, filtrando por `collector.id`, para el tablero en vivo y para detectar devoluciones y contracargos.
- **Otra opción: programar el reporte en Mercado Pago** con `POST /schedule` y frecuencia diaria, y después leer `list` o `search` (`created_from=schedule`).
  - Sirve igual, pero generarlo a pedido es **más determinista**: el sistema elige el rango y se puede volver a correr o completar huecos.
- **Carga inicial de la historia.** Hay que cubrir desde que la SAS empezó a cobrar:
  - con reportes por API en **ventanas de 60 días como máximo**, mejor de a un mes;
  - o con `activities_collection` y `activities_withdraw`, que admiten 1 año pero **no traen el desglose de impuestos**.
- **Errores:**
  - 401: la conexión pasa a «Reconectar» y se avisa.
  - 203 al generar: se reintenta con las fechas que sugiere Mercado Pago.
  - 429 o 5xx: backoff exponencial.
  - En todos los casos queda registrado en el lote, con estados y mensajes en español.
- **Mensual:** con la API de facturación (`group=MP`) se bajan la factura en PDF y el reporte CSV. Si el token no sirve para esa API (A CONFIRMAR), queda como carga manual.

### 4.5 Normalización y claves

- **Tablas sugeridas.** Todas con `tenant_id not null`, RLS, GRANT y `created_at` / `updated_at`.
  - `mp_connections`:
    - datos de la cuenta: `mp_user_id`, `site_id`, `auth_kind` (`token` u `oauth`);
    - secretos: `access_token_enc`, `refresh_token_enc`, `expires_at`, `scopes`;
    - estado: `status`, `last_sync_at`;
    - configuración: `own_accounts` (los CBU y CVU propios), `treasury_account_id` (la caja «Mercado Pago» del plan).
    - Los secretos se leen **solo** por RPC o con `service_role`.
  - `mp_import_batches`: `source` (`csv` o `api`), `report_kind` (`release`, `settlement` o `payments`), `period_from` y `period_to`, `file_name`, `file_sha256`, contadores, `status`, `error`, `created_by`.
  - `mp_movements`, la fila normalizada:
    - identificación: `row_key` (único por tenant), `source_id`, `record_type`, `description`;
    - fechas: `released_at`, `approved_at`, `business_date`;
    - importes en centavos: `gross`, `fee`, `financing_fee`, `taxes`, `net`, `balance_after`;
    - canal: `payment_method_type`, `payment_method`, `channel` (`qr`, `point`, `link`, `transfer_in`, `payout_own`, `payout_third`, `tip`, `yield`, `tax`, `refund`, `chargeback`, `reserve`, `other`), `pos_id`, `store_id`, `poi_id`;
    - otros: `payout_account_masked`, `from_own_cuit`, `raw` (sin columnas personales);
    - resultado: `status` (`pending`, `posted`, `ignored`, `review`), `document_id`.
  - `mp_movement_taxes`: `movement_id`, `financial_entity`, `detail`, `amount_cents`, `mapped_kind`.
  - `mp_mapping_rules`: reglas **editables por la contadora**. Toman (`description` | `financial_entity` + `detail` | señales de canal) y devuelven un tipo y una cuenta. Vienen precargadas con lo de §4.6.
- **`row_key`.** Es el hash de `SOURCE_ID|DESCRIPTION|RECORD_TYPE|DATE|NET_CREDIT|NET_DEBIT|GROSS`. La dirección y la fecha entran porque los pares `reserve_*` y las devoluciones parciales repiten `SOURCE_ID` (obs.).
  - Si la clave ya existe con el mismo contenido, se ignora.
  - Si `(SOURCE_ID, DESCRIPTION, DATE)` coincide pero cambiaron los montos, va a revisión.
  - Un mismo cobro visto en Liquidaciones y en Todas las transacciones comparte `SOURCE_ID` (obs.), lo que permite cruzarlos sin duplicar el asiento. [GH-GRANJA-V3 §16]
- **Lectura tolerante de `TAXES_DISAGGREGATED` y `METADATA`.**
  1. Primero se intenta `JSON.parse`.
  2. Si falla, se toma cada `{…}` con `/\{([^}]*)\}/g`, se parte por `,` y después por el primer `:`, y se le sacan las comillas a cada valor.
  3. Por último se valida que `Σ amount = TAXES_AMOUNT`. Si no da, la fila va a revisión.
- **Cuenta propia sin guardar datos personales.**
  - Para transferencias recibidas: `from_own_cuit = (PAYER_ID_TYPE='CUIT' && PAYER_ID_NUMBER == CUIT de HUB)`, calculado en memoria. El valor original no se guarda.
  - Para retiros: `PAYOUT_BANK_ACCOUNT_NUMBER ∈ own_accounts`, guardando solo los últimos 4 dígitos.

### 4.6 De la fila al asiento (con las `system_key` que ya existen)

**La acreditación diaria (E.5.8):** un comprobante por día y por canal.

| Línea | Lado | Cuenta | Origen |
|---|---|---|---|
| Neto de Mercado Pago | D | Caja o billetera «Mercado Pago» | `net` |
| Comisión sin IVA | D | Comisiones de Mercado Pago (`4.2.01.05.002`, vía `commissionKeyFor`) | `MP_FEE_AMOUNT / 1,21` |
| IVA de la comisión | D | `vat_credit_pending` mientras no hay factura; después `vat_credit` | `MP_FEE − neto de comisión` |
| SIRTAC (cobros) | D | `iibb_withholdings` (descuento `ret_iibb`) | `TAXES_DISAGGREGATED` |
| SIRCUPA (transferencias) | D | `iibb_sircupa` (descuento `sircupa`) | `TAXES_DISAGGREGATED` |
| Créditos y débitos en cobros | D | `bank_tax_credit` (parte computable) y `bank_tax_expense` (resto) | `debitos_creditos` / `tax_withholding_collector`. **Hoy no existe ese tipo de descuento en la acreditación** (§4.9). |
| Bruto vendido | H | `receivable_wallets` («Mercado Pago a acreditar») con el medio (`salesMethodId`) | Σ `GROSS` del canal |
| Diferencia | D o H | `reconciliation_differences` | Lo que no explica el cierre del día |

**Ejemplo con un cobro real con QR**, saneado (obs.) [GH-ARIAN-QR]:
- bruto 67.800,00;
- comisión 657,66 con IVA, que se separa en 543,52 de neto y 114,14 de IVA;
- créditos y débitos 406,80 (0,6 %);
- neto 66.735,54.

El asiento queda así: D Mercado Pago 66.735,54 · D Comisiones 543,52 · D IVA CF a documentar 114,14 · D 25.413 computable o gasto 406,80 · H Mercado Pago a acreditar 67.800,00.

**Los otros movimientos:**

| Movimiento | Comprobante del módulo | Cuentas |
|---|---|---|
| `payout` a cuenta propia | `transfer` (E.5.10) | D Banco · H Mercado Pago |
| `payout` a un tercero | Pago a proveedor (revisión: elegir proveedor y comprobante) | D Proveedor · H Mercado Pago |
| `tax_withholding_payout` / `_payer` | `bank_expense` (Ley 25.413 en débitos) | `bank_tax_credit` y `bank_tax_expense` · H Mercado Pago |
| `asset_management` | `cash_movement` con el atajo `mp_yield` | D Mercado Pago · H Rendimientos |
| `tax_withdholding` (IIBB cobrado después) | `bank_expense` u otro movimiento | `iibb_withholdings` o `iibb_sircupa` · H Mercado Pago |
| Débito de la factura o de las percepciones | Pago de la factura mensual | D Proveedor «MercadoLibre S.R.L.» · H Mercado Pago |
| Factura mensual (Libro IVA Compras) | Factura de compra | D Comisiones (si no se registraron) o baja de `vat_credit_pending` · D `vat_credit` · D `vat_perceptions` · D `iibb_perceptions` · H Proveedor |
| `tip` | Movimiento con la cuenta de propinas | D Mercado Pago · H Propinas a distribuir (**cuenta nueva, A CONFIRMAR**) |
| `refund`, `chargeback`, `dispute`, `restriction` | Revisión | — |
| `reserve_*` compensados | Ignorados | — |

La factura mensual necesita un detalle propio, sin duplicar la comisión que ya se descontó cobro por cobro. Propuesta:
- se registra con el IVA contra `vat_credit_pending`, como ya prevé el módulo con «comprobante de la comisión… si llega después»;
- las percepciones van como deuda con Mercado Pago, que se cancela cuando aparece el débito en Liquidaciones.

**A CONFIRMAR con la contadora.**

### 4.7 Controles automáticos

1. **Saldo:** `initial_available_balance + Σ movimientos = total`, y el `BALANCE_AMOUNT` de la última fila contra el saldo de libro de la caja «Mercado Pago». Si difieren, se muestra en el arqueo («Ajustar saldo»).
2. **Por cada fila:** la identidad de §1.2. Si no se cumple, la fila va a revisión.
3. **Cobros contra cierre:** Σ `GROSS` de los cobros del día y del canal contra lo cargado en el cierre del día (QR, Point, transferencia). La diferencia queda a la vista: transferencias que no son ventas, propinas o ventas cargadas en otro medio.
4. **API contra reporte:** `payment.id = SOURCE_ID`, con el mismo bruto y neto (obs.). Si difieren, alerta.
5. **Mensual:** Σ (comisiones de cargos de servicio) / 1,21 contra el subtotal de la factura; el IVA contra la línea de IVA; las percepciones contra sus líneas. [MELI-NOTE-FACT-CONC]

### 4.8 Qué hay que cargar a mano al empezar (lo relacionado con Mercado Pago)

- **Fecha de corte y saldo inicial de Mercado Pago a esa fecha:** sale de `initial_available_balance` del primer reporte.
- **CBU y CVU propios de la SAS**, para distinguir los retiros de los pagos a terceros.
- **CUIT de HUB**, que ya está en el módulo.
- **Si HUB es micro o pequeña empresa MiPyME**, para usar el 100 % o el 33 % de créditos y débitos como computable.
- **Si HUB está inscripta en IIBB Córdoba como contribuyente local o en Convenio Multilateral.**
- **Los plazos de liberación elegidos** en Mercado Pago.
- **Qué hacer con las propinas por QR.**
- **Las reglas de canal**, si el primer reporte muestra valores nuevos de `SUB_UNIT` u `OPERATION_TAGS`.
- **Cada mes:** la factura de Mercado Pago, si no se puede bajar por API, y los certificados.

### 4.9 Huecos del módulo de Administración actual

1. **La acreditación no tiene un tipo de descuento para la Ley 25.413.**
   - `DEDUCTION_KINDS` = `comision`, `iva_comision`, `percepcion_iva_comision`, `ret_iva`, `ret_iibb`, `sircupa`, `ret_ganancias`, `otro`, `diferencia`.
   - Ese impuesto hoy existe solo en `bank_expense`, con el reparto entre computable y gasto (`lib/accounting/posting/treasury.ts`).
   - Mercado Pago lo descuenta **en cada cobro**. Hace falta un tipo `ley_25413` en `collection` que reparta igual.
2. **No hay cuenta de propinas a distribuir** en `lib/accounting/chart.ts`.
3. **SIRTAC contra SIRCUPA.** La precarga actual (`prefillDeductions`) tiene `ret_iibb` y `sircupa`. El import tiene que mandar SIRTAC (cobros) a `ret_iibb` (`iibb_withholdings`) y SIRCUPA (transferencias) a `sircupa`. La descripción de `iibb_sircupa` hoy dice «Lo que Mercado Pago descuenta de Ingresos Brutos sobre lo que entra», y eso es solo la parte de transferencias.
4. **El porcentaje computable** de créditos y débitos está en 33 % por defecto. Puede ser 100 % si HUB es micro o pequeña empresa (§1.7).

### 4.10 Cuando llegue el POS propio

Para QR y Point, Mercado Pago empuja la **API de Orders** (tema de webhook `orders`) [MP-WEBHOOKS]. Si el POS crea cada cobro con `external_reference` igual al **id del ticket**, la conciliación pasa a ser **uno a uno y automática**: `EXTERNAL_REFERENCE` aparece en los reportes y en la API.

---

## 5. A CONFIRMAR (lista consolidada)

1. Los valores reales de `SUB_UNIT`, `BUSINESS_UNIT` y `OPERATION_TAGS` para **Point** y **Link de pago** en Argentina. En QR se vio `Mercado Pago` / `QR`.
2. Cómo vienen **SIRTAC y SIRCUPA de Córdoba** en `TAXES_DISAGGREGATED` (`financial_entity` y `detail`) y en `charges_details[].name`.
3. Si una aplicación **sin permiso `write`** puede generar y bajar reportes (`POST /v1/account/release_report`).
4. Si los endpoints de reportes aceptan **tokens de OAuth** de terceros.
5. Si la **API de facturación de Mercado Libre** (`group=MP`) acepta el token de una aplicación de Mercado Pago.
6. El **máximo real de `limit`** en `payments/search`: la doc dice 50 y un tercero usó 100 sin errores.
7. Qué hace exactamente `compensate_detail` y la opción del panel «Ocultar movimientos de reserva compensados».
8. Los **textos exactos de los encabezados en español** cuando se usa `report_translation=es`.
9. Los **nombres de los botones** del panel para configurar las columnas de Liquidaciones.
10. Si llegan **webhooks `payment`** de cobros que no creó la aplicación (QR estático, Point, transferencias).
11. Si el **token propio de producción no vence**: no hay vencimiento documentado.
12. Qué **URL acepta el campo «Sitio web (obligatorio)»** al activar credenciales, y si da lo mismo qué producto se elige al crear la aplicación.
13. Los **plazos de liberación** que tiene configurados HUB, y si hay comisión en las transferencias recibidas (en los datos de terceros no la hubo).
14. Con la contadora:
    - si HUB tiene certificado **MiPyME micro o pequeña** (100 % de créditos y débitos computable);
    - si es **contribuyente local de Córdoba o de Convenio Multilateral**;
    - cómo tratar las **propinas por QR**;
    - la **fecha contable** (día calendario o día de servicio);
    - el circuito de la **factura mensual** y el débito de percepciones.
15. El **CUIT del emisor** de la factura de Mercado Pago («MercadoLibre S.R.L.» según el sitio) y si aparece en **Mis Comprobantes Recibidos de ARCA**.
16. Los **límites de pedidos por minuto** de los endpoints de reportes y pagos: no están documentados.
17. Desde cuándo están disponibles para cuentas de Argentina los **reportes de Otras operaciones**, y cómo se firma su webhook.
18. Que no haya **restricción geográfica** al llamar desde Vercel `iad1`.

---

## 6. Qué tiene que hacer el dueño de HUB, en resumen (para los instructivos)

- **Una sola vez, 10 minutos desde la computadora:**
  1. Crear la aplicación y activar las credenciales de producción.
  2. Copiar el Access Token y pegarlo en Administración.
  3. Cargar los CBU y CVU propios.

  Desde ahí, la app configura el reporte y lo importa sola todos los días.
- **Si no quiere conectar el token:** una vez por semana o por mes, bajar **Liquidaciones** en .csv (60 días como máximo) y subirlo.
- **Una vez por mes** (o automático si la API de facturación funciona):
  - bajar la **factura de Mercado Pago** y el reporte **«Facturación de Mercado Pago»** en Facturación › mes;
  - bajar los **certificados** en Información fiscal › Cálculos fiscales › Retenciones y Percepciones.
- **Revisar la bandeja** de movimientos sin clasificar: transferencias que no son ventas, pagos a terceros, propinas y devoluciones.

---

## 7. Fuentes

**Oficiales de Mercado Pago (Argentina)**

| Id | URL | Qué se tomó |
|---|---|---|
| MP-REP-INTRO | https://www.mercadopago.com.ar/developers/es/docs/reports/introduction | Tipos de reporte y sus nombres en español |
| MP-LIQ-INTRO | https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/introduction | Qué es Liquidaciones, cambios de octubre de 2022, solo desde la computadora, cuentas de prueba vacías |
| MP-LIQ-USO | https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/how-to-use | Secciones, crédito y débito |
| MP-LIQ-GEN | https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/generate | 60 días, GMT-4, formatos, webhook con BCrypt |
| MP-LIQ-PANEL | https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/panel | Pasos en el panel y generar al retirar |
| MP-LIQ-CAMPOS | https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/report-fields | Glosario completo (columnas y `DESCRIPTION`) |
| MP-LIQ-API | https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/api | Endpoints, configuración, 202 y 203, CSV de ejemplo |
| MP-TT-INTRO | https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/introduction | Todas las transacciones |
| MP-TT-USO | https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/how-to-use | `TRANSACTION_TYPE` |
| MP-TT-GEN | https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/generate | Características técnicas, fechas en UTC por API |
| MP-TT-CAMPOS | https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/report-fields | Glosario |
| MP-TT-API | https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/api | Endpoints y configuración |
| MP-ACT-INTRO | https://www.mercadopago.com.ar/developers/es/docs/reports/activities-reports/introduction | Otras operaciones |
| MP-ACT-GEN | https://www.mercadopago.com.ar/developers/es/docs/reports/activities-reports/generate | Características y notificadores |
| MP-ACT-API | https://www.mercadopago.com.ar/developers/es/docs/reports/activities-reports/api | Flujo de la API |
| MP-ACT-CAMPOS | https://www.mercadopago.com.ar/developers/es/docs/reports/activities-reports/report-fields | Campos |
| MP-REF-REL-CREATE | https://www.mercadopago.com.ar/developers/es/reference/releases-report/create-report/post | 202 y errores |
| MP-REF-REL-TASK | https://www.mercadopago.com.ar/developers/es/reference/releases-report/search-task/get | `task/{id}` |
| MP-REF-REL-SEARCH | https://www.mercadopago.com.ar/developers/es/reference/releases-report/search-report/get | `search`, límites 500 y 10000 |
| MP-REF-REL-DL | https://www.mercadopago.com.ar/developers/es/reference/releases-report/download-report/get | Descarga |
| MP-REF-SET-CREATE | https://www.mercadopago.com.ar/developers/es/reference/settlements-report/create-report/post | Generar Todas las transacciones |
| MP-REF-SET-TASK | https://www.mercadopago.com.ar/developers/es/reference/settlements-report/query-task-status/get | Tarea |
| MP-REF-SET-SEARCH | https://www.mercadopago.com.ar/developers/es/reference/settlements-report/search-report/get | Búsqueda |
| MP-REF-ACT-CREATE | https://www.mercadopago.com.ar/developers/es/reference/reports/create-activity-report/post | `statements`, 409 y 400 |
| MP-REF-ACT-CONFIG | https://www.mercadopago.com.ar/developers/es/reference/reports/create-activity-report-configuration/post | `structure` y `notifiers` |
| MP-REF-PAY-SEARCH | https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api-payments/search-payments/get | Parámetros, 12 meses, error de 365 días |
| MP-PAY-MGMT | https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/payment-management | `limit` hasta 50, `offset` hasta 10000, `NOW-x` |
| MP-CRED | https://www.mercadopago.com.ar/developers/es/docs/your-integrations/credentials | Credenciales, activación, renovar, compartir, token en el header |
| MP-DASH | https://www.mercadopago.com.ar/developers/es/docs/your-integrations/dashboard | Crear aplicación |
| MP-YI-INTRO | https://www.mercadopago.com.ar/developers/es/docs/your-integrations/introduction | Tus integraciones, no disponible para menores |
| MP-APPDET | https://www.mercadopago.com.ar/developers/es/docs/your-integrations/application-details | Permisos `read`, `offline_access` y `write`, Redirect URL, PKCE |
| MP-OAUTH | https://www.mercadopago.com.ar/developers/es/docs/security/oauth/introduction | Flujos, `code` de 10 minutos, refresh de 6 meses |
| MP-OAUTH-CREATE | https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation | Authorization code, PKCE, `client_credentials` de 6 horas |
| MP-OAUTH-RENEW | https://www.mercadopago.com.ar/developers/es/docs/security/oauth/renewal | 180 días, refresh rotativo, `offline_access` |
| MP-OAUTH-MGMT | https://www.mercadopago.com.ar/developers/es/docs/security/oauth/management | Causas de invalidación |
| MP-OAUTH-REF | https://www.mercadopago.com.ar/developers/es/reference/authentication/oauth/_oauth_token/post | Respuesta: `expires_in` 15552000 y `scope` |
| MP-WEBHOOKS | https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks | Temas, `x-signature`, restricción de QR |
| MP-SDK-TYPES | https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/payment/commonTypes.ts · https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/payment/search/types.ts | `fee_details`, `charges_details`, `point_of_interaction.business_info` |

**Oficiales de Mercado Libre / Mercado Pago para vendedores (Argentina)**

| Id | URL | Qué se tomó |
|---|---|---|
| MELI-NOTE-LIQ | https://vendedores.mercadolibre.com.ar/nota/lleva-el-control-de-tu-dinero-con-el-reporte-de-liquidaciones | Liquidaciones contra Todas las transacciones, `reserve_`, `payout` |
| MELI-NOTE-RI | https://vendedores.mercadolibre.com.ar/nota/responsables-inscriptos-en-mercado-pago | Impuestos para responsables inscriptos, RG 5554/2024, condición fiscal |
| MELI-NOTE-IVA | https://vendedores.mercadolibre.com.ar/nota/iva-y-ganancias-para-responsables-inscriptos-en-mercado-pago | Percepción de IVA en la factura mensual, débito al vencimiento |
| MELI-NOTE-IIBB-RET | https://vendedores.mercadolibre.com.ar/nota/retencion-iibb-para-responsables-inscriptos-en-mercado-pago | SIRTAC, SIRCUPA, jurisdicciones, certificados |
| MELI-NOTE-IIBB-PERC | https://vendedores.mercadolibre.com.ar/nota/percepcion-iibb-para-responsables-inscriptos-en-mercado-pago | Percepción de IIBB en la factura |
| MELI-NOTE-ICD | https://vendedores.mercadolibre.com.ar/nota/icd-para-responsables-inscriptos-en-mercado-pago | Créditos y débitos para personas jurídicas, exención entre cuentas propias, cómputo en Ganancias |
| MELI-NOTE-FACT | https://vendedores.mercadolibre.com.ar/nota/reporte-de-conciliacion-de-mercado-pago-como-analizarlo | Reporte «Facturación de Mercado Pago» |
| MELI-NOTE-FACT-CONC | https://vendedores.mercadolibre.com.ar/nota/como-puedo-conciliar-el-reporte-de-conciliacion-de-mercado | Valor del cargo con 21 % de IVA, dividir por 1,21 |
| ML-BILLING | https://developers.mercadolibre.com.ar/es_ar/reportes-de-facturacion | Períodos, documentos y resumen (`group=MP`) |
| ML-BILLING-DL | https://developers.mercadolibre.com.ar/es_ar/reportes-descargas | PDF de la factura y reporte de conciliación |
| ML-BILLING-PERC | https://developers.mercadolibre.com.ar/es_ar/resumen-percepciones | Percepciones (solo Argentina) |
| ML-BILLING-PAY | https://developers.mercadolibre.com.ar/es_ar/reportes-pagos | Pagos de facturas |

**Normativa**

| Id | URL | Qué se tomó |
|---|---|---|
| CA-RG9-2022 | https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-9-2022-369722/texto | SIRCUPA: vigencia desde el 01/10/2022, alícuotas de la A a la Z, comprobante y SIFERE |

**Secundarias (prensa)**

| Id | URL | Qué se tomó |
|---|---|---|
| IPROF-2025 | https://www.iprofesional.com/impuestos/441279-ingresos-brutos-que-retenciones-aplican-cuando-cobras-por-mercado-pago | SIRCUPA, SIRTAC y dónde ver las retenciones |
| DIARIOCAST | https://diariocastellanos.com.ar/especiales/2025/11/10/ingresos-brutos-que-retenciones-aplican-cuando-cobras-por-mercado-pago.htm | Ruta Facturación › Información fiscal › Cálculos fiscales › Retenciones, alícuotas de créditos y débitos |

**Evidencia empírica de terceros** (repos públicos; no son documentación oficial)

| Id | URL | Qué se tomó |
|---|---|---|
| GH-GRANJA-V3 | https://github.com/franabregu22/claudio-app-granja/blob/main/.planning/implementation-design/ADR006_V3_ACCOUNT_MONEY_ADDENDUM.md | Análisis de exports reales de Argentina de septiembre de 2026: 60 columnas, `;`, `PAYOUTS`, `TAXES_DISAGGREGATED` no JSON, `SOURCE_ID` estable, pares `reserve_*`, `asset_management`, 0,6 % |
| GH-GRANJA-V2 | https://github.com/franabregu22/claudio-app-granja/blob/main/.planning/implementation-design/ADR006_V2_PAYMENT_FIELD_EVIDENCE.md | 1000 pagos reales vía API: `money_transfer` y `account_fund`, `charges_details`, `taxes_amount` = 0, páginas de 100 |
| GH-ARIAN-QR | https://github.com/Arian023/mp-webhook-api/blob/main/docs/examples/Payments/GET%20Payments%20200.%20Cobro%20con%20QR.json | Pago QR real saneado: `INSTORE`, `wallet/qr`, comisión 0,97 % e impuesto 0,6 % |
| GH-ARIAN-PLAN | https://github.com/Arian023/mp-webhook-api/blob/main/docs/PLAN.md | `point_of_interaction.type` `POINT` e `INSTORE`, `tax_withholding_sirtac_noinsc-neuquen` |
| GH-BINDERPLUS | https://github.com/binderplus/preprocesador_mercadopago | Ejemplo de `TAXES_DISAGGREGATED`, `payment` como transferencia recibida y `payout` como enviada, opción de ocultar reservas compensadas |

**Código del repo consultado (solo lectura):**
- `lib/accounting/chart.ts`: cuentas `receivable_wallets`, `iibb_sircupa`, `iibb_withholdings`, `bank_tax_credit`, `vat_credit_pending`, `vat_perceptions`, `iibb_perceptions` y otras.
- `lib/accounting/posting/collection.ts`: E.5.7 y E.5.8, `prefillDeductions`.
- `lib/accounting/schemas.ts`: `DEDUCTION_KINDS`.
- `lib/accounting/posting/treasury.ts`: Ley 25.413 y `mp_yield`.
