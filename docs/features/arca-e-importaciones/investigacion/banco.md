# Tema E: extractos bancarios del Banco Nación (BNA) para el importador de Administración

> Relevado el 7 y 8/10/2026. Cada dato no obvio lleva su fuente al lado. Lo que no pude confirmar dice **A CONFIRMAR**.
> Sirve para diseñar el importador de extractos del módulo Administración y el instructivo de «qué bajar del banco y dónde».
> Los nombres técnicos (campos, regex, códigos) quedan como están.

---

## 0. Lo esencial en un minuto

1. **«BNA Conecta» no es el home banking.** Es el marketplace B2B del banco: compradores y vendedores que son clientes de BNA. Los vendedores pagan una membresía de $175.000 + IVA por mes, con bonificación por segmento ([BNA Conecta](https://www.bna.com.ar/home/bnaconecta), [LM Neuquén](https://www.lmneuquen.com/el-banco-nacion-lanzo-un-portal-potenciar-las-pymes-n846242), [tarifario comercial BNA](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)).
   La banca para empresas hoy es **BNA+ Empresas («Nueva BNA+»)**, en la web `digital.bna.com.ar` y en la app. Sigue conviviendo con el canal histórico **Nación Empresa 24 (NE24)**, que corre sobre la plataforma **BEE 3.0 de Red Link** (`bee3.redlink.com.ar/bna3`) ([BNA+ Empresas](https://www.bna.com.ar/home/bnamasempresas), [NE24](https://bna.com.ar/Empresas/Grandes/NacionEmpresa24)).
2. **Formatos:**
   - El **resumen mensual oficial** sale en **PDF**. Se adhiere al «extracto electrónico» desde «Cuentas» › «Extracto» ([FAQ BNA](https://www.bna.com.ar/Personas/CajaDeAhorrosEnPesosYDolares/PreguntasFrecuentesCajaDeAhorrosEnPesosYDolares)).
   - **Movimientos en NE24 (BEE 3.0):** la pantalla muestra fecha, descripción, número de comprobante, monto y saldo. Se puede filtrar y **exportar en XLS, TXT o CSV**, según la FAQ de BEE 3.0 de otro banco de la red Link; en NE24 está **A CONFIRMAR** ([FAQ BEE 3.0](https://www.bancojulio.com.ar/wp-content/uploads/2023/07/Preguntas-Frecuentes-BEE-3.0.pdf)). NE24 guarda **3 meses** de histórico ([NE24](https://bna.com.ar/Empresas/Grandes/NacionEmpresa24)).
   - **BNA+ Empresas** confirma «consulta de saldos y movimientos» y «extractos electrónicos». No hay manual público, así que **el formato de exportación está A CONFIRMAR** ([BNA+ Empresas](https://www.bna.com.ar/home/bnamasempresas)).
   - **Interbanking** es la opción más automática. Su **API «Información Financiera»** (saldos, movimientos y extractos) devuelve un JSON con débito o crédito, el CUIT y el nombre de la contraparte, y el código original del banco. BNA participa de Interbanking y cobra por operación ([tarifario BNA](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf), [planes Interbanking](https://www.interbanking.com.ar/planes), [cliente no oficial con los detalles](https://github.com/rje1974/interbanking-api-ejemplo)). El precio del plan con APIs está **A CONFIRMAR**.
3. **El PDF de BNA no trae el signo en texto plano.** Tiene columnas DEBITOS y CREDITOS, pero se pierden al extraer el texto.
   - Las fechas van como `DD/MM/YY` y los importes como `1.234,56`. El saldo deudor lleva **el menos al final** (`12.239.301,29-`).
   - Aparecen líneas `SALDO ANTERIOR`, `TRANSPORTE` y `FIN DE RESUMEN`. Desde septiembre de 2024, además, hay marcas en el margen.
   - El sentido de cada fila se deduce por la **diferencia de saldo** ([bank-extractor](https://github.com/Francoooo22/bank-extractor), [xExtracta v2.2.4](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario/releases/tag/v2.2.4)).
4. **Cargos típicos de una cuenta empresa en BNA.** Las etiquetas vienen de las reglas de un estudio contable y de parsers open source (§2):
   - comisiones: `COMISION PAQUETES`, `COMIS.TRANSF.NE24`;
   - IVA: `I.V.A. BASE` (21 % o 10,5 %);
   - percepción de IVA: `RETEN. I.V.A. RG.2408` (3 %);
   - impuesto al cheque: `IMP AL DEB/CRED` (Ley 25.413, 0,6 % sobre débitos y 0,6 % sobre créditos);
   - SIRCREB (IIBB Córdoba, alícuota según padrón);
   - cheques: `48HS. BANCOS`, `48HS. CANJE ZONAL`;
   - transferencias: `CR.TRANF.INT.DIST`, `TRANSF.INT.DIST`, `DEBIN <cuit>`, `DEB.TRAN.INTERB-LINK`, `DB CREDIN TRANS-LINKCIA`;
   - liquidaciones de cobros: `LIQ+PAGOS NACIO`, `ACRED PR-ADEL+PAGOSNACION`, `PAGO CON TRANSF`.
5. **Reglas de oro del importador:**
   - Nunca deducir débito o crédito por el texto: el mismo `DEBIN <cuit>` puede ser cualquiera de los dos ([bank-extractor](https://github.com/Francoooo22/bank-extractor)).
   - Usar las columnas o la diferencia de saldo, y verificar el saldo fila por fila.
   - Hacer el import idempotente con una huella por fila.
   - Clasificar con reglas ordenadas más el CUIT de la contraparte. Si el caso no es inequívoco, mandarlo a «a identificar».

---

## 1. Cómo saca los movimientos una SAS cliente de BNA

### 1.1 Canales disponibles

| Canal | Qué es | Movimientos | Formatos | Estado |
|---|---|---|---|---|
| **BNA+ Empresas / Nueva BNA+** (`digital.bna.com.ar` + app) | Banca digital nueva. «Una experiencia unificada para personas y empresas», mismo usuario en la app y en la web ([App Store](https://apps.apple.com/ar/app/bna-digital-empresas/id6446181557), [Nueva BNA+](https://www.bna.com.ar/Personas/nuevabnamas)). | «Consulta online de saldos y movimientos» y «Extractos electrónicos de cuentas» ([BNA+ Empresas](https://www.bna.com.ar/home/bnamasempresas)). | **A CONFIRMAR.** Ningún video oficial cubre la exportación de movimientos ([playlist BNA+ Empresas](https://www.youtube.com/playlist?list=PLIinff-hDEz0MIn5-Eid29oMpR33tWplR)). | Canal actual. El alta de empresas se hace en [Adhesión a BNA Digital Empresas](https://www.bna.com.ar/Empresas/OnBoardingBancaDigital). |
| **Nación Empresa 24 (NE24) 3.0** | Banca empresas sobre Red Link BEE 3.0 (login en `bee3.redlink.com.ar/bna3/bee/auth/login`). Tiene módulos Básico, Full y Aduana ([NE24](https://bna.com.ar/Empresas/Grandes/NacionEmpresa24)). | «Consulta histórica de los saldos y movimientos de los últimos 3 meses». Permite «guardar consultas de movimientos conformados y pendientes en tu PC» ([NE24](https://bna.com.ar/Empresas/Grandes/NacionEmpresa24)). | XLS, TXT o CSV según la FAQ de BEE 3.0 ([FAQ BEE 3.0](https://www.bancojulio.com.ar/wp-content/uploads/2023/07/Preguntas-Frecuentes-BEE-3.0.pdf)). En NE24, **A CONFIRMAR**. | Vigente: figura en el tarifario de octubre de 2026 ([tarifario](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)). |
| **Resumen o extracto mensual** | Documento oficial. Por norma BCRA llega como máximo 8 días corridos después de terminado el mes ([BCRA, cuenta corriente](https://www.bcra.gob.ar/pdfs/texord/t-ctacte.pdf)). | Todo el mes, con saldo inicial y final. | **PDF**. El camino citado es «Cuentas › Extracto › Consulta › Ver extractos» (fuente secundaria: [extractpro](https://extractpro.app/blog/como-descargar-extracto-bancario-homebanking-argentina)). | Siempre disponible. Es la base del control mensual. |
| **Interbanking** | Plataforma multibanco. BNA cobra $445 + IVA por cada débito en pesos y $300 + IVA si es monobanco ([tarifario](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)). | Web: «Consultas ilimitadas de extractos de cuentas, movimientos, consolidados de saldos» en todos los planes ([planes](https://www.interbanking.com.ar/planes)). API: movimientos del día, anteriores y diferidos. | Web: reportes (formato **A CONFIRMAR**). API: JSON (§1.6). | Plan Gratuito: hasta 10 transferencias y 10 reportes. **Las APIs arrancan en el Plan Básico** ([planes](https://www.interbanking.com.ar/planes)). |
| **Extractos por SWIFT** | Envío de extractos por SWIFT a titulares de cuentas corrientes. | Periodicidad según lo pactado: **A CONFIRMAR**. | Tipo de mensaje SWIFT (MT940 u otro): **A CONFIRMAR**. | Cuesta $32.016 + IVA por mes ([tarifario](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)). Es para grandes empresas, no lo recomiendo. |
| **«Emisión de Extractos de Cuenta en Soporte»** | Servicio pago con periodicidad mensual, quincenal, semanal o diaria. Mensual: $7.903 + IVA ([tarifario](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)). | Según la periodicidad elegida. | **A CONFIRMAR** qué «soporte» es (¿archivo?) y con qué layout. Conviene preguntarlo en la sucursal. | Poco documentado. |

> Aclaración: las migraciones a la «Nueva BNA+» que salieron en la prensa en marzo de 2026 hablan del home banking de **personas** ([El Nueve](https://www.elnueve.com/servicios/el-banco-nacion-anuncio-que-dejara-de-funcionar-su-home-banking-que-cambiara-y-como-seguir-operando_20260313/)). No encontré una fecha de baja de NE24.

### 1.2 NE24 (BEE 3.0 de Red Link): lo que muestra y lo que exporta

Según la FAQ de **Banca Electrónica 3.0 de Red Link**, publicada por Banco Julio, la misma plataforma que usa NE24 ([FAQ BEE 3.0](https://www.bancojulio.com.ar/wp-content/uploads/2023/07/Preguntas-Frecuentes-BEE-3.0.pdf)):

- **Menú:** «Consultas» › «Movimientos» › combo de cuenta. Por defecto muestra débitos y créditos.
- **Datos:** «fecha, descripción, número de comprobante, monto y saldo hasta ese momento».
- **Filtros:** «rango de fechas, tipo de operación (débito o crédito), y … importe mínimo y máximo».
- **Exportación:** «seleccionar en qué formato necesitas exportar la información (**XLS, TXT o CSV**)». Para saldos, «txt, xvs [sic] o pdf».
- **«Buzón de archivos»:** listado de archivos generados por la operatoria, descargables «en diferentes formatos (TXT, XLS, CSV)».
- En NE24 la consulta se divide en **movimientos del día, conformados, pendientes e históricos**, y además valores negociados y al cobro ([tarifario, sección NE24](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)).

**Para el importador:**
- Tomar como definitivos solo los movimientos **históricos o conformados**. Los del día y los pendientes son provisorios.
- Como NE24 guarda 3 meses, hay que exportar por lo menos una vez por mes (ideal, una vez por semana).
- **A CONFIRMAR:** el layout exacto del XLS, CSV y TXT de NE24 (encabezados, separador, codificación, si trae columna D/C o el signo en el importe). Pedir una exportación real a la SAS y armar los fixtures con ella.

### 1.3 BNA+ Empresas: lo confirmado y lo que falta

- **Confirmado:**
  - Las mismas credenciales en la app y en la web.
  - Consulta de saldos y movimientos.
  - Extractos electrónicos.
  - Transferencias individuales y múltiples, pagos VEP, Echeq y pago de haberes.

  Fuentes: [BNA+ Empresas](https://www.bna.com.ar/home/bnamasempresas), [App Store](https://apps.apple.com/ar/app/bna-digital-empresas/id6446181557) y los títulos de la [playlist oficial](https://www.youtube.com/playlist?list=PLIinff-hDEz0MIn5-Eid29oMpR33tWplR): «¿Cómo hago pagos VEP?», «¿Cómo opero con Echeq?», «¿Cómo pago haberes?», «¿Cómo accedo a las cuentas de mi empresa desde la Nueva BNA+?».
- **A CONFIRMAR:**
  - si BNA+ Empresas exporta movimientos y en qué formato;
  - cuántos meses guarda;
  - si muestra CUIT y nombre de la contraparte en el detalle.

  Por norma BCRA, en las transferencias el receptor tiene que ver el nombre y el CUIT del ordenante y una referencia unívoca (§2.6). Por eso es muy probable que el detalle los muestre.
- Una fuente secundaria afirma que el home banking de BNA solo deja descargar el resumen en PDF ([extractpro](https://extractpro.app/blog/como-descargar-extracto-bancario-homebanking-argentina)). Eso es para el **resumen** y no contradice que NE24 exporte **movimientos** en XLS, CSV o TXT.

### 1.4 El PDF del resumen mensual: contenido y estructura

**Lo que el BCRA obliga a incluir** ([Reglamentación de la cuenta corriente bancaria, Com. «A» 8299, punto 1.5.2.3](https://www.bcra.gob.ar/pdfs/texord/t-ctacte.pdf)):
- cada movimiento, débito o crédito, «identificando los distintos tipos de transacción mediante un **código específico que cada entidad instrumente**», y los saldos del período;
- la **CBU**, el plazo de compensación de cheques y «el **importe total debitado en el período** en concepto de “Impuesto a las transacciones financieras”» (es decir, un total de Ley 25.413);
- en los débitos automáticos: empresa, identificación del cliente, concepto, importe y fecha;
- en las transferencias: los datos del punto 3.2 de «SNP – Transferencias» (§2.6);
- la conformidad se presume si no hay reclamo dentro de los **60 días corridos**.

**Estructura del PDF de BNA observada por parsers open source.** No hay documento oficial del layout ([bank-extractor](https://github.com/Francoooo22/bank-extractor): `extractor.py`, tests y CHANGELOG; [xExtracta](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario)):
- **Encabezado:** «BANCO DE LA NACION ARGENTINA», «RESUMEN DE CUENTA», `SUC:NNN` y en la línea siguiente el nombre del titular, CUIT, CBU, «Hoja: n».
- **Columnas:** `FECHA`, `MOVIMIENTOS`, `COMPROB.`, `DEBITOS`, `CREDITOS`, `SALDO`. Lo deduzco de las palabras que el parser descarta como encabezado; los nombres exactos están **A CONFIRMAR**.
- **Fila:** `DD/MM/YY DESCRIPCION COMPROBANTE IMPORTE SALDO`. El comprobante puede ser corto, por ejemplo un cheque `48HS. CANJE ZONAL` con comprobante `9` ([xExtracta](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario/releases/tag/v2.2.4)).
- **Importes:** formato argentino `1.234,56`. El **saldo deudor lleva «-» al final**.
- **Líneas de control:** `SALDO ANTERIOR <saldo>`, `TRANSPORTE` al cambiar de hoja, y al final `<número> <--- FIN DE RESUMEN`.
- **Desde septiembre de 2024**, BNA imprime «marcas en el margen de cada página (hasta 5 o 6 por página)» que rompían la lectura de filas ([xExtracta v2.2.4](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario/releases/tag/v2.2.4)). bank-extractor también admite el prefijo `____` antes de la fecha.
- **Débito o crédito:** al extraer el texto, el importe queda en una sola posición. bank-extractor lo resuelve con «`saldo_actual = saldo_anterior ± monto`» y deja el prefijo de texto (`CR `, `LIQ `, `ACREDIT`, `DEPOSITO`, `DEP.` = crédito) solo como respaldo.
- **Ejemplo real anonimizado** (test de bank-extractor, resumen de agosto de 2026):

```
RESUMEN DE CUENTA
SALDO ANTERIOR 8.885.389,76-
20/08/26 DB PM/TOT RESUMEN TCORP 4572 3.353.911,53 12.239.301,29-
000230476 <--- FIN DE RESUMEN
```
→ fecha 20/08/2026; descripción `DB PM/TOT RESUMEN TCORP` (pago total del resumen de la tarjeta corporativa); comprobante `4572`; **débito** de 3.353.911,53; saldo −12.239.301,29.

- **A CONFIRMAR con un PDF real de la SAS:**
  - si los totales de Ley 25.413 aparecen como bloque al final;
  - si hay bloques informativos (resumen de impuestos, tasas);
  - si la columna D/C se puede recuperar por la posición X con pdf.js.

  Si se puede, es más robusto que la diferencia de saldo, aunque conviene mantener los dos métodos y comparar.

### 1.5 Indicio de un CSV viejo de BNA («EXTRACTONACION»)

El ERP Zoologic documentaba un diseño de importación llamado «EXTRACTONACION» para un **CSV** de BNA. La página hoy devuelve 404 y no está archivada; solo vi el contenido en el índice del buscador ([URL original](http://campus.zoologic.com.ar/novedades/dnvdf/dnvtycg_func10119.htm)):
- el número de cuenta sale de la «segunda columna de la línea 6», «entre los caracteres “$” y el primer “|”» (hay metadatos antes del encabezado);
- columnas aproximadas: fecha de operación, fecha valor, importe, referencia o concepto, concepto, saldo;
- entidad = 11, que es el código BCRA de BNA, 011.

→ **A CONFIRMAR.** Sirve como argumento para que el importador **busque el encabezado y no asuma que está en la fila 1**.

### 1.6 Interbanking API (la vía más automática)

Datos del cliente **no oficial** [`rje1974/interbanking-api-ejemplo`](https://github.com/rje1974/interbanking-api-ejemplo), también publicado como paquete npm `interbanking-client`. El último push es de octubre de 2026. El portal oficial es [developers.interbanking.com.ar](https://developers.interbanking.com.ar/api/prod/).

- **Requisitos:**
  - cuenta **empresa** en Interbanking con BNA adherido;
  - una app en el portal de desarrolladores, suscripta al plan de API «**Información Financiera**» (saldos, movimientos, extractos);
  - el `customer-id` (código de abonado), que está en la web de Interbanking en «Administración › Bancos y cuentas».
- **Autenticación:** OAuth2 `client_credentials`. Los parámetros van **en la query string** del POST, el header `service` tiene que coincidir con la Redirect URL e incluir `https://`, y el token dura 7200 s.
- **Endpoints:**
  - `GET /accounts/balances?customer-id=…`
  - `GET /v1/accounts/{account}/movements/{dia|anteriores|diferidos}`
  - Extractos en `/accounts/{account}/statements/…`
  - **Máximo 64 días por request.**
  - Hay que mandar el header `client_id` en cada llamada (gateway IBM API Connect).
- **Campos de un movimiento** (ejemplo del README):
  - `id`
  - `amount`: negativo = débito
  - `debit_credit_type`: `D` o `C`
  - `movement_date`, `process_date`, `value_date`, `real_date_activity`
  - `code_description_ib`: descripción **estandarizada** por Interbanking, p. ej. «TRANSFERENCIA EMITIDA»
  - `code_description_bank`: descripción **original del banco**, p. ej. «TRANSF.INMEDIATA»
  - `operation_code_ib` (p. ej. `T01`) y `operation_code_bank` (p. ej. `00501`)
  - `customer_cuit`: CUIT del tercero
  - `depositor_description`: nombre del tercero
  - `voucher_number`, `account_cbu`, `branch_office_activity`
- **Código de banco de BNA:** `011` ([README](https://github.com/rje1974/interbanking-api-ejemplo), [Wikipedia CBU](https://es.wikipedia.org/wiki/Clave_Bancaria_Uniforme)).
- **Ventaja enorme para clasificar:** trae D/C explícito, el CUIT de la contraparte y un código normalizado entre bancos (`operation_code_ib`). Así la clasificación no depende del texto de BNA.
- **A CONFIRMAR:**
  1. el precio del Plan Básico o superior (la web no lo publica: [planes](https://www.interbanking.com.ar/planes));
  2. que la API **acepte llamadas desde IPs de EE. UU.** (Vercel `iad1`);
  3. el catálogo oficial de `operation_code_ib`;
  4. los términos de uso para un SaaS multi-tenant: cada empresa tiene que tener su app y su `customer-id`, nunca compartir credenciales ([README](https://github.com/rje1974/interbanking-api-ejemplo)).

### 1.7 Estrategia recomendada (de más a menos automática)

1. **Nivel A, automático:** Interbanking API, si la SAS contrata un plan con APIs. Un cron diario (Vercel Cron, ya hay 9 jobs en el repo) baja los movimientos `anteriores` de D-1 en ventanas de 60 días o menos, con *upsert* por `id`. Las credenciales se guardan cifradas, igual que los tokens de Meta.
2. **Nivel B, semiautomático:** arrastrar y soltar la exportación XLS, CSV o TXT de NE24 (o de BNA+ Empresas, si exporta) una vez por semana. El importador detecta solo el formato y deduplica los solapamientos.
3. **Nivel C, control mensual:** subir el **PDF del resumen** para conciliar saldo inicial y final, los totales de Ley 25.413 y los movimientos faltantes. Si no hay A ni B, el PDF es la fuente única.

---

## 2. Cargos y movimientos típicos: cómo aparecen y cómo se contabilizan

**Fuentes de las etiquetas:**
- reglas por banco de un estudio contable argentino, publicadas en GitHub ([`conceptos_bancos_cache.json`](https://github.com/zustovichmartina-ux/Estudio-Contable/blob/master/data/conceptos_bancos_cache.json); de ahí sale el **«EC»** de la tabla);
- los parsers [bank-extractor](https://github.com/Francoooo22/bank-extractor) («**BX**») y [xExtracta](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario) («**XX**»);
- el glosario de [CPN Gustavo Rojas](https://www.rojas.com.ar/abreviaturas-homebanking/) («**GR**»).

**Ninguna es documentación oficial de BNA.** Los textos exactos de cada línea están **A CONFIRMAR** con los extractos reales de la SAS.

### 2.1 Impuesto sobre los créditos y débitos (Ley 25.413, el «impuesto al cheque»)

- **Alícuota general:** «SEIS POR MIL (6‰) para los créditos y … SEIS POR MIL (6‰) para los débitos». Es del **12‰** para operatorias sin cuenta ([Decreto 380/2001, art. 7, texto actualizado](https://servicios.infoleg.gob.ar/infolegInternet/anexos/65000-69999/66561/texact.htm)).
- **Exención clave para conciliar:** las «transferencias de fondos … excepto mediante el uso de cheques, con destino a otras cuentas bancarias **a nombre del ordenante**». El Decreto 301/2021 la extendió a las cuentas de pago ([art. 10 inc. b](https://servicios.infoleg.gob.ar/infolegInternet/anexos/65000-69999/66561/texact.htm)).
  → Si un crédito *no* tiene su impuesto asociado, es una pista de transferencia entre cuentas propias, por ejemplo un retiro de Mercado Pago. Es una heurística, no una regla.
- **Cómo se computa en Ganancias:**
  - El **33 %** del impuesto ingresado es pago a cuenta ([Decreto 380/2001, art. 13, texto según Decreto 409/2018](https://servicios.infoleg.gob.ar/infolegInternet/anexos/65000-69999/66561/texact.htm); [ARCA](https://www.afip.gob.ar/creditosyDebitos/casos-especiales/computo-en-ganancias.asp)).
  - Las **micro y pequeñas empresas** pueden computar el **100 %**. Las manufactureras «medianas – tramo 1», el 60 %. En ambos casos solo el 33 % se traslada como saldo a favor a ejercicios futuros ([ARCA](https://www.afip.gob.ar/creditosyDebitos/casos-especiales/computo-en-ganancias.asp)).
  - Durante 2026, las **microempresas** pueden computar «hasta un 30 % del impuesto efectivamente ingresado como pago a cuenta de hasta el 15 % de las contribuciones patronales con destino SIPA» ([Decreto 923/2025](https://www.argentina.gob.ar/noticias/el-gobierno-nacional-extiende-beneficios-fiscales-para-microempresas-durante-2026)). Cómo se combina con el 100 % en Ganancias lo define la contadora: **A CONFIRMAR**.
  - El Decreto 475/2026 (BO 18/06/2026) amplió exenciones, sobre todo para PSP, PSAV, administradoras de tarjetas y transportadoras de caudales. No cambia el caso de un bar ([abogados.com.ar](https://abogados.com.ar/impuesto-sobre-los-creditos-y-debitos-en-cuentas-bancarias-y-otras-operatorias/39425)).
- **Cómo aparece:**
  - **En BNA (EC):** `IMP AL DEB/CRED`, «Gravamen Ley 25413 s/débitos y s/créditos». El estudio aclara: «**Totalizado al final del resumen**, separado en débitos y créditos pero sumá ambos como un solo impuesto del período». Coincide con el total que exige el BCRA (§1.4). **A CONFIRMAR** si además hay una línea por movimiento o una por día.
  - **En otros bancos:** `IMP LEY 25413` (XX), `IMP.LEY 25413` (Macro, EC), «Impuesto ley 25.413 credito 0,6%» (Santander, BX: «es un **débito** cuando el saldo baja»), `IMP DEB TASA GRAL` y `DB/CR BANCARIOS` (XX), `I25413C` (GR).
- **Asiento sugerido:**
  - Por cada línea: **D** «Impuesto s/créd. y déb. bancarios» / **H** Banco.
  - Al cierre: reclasificar el % computable a **«Pago a cuenta Ganancias – Ley 25.413»** (activo) y dejar el resto como gasto.
  - Para mantener consistencia con el informe de Mercado Pago (`mercadopago.md`), usar las claves `bank_tax_credit` (la parte computable) y `bank_tax_expense` (el resto).
  - **Dato a cargar:** categoría MiPyME (certificado vigente) para elegir el 33 % o el 100 %.

### 2.2 Comisiones de BNA (tarifario vigente, generado el 01/10/2026)

Fuente: [Comisiones y Cargos – Cartera Comercial (PDF)](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf).

| Concepto del tarifario | Importe | Cómo se vería en el extracto |
|---|---|---|
| Compensación cuenta corriente común, **Personas Jurídicas** | **$69.000 + IVA por mes** desde el 31/07/2026 (antes $60.000 + IVA) | Comisión mensual de mantenimiento. EC: `COMISION PAQUETES`. Texto exacto **A CONFIRMAR**. |
| Cuenta Nación PYME / Empresa / Empresa + PYME (paquetes) | $69.000 + IVA por mes | Ídem («COMI PAQUETE» en GR) |
| Cuenta corriente especial PJ | $19.320 por mes, IVA exento | Comisión sin IVA |
| Adicional desde el cheque 20 debitado en el mes | $849 + IVA por cheque | Comisión por cheque |
| NE24: transferencias | Hasta $250.000 sin cargo; de $250.000 a $300.000, $535; más de $300.000, $956. Adicional por cobertura geográfica interbancaria: 0,1 % + IVA | `COMIS.TRANSF.NE24` (EC) / `COMIS.TRANSF.NE` (XX) |
| NE24: pago de impuestos o servicios | $108 + IVA. **Pagos AFIP sin cargo** | Comisión por pago |
| BNA+ Empresas: transferencias interbancarias de más de $300.000 | $1.130 desde el 31/07/2026 (antes $956 + IVA) | Comisión por transferencia |
| BNA+ Empresas: pago de impuestos y servicios | $130 desde el 31/07/2026 (antes $108 + IVA) | Comisión por pago |
| Echeq: emisión / depósito de uno emitido en otro banco / clearing | $50 / $43 / $385, todos + IVA | Comisiones Echeq. BX: `COMIS. CANJE O/BANCOS` (canje de valores de otros bancos) |
| Interbanking: cada operación débito en pesos (monobanco) | $445 + IVA ($300 + IVA) | Comisión Interbanking |
| Extracto adicional a pedido | $3.312 + IVA | Comisión eventual |

Otras comisiones que aparecen en extractos de BNA (EC): `COMIS.DE COMPROMISO`, por líneas de crédito.

**Asiento:** **D** «Gastos y comisiones bancarias» / **H** Banco. El IVA y la percepción van en líneas propias (§2.3 y §2.4).

### 2.3 IVA sobre comisiones e intereses (`I.V.A. BASE`)

- **Alícuota general: 21 %.** Los intereses y comisiones de préstamos de entidades de la Ley 21.526 a **responsables inscriptos** pagan la **mitad, 10,5 %** ([Ley de IVA t.o. 1997, art. 28](https://servicios.infoleg.gob.ar/infolegInternet/anexos/40000-44999/42701/texact.htm)).
- **En BNA (EC):** la misma etiqueta `I.V.A. BASE` sirve para el IVA de comisiones (21 %) y para el de intereses por descubierto (10,5 %).
  → **Para separar los casos:** comparar el importe con la línea «madre» del mismo día. Si da cerca del 21 % es de comisiones; si da cerca del 10,5 %, de intereses (§3.9).
- **Otras variantes:** «IVA 21% reg de transfisc ley27743» (Santander, BX), `IVA` (Galicia, EC).
- **Asiento:** **D** «IVA Crédito Fiscal 21 %» o «IVA Crédito Fiscal 10,5 %» / **H** Banco.
- **Libro IVA Compras:** el resumen bancario se carga como **«otros comprobantes»** ([iProfesional, 18/08/2025](https://www.iprofesional.com/impuestos/435345-iva-simple-como-bajar-pago-mensual-con-tarjeta-y-banco)).
  - Los bancos registran esas comisiones en su propio Libro IVA con el tipo «**099 – Otros Comp. que no cumplen con la RG 1415**» y punto de venta `00003 – Movimientos de cuentas` ([ARCA, Libro IVA Digital, modalidades especiales, IV](https://www.afip.gob.ar/iva/documentos/libro-iva-digital-modalidades-especiales-de-registracion.pdf)).
  - CUIT de BNA: **30-50001091-2** ([listado de CUIT, contadoresenred, 2009](https://contadoresenred.com/listado-de-cuits-de-utilidad/)).
  - **A CONFIRMAR con la contadora:** qué tipo de comprobante y qué número usar del lado comprador.

### 2.4 Percepción de IVA RG 2408 (`RETEN. I.V.A. RG.2408`)

- **Norma:** régimen general de **percepción** de IVA. Alícuota del **3 %** sobre el precio neto, o del **1,5 %** en operaciones al 50 % de la tasa. Se aplica en ventas, locaciones y prestaciones a **responsables inscriptos**. Para quien la sufre tiene «el carácter de impuesto ingresado y será computable en la declaración jurada» ([RG AFIP 2408, arts. 1, 2 y 7](https://servicios.infoleg.gob.ar/infolegInternet/anexos/135000-139999/137452/norma.htm)).
- **En BNA (EC):** `RETEN. I.V.A. RG.2408`. El estudio la interpreta como una retención sobre acreditaciones de tarjeta. Pero desde el **1/9/2024 se derogaron** las retenciones nacionales de IVA y Ganancias sobre cobros electrónicos: RG 5554/2024 deroga las RG 140/1998, 4011/2017 y 4622/2019 ([argentina.gob.ar](https://www.argentina.gob.ar/noticias/se-derogaron-los-regimenes-de-retencion-de-iva-y-ganancias-los-cobros-electronicos)).
  → Lo más probable es que sea la **percepción** del 3 % sobre las comisiones, aunque diga «RETEN.». Hay que verificarlo con el ratio contra la comisión del mismo día: 3 % del neto.
- **Ejemplo:** una comisión de $69.000 lleva una percepción de $2.070.
- **Asiento:** **D** «Percepciones de IVA sufridas» / **H** Banco. Se computa en la DDJJ de IVA del mes.

### 2.5 SIRCREB: IIBB Córdoba sobre acreditaciones bancarias

- **Quién lo sufre:** «Todo Ciudadano que esté inscripto en el Impuesto sobre los Ingresos Brutos en la Provincia de Córdoba es pasible de recaudaciones bancarias». Hay trámite de exclusión o reducción de alícuota, que se pide antes del día 13 de cada mes ([Rentas Córdoba](https://www.rentascordoba.gob.ar/cms/exclusion-o-reduccion-de-alicuota-del-regimen-de-recaudacion/)).
- **Padrones:** Rentas Córdoba aprueba cada mes los padrones y las alícuotas de **SIRCREB** (bancos), **SIRCUPA** (cuentas de pago y billeteras), **SIRTAC** (tarjetas) y **SIRPEI**, tanto para contribuyentes locales como de Convenio Multilateral. La consulta se hace con clave fiscal en «Convenio Multilateral – SIFERE WEB – Consultas» ([Comercio y Justicia, padrones de octubre de 2026](https://comercioyjusticia.info/leyes-y-comentarios/ingresos-brutos-cordoba-aprueban-los-padrones-y-alicuotas-para-octubre-de-2026/); RG 2228/2026 del 27/08/2026, según [Forum Jurídico Fiscal](https://contadoresenred.forumjuridicofiscal.com.ar/cordoba-r-2228-2026-dgr-aprueban-padrones/)).
- **Alícuota:** depende de cada contribuyente. En 2021 la tabla de Córdoba iba de «0,01 % (A)» a «5,00 % (Z)», con un 3 % (letra V) para locales ([Res. 196/21](https://contadoresenred.com/cordoba-alicuotas-sircreb-convenio-multilateral-resolucion-196-21/)). **La de la SAS para 2026 está A CONFIRMAR en el padrón.**
- **Detalle mensual de lo recaudado por banco:** se consulta con clave fiscal en SIFERE WEB, módulo de consultas, según la RG CA 3/2009 ([Comisión Arbitral](https://www.ca.gob.ar/descargas/sircreb/resoluciones/r.g_n3_2009_sircreb_nueva_consulta_para_contribuyentes.pdf)). **A CONFIRMAR** si también aplica a contribuyentes **locales** de Córdoba.
- **Exclusiones de la base** (criterio de la Comisión Arbitral; para Córdoba en 2026, **A CONFIRMAR**) ([contadoresenred](https://contadoresenred.com/sircreb-que-operaciones-estan-exceptuadas/)):
  - transferencias a cuentas del mismo titular, salvo por cheque;
  - contrasientos por error;
  - préstamos de la misma entidad;
  - acreditación de plazos fijos propios.

  → Un SIRCREB cobrado sobre un retiro propio de Mercado Pago sería indebido, y Rentas tiene un [trámite de devolución](https://www.rentascordoba.gob.ar/cms/devolucion-sircreb-iibb-gc/).
- **Cómo aparece:** el crédito entra **bruto** y el SIRCREB es una **línea de débito aparte**. Ejemplos:
  - «REG REC SIRCREB» ([Calim](https://calim.com.ar/reg-rec-sircreb-que-es/))
  - «D SIRCREB», «DBSIR021» (débito por retención de IIBB) y «GRAV.IB.MIS» (GR)
  - «Regimen de recaudacion sircreb c» (Santander, BX)

  En Santander aparecen además líneas **informativas** con una sola cifra («Total Retención … SIRCREB $ 1.203,37», «… 0,10% sobre $1.203.371,18») que **no son movimientos** (BX). **La etiqueta en BNA está A CONFIRMAR.**
- **SIRTAC y SIRCUPA no aparecen en el banco.** Se descuentan en la liquidación del adquirente (SIRTAC) o en Mercado Pago (SIRCUPA); ver `mercadopago.md`.
- **Asiento:** **D** «Recaudaciones IIBB sufridas – SIRCREB» / **H** Banco. Se computa en la DDJJ de IIBB de Córdoba.

### 2.6 Transferencias recibidas y enviadas

- **Datos que el BCRA obliga a mostrar** ([SNP – Transferencias, sección 3.2](https://www.bcra.gob.ar/pdfs/texord/t-snp-tr.pdf)):
  - **Al receptor:** importe, fecha, «nombre del cliente ordenante» (o el nombre de fantasía), «número de CUIT, CUIL, CDI del cliente ordenante» y «**referencia unívoca** de la transferencia».
  - **Al originante:** los mismos datos, pero del receptor.
  - Los canales electrónicos tienen que mostrar estos datos dentro de las 24 h de la acreditación.
  - Los pagos con QR por transferencia se identifican como «**Pago con Transferencia**» o «**Compra con Transferencia**» (como mínimo «Pago CT» o «Compra CT»). Las devoluciones, como «Devolución Pago con transferencia» o «Devolucion PCT» más el nombre del receptor.
  - Los pagos de sueldos o a proveedores en lote se informan como **un solo débito por el total** (3.2.2.1).

  → **El importador tiene que extraer CUIT, nombre y referencia** de la descripción o de columnas aparte. La referencia unívoca podría coincidir con el `EXTERNAL_REFERENCE` (ID de Coelsa) de los retiros de Mercado Pago, lo que daría un *match* exacto (`mercadopago.md`, §1.8). **A CONFIRMAR** que BNA la muestre.
- **Etiquetas vistas en BNA:**
  - **Créditos:** `CR.TRANF.INT.DIST` (resumen de movimientos históricos de BNA, según el índice del buscador de [Studocu](https://www.studocu.com/es-ar/document/universidad-argentina-de-la-empresa/sistemas-informaticos/consulta-de-movimientos-historicos-banco-nacion-argentina/164062456); el significado probable, «crédito por transferencia interbancaria de distinto titular», está **A CONFIRMAR**), `TRANSF.INT.DIST` (EC) y `cr interb` (GR).
  - **Débitos:** `DEB.TRAN.INTERB-LINK`, `DB CREDIN TRANS-LINKCIA` (EC), «db interbanc» ([reclamo en tuquejasuma](https://tuquejasuma.com/banco-nacion/reclamos/significado-de-las-siglas-db-interbanc)) y `DB TRF/G NL` (GR).
  - **Cualquier sentido:** `DEBIN <cuit>`. Según BX, «puede ser débito o crédito según de quién sea el CUIT asociado».
- **Etiquetas de la red Link y de otros bancos** (GR, salvo indicación): `CRTRABEE` (acreditación por banca empresa, BEE), `CREINTEPR` (crédito Interbanking), `CR.TR.INTERB` (Macro), `DBHOMEBA`, `TRLINKEX`, `TRPPRDAT` (pago a proveedores Datanet), `CREDEBIN` (CREDIN, «por ejemplo desde Mercadopago»), «Credito Transferencia Coelsa» (Galicia, EC, con origen o destino Mercado Pago), «TRANSFERENCIA PEI» (EC).
- **Asiento según la contraparte (CUIT):**

| Contraparte | Asiento |
|---|---|
| CUIT propio de la SAS | Transferencia entre cuentas propias (cuenta puente por banco o billetera) |
| Cliente conocido | Deudores por ventas o anticipos de clientes (señas de eventos y reservas) |
| Proveedor conocido | Proveedores |
| Socio | Cuenta particular |
| Sin identificar | «Cobros a identificar» o «Pagos a identificar» |

  El estudio contable exige tres coincidencias para dar por propia una transferencia: banco contraparte, fecha razonable e importe exacto. Si falla alguna, va a «a identificar» (EC).

### 2.7 Acreditaciones de tarjetas y QR

- **Actores:**
  - **Prisma / Payway.** Visa acordó en febrero de 2026 la compra de Prisma Medios de Pago ([Infobae](https://www.infobae.com/economia/2026/02/19/visa-compra-prisma-y-expande-su-negocio-de-pagos-digitales-en-la-argentina/), [Simpson Thacher](https://www.stblaw.com/about-us/news/view/2026/02/20/advent-to-sell-prisma-medios-de-pago-and-newpay-to-visa)).
  - **Fiserv (ex First Data):** terminales **Posnet** y Clover ([Infonegocios](https://infonegocios.info/plus/posnet-de-fiserv-ex-first-data-permite-pago-con-codigo-qr-beneficios-para-ambas-puntas-del-negocio)).
  - **+Pagos Nación:** la app de cobros de BNA con QR, link de pago y terminales ([iProUP](https://www.iproup.com/innovacion/43317-el-banco-nacion-lanzo-su-propio-mercado-pago-como-funciona), [App Store](https://apps.apple.com/us/app/id1641567960)).
  - Mercado Pago Point.
- **Quién acredita:** el **«Banco Pagador»**, que es el banco de la cuenta del comercio. En **Pago con Transferencia (PCT)** la acreditación es «**inmediata**», «todos los días de la semana». Con QR y tarjeta de débito tarda **24 h hábiles**; con crédito, **8 días hábiles** (de 2 a 18 según el plan) ([Fiserv, Pagos con QR](https://www.fiserv.com.ar/pagosconqr/)).
- **Plazos de crédito según la categoría BCRA del comercio** ([Prisma, «Plazos vigentes de acreditación», PDF de 2022](https://prismamediosdepago.blob.core.windows.net/www/Plazos-acreditacion-tarjetas.pdf)):
  - micro y pequeños: 8 días hábiles;
  - medianos, o grandes de **gastronomía**, salud, turismo y alojamiento: 10 días hábiles;
  - resto: 18 días hábiles;
  - débito: 1 día hábil.

  **Que sigan vigentes en 2026 está A CONFIRMAR.** Sirven para definir la **ventana de matching** entre la venta y la acreditación.
- **La línea del banco es el NETO.** El desglose (arancel, IVA del arancel, costo financiero y SIRTAC) está en la liquidación del adquirente. Las retenciones nacionales de IVA y Ganancias sobre estos cobros ya no existen desde el 1/9/2024 ([RG 5554/2024](https://www.argentina.gob.ar/noticias/se-derogaron-los-regimenes-de-retencion-de-iva-y-ganancias-los-cobros-electronicos)).
  → No imputar la acreditación a «Ventas». Va contra **«Tarjetas a cobrar / Liquidaciones a cobrar»** (cuenta puente) y se concilia con la liquidación (EC: «No lo cargues directo a ventas: va a deudores por ventas hasta conciliarlo con el resumen de tarjeta/POS»).
- **Etiquetas:**
  - **BNA (EC):** `LIQ+PAGOS NACIO`, `ACRED PR-ADEL+PAGOSNACION`, `PAGO CON TRANSF`. Corresponden a «ventas cobradas con tarjeta o POS propio».
  - **Prefijos de crédito en BNA (BX):** `CR `, `LIQ `, `ACREDIT`, `DEPOSITO`, `DEP.`
  - **Otros bancos (EC):** «Acreditamiento prisma comercios» (Galicia), «Cupones Prisma/Argen/Mastercard» (BBVA).
  - **Cómo figuran en BNA las liquidaciones de Payway y de Fiserv/Posnet: A CONFIRMAR.**
- **CUIT útiles para detectar la contraparte** (fuentes secundarias, **A CONFIRMAR**): Prisma Medios de Pago S.A. **30-59891004-5** y First Data Cono Sur S.R.L. (Fiserv) **30-52221156-3** ([Infonegocios, Prisma](https://infonegocios.info/tarjetero/empresa/prisma), [Infonegocios, First Data](https://infonegocios.info/tarjetero/empresa/first-data)).

### 2.8 Retiros de Mercado Pago hacia BNA

- **Lado Mercado Pago:** el retiro aparece como `payout`. `EXTERNAL_REFERENCE` trae el ID de Coelsa y `PAYOUT_BANK_ACCOUNT_NUMBER` la cuenta destino. En los retiros a cuenta propia no hubo impuesto al cheque (ver `mercadopago.md`).
- **Lado BNA:** es una **transferencia recibida**, procesada por Coelsa o CREDIN ([GR](https://www.rojas.com.ar/abreviaturas-homebanking/): `CREDEBIN`, «desde Mercadopago»; EC: «Credito Transferencia Coelsa» en Galicia). Como ordenante, por norma BCRA, debería figurar el **titular de la CVU, o sea la misma SAS** (§2.6). La otra posibilidad es **MERCADOLIBRE S.R.L.**, CUIT **30-70308853-4**, que aparece en extractos con esa forma en débitos que hace MercadoLibre ([tuquejasuma](https://tuquejasuma.com/mercado-libre/reclamos/debito-desconocido-mercadolibre-srl-30-70308853-4)).
  → **Texto exacto A CONFIRMAR con un retiro real.**
- **Regla propuesta** (reglas 10 y 18 de §2.10): crédito por transferencia, con contraparte = CUIT propio o 30-70308853-4, o descripción con `MERCADO PAGO` o `MERCADOLIBRE` → **«Transferencia entre cuentas propias – Mercado Pago»**. Si solo aparece `COELSA`, `CREDIN` o `CVU`, cuenta como indicio pero no alcanza, porque esos mecanismos los usa cualquier billetera o banco. Se concilia contra el `payout` por importe exacto, con una fecha de 0 a 2 días hábiles y, si aparece, el ID de Coelsa.
  No debería llevar Ley 25.413 por el art. 10 inc. b ni SIRCREB por las exclusiones. Si aparecen, hay que marcarlo para reclamar.

### 2.9 Otros movimientos frecuentes en un bar

| Movimiento | Etiquetas vistas | Asiento |
|---|---|---|
| Cheque propio pagado por cámara | `48HS. BANCOS` / `48HS. CANJE ZONAL` en **débito** (XX, EC) | Proveedores / Cheques diferidos a pagar |
| Cheque de terceros acreditado | Las mismas, en **crédito** (XX, EC) | Valores al cobro / Deudores |
| Pago de la tarjeta corporativa | `DB PM/TOT RESUMEN TCORP`, `DEB. LIQ VISA`, `DEB/MAD` (EC, BX) | Tarjetas de crédito a pagar |
| Pagos a ARCA (VEP: IVA, F.931, anticipos) | VEP. CUIT de ARCA/AFIP **33-69345023-9** ([contadoresenred](https://contadoresenred.com/listado-de-cuits-de-utilidad/)). En Galicia: «Transf. AFIP», «Deb. Autom de Serv AFIP» (EC) | Impuestos a identificar, conciliados contra los VEP |
| IIBB, sellos u otros tributos provinciales | `INGR.BRUTOS/SELLOS BS.AS.` (BNA, EC; en Córdoba la etiqueta está **A CONFIRMAR**) | IIBB a pagar / Impuestos y tasas |
| Sueldos | Pago de haberes en lote: **un débito por el total** (BCRA 3.2.2.1) | Sueldos a pagar, conciliado con el recibo o la planilla |
| Débitos automáticos de servicios | El BCRA exige empresa, identificación, concepto, importe y fecha (§1.4). GR: `DEBAUT`, `DEBCAMA`, `PAGSERVDB` | Proveedores de servicios |
| Intereses por descubierto | EC: «INTERESES NEGATIVOS» con su IVA al 10,5 % | Intereses bancarios (gasto) + IVA CF 10,5 % |
| Cuota de un préstamo de BNA | `COB CTA PMO` (GR) | Préstamos bancarios (capital) + intereses |
| Seguro del banco | `DA NACION SE` (GR) | Seguros |
| Efectivo | GR: `CR-DEPEF`, `EXTCAJER` | Caja |
| Plazo fijo o FCI | GR: `DB-PFELE`, `PAGOPF`; FCI (EC) | Inversiones (no es resultado) |
| Contrasientos y ajustes | GR: `cr.aj.lk.rec` y `DB.AJ.LK-REC` (ajustes Link), `DEV`, `CONTRASIENT` | Contra la misma cuenta que el movimiento original |

### 2.10 Tabla maestra de clasificación (primera versión)

Se aplica en orden, la primera regla que coincide gana, sobre la descripción **normalizada**: mayúsculas, sin acentos y con espacios colapsados. **El sentido (D/C) nunca sale del texto.** En la tabla, los `|` de las regex aparecen escapados como `\|` por el formato Markdown: al copiarlas, sacar la barra invertida. Son un punto de partida y hay que calibrarlas con los extractos reales y tests de Vitest.

| # | Sentido | Regex (JS, flag `i`) | Categoría → clave sugerida | Confianza |
|---|---|---|---|---|
| 1 | D | `/LEY\s*25\.?413\|IMP(UESTO)?\.?\s*(AL\s*)?(DEB\|CRED)\|GRAV(AMEN)?\.?\s*LEY\|I25413\|IMP\.?\s*DEB\.?\s*TASA\|DB\/CR\s*BANCARIOS/` | Impuesto Ley 25.413 → `bank_tax_credit` / `bank_tax_expense` | Alta |
| 2 | D | `/SIRCREB\|DBSIR\d*\|REG\.?\s*REC\|RECAUD.*(IIBB\|ING\.?\s*BR)\|RET(EN)?\.?\s*(IIBB\|I\.?B\.?\|ING\.?\s*BR)\|GRAV\.?\s*IB/` | Recaudación IIBB → `iibb_sircreb` | Alta |
| 3 | D | `/RG\.?\s*2408\|PERC(EP)?\.?\s*(DE\s*)?I\.?\s*V\.?\s*A\|RETEN\.?\s*I\.?\s*V\.?\s*A/` | Percepción de IVA → `iva_percepcion` | Alta |
| 4 | D | `/\bI\.?\s*V\.?\s*A\.?\b/` (después de la 3) | IVA CF: 21 % o 10,5 % por ratio con la línea madre → `iva_cf_21` / `iva_cf_105` | Alta, con el ratio |
| 5 | D | `/INT(ERES(ES)?)?\.?\s*(S\/\s*)?(SALDO\s*)?(DEUDOR\|DESCUB\|NEG)/` | Intereses deudores → `bank_interest_expense` | Media |
| 6 | D | `/COMIS\|COMI\s\|MANT(ENIMIENTO)?\|PAQUETE\|ARANCEL\|CARGO\s/` | Comisiones → `bank_fees` | Alta |
| 7 | D/C | `/^(48\|24)\s*HS\.?\s*(BANCOS\|CANJE)/` | Cheques: D = propio pagado, C = de terceros acreditado | Alta |
| 8 | C | `/(LIQ\|ACRED\|CR\.?\|CRED\.?).*(VISA\|MASTER\|CABAL\|MAESTRO\|AMEX\|NARANJA\|PRISMA\|PAYWAY\|FISERV\|FIRST\s*DATA\|POSNET\|\+?\s*PAGOS\s*NACI)/` | Liquidación de tarjetas o POS → `card_settlements` (puente) | Media, **A CONFIRMAR** |
| 9 | C | `/(PAGO\|COMPRA)\s*(CON\s*TRANSF\|CT\b)/` | Cobro QR (PCT) → `card_settlements` o `customers` | Media |
| 10 | C/D | contraparte = CUIT propio o 30-70308853-4, o `/MERCADO\s*(PAGO\|LIBRE)\|MERCADOLIBRE/` | Transferencia entre cuentas propias → `transfer_own` | Media (alta si hay *match* con el `payout`). COELSA, CREDIN y CVU **no** alcanzan solos: son mecanismos genéricos; ver 18 y 19. |
| 11 | D | `/PM\/TOT\s*RESUMEN\|DEB\.?\s*LIQ\s*VISA\|DEB\/MAD\|PAGO\s*TARJ/` | Tarjeta corporativa → `cards_payable` | Alta |
| 12 | D | `/AFIP\|ARCA\|\bVEP\b\|F\.?\s*931/` o contraparte 33-69345023-9 | Impuestos nacionales → `taxes_to_identify` | Alta |
| 13 | D | `/RENTAS\|DGR\|ING(R)?\.?\s*BRUTOS\|SELL\|MUNIC/` | Impuestos provinciales o municipales | Media |
| 14 | D | `/HABERES\|SUELDO\|ACRED\.?\s*HAB\|PAGO\s*HAB/` | Sueldos → `payroll_payable` | Media |
| 15 | D | `/DEB\.?\s*AUT\|DEBAUT\|DEBCAMA\|PAGSERVDB\|^DA\s\|SEGURO/` | Débito automático o seguros (`DA NACION SE`) → proveedor por CUIT o «a identificar» | Media |
| 16 | C | `/DEP(OSITO)?\.?\s*(EN\s*)?EF\|CR-DEPEF/` | Depósito de efectivo → `cash` | Alta |
| 17 | D | `/EXTRAC\|EXT(CAJ\|RCAJA)/` | Extracción → `cash` | Alta |
| 18 | C | `/CR\.?\s*TR\|CRED\.?\s*TR\|TRANS?F?\.?\s*INT\|CR\s*INTERB\|CREDIN\|COELSA\|DEBIN\|TRANSF\|TRANF\|\bTRF\b/` | Transferencia recibida → por CUIT (§2.6) | Media |
| 19 | D | `/DB\.?\s*TR\|DEB\.?\s*TRAN\|DB\s*CREDIN\|DBHOMEBA\|TRLINKEX\|PAGO\s*PROV\|DEBIN\|TRANSF\|TRANF\|\bTRF\b/` | Transferencia enviada → por CUIT (§2.6) | Media |
| 20 | D/C | `/DEV\|REVERS\|ANUL\|CONTRASIENT\|AJ\.?\s*LK\|AJUSTE/` | Reverso: buscar el original con importe opuesto y misma descripción raíz | Baja |
| 21 | * | (nada coincidió) | «Cobros a identificar» o «Pagos a identificar» | — |

> Criterio de diseño ([xExtracta](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario)): «Una imputación confiada pero equivocada es peor que un casillero vacío». Sugerir una cuenta solo cuando el caso es inequívoco; si no, «a clasificar».

> Prueba rápida: las 21 reglas se corrieron con Node contra 53 descripciones de ejemplo de esta investigación, y todas cayeron donde se esperaba. El script está en `scratchpad/banco-scripts/check-rules.mjs` y sirve de semilla para los tests de Vitest (CLAUDE.md §10).

### 2.11 Ejemplo ilustrativo de la comisión mensual

Es un caso calculado con el tarifario. Las etiquetas vienen de EC y la presentación exacta está **A CONFIRMAR**.

```
31/10/26  COMISION PAQUETES        69.000,00  D   → Gastos y comisiones bancarias
31/10/26  I.V.A. BASE              14.490,00  D   → IVA CF 21 %   (14.490 / 69.000 = 0,21)
31/10/26  RETEN. I.V.A. RG.2408     2.070,00  D   → Percepción IVA (2.070 / 69.000 = 0,03)
```
Las tres líneas quedan agrupadas como «cargo mensual BNA». El asiento es D 69.000 gasto + D 14.490 IVA CF + D 2.070 percepción / H 85.560 banco.

---

## 3. Patrones para un importador robusto

### 3.1 Pipeline

`detectar fuente/formato → parsear → normalizar (centavos, fechas) → verificar saldos → deduplicar → agrupar líneas vinculadas → clasificar → conciliar con otras fuentes → previsualizar → asentar`

Cada paso deja rastro: archivo, hoja, fila original y regla aplicada. Así se puede auditar o deshacer una importación completa.

### 3.2 Detección de formato y de la fila de encabezado

- **Bytes:** BOM UTF-8 o UTF-16, o «PK» de un XLSX. Si no es UTF-8 válido, probar **Windows-1252 o Latin-1**, que es común en los TXT y CSV de bancos argentinos. «%PDF» indica un PDF.
- **Separador** del CSV o TXT: elegir entre `;`, `,`, `\t` o `|` según qué carácter da la cantidad de columnas más estable entre filas.
  - Atención: con coma decimal, **`,` casi nunca es el separador**.
  - El indicio de BNA usaba `|` (§1.5) y Colppy usa `;` ([Colppy](https://intercom.help/Colppy/es/articles/3275205-importar-extracto-bancario)).
  - Contemplar también TXT de **ancho fijo**: columnas alineadas por posición.
- **Fila de encabezado:**
  1. Revisar las primeras **40 filas**. Normalizar cada celda: minúsculas, sin acentos, sin puntuación, espacios colapsados.
  2. Dar puntaje por categorías distintas encontradas, con un diccionario de sinónimos:
     - `fecha`: fecha, fecha mov, fecha operacion, f operacion, fec, fecha proceso, fecha contable
     - `fecha_valor`: fecha valor, f valor
     - `descripcion`: descripcion, concepto, detalle, movimiento(s), leyenda
     - `comprobante`: comprobante, comprob, nro comprobante, referencia, nro operacion, numero
     - `debito`: debito(s), debe, egresos, cargos
     - `credito`: credito(s), haber, ingresos, abonos
     - `importe`: importe, monto
     - `dc`: d/c, deb/cred, tipo, signo, tipo de movimiento
     - `saldo`: saldo, saldo parcial
  3. Exigir `fecha`, `descripcion` y (`importe` o `debito`+`credito`).
  4. Ganar la fila con más puntaje y, a igualdad, la primera.
- **Metadatos previos al encabezado:** número de cuenta, CBU (22 dígitos), CUIT, moneda (`$`, `U$S`, `USD`) y período.
  - La cuenta de BNA tiene **10 dígitos**: los 3 primeros son el código de sucursal ante el BCRA y los 7 siguientes, el número de cuenta ([tarifario](https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf)).
  - La CBU de BNA empieza con **011** ([Wikipedia CBU](https://es.wikipedia.org/wiki/Clave_Bancaria_Uniforme)).
- **Fin de los datos:** una fila con «total», «saldo final» o «fin de resumen», o 3 filas vacías seguidas.
- **XLS o XLSX:** contemplar celdas combinadas, títulos en las primeras filas, fechas como **número serial de Excel** (días desde el 30/12/1899) e importes como número o como texto.
- **Varias cuentas en un mismo archivo:** dividir por bloque de cuenta y **nunca mezclar ARS con USD**. Así lo hace xExtracta en Patagonia y Macro ([README](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario)).
- **Huella del layout:** guardar por tenant una «firma» del formato detectado (encabezados y separador) para reconocerlo después y alertar si cambia. BankStatementParser tiene *fixtures* de «format_changed_partial» para eso ([repo](https://github.com/Santi-RL/BankStatementParser)).

### 3.3 Fechas e importes

- **Fechas:** aceptar `dd/mm/yyyy`, `dd/mm/yy` (BNA PDF, tomar 20yy), `dd-mm-yyyy`, `yyyy-mm-dd`, timestamps ISO (`2025-01-15T00:00:00` de Interbanking) y el serial de Excel.
  - Son **fechas calendario sin hora**. No convertir zonas horarias; tomar el contexto de `America/Argentina/Cordoba` (CLAUDE.md §2).
  - Guardar fecha de operación y, si viene, **fecha valor**.
- **Importes:** parsear **a centavos enteros (`bigint`), sin pasar por `float`** (CLAUDE.md §2).
  - Admitir `1.234.567,89`, `-1.234,56`, `1.234,56-` (**menos al final**, BNA PDF), `(1.234,56)`, prefijos `$`, `ARS`, `U$S`, `USD`, espacios duros (NBSP) y la variante anglo `1,234.56` (BX la contempla).
  - **Heurística del separador:** la última `,` o `.` seguida de exactamente 2 dígitos al final es el decimal y el resto son miles. Un solo separador seguido de 3 dígitos es de miles.
  - Rechazar las filas con importe ambiguo y no adivinar.

### 3.4 Débito o crédito (cuatro casos)

1. **Dos columnas Débito/Crédito** (o Debe/Haber): el sentido sale de cuál está completa.
2. **Una columna con signo** (Interbanking `amount`, Colppy: el débito con «-»).
3. **Importe sin signo más una columna D/C** (Interbanking `debit_credit_type`) o un sufijo D/H. Según extractpro, BNA usa D/H en algún formato: **A CONFIRMAR**.
4. **PDF sin columnas recuperables:** **diferencia de saldo**. Si `saldo_i − saldo_{i−1} = +importe`, es crédito; si da `−importe`, débito. Si ambas fallan, usar el prefijo de texto como último recurso y marcar la fila como «a revisar» (BX).

Siempre que haya saldo, **comparar el sentido declarado con la diferencia de saldo** y avisar si no coinciden. En Santander, «Impuesto ley 25.413 credito 0,6%» es un débito, y el texto engaña (BX).

### 3.5 Control de saldos

- **Por fila:** `saldo_{i−1} + importe_firmado_i == saldo_i`, con una tolerancia de 1 centavo.
- Detectar si el archivo viene **del más nuevo al más viejo** (por fecha o porque el saldo cierra al revés) y darlo vuelta.
- **Saldo inicial y final:** contra `SALDO ANTERIOR` y el último saldo del PDF. El saldo inicial de un período tiene que ser igual al final del anterior («Control de saldos», EC).
- **Si no hay columna de saldo:** pedir saldo inicial y final, o tomarlos del PDF, y verificar `Σ importes == final − inicial`.
- **Si no cierra, no frenar:** importar e informar en ámbar «archivo + fecha donde mirar», como hace xExtracta («sin un solo aviso falso contra 71.024 movimientos reales», [v2.2.4](https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario/releases/tag/v2.2.4)).

### 3.6 Idempotencia y solapamientos

- **Huella por fila:** `sha256(cuenta | fecha | importe_cent | desc_normalizada | comprobante | saldo_cent?)` más un **ordinal** para filas idénticas del mismo día, por ejemplo dos comisiones iguales. El saldo, si viene, es el mejor desempate.
- **Interbanking:** *upsert* por `id`.
- **Fuentes que se pisan** (export semanal, PDF mensual, API): primero cruzar por (fecha, importe, comprobante) y después por (fecha, importe, similitud de descripción). Conservar la **procedencia** de cada fila. El PDF «confirma», no duplica.
- **Pendientes o del día contra históricos:** una fila provisoria se «promueve» cuando aparece en histórico. Si desaparece, se anula, porque pudo ser un reverso.
- **Reimportar el mismo archivo no tiene que cambiar nada.** Mostrar «0 nuevas, N ya existentes».

### 3.7 Particularidades del PDF

- Extraer el texto **con coordenadas**, por ejemplo con `pdfjs-dist` (`getTextContent` con `transform` x/y), para recuperar las columnas DEBITOS y CREDITOS. Si no se puede, usar la diferencia de saldo.
- **Una fila válida tiene al menos dos importes**: el último es el saldo y el anteúltimo, el movimiento. Con eso se descartan líneas informativas de un solo importe y texto legal (BX, CHANGELOG).
- No descartar filas por palabras como «banco», «nación», «resumen» o «comisión», porque forman parte de descripciones reales (`48HS. BANCOS`, `DB PM/TOT RESUMEN TCORP`). Filtrar por **estructura**: la línea tiene que empezar con fecha (BX, CHANGELOG).
- **Líneas de continuación** (descripción en dos renglones, sin fecha): se agregan a la fila anterior.
- Ignorar `TRANSPORTE`, los encabezados repetidos, «Hoja: n», `FIN DE RESUMEN` y las **marcas de margen** de BNA desde 2024.
- **Comprobantes cortos** (de 1 a 3 dígitos) son válidos (XX).

### 3.8 Contraparte: CUIT y CBU

- **CUIT:** regex `\b(20|23|24|25|26|27|30|33|34)-?\d{8}-?\d\b` con validación del **dígito verificador por módulo 11** ([Wikipedia CUIT](https://es.wikipedia.org/wiki/Clave_%C3%9Anica_de_Identificaci%C3%B3n_Tributaria)). El nombre del tercero suele ir pegado antes o después.
- **CBU o CVU:** 22 dígitos en dos bloques con dígito verificador. Pesos `7,1,3,9,7,1,3` en el primero y `3,9,7,1,3,9,7,1,3,9,7,1,3` en el segundo ([Wikipedia CBU](https://es.wikipedia.org/wiki/Clave_Bancaria_Uniforme)). Los primeros 3 dígitos son la entidad.
- **Cruces:**
  - CUIT propio → cuentas propias;
  - maestro de **proveedores** y de **clientes** por CUIT;
  - CUIT conocidos: ARCA 33-69345023-9, MercadoLibre 30-70308853-4, Prisma 30-59891004-5, Fiserv 30-52221156-3 (estos dos últimos **A CONFIRMAR**).

### 3.9 Motor de reglas y líneas vinculadas

- **Reglas por tenant:** prioridad, sentido, regex sobre la descripción normalizada, CUIT de la contraparte, rango de importe, banco o fuente, cuenta destino, confianza y «motivo» (texto para la UI).
- **Agrupar «hijas» con su «madre» del mismo día** cuando el ratio cierra, con tolerancia de ±1 centavo o 0,5 %:
  - comisión → IVA (0,21; o 0,105 si la madre es un interés) → percepción RG 2408 (0,03);
  - crédito o débito → Ley 25.413 (0,006), si BNA lo cobra por movimiento (**A CONFIRMAR**);
  - acreditación → SIRCREB (alícuota del padrón).

  Así se explica el cargo en la UI y se valida la clasificación (§2.11).
- **Aprendizaje:** cuando el usuario reclasifica una fila, ofrecer «crear regla» con la descripción sin números ni CUIT, el sentido y el CUIT de la contraparte. Proponerlo automáticamente después de **2 reclasificaciones iguales**.
- **Cuentas puente** en lugar de resultados: tarjetas a cobrar, Mercado Pago, cuentas propias y «a identificar». Los ingresos reales salen del POS o de la facturación; el banco solo cancela créditos.

### 3.10 Conciliación con otras fuentes

| Línea del banco | Se cruza con | Clave |
|---|---|---|
| Liquidación de tarjeta o QR | Liquidaciones de Payway, Fiserv o +Pagos Nación | Importe neto y fecha de pago; número de comercio |
| Transferencia de Mercado Pago | `payout` de Liquidaciones MP (`mercadopago.md`) | Importe exacto, 0 a 2 días hábiles, ID de Coelsa |
| VEP de ARCA | VEP generados o pagados | Importe y fecha exactos (EC, Galicia: «se cruza automaticamente contra los comprobantes de VEP») |
| Ley 25.413 del período | Total del PDF. Si BNA lo informa, también «Mis Retenciones» de ARCA (nueva versión con consulta por impuesto, agente y fechas: [trivia.consejo](https://trivia.consejo.org.ar/ficha/527527-nueva_version_de_mis_retenciones)). **A CONFIRMAR** que el impuesto al cheque figure ahí | Total mensual |
| SIRCREB del período | SIFERE WEB › Consultas, detalle mensual por banco ([CA RG 3/2009](https://www.ca.gob.ar/descargas/sircreb/resoluciones/r.g_n3_2009_sircreb_nueva_consulta_para_contribuyentes.pdf)) | Total mensual por banco |
| Transferencias a proveedores | Facturas de compra (IVA Compras) | CUIT e importe |
| Sueldos (un débito total) | Liquidación de sueldos del mes | Importe total |

### 3.11 Datos de prueba que hay que pedir antes de codificar

- Un **PDF de resumen** real de BNA de la SAS. Si es nueva, uno de otra cuenta empresa de BNA, anonimizado.
- Una **exportación de movimientos** de NE24 en XLS, CSV y TXT, y de BNA+ Empresas si existe, del mismo período que el PDF, para probar la deduplicación entre fuentes.
- Un día con: una comisión con su IVA y su percepción, una acreditación de tarjetas, un retiro de Mercado Pago, una transferencia a un proveedor, un VEP y un SIRCREB.
- Si se contrata Interbanking: un JSON real de `movements/anteriores`, con los datos personales tapados.

---

## 4. Datos de banco que hay que cargar a mano al inicio

| Dato | Dónde se saca | Para qué sirve |
|---|---|---|
| Cuenta BNA: tipo (CC común, CC especial, Cuenta Nación PyME o Empresa), moneda, número de 10 dígitos, CBU, alias, sucursal | Contrato de apertura o BNA+ / NE24 › Consultas › CBU | Identificar la cuenta en los archivos y elegir las comisiones esperadas |
| **Saldo inicial** a la fecha de corte | `SALDO ANTERIOR` del primer resumen | Asiento de apertura y control de saldos |
| CUIT de la SAS + **todas las CBU y CVU propias** (Mercado Pago, otros bancos) | Constancia de CUIT; apps | Detectar transferencias entre cuentas propias |
| Adquirentes y **números de comercio** (Payway, Fiserv/Posnet/Clover, +Pagos Nación, MP Point) | Portales de los adquirentes | Clasificar y conciliar las liquidaciones |
| Condición en IIBB: local de Córdoba o Convenio Multilateral. **Alícuota SIRCREB** del mes | SIFERE WEB › Consultas, con clave fiscal | Validar el SIRCREB cobrado y detectar cobros indebidos |
| **Certificado MiPyME** y categoría (micro o pequeña) | ARCA | Usar el 100 % en lugar del 33 % de la Ley 25.413 en Ganancias |
| Proveedores y clientes con CUIT | Maestros de la app | Clasificar las transferencias por contraparte |
| Plan de cuentas: mapeo de las claves de §2.10 | Configuración de Administración | Que las reglas generen asientos |
| Si hay Interbanking: `client_id`, `client_secret` y `customer-id` | Portal de Interbanking | Importación automática (Nivel A) |

---

## 5. A CONFIRMAR / preguntas abiertas

1. **Canal de la SAS:** BNA+ Empresas (`digital.bna.com.ar`), NE24 (`bee3.redlink.com.ar/bna3`) o los dos. ¿Qué perfil de usuario y qué módulo NE24 (Básico o Full) tiene?
2. **Exportación de BNA+ Empresas:** ¿exporta movimientos? ¿En qué formatos y con cuántos meses? ¿Muestra el CUIT de la contraparte? Lo más simple es que la SAS haga una exportación de prueba.
3. **Layout real del XLS, CSV y TXT de NE24:** encabezados, separador, codificación, D/C o signo, fecha valor.
4. **Etiquetas exactas en BNA de:**
   - SIRCREB;
   - Ley 25.413: si hay una línea por movimiento, una por día o solo el total al final;
   - liquidaciones de Payway y de Fiserv;
   - retiros de Mercado Pago (¿ordenante = SAS o MercadoLibre?);
   - débitos de ARCA y de Rentas Córdoba.
5. **`RETEN. I.V.A. RG.2408`:** ¿es la percepción del 3 % sobre las comisiones? El ratio lo confirma con el primer extracto.
6. **Interbanking:** precio del Plan Básico o superior con InterAPIs; si la API acepta IPs de EE. UU. (Vercel `iad1`); catálogo oficial de `operation_code_ib`; condiciones para un SaaS.
7. **«Emisión de Extractos de Cuenta en Soporte» ($7.903 + IVA por mes):** ¿es un archivo estructurado? ¿Con qué layout? Si es un TXT diario, sería una vía B+ barata.
8. **Alícuota SIRCREB de la SAS** en el padrón de Córdoba de 2026, y si las exclusiones de la base (transferencias propias) se aplican en Córdoba.
9. **Plazos de acreditación de tarjetas vigentes en 2026** (el PDF de Prisma es de 2022) y **en qué categoría BCRA** queda HUB: micro o pequeña (8 días) o la de gastronomía (10 días).
10. **Libro IVA Compras:** tipo y número de comprobante para cargar las comisiones bancarias con CUIT 30-50001091-2. Lo decide la contadora.
11. **Ley 25.413 y Decreto 923/2025:** cómo combinar el 100 % en Ganancias (micro o pequeña) con el cómputo contra contribuciones SIPA en 2026. Lo decide la contadora.
12. **Constancia del impuesto al cheque:** ¿BNA emite un certificado mensual o anual del impuesto percibido, o aparece en «Mis Retenciones» de ARCA? Hace falta para respaldar el pago a cuenta de Ganancias.
13. **Categoría de las comisiones de BNA para la SAS:** confirmar con el oficial de cuenta qué producto se contrató (cuenta corriente común con $69.000 + IVA por mes, cuenta corriente especial con $19.320 IVA exento, o un paquete Cuenta Nación) y qué bonificaciones tiene. Con eso el importador puede avisar si un cargo mensual se desvía de lo esperado.

---

## 6. Fuentes

**Banco Nación**
- BNA+ Empresas: https://www.bna.com.ar/home/bnamasempresas
- Nueva BNA+ (personas y empresas): https://www.bna.com.ar/Personas/nuevabnamas
- App «Nueva BNA+»: https://apps.apple.com/ar/app/bna-digital-empresas/id6446181557
- Adhesión a BNA Digital Empresas: https://www.bna.com.ar/Empresas/OnBoardingBancaDigital
- Nación Empresa 24: https://bna.com.ar/Empresas/Grandes/NacionEmpresa24
- Migración a BNA+: https://www.bna.com.ar/home/migracionbnamas
- BNA Conecta (marketplace): https://www.bna.com.ar/home/bnaconecta y https://www.lmneuquen.com/el-banco-nacion-lanzo-un-portal-potenciar-las-pymes-n846242
- Comisiones y Cargos, Cartera Comercial (PDF generado el 01/10/2026): https://bna.com.ar/Downloads/ComisionesYCargosComercial.pdf
- FAQ de cuentas (extracto electrónico): https://www.bna.com.ar/Personas/CajaDeAhorrosEnPesosYDolares/PreguntasFrecuentesCajaDeAhorrosEnPesosYDolares
- Playlist BNA+ Empresas: https://www.youtube.com/playlist?list=PLIinff-hDEz0MIn5-Eid29oMpR33tWplR
- +Pagos Nación: https://www.iproup.com/innovacion/43317-el-banco-nacion-lanzo-su-propio-mercado-pago-como-funciona y https://apps.apple.com/us/app/id1641567960
- Baja del home banking de personas (marzo de 2026): https://www.elnueve.com/servicios/el-banco-nacion-anuncio-que-dejara-de-funcionar-su-home-banking-que-cambiara-y-como-seguir-operando_20260313/

**Red Link e Interbanking**
- FAQ Banca Electrónica 3.0, Red Link (publicada por Banco Julio): https://www.bancojulio.com.ar/wp-content/uploads/2023/07/Preguntas-Frecuentes-BEE-3.0.pdf
- Interbanking, planes: https://www.interbanking.com.ar/planes
- Interbanking, soluciones: https://www.interbanking.com.ar/soluciones
- Portal de desarrolladores: https://developers.interbanking.com.ar/api/prod/
- Cliente no oficial con los detalles de la API: https://github.com/rje1974/interbanking-api-ejemplo

**BCRA**
- Reglamentación de la cuenta corriente bancaria (Com. «A» 8299, punto 1.5.2.3): https://www.bcra.gob.ar/pdfs/texord/t-ctacte.pdf
- Sistema Nacional de Pagos, Transferencias (sección 3.2): https://www.bcra.gob.ar/pdfs/texord/t-snp-tr.pdf

**Impuestos**
- Decreto 380/2001, texto actualizado (arts. 7, 10 y 13): https://servicios.infoleg.gob.ar/infolegInternet/anexos/65000-69999/66561/texact.htm
- ARCA, cómputo en Ganancias (33 % / 100 % / 60 %): https://www.afip.gob.ar/creditosyDebitos/casos-especiales/computo-en-ganancias.asp
- Decreto 923/2025 (microempresas, SIPA 2026): https://www.argentina.gob.ar/noticias/el-gobierno-nacional-extiende-beneficios-fiscales-para-microempresas-durante-2026
- Decreto 475/2026: https://abogados.com.ar/impuesto-sobre-los-creditos-y-debitos-en-cuentas-bancarias-y-otras-operatorias/39425
- RG AFIP 2408 (percepción de IVA): https://servicios.infoleg.gob.ar/infolegInternet/anexos/135000-139999/137452/norma.htm
- Ley de IVA t.o. 1997, art. 28: https://servicios.infoleg.gob.ar/infolegInternet/anexos/40000-44999/42701/texact.htm
- RG 5554/2024 (derogación de retenciones sobre cobros electrónicos): https://www.argentina.gob.ar/noticias/se-derogaron-los-regimenes-de-retencion-de-iva-y-ganancias-los-cobros-electronicos
- ARCA, Libro IVA Digital, modalidades especiales: https://www.afip.gob.ar/iva/documentos/libro-iva-digital-modalidades-especiales-de-registracion.pdf
- iProfesional, comisiones como «otros comprobantes»: https://www.iprofesional.com/impuestos/435345-iva-simple-como-bajar-pago-mensual-con-tarjeta-y-banco
- Mis Retenciones, nueva versión: https://trivia.consejo.org.ar/ficha/527527-nueva_version_de_mis_retenciones

**Ingresos Brutos Córdoba**
- Rentas Córdoba, exclusión o reducción de SIRCREB: https://www.rentascordoba.gob.ar/cms/exclusion-o-reduccion-de-alicuota-del-regimen-de-recaudacion/
- Rentas Córdoba, devolución de SIRCREB: https://www.rentascordoba.gob.ar/cms/devolucion-sircreb-iibb-gc/
- Padrones de octubre de 2026: https://comercioyjusticia.info/leyes-y-comentarios/ingresos-brutos-cordoba-aprueban-los-padrones-y-alicuotas-para-octubre-de-2026/
- RG 2228/2026: https://contadoresenred.forumjuridicofiscal.com.ar/cordoba-r-2228-2026-dgr-aprueban-padrones/
- Res. 196/21, alícuotas SIRCREB: https://contadoresenred.com/cordoba-alicuotas-sircreb-convenio-multilateral-resolucion-196-21/
- Comisión Arbitral, RG 3/2009 (consulta SIRCREB): https://www.ca.gob.ar/descargas/sircreb/resoluciones/r.g_n3_2009_sircreb_nueva_consulta_para_contribuyentes.pdf
- Exclusiones SIRCREB: https://contadoresenred.com/sircreb-que-operaciones-estan-exceptuadas/
- «REG REC SIRCREB»: https://calim.com.ar/reg-rec-sircreb-que-es/

**Medios de pago**
- Fiserv, Pagos con QR (PCT inmediato, banco pagador): https://www.fiserv.com.ar/pagosconqr/
- Prisma, plazos de acreditación (PDF de 2022): https://prismamediosdepago.blob.core.windows.net/www/Plazos-acreditacion-tarjetas.pdf
- Visa compra Prisma: https://www.infobae.com/economia/2026/02/19/visa-compra-prisma-y-expande-su-negocio-de-pagos-digitales-en-la-argentina/ y https://www.stblaw.com/about-us/news/view/2026/02/20/advent-to-sell-prisma-medios-de-pago-and-newpay-to-visa
- Posnet de Fiserv: https://infonegocios.info/plus/posnet-de-fiserv-ex-first-data-permite-pago-con-codigo-qr-beneficios-para-ambas-puntas-del-negocio
- CUIT de Prisma y First Data: https://infonegocios.info/tarjetero/empresa/prisma y https://infonegocios.info/tarjetero/empresa/first-data
- CUIT de MercadoLibre S.R.L.: https://tuquejasuma.com/mercado-libre/reclamos/debito-desconocido-mercadolibre-srl-30-70308853-4
- Listado de CUIT (AFIP, BNA): https://contadoresenred.com/listado-de-cuits-de-utilidad/

**Parsers, glosarios y reglas de terceros (no oficiales)**
- bank-extractor (parser de PDF de BNA, tests y CHANGELOG): https://github.com/Francoooo22/bank-extractor
- xExtracta (README y v2.2.4): https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario y https://github.com/marvaq-ai/xExtracta_transformador-pdf-bancario/releases/tag/v2.2.4
- Reglas por banco de un estudio contable: https://github.com/zustovichmartina-ux/Estudio-Contable/blob/master/data/conceptos_bancos_cache.json
- BankStatementParser (fixtures de cambio de formato): https://github.com/Santi-RL/BankStatementParser
- Glosario de abreviaturas (CPN Gustavo Rojas): https://www.rojas.com.ar/abreviaturas-homebanking/
- extractpro (descarga del resumen de BNA, fuente comercial): https://extractpro.app/blog/como-descargar-extracto-bancario-homebanking-argentina
- Zoologic «EXTRACTONACION» (404 hoy, visto solo en el buscador): http://campus.zoologic.com.ar/novedades/dnvdf/dnvtycg_func10119.htm
- Colppy, formato de importación: https://intercom.help/Colppy/es/articles/3275205-importar-extracto-bancario
- Xubio, formato de importación: https://ayuda.xubio.com/es-ar/como-hago-conciliacion-bancaria-automatica/
- Wikipedia, CBU y CUIT: https://es.wikipedia.org/wiki/Clave_Bancaria_Uniforme y https://es.wikipedia.org/wiki/Clave_%C3%9Anica_de_Identificaci%C3%B3n_Tributaria
