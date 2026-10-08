# Topic C — «Mis Comprobantes» de ARCA: formatos de exportación, descarga automática, deduplicación y datos de proveedores

> Investigación hecha entre el 07 y el 08/10/2026 para HUB! Coffee & Bar (SAS, responsable inscripto en IVA).
> Todo dato no obvio lleva su fuente (URL). Lo que no pude verificar con una fuente oficial, una muestra real o una
> implementación en producción queda marcado **A CONFIRMAR**.
> Muestras reales analizadas (sin copiar datos de terceros: los ejemplos de este documento están anonimizados):
> 2 ZIP originales bajados del portal el 25/08/2025 (Recibidos y Emitidos), 2 CSV de Recibidos de nov. y dic. 2025,
> 2 CSV de Portal IVA de oct. 2025, y el código de 12 implementaciones abiertas que leen estos archivos (Odoo/Adhoc,
> Mr Bot, SOS Contador, Afip SDK, etc.).

---

## 0. Resumen en 15 líneas

1. **No existe un web service oficial de ARCA para listar ni bajar los comprobantes recibidos.** El catálogo oficial solo
   tiene la *constatación* de un comprobante puntual (WSCDC) y, para Factura de Crédito MiPyME, `consultarComprobantes`
   de WSFECRED. Todo lo demás (Afip SDK, Mr Bot, scripts) automatiza el portal con la clave fiscal.
2. **Automatizar el portal está prohibido por la Disposición AFIP 74/2022** (art. 11: «Se prohíbe el acceso a los
   sistemas y servicios interactivos… a través de herramientas automatizadas»), con sanciones de blanqueo, segundo factor
   o bloqueo temporal de la clave (art. 14). No encontré que la hayan derogado. Recomendación: **semiautomático**. Una
   persona baja el ZIP (1 minuto por mes) y lo arrastra a la app, y la app hace todo lo demás.
3. **Formato vigente (desde ~01/09/2025):** CSV dentro de un ZIP, UTF-8 sin BOM, separador `;`, coma decimal sin
   separador de miles, fechas `aaaa-mm-dd`, tipo de comprobante como **código** (`1`, `3`, `11`…). **Recibidos tiene
   30 columnas** y **Emitidos 28**, con neto e IVA **por alícuota** más `Imp. Neto Gravado Total`, `Otros Tributos`,
   `Total IVA` e `Imp. Total`.
4. El **Excel** trae las mismas columnas con nombres cortos (`Fecha`, `Tipo`, `Neto Grav. IVA 21%`…). La fila 1 es un
   título («Mis Comprobantes Recibidos - CUIT …») y la fila 2 tiene los encabezados. El tipo viene como texto
   «1 - Factura A».
5. Hubo **tres generaciones** de formato: ≤oct-2023 (coma, 16 col.), oct-2023→ago-2025 (`;`, 17 col., con
   `Otros Tributos`) y sep-2025→hoy (`;`, 30/28 col. por alícuota). El parser tiene que aceptar las tres.
6. **Las notas de crédito vienen en positivo.** El signo sale del código de comprobante. Los códigos de NC/ND salen de la
   tabla oficial de ARCA.
7. **La moneda extranjera viene en la moneda original** (aunque el archivo se llame «montos expresados en pesos»). Hay
   que multiplicar por `Tipo Cambio`.
8. **En el formato vigente el total cuadra con la suma de los componentes salvo redondeo** (≤ $0,55 en las muestras). En
   el formato 2023–2025, ~10 % de las filas (casi todas facturas A) tenían un residuo de ~3 % del neto, que eran
   percepciones sin informar.
9. **Factura B, Factura C y recibos C traen solo `Imp. Total`** (las columnas de neto e IVA vienen en 0).
10. `Otros Tributos` es **un solo número**: no separa percepción de IVA, de IIBB, internos ni municipales. El CSV de
    compras de **Portal IVA** sí los separa (fuente alternativa, §11).
11. **Clave de deduplicación:** `(CUIT emisor, código de comprobante, punto de venta, número)`. **No usar el CAE**,
    porque con CAEA el mismo código se repite en muchas facturas del mismo emisor (en las muestras aparece hasta 17 veces).
12. **No existe el estado «anulada»:** una anulación es otra fila (NC o ND), y el export no trae el comprobante asociado.
13. **Llegan tarde:** el emisor puede autorizar hasta 5 días corridos después de la fecha (bienes) o 10 (servicios).
    Conviene re-importar el mes anterior hasta ~día 11 o usar una ventana solapada.
14. **Datos de proveedor:** el export trae CUIT + razón social oficial. La condición frente al IVA, el domicilio y la
    actividad salen del padrón (`ws_sr_constancia_inscripcion`, hasta 250 CUIT por llamada, con certificado). Además
    conviene un chequeo semanal contra la base pública de apócrifos (APOC).
15. **Advertencia para el repo:** el índice único actual de compras usa `voucher_type` (letra interna). Factura A
    (código 1) y FCE A (código 201) con el mismo PV y número **chocarían**. Conviene que la clave use el código ARCA (§8.8).

---

## 1. Qué es «Mis Comprobantes» y qué trae (y qué no)

- Es el servicio interactivo de ARCA (con clave fiscal) para consultar los comprobantes **emitidos** y **recibidos** de
  una CUIT. Se habilita en el «Administrador de Relaciones de Clave Fiscal»
  ([Contadores en Red/Tributum 2018](https://www.consejosalta.org.ar/wp-content/uploads/INFO.-GRAL.-MIS-COMPROBANTES.pdf)).
  El nivel de clave exigido queda **A CONFIRMAR**: las guías de terceros hablan de nivel 3 para los servicios de
  facturación.
- Pestañas «Emitidos» y «Recibidos». Filtros: fecha (rango), tipo, punto de venta, rango de números, CUIT del emisor o del
  receptor y código de autorización
  ([Fudo, act. 11/02/2026](https://soporte.fu.do/es/articles/11731368-seccion-documentos-recibidos-descargar-facturas-en-el-arca);
  los mismos filtros figuran en la automatización de
  [Afip SDK](https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-via-api/): `t` E/R, `fechaEmision`,
  `puntosVenta`, `tiposComprobantes`, `comprobanteDesde/Hasta`, `tipoDoc`, `nroDoc`, `codigoAutorizacion`).
- Se puede exportar a **CSV** (llega como **ZIP**), **Excel** y **PDF**
  ([Xubio](https://ayuda.xubio.com/es-ar/como-importo-mis-facturas-de-compra-desde-afip/): «ARCA genera un ZIP»).
- **Rango máximo de consulta: 365 días**, desde oct-2023; antes era mensual
  ([Contadores en Red, 11/10/2023](https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/)).
- **Con más de 500 comprobantes, el portal solo ofrece CSV** (desaparecen Excel y PDF). Lo reportó una usuaria el
  24/10/2023 en la misma nota. Si sigue vigente con la interfaz 2025–2026 queda **A CONFIRMAR**. Para un bar con
  cientos de tiques por día, **Emitidos siempre va a superar ese límite**, así que conviene diseñar todo sobre CSV.
- **Qué aparece en Recibidos:** los comprobantes electrónicos con CAE o CAEA donde el receptor es tu CUIT (en personas
  humanas también los que se emitieron a su DNI: el CSV vigente trae `Tipo Doc. Receptor` y `Nro. Doc. Receptor`, y
  [holistor-uploader](https://github.com/Fedee17/holistor-uploader/blob/main/index.html) documenta casos con DNI en vez
  de CUIT). También aparecen tiques de controlador fiscal: el código 81 «Tique Factura A» se observó en imports reales
  ([SOS Contador Skill](https://github.com/Santi-RL/SOS_Contador_Skill/blob/main/sos-contador-api/references/mis-comprobantes-afip.md)).
- **Qué NO aparece** (y habrá que cargar a mano o por otra vía):
  - comprobantes en papel (CAI). Desde el 01/11/2026 quedan solo para contingencias por la
    [RG ARCA 5893/2026](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5893.pdf);
  - tiques a consumidor final **sin** la CUIT de HUB (por ejemplo, el súper si no se pide factura A);
  - facturas del exterior (plataformas extranjeras), sueldos, impuestos (DDJJ/VEP) y gastos sin comprobante;
  - por ahora, las comisiones de bancos, tarjetas y billeteras que se descuentan en la liquidación. La
    [RG ARCA 5866/2026](https://web.cpcecba.org.ar/?p=67697) (vigente desde el 01/07/2026) crea la «liquidación
    electrónica mensual», con un único comprobante mensual por cliente. Para entidades financieras, administradoras
    de tarjetas y participantes de sistemas de pago el cronograma corre de oct–dic 2026 a marzo 2027. A partir de ahí
    esas comisiones **deberían** empezar a verse en Recibidos. El tipo y el código de comprobante quedan **A CONFIRMAR**.
- **Llegan tarde:** para bienes, «su transferencia electrónica… no podrá exceder los 5 días corridos» desde la fecha del
  comprobante. Para servicios, «dentro de los 10 días corridos anteriores o posteriores», y esa fecha se considera la de
  emisión ([ARCA, consideraciones](https://www.afip.gob.ar/fe/emision-autorizacion/consideraciones.asp)). Una factura
  fechada el 28 puede aparecer recién el 3 o el 8 del mes siguiente. Para CAEA el plazo de información puede ser mayor
  (**A CONFIRMAR**).

---

## 2. Línea de tiempo de los formatos

| Generación | Período | Contenedor | Separador / comillas | Títulos (CSV) | Columnas | `Moneda` | Evidencia |
|---|---|---|---|---|---|---|---|
| **G1 «legado»** | hasta ~oct-2023 | CSV | `,` con **todos** los campos entre comillas | `"Fecha","Tipo",…,"IVA","Imp. Total"` (sin `Otros Tributos`) | 16 | **A CONFIRMAR** | [AFungo/abmodel-facturas-app (2022)](https://github.com/AFungo/abmodel-facturas-app/blob/develop/src/main/java/facturas/app/utils/FixedData.java) |
| **G2 «2023»** | ~oct-2023 → ago-2025 | ZIP con CSV | `;`, comillas solo en la fila de títulos | `"Fecha de Emisión";"Tipo de Comprobante";…;"Otros Tributos";"IVA";"Imp. Total"` | 17 | `PES` / `DOL` | ZIP originales del 25/08/2025 ([repo](https://github.com/marajadesantelmo/resumen_contable_franco_rotta/blob/main/data/raw/comprobantes_consulta_csv_emitidos_124447584_20428786336_20250825-1059%20(montos%20expresados%20en%20pesos).csv)) · [Contadores en Red 10–11/2023](https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/) |
| **G3 «alícuotas» (vigente)** | ~01/09/2025 → hoy (verificado hasta 07/10/2026) | ZIP con CSV | `;`, comillas solo en la fila de títulos | igual que G2 pero con neto e IVA por alícuota, `Imp. Neto Gravado Total` y `Total IVA`; Recibidos suma los datos del receptor | 30 (Recibidos) / 28 (Emitidos) | `$` / `USD` | CSV reales de nov. y dic. 2025 ([Nrlsb/ArcaFTPES](https://github.com/Nrlsb/ArcaFTPES/blob/main/12%20-%20AFIP%20IVA%20Diciembre%202025.csv)) · [Del Rincón, 01/09/2025](https://www.delrincon.ar/post/arca-actualiz%C3%B3-el-dise%C3%B1o-de-mis-comprobantes) · [Tributum](https://tributum.news/redes-sociales-nuevos-campos-en-descarga-mis-comprobantes-de-arca/) («Sumaron más columnas y se asemejan a la descarga de Libro IVA Digital») · runbook de Mr Bot del 29/09/2026 ([link](https://github.com/abustosp/api-bots-mrbot-v3/blob/main/infra/deploy/runbooks/validacion-descargas-2026-09-29-catalogo.md)): «encabezado `Fecha de Emisión;Tipo de Comprobante;...`» |

El cambio de sep-2025 lo anunció la consultora Abacus en X el 01/09/2025 (tweet citado por Tributum; la fecha sale del
ID del tweet). Bejerman informó el 04/09/2025 que estaba adaptando sus importadores (Del Rincón).

---

## 3. CSV vigente (G3, desde ~01/09/2025)

### 3.1 El archivo

- El botón **CSV** baja un **ZIP**.
  - Nombre del ZIP:
    `comprobantes_consulta_csv_{recibidos|emitidos}_{idConsulta}_{CUIT}_{AAAAMMDD-HHMM}.zip`.
  - Contenido: **un único CSV**, observado como
    `comprobantes_consulta_csv_recibidos_{idConsulta}_{CUIT}_{AAAAMMDD-HHMM} (montos expresados en pesos).csv`
    en los ZIP originales de ago-2025. Que el sufijo «(montos expresados en pesos)» se mantenga en G3 queda
    **A CONFIRMAR**.
  - Xubio exige que el nombre del archivo «corresponda con el formato extraído desde ARCA y con el CUIT de la empresa»
    ([Xubio](https://ayuda.xubio.com/es-ar/como-importo-mis-facturas-de-compra-desde-afip/)).
  - **El CUIT del nombre del archivo es el de quien consulta** (puede ser el contador que representa a la SAS). No es
    necesariamente el de HUB: hay que validarlo contra `Nro. Doc. Receptor` (Recibidos) y no al revés.
- **Codificación: UTF-8 sin BOM** (verificado byte a byte en los ZIP originales y en los CSV de nov. y dic. 2025).
  Hay quienes reportan bajadas en Windows-1252
  ([holistor-uploader](https://github.com/Fedee17/holistor-uploader/blob/main/index.html), [IronWeb](https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/importar_arca.py):
  «los CSV viejos vienen en latin1»). Estrategia: UTF-8 estricto, sacar el BOM si viene, y si falla usar Windows-1252.
- **Fin de línea: LF** en los originales. Aceptar también CRLF.
- **Separador `;`**. La fila de títulos va con cada campo **entre comillas dobles**; las filas de datos van **sin
  comillas**. En las muestras no hubo ninguna `;` dentro de una denominación (todas las filas tenían exactamente
  30/17 campos). Qué hace ARCA si una razón social contiene `;` queda **A CONFIRMAR**. Validar que cada fila tenga la
  misma cantidad de campos que los títulos y rechazar la fila si no.
- **Números:** coma decimal, **sin separador de miles**, 2 decimales en importes y hasta 4–6 en `Tipo Cambio`
  (`1,00`, `1475,006`, `1465,0222`). Los importes de una alícuota que no aplica vienen **vacíos**, no `0,00`.

### 3.2 Recibidos — 30 columnas, en este orden exacto

| # | Título exacto | Contenido / formato | Ejemplo (anonimizado) |
|---|---|---|---|
| 1 | `Fecha de Emisión` | `aaaa-mm-dd` | `2025-12-01` |
| 2 | `Tipo de Comprobante` | **código** ARCA (sin texto) | `1`, `3`, `11`, `4`, `15` |
| 3 | `Punto de Venta` | entero sin ceros a la izquierda | `3`, `1203` |
| 4 | `Número Desde` | entero | `110266` |
| 5 | `Número Hasta` | entero (en Recibidos siempre igual a «Desde» en las muestras) | `110266` |
| 6 | `Cód. Autorización` | 14 dígitos: CAE o **CAEA, que se repite** | `7548XXXXXXXXXX` |
| 7 | `Tipo Doc. Emisor` | código (`80` = CUIT) | `80` |
| 8 | `Nro. Doc. Emisor` | CUIT del proveedor, 11 dígitos | `30XXXXXXXX1` |
| 9 | `Denominación Emisor` | razón social según ARCA (puede tener `,` y `.`) | `DISTRIBUIDORA EJEMPLO SA` |
| 10 | `Tipo Doc. Receptor` | código (`80`, `96` DNI…) | `80` |
| 11 | `Nro. Doc. Receptor` | CUIT o DNI de quien recibió | `30YYYYYYYY2` |
| 12 | `Tipo Cambio` | decimal con coma; `1,00` en pesos | `1475,006` |
| 13 | `Moneda` | **`$`** (pesos) o **`USD`**; otras monedas **A CONFIRMAR** | `$` |
| 14 | `Imp. Neto Gravado IVA 0%` | importe | |
| 15 | `IVA 2,5%` | importe | |
| 16 | `Imp. Neto Gravado IVA 2,5%` | importe | |
| 17 | `IVA 5%` | importe | |
| 18 | `Imp. Neto Gravado IVA 5%` | importe | |
| 19 | `IVA 10,5%` | importe | `252,32` |
| 20 | `Imp. Neto Gravado IVA 10,5%` | importe | `2403,00` |
| 21 | `IVA 21%` | importe | `5814,05` |
| 22 | `Imp. Neto Gravado IVA 21%` | importe | `27685,95` |
| 23 | `IVA 27%` | importe | |
| 24 | `Imp. Neto Gravado IVA 27%` | importe | |
| 25 | `Imp. Neto Gravado Total` | suma exacta de 14+16+18+20+22+24 (0 diferencias en 1052 filas) | `27685,95` |
| 26 | `Imp. Neto No Gravado` | importe (a veces vacío) | `0,00` |
| 27 | `Imp. Op. Exentas` | importe (a veces vacío) | `0,00` |
| 28 | `Otros Tributos` | **un solo número**: percepciones e impuestos varios sin discriminar | `1256,14` |
| 29 | `Total IVA` | suma de 15+17+19+21+23 (en 1052 filas, solo 1 difería, por 1 centavo) | `5814,05` |
| 30 | `Imp. Total` | total del comprobante | `33500,00` |

Fuentes del orden: muestras reales de nov. y dic. 2025 (Nrlsb/ArcaFTPES). El mismo orden figura en el mapa de columnas
de [Mr Bot](https://github.com/abustosp/mrbot-cliente-escritorio-v1/blob/master/mrbot_app/mis_comprobantes.py) y en el
validador de [holistor-uploader](https://github.com/Fedee17/holistor-uploader/blob/main/index.html), que rechaza el
archivo si no trae «30 columnas» (comentario fechado el 07/10/2026). Coincide además con las letras de columna de SOS
Contador: `Tipo Cambio` = L, `Moneda` = M, `Importe total` = AD (columna 30)
([SOS Contador](https://sites.google.com/sos-contador.com.ar/ayuda/menu-inicio/importar-datos/desde-arca/Importacion-Mis-Comprobantes-Emitidos-y-Recibidos)).

### 3.3 Emitidos — 28 columnas

Es igual a Recibidos pero **sin** las columnas del emisor (que es uno mismo): las columnas 7 a 9 pasan a ser
`Tipo Doc. Receptor`, `Nro. Doc. Receptor` y `Denominación Receptor`. El orden completo:

`Fecha de Emisión` · `Tipo de Comprobante` · `Punto de Venta` · `Número Desde` · `Número Hasta` · `Cód. Autorización` ·
`Tipo Doc. Receptor` · `Nro. Doc. Receptor` · `Denominación Receptor` · `Tipo Cambio` · `Moneda` ·
`Imp. Neto Gravado IVA 0%` · `IVA 2,5%` · `Imp. Neto Gravado IVA 2,5%` · `IVA 5%` · `Imp. Neto Gravado IVA 5%` ·
`IVA 10,5%` · `Imp. Neto Gravado IVA 10,5%` · `IVA 21%` · `Imp. Neto Gravado IVA 21%` · `IVA 27%` ·
`Imp. Neto Gravado IVA 27%` · `Imp. Neto Gravado Total` · `Imp. Neto No Gravado` · `Imp. Op. Exentas` ·
`Otros Tributos` · `Total IVA` · `Imp. Total`

Fuentes: fixture «variante real» de [IronWeb](https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/tests/test_importar_arca.py)
(2026); letras de SOS Contador (`Tipo Cambio` = J, `Moneda` = K, `Importe total` = AB, columna 28); mapa
`_MC_EMITIDOS_COLUMN_MAP` de Mr Bot. No conseguí un CSV G3 de Emitidos completo bajado del portal, así que el orden
queda verificado por tres implementaciones y no por una muestra propia.

En Emitidos a consumidor final: `Tipo Doc. Receptor` = `99`, `Nro. Doc. Receptor` = `0` y la denominación vacía. Los
clientes identificados aparecen con `96` (DNI) o `80` (CUIT) y su nombre (muestra G2). Eso es **dato personal**: no
loguearlo y evaluar no persistirlo.

### 3.4 Reglas de valores (G2 y G3)

- **Fecha:** ISO `aaaa-mm-dd`. Si llega `d/m/aaaa`, el archivo pasó por Excel (§5.4).
- **Tipo:** solo el código numérico. La descripción sale de la tabla oficial
  [TABLACOMPROBANTES.xls](https://www.arca.gob.ar/fe/documentos/TABLACOMPROBANTES.xls) (ARCA, modificada el 29/12/2025).
- **Punto de venta y números:** enteros sin ceros a la izquierda. G1 y algunos Excel los traían con ceros
  (`00004`, `00000123`): parsear siempre como entero.
- **Factura B, Factura C y recibos C** (y en general los comprobantes sin IVA discriminado): las 16 columnas de
  componentes vienen en `0,00` y solo se completa `Imp. Total`. Verificado en 114 de 114 filas B/C de nov. y dic. 2025.
  En G2 hubo 5 filas B/C con `Otros Tributos` distinto de 0.
- **Recibos (códigos 4, 9 y 15)** aparecen en Recibidos (2 y 3 filas en las muestras de dic-2025). Si se registran como
  gasto o como constancia de pago de una factura ya cargada lo tiene que decidir la contadora (**A CONFIRMAR**): hay
  riesgo de duplicar el gasto si el proveedor emite factura **y** recibo por la misma operación.
- **`Cód. Autorización`:** en las muestras los CAE empiezan con `7` y son únicos, y los CAEA empiezan con `3` y **se
  repiten** (hasta 17 filas con el mismo código, siempre del mismo emisor). Lo de la primera cifra es solo una
  observación, no una regla documentada.

### 3.5 Filas de ejemplo (G3 Recibidos; datos ficticios con el formato real)

```
"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"
2025-12-01;1;3;110266;110266;7548XXXXXXXXXX;80;30XXXXXXXX1;DISTRIBUIDORA EJEMPLO SA;80;30YYYYYYYY2;1,00;$;;;;;;;;5814,05;27685,95;;;27685,95;0,00;0,00;0,00;5814,05;33500,00
2025-12-01;3;4;1163;1163;7548XXXXXXXXXX;80;20XXXXXXXX3;PROVEEDOR EJEMPLO;80;30YYYYYYYY2;1,00;$;;;;;;;;3869,77;18427,50;;;18427,50;0,00;0,00;0,00;3869,77;22297,27
2025-12-01;11;100;1335865;1335865;7547XXXXXXXXXX;80;30XXXXXXXX4;MONOTRIBUTISTA EJEMPLO;80;30YYYYYYYY2;1,00;$;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;856492,00
2025-12-15;1;1203;648;648;7550XXXXXXXXXX;80;30XXXXXXXX5;SOFTWARE EJEMPLO SA;80;30YYYYYYYY2;1465,0222;USD;;;;;;;;45,86;218,40;;;218,40;0,00;0,00;0,00;45,86;264,26
2025-12-01;3;32;165833;165833;3548XXXXXXXXXX;80;30XXXXXXXX6;MAYORISTA EJEMPLO SA;80;30YYYYYYYY2;1,00;$;;;;;;;;52757,91;251228,14;;;251228,14;;;1256,14;52757,91;305242,23
```

En la fila 2 (tipo `3`, una NC A) los importes están **en positivo**. En la fila 4 (USD) los importes son **dólares**.
La fila 5 muestra el redondeo de ARCA: los componentes suman 305.242,19 y el total es 305.242,23.

---

## 4. Excel vigente (.xlsx)

- **Fila 1:** título combinado `Mis Comprobantes Recibidos - CUIT 30XXXXXXXXX` (o `Emitidos`). **Fila 2:** títulos.
  **Fila 3 en adelante:** datos. Lo confirman
  [Adhoc/Odoo](https://github.com/ingadhoc/odoo-argentina-ee/blob/e9c8d8053150b88d631854c65650c7f1e4ade1e0/l10n_ar_import_bill/models/account_journal.py)
  («El archivo tiene un header en la primera fila, lo eliminamos»), [SOS Contador Skill](https://github.com/Santi-RL/SOS_Contador_Skill/blob/main/sos-contador-api/references/mis-comprobantes-afip.md)
  (la fila 1 define compras/ventas y el CUIT de trabajo), [crumges](https://github.com/crumges-org/odoo-custom-argentina/blob/17.0/l10n_ar_import_arca_excel/models/import_wizard.py)
  y [trixocom](https://github.com/trixocom/odoo-argentina-trx-ce/blob/842b9507d39ce3c9eaea6c75291428a4f53d51b8/l10n_ar_mis_comprobantes/lib/parser.py)
  («verificado 2026-04 sobre el portal real»).
- **Nombre del archivo:** `Mis Comprobantes Recibidos - CUIT {CUIT}.xlsx` (FEFO2 y SOS lo usan; SOS documenta `.xls`
  para versiones viejas).
- **Títulos G3 del Excel (30, Recibidos):** `Fecha` · `Tipo` · `Punto de Venta` · `Número Desde` · `Número Hasta` ·
  `Cód. Autorización` · `Tipo Doc. Emisor` · `Nro. Doc. Emisor` · `Denominación Emisor` · `Tipo Doc. Receptor` ·
  `Nro. Doc. Receptor` · `Tipo Cambio` · `Moneda` · `Neto Grav. IVA 0%` · `IVA 2,5%` · `Neto Grav. IVA 2,5%` · `IVA 5%` ·
  `Neto Grav. IVA 5%` · `IVA 10,5%` · `Neto Grav. IVA 10,5%` · `IVA 21%` · `Neto Grav. IVA 21%` · `IVA 27%` ·
  `Neto Grav. IVA 27%` · `Neto Gravado Total` · `Neto No Gravado` · `Op. Exentas` · `Otros Tributos` · `Total IVA` ·
  `Imp. Total` (holistor-uploader, Adhoc, Mr Bot). Emitidos lleva los mismos títulos cortos en el orden de §3.3.

| CSV (G3) | Excel (G3) |
|---|---|
| `Fecha de Emisión` (`2025-12-01`) | `Fecha` (texto `01/12/2025`; ver nota) |
| `Tipo de Comprobante` (`1`) | `Tipo` (`1 - Factura A`, `3 - Nota de Crédito A`, `11 - Factura C`) |
| `Tipo Doc. Emisor` (`80`) | `Tipo Doc. Emisor` (`CUIT`) |
| `Imp. Neto Gravado IVA 21%` | `Neto Grav. IVA 21%` |
| `Imp. Neto Gravado Total` | `Neto Gravado Total` |
| `Imp. Neto No Gravado` | `Neto No Gravado` |
| `Imp. Op. Exentas` | `Op. Exentas` |
| los demás (`Punto de Venta`, `Número Desde/Hasta`, `Cód. Autorización`, `Nro. Doc.…`, `Denominación…`, `Tipo Cambio`, `Moneda`, `IVA x%`, `Otros Tributos`, `Total IVA`, `Imp. Total`) | iguales |

Notas del Excel:
- **Fecha:** los fixtures de crumges y la lectura de SOS la tratan como texto `dd/mm/aaaa`; Adhoc usa
  `pd.to_datetime(dayfirst=True)`. Si es una celda de fecha o texto queda **A CONFIRMAR**, así que hay que aceptar las
  dos cosas y también el número de serie de Excel.
- **Importes:** Adhoc usa `pd.to_numeric` (implica celdas numéricas). Que lo sean siempre queda **A CONFIRMAR**: aceptar
  también texto con coma decimal.
- **Trampa de formato de celda:** «algunas filas de ARCA traen esa celda [`Tipo Cambio`] con un formato de Excel que le
  saca el punto decimal al mostrarla como texto (ej. "1438.43498" → se lee como "143.843.498")». Hay que leer el
  **valor crudo** de la celda, no el texto formateado (holistor-uploader).
- **Variante «sin fila de título»:** holistor-uploader documenta un caso real del 22/09/2026, «una exportación con los
  títulos ya en la fila 1… con fechas del tipo 8/1/26» (otra descarga de ARCA, no identificada). Por eso hay que
  **buscar** la fila de títulos en vez de asumir que es la 2.
- **Recomendación:** pedir siempre el **CSV/ZIP**. No tiene el límite de 500, trae tipos y fechas crudos y evita los
  formatos de celda.

---

## 5. Formatos anteriores y variantes que el parser debe tolerar

### 5.1 G2 — CSV oct-2023 → ago-2025 (17 columnas; verificado con los ZIP originales del 25/08/2025)

Recibidos:

```
"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"IVA";"Imp. Total"
2024-11-28;1;7;63976;63976;7448XXXXXXXXXX;80;30XXXXXXXX7;SERVICIOS EJEMPLO SA;1028,00;DOL;60,00;0,00;0,00;0,00;12,60;72,60
2024-09-02;6;11;63322;63322;7436XXXXXXXXXX;80;30XXXXXXXX8;COMERCIO EJEMPLO SRL;1,00;PES;0,00;0,00;0,00;0,00;0,00;26274,49
```

En Emitidos los títulos 7 a 9 son `Tipo Doc. Receptor` · `Nro. Doc. Receptor` · `Denominación Receptor`. Diferencias con
G3: un solo `Imp. Neto Gravado` (total) y un solo `IVA` (total), sin desglose por alícuota, sin columnas del receptor en
Recibidos, y `Moneda` = `PES`/`DOL` en vez de `$`/`USD`. Con G2 hay que **deducir la alícuota** a partir de IVA/neto
(como hace [IronWeb](https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/importar_arca.py)) o pedir el detalle.
La columna `Otros Tributos` apareció en oct/nov-2023: «aparece otra columna denominada 'OTROS TRIBUTOS' que en meses
anteriores no me figuraba» ([Contadores en Red](https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/), comentario del 09/11/2023).

### 5.2 G2 — Excel oct-2023 → ago-2025

Los títulos exactos quedan **A CONFIRMAR**. Por G1 y G3, lo más probable es `Fecha` · `Tipo` · `Punto de Venta` ·
`Número Desde` · `Número Hasta` · `Cód. Autorización` · `Tipo Doc. Emisor` · `Nro. Doc. Emisor` · `Denominación Emisor`
· `Tipo Cambio` · `Moneda` · `Imp. Neto Gravado` · `Imp. Neto No Gravado` · `Imp. Op. Exentas` · `Otros Tributos` ·
`IVA` · `Imp. Total`, con la fila 1 de título. Un truco de la época recomendaba bajar el xlsx, borrar la primera fila,
quitar `Otros Tributos` y cambiar comas por puntos (búsqueda sobre Contadores en Red, nov-2023).

### 5.3 G1 — CSV hasta ~oct-2023 (16 columnas)

```
"Fecha","Tipo","Punto de Venta","Número Desde","Número Hasta","Cód. Autorización","Tipo Doc. Emisor","Nro. Doc. Emisor","Denominación Emisor","Tipo Cambio","Moneda","Imp. Neto Gravado","Imp. Neto No Gravado","Imp. Op. Exentas","IVA","Imp. Total"
```

Separador `,` y **todos** los campos entre comillas: el parser de AFungo hace `split("\",\"")` «so we don't get in
trouble with names containing ,». El tipo venía como texto (`"1 - Factura A"`), el PV y el número probablemente con
ceros, y el decimal con **punto** (AFungo hace `Float.parseFloat`). El formato de fecha queda **A CONFIRMAR**. En
Emitidos, `Receptor` en lugar de `Emisor`. Para HUB (SAS nueva) no hace falta salvo historia previa, pero el parser lo
reconoce sin costo.

### 5.4 Variantes vistas en archivos reales

| Variante | Qué cambia | Fuente | Cómo tratarla |
|---|---|---|---|
| «del Emisor» | `Tipo Doc. del Emisor`, `Nro. Doc. del Emisor`, `Denominación del Emisor` | [IronWeb](https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/tests/test_importar_arca.py) («Variante real de ARCA») | La normalización saca «del» |
| PV y número en una sola columna | «Punto de venta y número unificados» (Excel, primeros días de sep-2025) | [Del Rincón](https://www.delrincon.ar/post/arca-actualiz%C3%B3-el-dise%C3%B1o-de-mis-comprobantes) | Las implementaciones de 2026 leen columnas separadas (**A CONFIRMAR** si existió o si se revirtió). Aceptar `PPPPP-NNNNNNNN` en una columna «Número»/«Comprobante» |
| Títulos en la fila 1 sin título | Fechas `8/1/26` | holistor-uploader (22/09/2026) | Buscar la fila de títulos en las primeras 10 filas |
| **CSV abierto y guardado con Excel** | Fechas `d/m/aaaa`, CAE en notación científica («se pierde precisión»), posible cambio de separador o codificación | holistor-uploader (07/10/2026); [SOS Contador](https://ayuda.sos-contador.com.ar/menu-inicio/importar-datos/desde-arca/Importacion-Multiple): «NO ABRIR EL CSV EN EXCEL YA QUE SE MODIFICARÁ EL FORMATO» | Detectar (CAE con `E+`, fechas `d/m/aaaa`) y avisar «subí el ZIP tal cual lo bajaste». Si el CAE está dañado, guardarlo como nulo |
| Windows-1252 | Tildes rotas si se lee como UTF-8 | holistor-uploader, IronWeb | Decodificar con UTF-8 estricto y, si falla, con windows-1252 |
| CUIT del receptor «truncado» | `22423064` en vez de `20224230649` (DNI) | holistor-uploader | Usar `Tipo Doc. Receptor` (96 = DNI). No completar con ceros a la izquierda para «hacer» un CUIT |

---

## 6. Signos, monedas, totales y «Otros Tributos»

### 6.1 Notas de crédito: siempre positivas

- En **todas** las muestras (G2 y G3, Recibidos y Emitidos) no hay **ningún** importe negativo, y hay 39 + 25 + 77 + 75
  NC. Lo mismo se reportó en 2023: «las Notas de Crédito que figuran sumando en vez de restando»
  ([Contadores en Red](https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/)).
  Los importadores también lo asumen: [FEFO2](https://github.com/FEFO2/AFIP-nuevo/blob/main/src/transform/afip.py) las
  pasa a negativo a mano y [SOS Contador Skill](https://github.com/Santi-RL/SOS_Contador_Skill/blob/main/sos-contador-api/references/mis-comprobantes-afip.md)
  las deja positivas y usa el tipo.
- No hay que confundirlo con el **Libro IVA Digital (Portal IVA)**, donde desde el 19/11/2020 los importes de NC van
  «expresados como negativos» ([ARCA, Novedades IVA](https://arca.gob.ar/iva/sujetos-exentos/novedades.asp)).
- **Códigos según la tabla oficial** ([TABLACOMPROBANTES.xls](https://www.arca.gob.ar/fe/documentos/TABLACOMPROBANTES.xls), modificada el 29/12/2025):
  - **Notas de crédito:** 3, 8, 13, 21, 38, 43, 44, 48, 53, 90, 110, 112, 113, 114, 203, 208, 213.
  - **Notas de débito:** 2, 7, 12, 20, 37, 45, 46, 47, 52, 115, 116, 117, 202, 207, 212.
  - **Facturas y tiques de compra habituales para un bar:** 1 (Factura A), 6 (B), 11 (C), 51 (Factura A «operación
    sujeta a retención», ex «M»), 81 (Tique Factura A), 82 (Tique Factura B), 83 (Tique), 109 (Tique C),
    111 (Tique Factura C), 201/206/211 (FCE A/B/C), 17/18 (Liquidación de servicios públicos A/B).
  - **Recibos:** 4, 9, 15 y 54.
  - Los códigos 80–83 y 110–117 llevan «(*) Solo emitidos con Controladores Fiscales».
  - La tabla oficial **no** tiene 118–120 (Tique M), aunque figuran en listas de terceros como Mr Bot.
- Implementación: `is_credit_note = código ∈ NC`. Los montos se guardan positivos (es lo que ya hace el esquema del repo,
  §8.8) y el signo se aplica al contabilizar.

### 6.2 Moneda extranjera: viene en la moneda original

- En las muestras, las filas `USD`/`DOL` traen importes en dólares (por ejemplo, total `641,37` con `Tipo Cambio`
  `1475,006`). Esto pasa **aunque el nombre del CSV diga «(montos expresados en pesos)»**. Ya lo advertían en 2018
  («el sistema las muestra por el valor en su moneda de origen»,
  [Consejo Salta/Contadores en Red](https://www.consejosalta.org.ar/wp-content/uploads/INFO.-GRAL.-MIS-COMPROBANTES.pdf))
  y en 2023 (Contadores en Red).
- Conversión: `importe_ARS = round(importe × Tipo Cambio, 2)`, columna por columna. Guardar la moneda y la cotización
  originales.
- Tokens de moneda vistos: `$`, `PES` → ARS; `USD`, `DOL` → USD. IronWeb además mapea `U$S`. Para otras monedas (EUR) el
  token G3 queda **A CONFIRMAR**: guardar el texto crudo y marcar la fila para revisión.
- Colppy directamente «no acepta comprobantes en moneda extranjera; cargalos manualmente»
  ([Colppy](https://intercom.help/Colppy/es/articles/15468236-errores-al-importar-comprobantes-desde-arca-como-resolverlos)).
  Alternativa razonable para la v1.

### 6.3 Cuadre del total

- **G3:** `Imp. Total` = `Imp. Neto Gravado Total` + `Imp. Neto No Gravado` + `Imp. Op. Exentas` + `Otros Tributos` +
  `Total IVA` ± redondeo. En 1052 filas reales, la mayor diferencia en comprobantes con IVA discriminado fue $0,55 y
  ninguna superó $1. «ARCA redondea y sus componentes no siempre suman el Imp. Total» ([IronWeb](https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/importar_arca.py)).
- **G2:** en la muestra de Recibidos, **112 de 1094 filas** (casi todas facturas A) tenían un residuo positivo de
  ~2,4 % del total, equivalente a ~3 % del neto. Son percepciones que no se reflejaron en `Otros Tributos` (ya en 2018:
  «aquellas facturas que tienen percepciones (IVA o Ingresos Brutos) el sistema no las muestra»). SOS Contador manda ese
  residuo a «nogravado» (Factura C) o a «percepcionotra» (facturas de compra)
  ([SOS Contador Skill](https://github.com/Santi-RL/SOS_Contador_Skill/blob/main/sos-contador-api/references/mis-comprobantes-afip.md)).
- **B y C:** como los componentes vienen en 0, el total completo es «gravado sin IVA discriminado» (no da crédito fiscal
  a un responsable inscripto). Fórmula: `undiscriminated = total − otros − exento − no gravado`.
- Regla propuesta: si `|diferencia| ≤ $1`, ajustar contra el bucket neto de mayor monto. Si es mayor a $1 y positiva,
  llevarla a «otros tributos sin discriminar» y marcar la fila como «revisar percepciones». Si es negativa y mayor a $1,
  mandar la fila a revisión manual.

### 6.4 «Otros Tributos» no discrimina

En G3 es una sola columna. Para el libro IVA y la posición de IIBB la contadora necesita separar percepción de IVA,
percepción de IIBB (y de qué jurisdicción), impuestos internos y municipales. Opciones:
1. **CSV de compras de Portal IVA** (§11), que separa cada tributo.
2. Carga o edición manual del desglose por comprobante cuando `Otros Tributos > 0`.
3. Servicio «Mis Retenciones» de ARCA para las percepciones de IVA sufridas. Mr Bot lo consulta y entrega CSV
   ([runbook](https://github.com/abustosp/api-bots-mrbot-v3/blob/main/infra/deploy/runbooks/validacion-descargas-2026-09-29-catalogo.md)).
   El formato no lo investigué: **A CONFIRMAR**.

---

## 7. ¿Hay una API oficial? ¿Se puede automatizar la descarga?

### 7.1 No hay web service oficial para listar o bajar los recibidos

- El [catálogo de WS de ARCA](https://www.afip.gob.ar/ws/documentacion/catalogo.asp) no tiene ningún servicio para
  listar los comprobantes recibidos. Para recibidos solo está **WSCDCV1**: «verificar en forma dinámica si los
  comprobantes recibidos se encuentran autorizados por ARCA».
- Un desarrollador que lo implementó lo dice textual: «Mis Comprobantes no tiene web service»
  ([teosibileau/arca PR #10](https://github.com/teosibileau/arca/pull/10)).

### 7.2 Servicios oficiales relacionados (permitidos, con certificado y WSAA)

| Servicio | Para qué sirve en HUB | Detalle |
|---|---|---|
| **WSCDC** (`ComprobanteConstatar`) | Validar un comprobante cargado a mano (foto/PDF/papel) | Entrada: `CbteModo` (CAE/CAEA/CAI), `CuitEmisor`, `PtoVta`, `CbteTipo`, `CbteNro`, `CbteFch` (AAAAMMDD), `ImpTotal`, `CodAutorizacion`, `DocTipoReceptor`, `DocNroReceptor` ([pyafipws/wscdc.py](https://github.com/reingart/pyafipws/blob/master/wscdc.py); WSDL de homologación `https://wswhomo.afip.gov.ar/WSCDC/service.asmx?WSDL`; producción **A CONFIRMAR**) |
| **WSFECRED** `consultarComprobantes` | Solo **Factura de Crédito Electrónica MiPyME**, como emisor o receptor | «Método que permite obtener información sobre los comprobantes Emitidos y Recibidos. Debe indicar el rol de la CUIT Representada, Emisor o Receptor». Filtros por contraparte, tipo, estado, fechas y paginado desde la v1.3.0 ([Manual WSFECRED v2.0.3, 20/12/2023](https://servicioscf.afip.gob.ar/facturadecreditoelectronica/documentos/Manual-Desarrollador-WSFECRED.pdf)). HUB, como pyme, normalmente **no** recibe FCE |
| **WSFEv1** `FECompConsultar` | Solo comprobantes **propios** emitidos | Sirve para Emitidos cuando HUB facture por WS (Topic A) |
| **Padrón** `ws_sr_constancia_inscripcion` | Datos del proveedor por CUIT | §10.3 |

### 7.3 Cómo lo automatizan terceros y por qué no lo recomiendo

- **Cómo funciona por dentro:** login con Playwright en `auth.afip.gob.ar` → `GET /portal/api/servicios/{cuit}/servicio/mcmp/autorizacion`
  (token y firma) → `POST` a `https://fes.afip.gob.ar/mcmp/jsp/index.do` → `ajax.do?f=generarConsulta&t=R&fechaEmision=dd/mm/aaaa - dd/mm/aaaa`
  → `f=estimarResultados` («sin esto queda en PE») → `f=listaResultados`, con estados PE/PR/TE/ER. El WAF corta las
  conexiones que no tienen User-Agent de navegador
  ([teosibileau/arca](https://github.com/teosibileau/arca/pull/10)). Afip SDK ofrece la automatización
  `mis-comprobantes` con CUIT, usuario y **contraseña** de ARCA
  ([blog 24/10/2025](https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-via-api/),
  [n8n 29/04/2026](https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-en-n8n/)), y Mr Bot hace lo mismo con
  la clave cifrada ([cliente](https://github.com/abustosp/mrbot-cliente-escritorio-v1/blob/master/mrbot_app/mis_comprobantes.py)).
  SOS Contador «ImpoAuto» ya lo hacía en 2020 con la clave del contribuyente
  ([Contadores en Red](https://contadoresenred.com/impoauto-la-importacion-automatica-de-mis-comprobantes/)).
- **Marco normativo:**
  - **Disposición AFIP 74/2022** (B.O. 28/04/2022), «Términos y condiciones sobre el acceso y el uso de los sistemas y
    servicios»:
    - **art. 11:** «Se prohíbe el acceso a los sistemas y servicios interactivos de esta Administración Federal a
      través de herramientas automatizadas»;
    - **art. 14:** ante eventos de seguridad, a) notificación de actividad anómala, b) blanqueo de clave fiscal,
      c) pedido de segundo factor, d) bloqueo temporal de clave
    ([ignacioonline](https://www.ignacioonline.com.ar/disposicion-74-22-afip-terminos-y-condiciones-para-el-uso-de-bots/),
    [Diario Judicial](https://www.diariojudicial.com/news-91985-migrated),
    [iProfesional](https://www.iprofesional.com/impuestos/361599-contadores-afip-prohibio-la-simplificacion-mediante-bots):
    entre lo prohibido figura «descarga y carga automática de comprobantes de compras/ventas»).
  - El 09/05/2022 AFIP solo se comprometió a «analizar las propuestas» y no hubo excepciones
    ([CPCECABA](https://consejo.org.ar/noticias/2022/espacio-dialogo-afio-disposicion74-aplicativos-090522)).
  - **No encontré ninguna derogación ni modificación hasta oct-2026**. Que siga vigente queda **A CONFIRMAR** con la
    contadora o un abogado.
  - **RG 3713/2015, art. 5:** «La utilización de la "Clave Fiscal", su resguardo y protección, son de exclusiva autoría
    y responsabilidad del usuario… toda consecuencia jurídica o fiscal… se atribuirán, de pleno derecho» al
    representado ([RG 3713](https://www.colegio-escribanos.org.ar/noticias/2015_01_22-AFIP-RES-GRAL-3713-15.pdf)).
    Darle la clave fiscal de la SAS a un SaaS de terceros traslada todo el riesgo a HUB.
  - El 13/03/2026 Errepar publicó en X que notaba dificultades para ingresar al portal con clave fiscal «tras reiterados
    intentos y, luego de recibir avisos» (lo vi solo en el resumen del buscador; el post devolvió HTTP 402). Si está
    relacionado con medidas antibot queda **A CONFIRMAR**.
- **Recomendación para HUB:**
  1. **v1 semiautomática (sin riesgo):** el día 11 de cada mes alguien con clave fiscal baja **Recibidos** del mes
     anterior y del mes en curso en CSV (es un ZIP) y lo **arrastra tal cual** a la app. La app descomprime, detecta el
     formato, deduplica, crea proveedores, propone imputaciones y deja todo «para revisar». Se puede sumar un
     recordatorio automático (mail/WhatsApp interno) con el link directo.
  2. **Nunca guardar la clave fiscal** en la plataforma (además va contra §9 de CLAUDE.md).
  3. Si el dueño quisiera automatización total, es una **decisión de riesgo del dueño** (no técnica): tercerizarla en
     un proveedor (Afip SDK o Mr Bot) que asuma la operación, con la clave de un usuario delegado y no la del
     administrador de relaciones. **A CONFIRMAR** con la contadora.

---

## 8. Deduplicación

### 8.1 Clave natural

- **Recibidos:** `(CUIT emisor, código de comprobante, punto de venta, número)`. Es la que usan
  [teosibileau](https://github.com/teosibileau/arca/pull/10) (upsert sobre `(cuit_emisor, cbte_tipo, punto_venta, cbte_nro)`)
  y [holistor-uploader](https://github.com/Fedee17/holistor-uploader/blob/main/index.html)
  (`${cuitEm}-${tipo}-${ptoVta}-${numHasta}`). ARCA numera en forma correlativa por emisor, punto de venta y tipo, así
  que la tupla es única. En las muestras hubo **0 claves repetidas** en 2.146 filas de Recibidos.
- **Emitidos:** `(CUIT propio, código, punto de venta, número desde, número hasta)`. `Desde` ≠ `Hasta` puede aparecer en
  lotes de facturas B a consumidor final («El rango Desde-Hasta agrupa comprobantes a consumidor final en una sola
  línea», IronWeb). En la muestra G2 de Emitidos no hubo rangos. Para HUB con su POS actual queda **A CONFIRMAR**.
- **Siempre con el código ARCA, no con la letra.** 1 (Factura A), 201 (FCE A), 81 (Tique Factura A) y 51 son
  secuencias distintas: «do not normalize it to Factura A `1/001` merely because the letter is A» (SOS Contador Skill).
- **Siempre con el CUIT del emisor.** Dos proveedores distintos pueden tener el mismo tipo, PV y número. IronWeb
  deduplica sin CUIT: es un bug y no hay que copiarlo.

### 8.2 No usar el CAE como clave

En las muestras, el mismo `Cód. Autorización` se repite hasta **17 veces** (siempre del mismo emisor). Son **CAEA**, el
código que se pide por quincena y se usa en todas las facturas de ese período. Sirve como dato y para la constatación
(WSCDC), pero no identifica un comprobante. SOS Contador Skill prioriza el CAE para deduplicar: con CAEA eso da falsos
duplicados.

### 8.3 Solapes entre descargas y llegadas tardías

- Bajar rangos solapados (por ejemplo, «mes anterior + mes actual» todos los meses) es **seguro** con la clave natural:
  si ya existe se ignora o se actualiza.
- Por la regla de 5/10 días (§1) hay que **re-importar el mes anterior al menos hasta el día ~11**. teosibileau usa un
  `SOLAPAMIENTO = 7 días` contra la última fecha guardada. Propuesta para HUB: ventana de 15 días.
- Política de re-import:
  - **No se actualiza:** importes, fecha, tipo, PV y número. No deberían cambiar; si cambian, se marca un conflicto.
  - **Se puede actualizar:** la denominación del proveedor (ARCA usa la razón social vigente).

### 8.4 «Anuladas»

- Un comprobante con CAE **no se anula**: «deberá emitir una nota de crédito o nota de débito, según corresponda»
  identificando el comprobante asociado ([ARCA, FAQ 6490326](https://servicioscf.afip.gob.ar/publico/abc/consultas_detalle.aspx?id=6490326)).
  El botón «Anular» del Facturador de ARCA genera automáticamente una nota de crédito (tique NC C)
  ([El Destape, 26/03/2026](https://www.eldestapeweb.com/economia/arca/como-anular-una-factura-en-la-web-de-arca-202632641536)).
- Por lo tanto **no existe un estado «anulado» en el export**. La anulación es otra fila con otro código, y **el export
  no trae el comprobante asociado** de la NC. Para vincular la NC con su factura (campo `related_document_id` del repo):
  - heurística: mismo CUIT, NC posterior a la factura, mismo total, o total ≤ al saldo pendiente;
  - siempre como **sugerencia** que se confirma a mano.
- Si un proveedor le facturó a HUB algo que no corresponde (CUIT mal tipeado), la fila aparece igual. La UI necesita
  «No es nuestro, ignorar», que se recuerda por clave natural para no volver a ofrecerla.

### 8.5 Duplicados contra cargas manuales previas

Si alguien ya cargó la compra a mano (por ejemplo, desde el PDF):
- **Coincidencia fuerte:** igualdad en la clave natural. Requiere que la carga manual pida tipo, PV y número.
- **Coincidencia débil:** cuando la carga manual no tiene número, mismo CUIT + fecha ±3 días + total ±$1. Se muestra
  como «posible duplicado» y nunca se fusiona sola. Es el mismo criterio de «ya cargado / pendiente / verificar» de SOS
  Contador.

### 8.6 Otras trampas

- **Número Desde ≠ Hasta en Recibidos:** en las muestras nunca pasó. SOS lo manda a «verificar». Hacer lo mismo.
- **Fecha del comprobante ≠ fecha contable:** el export trae solo la fecha de emisión. En qué mes del libro IVA se
  computa lo define la contadora (el repo ya separa `issue_date` y `accounting_date`).
- **Mismo archivo subido dos veces:** guardar el hash del archivo y la fecha de importación, y mostrar «ya importaste
  este archivo el …».

### 8.7 Validaciones por fila (antes de deduplicar)

- CUIT del emisor con dígito verificador válido (0 inválidos en las muestras).
- Fecha parseable y dentro del rango del archivo.
- Código de comprobante presente en la tabla oficial.
- Total parseable y cuadre (§6.3).
- Moneda conocida.
- En Recibidos: `Nro. Doc. Receptor` = CUIT de HUB, salvo que sea DNI (persona humana).

### 8.8 Notas para el esquema actual del repo (lectura, sin cambios)

- `acc_fiscal_vouchers` ya tiene buckets que calzan 1 a 1 con G3 (`net_0/25/5/105/21/27`, `vat_*`, `non_taxed`,
  `exempt`, `undiscriminated`, `perc_*`, `other_taxes`, `total`), `afip_voucher_code`, `is_credit_note` con importes no
  negativos y `counterparty_doc_type` (80/86/96/99).
  Archivo: `supabase/migrations/20261007120400_acc_core_tables.sql`.
- **Riesgo 1:** el índice único `adoc_purchase_dup_uq` es `(tenant_id, party_id, voucher_type, point_of_sale, number)`.
  Como `voucher_type` es la letra interna (`factura_a`…), un proveedor con Factura A 0003-150 (código 1) y FCE A 0003-150
  (código 201) **chocaría**. Lo mismo pasa con la NC A (3) y la NC FCE A (203). Sugerencia: deduplicar el import por
  `afip_voucher_code` (o sumar ese campo al índice).
- **Riesgo 2:** `afv_total` exige igualdad exacta entre el total y la suma de los buckets, y `afv_nonneg` no admite
  negativos. El importador tiene que absorber el redondeo de ARCA (§6.3) **antes** de insertar, o la fila va a fallar.
- **Riesgo 3:** `Otros Tributos` de G3 no dice si es `perc_iva`, `perc_iibb`, `internal_taxes` o `perc_municipal`. Sin
  el desglose (Portal IVA o carga manual) va a `other_taxes_cents` y queda marcado para revisión.
- `vat_computable_cents`: Mis Comprobantes no lo trae. Por defecto es la suma del IVA de los A/M; la prorrata la decide
  la contadora (**A CONFIRMAR**). El CSV de Portal IVA trae `Crédito Fiscal Computable`.

---

## 9. Estrategia robusta de detección de encabezados

### 9.1 Pipeline

1. **Entrada:** ZIP → tomar el único `.csv` (si hay más de uno o ninguno, error claro). `.xlsx`/`.xls` → primera hoja,
   leyendo **valores crudos** de celda. `.csv` suelto → seguir.
2. **Decodificar:** `TextDecoder('utf-8', {fatal:true})` y sacar `﻿`; si tira error, `windows-1252`. Si los títulos
   traen `Ã` o `Â`, el archivo se leyó mal (mojibake).
3. **Separador** (CSV): contar `;`, `,` y `\t` **fuera de comillas** en la primera línea no vacía y quedarse con el
   mayor (G2 y G3 → `;`, G1 → `,`). Parser de CSV con comillas («""» escapado).
4. **Fila de títulos:** recorrer las primeras 10 filas, clasificar cada celda (§9.3) y elegir la fila que tenga
   `fecha`, `tipo`, `pto_vta` y `total` **y** la mayor cantidad de columnas reconocidas. Las filas anteriores son el
   título: de ahí se sacan «Recibidos/Emitidos» y el CUIT (11 dígitos).
5. **Clase de archivo:** existe `denom_emisor` → **Recibidos**. Existe solo `denom_receptor` → **Emitidos**. Como
   respaldo, el título o el nombre del archivo (`recibidos`/`emitidos`). Si se detecta `nro_comprobante` o `perc_iibb`,
   es un CSV de **Portal IVA** (§11), no de Mis Comprobantes.
6. **Versión:**
   - hay `neto_21` (o cualquier `neto_*`/`iva_*` por alícuota) → **G3**;
   - si no, hay `otros_tributos` → **G2**;
   - si no → **G1**.
   El **separador decimal se decide por archivo, no por valor**: G2/G3 usan coma, G1 punto. El Excel numérico no tiene
   separador. Así se evita la ambigüedad de «1.234».
7. **Mapear valores** (§9.4), **validar** (§8.7), **deduplicar** (§8), **previsualizar** con contadores («142 nuevos,
   37 ya cargados, 3 para revisar») y recién entonces confirmar.

### 9.2 Normalización de un título

`NFD` → sacar diacríticos (`̀-ͯ`) → minúsculas → ` ` a espacio → unificar decimales (`10,5`/`10.5` →
`10.5`) → quitar `°º` → reemplazar toda puntuación salvo `.` entre dígitos, `%` y `/` por espacio → sacar las palabras
`de|del|la|el` → colapsar espacios.

Ejemplos:
- `"Cód. Autorización"` → `cod autorizacion`
- `"Imp. Neto Gravado IVA 10,5%"` → `imp neto gravado iva 10.5%`
- `"Neto Grav. IVA 10,5%"` → `neto grav iva 10.5%`
- `"Denominación del Emisor"` → `denominacion emisor`

### 9.3 Reglas (regex sobre el título normalizado → clave canónica)

| Clave | Regex | Cubre |
|---|---|---|
| `fecha` | `^fecha( emision)?$` | `Fecha`, `Fecha de Emisión` |
| `tipo` | `^tipo( comprobante)?$` | `Tipo`, `Tipo de Comprobante` |
| `pto_vta` | `^(punto venta\|pto vta\|pto venta\|punto vta)$` | `Punto de Venta`, `Pto. Vta.` |
| `nro_desde` / `nro_hasta` | `^(numero\|nro\|n) desde$` / `…hasta$` | `Número Desde/Hasta` |
| `nro_comprobante` | `^(numero\|nro) comprobante$` | Portal IVA |
| `cod_aut` | `^(cod\|codigo) autorizacion$\|^cae$` | `Cód. Autorización`, `CAE` |
| `tipo_doc_emisor` | `^tipo (doc\|documento) (emisor\|vendedor)$` | `Tipo Doc. Emisor`, `Tipo Doc. del Emisor`, `Tipo Doc. Vendedor` |
| `tipo_doc_receptor` | `^tipo (doc\|documento) receptor$` | |
| `nro_doc_emisor` | `^(nro\|numero\|n\|no) (doc\|documento) (emisor\|vendedor)$` | `Nro. Doc. Emisor`, `N° Doc. Emisor`, `Nro. Doc. del Emisor` |
| `nro_doc_receptor` | `^(nro\|numero\|n\|no) (doc\|documento) receptor$` | |
| `denom_emisor` | `^denominacion (emisor\|vendedor)$` | `Denominación Emisor`, `Denominación del Emisor`, `Denominación Vendedor` |
| `denom_receptor` | `^denominacion receptor$` | |
| `tipo_cambio` | `^tipo cambio$` | `Tipo Cambio`, `Tipo de Cambio` |
| `moneda` | `^moneda( original)?$` | `Moneda`, `Moneda Original` |
| `neto_{0,2_5,5,10_5,21,27}` | `^(imp \|importe )?neto grav(ado)? iva (0\|2\.5\|5\|10\.5\|21\|27)\s*%$` | `Imp. Neto Gravado IVA 21%`, `Neto Grav. IVA 21%`, `Neto Gravado IVA 21%` |
| `iva_{2_5,5,10_5,21,27}` | `^(importe )?iva (2\.5\|5\|10\.5\|21\|27)\s*%$` | `IVA 21%`, `Importe IVA 21%` |
| `neto_gravado_total` | `^(imp \|importe )?neto gravado( total)?$\|^total neto gravado$` | G1/G2 `Imp. Neto Gravado` (= total), G3 `Imp. Neto Gravado Total`, `Neto Gravado Total`, Portal IVA `Total Neto Gravado` |
| `no_gravado` | `^(imp \|importe )?neto no gravado$\|^importe no gravado$` | |
| `exento` | `^(imp \|importe )?op exentas$\|^importe exento$` | `Imp. Op. Exentas`, `Op. Exentas`, `Importe Exento` |
| `otros_tributos` | `^(importe )?otros tributos$` | |
| `iva_total` | `^(total )?iva$` | G1/G2 `IVA` (= total), G3 `Total IVA` |
| `total` | `^(imp\|importe) total$` | `Imp. Total`, `Importe Total` |
| Solo Portal IVA | `^credito fiscal computable$`, `^importe percepciones ingresos brutos$`, `^importe percepciones o pagos a cuenta iva$`, `^importe per o pagos a cta otros imp nac$`, `^importe impuestos municipales$`, `^importe impuestos internos$` | §11 |

Las reglas se prueban **en orden** y gana la primera. Cada clave se asigna una sola vez (gana la primera columna).
Ojo: `iva` a secas (G2) se tiene que evaluar como **total** y nunca contra las reglas por alícuota. trixocom lo resuelve
con «igualdad antes que substring» ([parser](https://github.com/trixocom/odoo-argentina-trx-ce/blob/842b9507d39ce3c9eaea6c75291428a4f53d51b8/l10n_ar_mis_comprobantes/lib/parser.py)).

### 9.4 Parseo de valores

- **Importes → centavos (`bigint`) sin pasar por `float`:**
  - quitar espacios y `$`;
  - si trae `E+`, error: «archivo pasado por Excel»;
  - con decimal coma: sacar los `.` de miles y cambiar `,` por `.`;
  - después, entero y decimales por string, con redondeo half-up a 2 decimales.
  - Las celdas numéricas de Excel se usan tal cual: `Math.round(v*100)`.
- **Tipo de cambio:** guardar como decimal exacto (`numeric(18,6)`), **no** en centavos.
- **Fecha:** aceptar `Date`, el serial de Excel (`(v − 25569) × 86400000`), `aaaa-mm-dd`, `d/m/aaaa`, `d/m/aa`
  (→ `20aa`) y `AAAAMMDD`.
- **Tipo:** `^(\d{1,3})(?:\.0+)?(?:\s*-.*)?$` toma el código de `1`, `1.0` y `1 - Factura A`.
- **Tipo de documento:** dígitos al inicio (`80`) o texto (`CUIT`→80, `CUIL`→86, `DNI`→96, `CDI`→87, `LE`→89,
  `LC`→90, `Pasaporte`→94).
- **CUIT:** solo dígitos, 11 de largo y dígito verificador (pesos 5,4,3,2,7,6,5,4,3,2; 11→0; 10→9).
- **Moneda:** `$`, `PES` o `ARS` → ARS; `USD`, `DOL` o `U$S` → USD; el resto, crudo y para revisar.

### 9.5 Prototipo validado contra las muestras

Escribí un prototipo en TypeScript (Node 25 con *type stripping*, sin dependencias) en el scratchpad, **no en el repo**:
`/private/tmp/claude-501/-Users-ignaciobaldovino-Hub-main/6bc921ab-2546-4d32-8fb8-1435c8671f61/scratchpad/research/scripts/mc-parse.ts`
(más `mc-parse-synth.ts` para los casos sintéticos). Resultados:

| Archivo | Detectó | Filas | Claves dup. | NC | ≠ARS | Filas con \|Δ\| > $1 | Mayor redondeo |
|---|---|---|---|---|---|---|---|
| Recibidos dic-2025 (real) | fila 1 · Recibidos · G3 | 513 | 0 | 77 | 8 | 0 | $0,35 |
| Recibidos nov-2025 (real) | fila 1 · Recibidos · G3 | 539 | 0 | 75 | 12 | 0 | $0,55 |
| Recibidos sep-24→ago-25 (ZIP original) | fila 1 · Recibidos · G2 | 1094 | 0 | 39 | 12 | **112** (percepciones) | $0,04 |
| Emitidos sep-24→ago-25 (ZIP original) | fila 1 · Emitidos · G2 | 3543 | 0 | 25 | 0 | 0 | $0,01 |
| Portal IVA compras oct-2025 (real, 2 versiones) | fila 1 · Portal IVA | 8 / 4 | 0 | 0 | 0 | 0 | $0,05 |
| Excel G3 sintético (título + títulos cortos) | **fila 2** · Recibidos · G3 · CUIT del título | 3 | 0 | 1 | 0 | 0 | 0 |
| CSV G1 sintético (coma, todo entre comillas) | fila 1 · Recibidos · G1 | 1 | 0 | 0 | 0 | 0 | 0 |

También reconoce `Denominación del Emisor`, `N° Doc. Emisor` y `Neto Grav. IVA 10.5%`, detecta un CAE en notación
científica y decodifica Windows-1252. Las reglas de `RULES` cubren el 100 % de los títulos de G1, G2, G3 (CSV y Excel)
y la variante «del Emisor».

---

## 10. Datos de proveedores

### 10.1 Lo que trae el export

- `Nro. Doc. Emisor` (CUIT) y `Denominación Emisor`. Es la razón social según ARCA: «ARCA tiene la razón social
  oficial normalizada» ([genuinefafa](https://github.com/genuinefafa/simple-procesador-facturas/blob/bea9197c6a6e64e83a2e04c2e5467eea272b241e/server/services/excel-import.service.ts)).
- Alta automática: `acc_parties(kind='supplier', tax_id_type='cuit', tax_id=CUIT, name=Denominación)`. El índice
  `apt_tax_id_uq` (tenant + tax_id activo) ya evita duplicar proveedores.
- El nombre de fantasía lo puede editar el usuario («Coca» en vez de «FEMSA…»).

### 10.2 Inferir la condición frente al IVA por la letra (provisorio)

| Recibe HUB | Inferencia | Nota |
|---|---|---|
| A (1, 2, 3), 51–53, 81, 201–203 | responsable inscripto | |
| C (11, 12, 13), 15, 109, 111, 211–213 | monotributo o exento | El padrón distingue cuál |
| B (6, 7, 8), 82 | responsable inscripto que **no** le hizo factura A a HUB | Pedirle factura A: la B no da crédito fiscal (dato para el instructivo) |

### 10.3 Enriquecer con el padrón oficial: `ws_sr_constancia_inscripcion`

- Manual v3.4 (08/05/2023). Métodos `getPersona_v2` y `getPersonaList_v2` (**hasta 250 CUIT** por llamada).
  Servicio WSAA `ws_sr_constancia_inscripcion`. Producción:
  `https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5`; homologación:
  `https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5`
  ([manual](https://www.afip.gob.ar/ws/WSCI/manual-ws-sr-ws-constancia-inscripcion-v3.4.pdf)).
- Devuelve:
  - `datosGenerales`: `razonSocial` o `nombre`/`apellido`, `tipoPersona`, `estadoClave` (ACTIVO/INACTIVO), y
    `domicilioFiscal` (`direccion`, `localidad`, `codPostal`, `idProvincia`, `descripcionProvincia`);
  - `datosRegimenGeneral`: `impuesto[]` (por ejemplo, `idImpuesto` 30 = IVA, 11 = Ganancias personas humanas,
    301/308 = seguridad social) y `actividad[]`;
  - `datosMonotributo`: `idImpuesto` 20 = MONOTRIBUTO, `categoriaMonotributo`;
  - y los errores `errorConstancia` / `errorRegimenGeneral`.
- El id de «IVA exento» queda **A CONFIRMAR**: suele citarse el 32, pero no está en el manual que leí.
- Mapeo a `acc_parties.iva_condition`:
  - impuesto 30 → `responsable_inscripto`;
  - `datosMonotributo` → `monotributo`;
  - exento → `exento` (**A CONFIRMAR** el id);
  - sin datos → `sin_datos`.
- Requisitos: el mismo certificado (computador fiscal) que WSFE y la delegación de ese servicio en el Administrador de
  Relaciones (Topic A/B). Es un WS **oficial**, así que automatizarlo está permitido.
- Uso propuesto: cuando aparece un CUIT nuevo en un import se hace una llamada por lote, y una vez por mes se refrescan
  los proveedores activos (un monotributista que pasa a RI cambia la letra).

### 10.4 Base APOC (facturas apócrifas): chequeo semanal

- Archivo **público**, sin clave: `https://servicioscf.afip.gob.ar/facturacion/facturasapocrifas/DownloadFile.aspx`.
  Es un ZIP con `FacturasApocrifas.txt` en UTF-8 con BOM, con líneas `#` de encabezado y filas
  `CUIT,Fecha Condicion Apocrifo, Fecha Publicacion, Descripcion` (~45.600 líneas al 29/09/2026)
  ([runbook de Mr Bot](https://github.com/abustosp/api-bots-mrbot-v3/blob/main/infra/deploy/runbooks/validacion-descargas-2026-09-29-catalogo.md)).
  También existe el WS oficial **WSAPOC** (catálogo).
- Por qué importa: si el proveedor está en APOC, ARCA impugna el gasto en Ganancias y el crédito fiscal de IVA. Una
  alerta en la ficha del proveedor y en el import vale mucho y es 100 % automatizable sin riesgo.

### 10.5 Lo que no sale de ARCA y hay que cargar a mano

Email, teléfono, CBU/alias, plazo de pago, cuenta contable habitual y si es «proveedor de mercadería» o «servicio».
La primera importación debería pedir **solo** la cuenta habitual de cada proveedor nuevo y recordarla para los
siguientes (el repo ya tiene `default_account_id`).

---

## 11. Fuente alternativa para el desglose de tributos: CSV de compras de Portal IVA

- Es el CSV del Libro IVA Digital (período mensual). Nombre observado:
  `comprobantes_periodo_{AAAAMM}_compras_{AAAAMMDD}_{HHMM} (montos expresados en pesos).csv`
  ([GOddovero/Corrector-CSV](https://github.com/GOddovero/Corrector-CSV), muestras de nov. y dic. 2025). UTF-8 sin BOM,
  `;`, coma decimal.
- **32 columnas:** `Fecha de Emisión` · `Tipo de Comprobante` · `Punto de Venta` · `Número de Comprobante` ·
  `Tipo Doc. Vendedor` · `Nro. Doc. Vendedor` · `Denominación Vendedor` · `Importe Total` · `Moneda Original` ·
  `Tipo de Cambio` · `Importe No Gravado` · `Importe Exento` · `Crédito Fiscal Computable` ·
  `Importe de Per. o Pagos a Cta. de Otros Imp. Nac.` · `Importe de Percepciones de Ingresos Brutos` ·
  `Importe de Impuestos Municipales` · `Importe de Percepciones o Pagos a Cuenta de IVA` ·
  `Importe de Impuestos Internos` · `Importe Otros Tributos` · `Neto Gravado IVA 0%` · `Neto Gravado IVA 2,5%` ·
  `Importe IVA 2,5%` · `Neto Gravado IVA 5%` · `Importe IVA 5%` · `Neto Gravado IVA 10,5%` · `Importe IVA 10,5%` ·
  `Neto Gravado IVA 21%` · `Importe IVA 21%` · `Neto Gravado IVA 27%` · `Importe IVA 27%` · `Total Neto Gravado` ·
  `Total IVA`. [abustosp/CSV-Portal-IVA-a-Holistor](https://github.com/abustosp/CSV-Portal-IVA-a-Holistor/blob/main/BIN/ProcesarCSVHolistorCompras.py)
  usa las mismas columnas.
- **Ventajas:** separa percepción de IVA, percepción de IIBB, internos, municipales y otros nacionales, y trae el
  crédito fiscal computable. Calza con los buckets `perc_iva`, `perc_iibb`, `internal_taxes`, `perc_municipal`,
  `other_taxes` y `vat_computable` del repo, y en las muestras los totales cuadran.
- **Contras y dudas:**
  - existe solo cuando el período está abierto en Portal IVA (lo maneja la contadora) y es mensual;
  - según ARCA, en los detalles del Libro IVA Digital las NC van en negativo (19/11/2020) y hay opción de montos en
    pesos (07/10/2020). En estas muestras no hubo NC ni USD para verificarlo: **A CONFIRMAR**;
  - el repo de GOddovero distingue un «formato viejo» (07/11/2025) de uno «nuevo» (18/12/2025) con los mismos títulos.
    Qué cambió queda **A CONFIRMAR**.
- **Propuesta:** el parser de §9 ya lo reconoce (`portal_iva_compras`). Usarlo como **enriquecimiento opcional**:
  si la contadora sube el CSV del período, se completan los desgloses de `Otros Tributos` de las facturas ya
  importadas, cruzando por la clave natural.

---

## 12. Insumos para el instructivo «de dónde, qué y cómo cargar» (borrador)

1. **Una sola vez:** en ARCA → «Administrador de Relaciones de Clave Fiscal» → adherir «Mis Comprobantes» para la CUIT
   de la SAS (o delegarlo en la persona que lo va a bajar, con su propia clave). Se puede ilustrar con capturas.
2. **Todos los meses, del 11 en adelante:**
   1. ARCA → buscar «Mis Comprobantes» → **Recibidos**.
   2. Fecha: del 1 del **mes anterior** a hoy → **Buscar**.
   3. Botón **CSV** (baja un ZIP).
   4. Arrastrar el **ZIP tal cual** a HUB › Administración › Importar de ARCA. **No abrirlo ni guardarlo con Excel.**
3. **Qué hace la app sola:**
   - detecta el formato;
   - crea los proveedores nuevos con su razón social y CUIT;
   - pre-carga la condición IVA desde el padrón;
   - deduplica;
   - convierte USD con el tipo de cambio de la factura;
   - marca las NC;
   - propone la cuenta contable habitual del proveedor;
   - avisa de los proveedores en APOC.
4. **Qué revisa la persona:**
   - cuenta contable de proveedores nuevos (una sola vez por proveedor);
   - facturas con `Otros Tributos` sin desglose;
   - facturas B (pedir A);
   - comprobantes que no son de HUB («ignorar»);
   - vínculo NC → factura.
5. **Qué se sigue cargando a mano** (con WSCDC opcional para validar):
   - tiques sin CUIT;
   - comprobantes en papel o de contingencia;
   - gastos del exterior;
   - sueldos, impuestos y gastos bancarios no facturados (hasta que la RG 5866 haga aparecer las liquidaciones
     mensuales).
6. **Pedido a los proveedores** (texto para el instructivo): «facturá siempre a la CUIT de HUB SAS, condición
   Responsable Inscripto, Factura A». Sin eso la compra no aparece en ARCA (o aparece como B) y se pierde el crédito
   fiscal.

---

## 13. Lista de A CONFIRMAR

1. Si el límite de «>500 comprobantes ⇒ solo CSV» sigue en la interfaz 2025–2026.
2. Si el sufijo «(montos expresados en pesos)» del CSV interno del ZIP sigue en G3.
3. Token de `Moneda` en G3 para monedas distintas de USD (EUR, BRL).
4. Si en el Excel G3 las fechas e importes son celdas tipadas o texto.
5. Si existió y se revirtió el «PV + número unificados» en el Excel (Del Rincón, sep-2025).
6. Títulos exactos del Excel G2 (oct-2023 → ago-2025) y formato de fecha y moneda de G1.
7. Si la Disposición AFIP 74/2022 sigue vigente sin cambios (no encontré derogación). Relación entre los problemas de
   login de mar-2026 y medidas antibot.
8. Nivel de clave fiscal exigido para «Mis Comprobantes».
9. Plazo de información de comprobantes CAEA y su impacto en la ventana de re-import.
10. Tipo y código de comprobante de la «liquidación electrónica mensual» de bancos, tarjetas y billeteras
    (RG 5866/2026) y desde qué mes le aparecerán a HUB.
11. Tratamiento de los recibos (4/9/15) recibidos (gasto o constancia de pago) y prorrata del crédito fiscal
    computable: los define la contadora.
12. `idImpuesto` de «IVA exento» en el padrón (¿32?).
13. Signo de las NC y conversión a pesos en el CSV de compras de Portal IVA. Diferencia entre los formatos «viejo» y
    «nuevo» de nov./dic. 2025.
14. Orden de columnas de Emitidos G3 en una muestra propia del portal (hoy verificado por tres implementaciones).
15. URL de producción de WSCDC.

---

## 14. Fuentes

**Oficiales (ARCA / Boletín Oficial / normativa)**
- Catálogo de web services de negocio: https://www.afip.gob.ar/ws/documentacion/catalogo.asp
- Tabla oficial de tipos de comprobante (modificada el 29/12/2025): https://www.arca.gob.ar/fe/documentos/TABLACOMPROBANTES.xls
- Consideraciones sobre la fecha del comprobante (5/10 días): https://www.afip.gob.ar/fe/emision-autorizacion/consideraciones.asp
- FAQ ARCA 6490326, anulación con NC/ND: https://servicioscf.afip.gob.ar/publico/abc/consultas_detalle.aspx?id=6490326
- Novedades IVA, Libro IVA Digital (19/11/2020 NC en negativo; 07/10/2020 montos en pesos): https://arca.gob.ar/iva/sujetos-exentos/novedades.asp
- Manual WSFECRED v2.0.3: https://servicioscf.afip.gob.ar/facturadecreditoelectronica/documentos/Manual-Desarrollador-WSFECRED.pdf
- Manual ws_sr_constancia_inscripcion v3.4: https://www.afip.gob.ar/ws/WSCI/manual-ws-sr-ws-constancia-inscripcion-v3.4.pdf
- RG AFIP 3713/2015 (art. 5): https://www.colegio-escribanos.org.ar/noticias/2015_01_22-AFIP-RES-GRAL-3713-15.pdf
- RG ARCA 5893/2026 (B.O. 31/08/2026): https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5893.pdf
- RG ARCA 5866/2026 (B.O. 29/06/2026): https://www.boletinoficial.gob.ar/detalleAviso/primera/343656/20260629 y resumen del CPCE Córdoba: https://web.cpcecba.org.ar/?p=67697

**Disposición AFIP 74/2022 (bots)**
- https://www.ignacioonline.com.ar/disposicion-74-22-afip-terminos-y-condiciones-para-el-uso-de-bots/
- https://www.diariojudicial.com/news-91985-migrated
- https://www.iprofesional.com/impuestos/361599-contadores-afip-prohibio-la-simplificacion-mediante-bots
- https://consejo.org.ar/noticias/2022/espacio-dialogo-afio-disposicion74-aplicativos-090522

**Prensa especializada y ayudas de software**
- Del Rincón / Bejerman (01–04/09/2025): https://www.delrincon.ar/post/arca-actualiz%C3%B3-el-dise%C3%B1o-de-mis-comprobantes
- Tributum (sep-2025): https://tributum.news/redes-sociales-nuevos-campos-en-descarga-mis-comprobantes-de-arca/ (cita https://x.com/AbacusConsulto1/status/1962519420376346708, del 01/09/2025)
- Contadores en Red (11/10/2023 y comentarios): https://contadoresenred.com/mis-comprobantes-permite-consultar-y-descargar-en-excel-periodos-de-hasta-365-dias/
- Contadores en Red / Tributum 2018 (PDF del Consejo Salta): https://www.consejosalta.org.ar/wp-content/uploads/INFO.-GRAL.-MIS-COMPROBANTES.pdf
- ImpoAuto de SOS Contador (2020): https://contadoresenred.com/impoauto-la-importacion-automatica-de-mis-comprobantes/
- SOS Contador, columnas y nombres: https://sites.google.com/sos-contador.com.ar/ayuda/menu-inicio/importar-datos/desde-arca/Importacion-Mis-Comprobantes-Emitidos-y-Recibidos
- SOS Contador, «no abrir el CSV en Excel»: https://ayuda.sos-contador.com.ar/menu-inicio/importar-datos/desde-arca/Importacion-Multiple
- Xubio: https://ayuda.xubio.com/es-ar/como-importo-mis-facturas-de-compra-desde-afip/
- Fudo (act. 11/02/2026): https://soporte.fu.do/es/articles/11731368-seccion-documentos-recibidos-descargar-facturas-en-el-arca
- Colppy, errores al importar: https://intercom.help/Colppy/es/articles/15468236-errores-al-importar-comprobantes-desde-arca-como-resolverlos
- Afip SDK, Mis Comprobantes por API (24/10/2025): https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-via-api/ ; en n8n (29/04/2026): https://afipsdk.com/blog/descargar-mis-comprobantes-de-arca-en-n8n/
- El Destape, anular en el Facturador (26/03/2026): https://www.eldestapeweb.com/economia/arca/como-anular-una-factura-en-la-web-de-arca-202632641536

**Muestras reales y código abierto**
- ZIP originales del portal del 25/08/2025 (G2): https://github.com/marajadesantelmo/resumen_contable_franco_rotta/tree/main/data/raw
- CSV G3 de Recibidos, nov. y dic. 2025: https://github.com/Nrlsb/ArcaFTPES/blob/main/12%20-%20AFIP%20IVA%20Diciembre%202025.csv
- Runbook de Mr Bot (29/09/2026): https://github.com/abustosp/api-bots-mrbot-v3/blob/main/infra/deploy/runbooks/validacion-descargas-2026-09-29-catalogo.md
- Cliente de Mr Bot (mapa de columnas CSV↔Excel, ZIP, codificaciones): https://github.com/abustosp/mrbot-cliente-escritorio-v1/blob/master/mrbot_app/mis_comprobantes.py
- Adhoc / Odoo (Excel G3): https://github.com/ingadhoc/odoo-argentina-ee/blob/e9c8d8053150b88d631854c65650c7f1e4ade1e0/l10n_ar_import_bill/models/account_journal.py
- trixocom (parser por pistas, 2026-04): https://github.com/trixocom/odoo-argentina-trx-ce/blob/842b9507d39ce3c9eaea6c75291428a4f53d51b8/l10n_ar_mis_comprobantes/lib/parser.py
- SOS Contador Skill (fila 1, tipos, signos, deduplicación): https://github.com/Santi-RL/SOS_Contador_Skill/blob/main/sos-contador-api/references/mis-comprobantes-afip.md
- holistor-uploader (validación de 30 columnas, trampas de Excel, CSV re-guardado; 22/09 y 07/10/2026): https://github.com/Fedee17/holistor-uploader/blob/main/index.html
- IronWeb (variantes, monedas, redondeo): https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/importar_arca.py y https://github.com/jmjacquet/IronWeb/blob/master/comprobantes/tests/test_importar_arca.py
- teosibileau/arca (endpoints del portal, upsert, solapamiento): https://github.com/teosibileau/arca/pull/10
- crumges (asistente de Odoo con Excel): https://github.com/crumges-org/odoo-custom-argentina/blob/17.0/l10n_ar_import_arca_excel/models/import_wizard.py
- AFungo (formato G1, 2022): https://github.com/AFungo/abmodel-facturas-app/blob/develop/src/main/java/facturas/app/utils/FixedData.java
- FEFO2 (NC negadas a mano): https://github.com/FEFO2/AFIP-nuevo/blob/main/src/transform/afip.py
- genuinefafa (importador en TypeScript): https://github.com/genuinefafa/simple-procesador-facturas/blob/bea9197c6a6e64e83a2e04c2e5467eea272b241e/server/services/excel-import.service.ts
- pyafipws / WSCDC: https://github.com/reingart/pyafipws/blob/master/wscdc.py
- Portal IVA, CSV de compras: https://github.com/GOddovero/Corrector-CSV y https://github.com/abustosp/CSV-Portal-IVA-a-Holistor/blob/main/BIN/ProcesarCSVHolistorCompras.py
