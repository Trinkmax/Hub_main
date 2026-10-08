# Fase 3 · Pasada con datos reales en el bar demo

> **Fecha:** 08/10/2026 · **Rama:** `feat/administracion` (HEAD `9f43899`; lo de esta pasada está **sin commitear**)
> · **Migraciones:** las 14 aplicadas en producción.
>
> **Qué fue.** Dos agentes recorrieron en paralelo, por la app y como dueño de QA (Chrome sin interfaz por CDP,
> clics reales), los caminos de datos de verdad en `demo-administracion`:
> - ARCA: CUIT de la SAS y pruebas de homologación contra el ARCA real;
> - los tres importadores: Mis Comprobantes, Mercado Pago y banco.
>
> Hubo una pasada por flujo, con capturas a 1280 y 390 px, arreglos y recaptura solo de lo que cambió.
>
> **Insumos:**
> - `fase3-estado.md`;
> - la pasada visual anterior (`tasks/w4fqxrf21.output`);
> - los dos reportes de esta pasada.
>
> Lo escribió el cierre después de correr los chequeos y de verificar los datos con SQL de solo lectura. Las horas
> son de Córdoba; la verificación se hizo a las 14:18.

---

## 0. Resumen

- **Todo verde y el cierre no tuvo que arreglar nada.** `tsc` completo, `npm run lint` y `npm run test:ci` dan
  exit 0 (§1).
- **Solo se escribió en `demo-administracion`** (§2). En las 30 tablas `acc_*` no hay filas de ningún otro bar, ni
  de hoy ni de antes. En el `audit_log` desde las 11:30, lo único de otro bar son 3 reservas del salón de `hub`,
  cargadas por su personal.
- **Se recorrió punta a punta** (§3):
  - la CUIT de la SAS;
  - todas las escrituras de «Pruebas (homologación)», con una «Probar conexión» real contra ARCA;
  - Mis Comprobantes de septiembre (23 comprobantes);
  - Mercado Pago (07 y 08/10);
  - Banco Nación (01 al 07/10), con «Contanos qué es cada columna»;
  - la marca manual de «Cómo arrancar»;
  - el Resumen al final.
- **24 arreglos** (§4): 8 de ARCA y 16 de los importadores. Cuatro tocaban números o mensajes de fondo:
  1. las notas de crédito **sumaban** en «Listos para cargar» y en los totales de la revisión;
  2. «Ya estaban cargados» no contaba el día de Mercado Pago cargado a mano;
  3. las compras salían ordenadas por CUIT;
  4. en homologación, el error real de ARCA (`cms.cert.untrusted`) mostraba un texto que decía lo contrario de lo
     que pasaba.
- **Lo que quedó en el demo** (§5):
  - la CUIT de la SAS y 8 proveedores nuevos;
  - 27 comprobantes importados: 18 de ARCA, 5 de Mercado Pago y 4 del banco;
  - 3 compras de ARCA sin cargar a propósito, para mostrar la revisión en vivo;
  - una conexión **de pruebas** de ARCA en error, con un certificado local de descarte;
  - **nada en producción de ARCA**.
- **Pendiente** (§6): el certificado real de WSASS, la conexión de producción, archivos reales de HUB y una contadora
  de verdad. Además quedan 5 bugs chicos fuera de las áreas de esta pasada. El más visible: en modo oscuro, un
  checkbox tildado se ve vacío.

---

## 1. Chequeos del cierre (resultados exactos)

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit -p /Users/ignaciobaldovino/Hub_main --incremental false` | exit 0, sin salida (24,9 s) |
| `npm run lint` (`biome check .`) | exit 0 · «Checked 1696 files in 823ms. No fixes applied.» |
| `npm run test:ci` (`vitest run`) | exit 0 · **263 archivos OK / 33 salteados (296) · 4684 tests OK / 282 salteados (4966)** · 13,89 s |

**Cómo se llega a 4684 tests desde el cierre de la fase 3** (261 archivos, 4673 tests):

| Origen | Suma |
|---|---|
| Pasada visual (`administracion-wire`) | +1 test |
| `arca-homologacion-copy` (archivo nuevo) | +5 tests |
| `arca-homologacion-render` (archivo nuevo) | +3 tests |
| `imports-ui-filters` (`signedTotalCents` y `formatFxRate`) | +2 tests |

**Notas**

- Los salteados son los de `tests/rls`, que corren en el job `rls` de CI.
- El cierre no cambió ningún archivo.
- Además del SQL, revisó a mano los cambios de `lib/` y verificó en la base dos supuestos del código:
  - la NC importada tiene `summary.kind = 'credit_note'`, que es lo que mira `signedTotalCents`;
  - `previewText` solo cambia lo que se muestra en el mapeo de columnas: la importación relee el archivo.
- Logs: `scratchpad/cierre-datos/{tsc,lint,test}.log`.

---

## 2. Solo se tocó el bar demo (SQL de solo lectura, 14:18)

`demo-administracion` = `0bf3d0cb-8ea4-4edb-8245-887184babb3f`.

| Tabla | Bares con filas (de siempre) | Filas del demo creadas hoy |
|---|---|---|
| `acc_import_batches` | solo `demo-administracion` | 3, creados entre las 13:11 y las 13:41. Los tres son de esta pasada |
| `acc_arca_connections` | solo `demo-administracion` | 1 (homologación): creada 13:03, última prueba 13:13 |
| `acc_documents` | solo `demo-administracion` | 99 desde la medianoche UTC (ver abajo) |

Los 99 comprobantes:

| Cuántos | De dónde | Hora |
|---|---|---|
| 70 | la carga del demo de la fase 2 | 21:12 del 07/10 |
| 2 | el usuario «Socios (demo)» (§5.7) | 11:44 |
| **27** | **esta pasada** | 13:27 a 13:44 |

**El resto de la base**

- **Las otras 27 tablas `acc_*`,** incluidas las líneas de comprobantes y de asientos (644 cada una) y la caché del
  padrón (vacía): ninguna fila de otro bar.
- **Lo tocado en el demo después de las 11:50** coincide con los reportes:
  - importación: 59 ítems, 37 propuestas, 1 regla y 1 formato de extracto;
  - libros: 27 asientos, 27 envíos y 18 comprobantes fiscales;
  - proveedores: 10 (8 nuevos y 2 editados);
  - Mercado Pago: 1 configuración;
  - ARCA: 1 ticket y 1 secreto;
  - 1 cambio en los datos de la SAS y 2 marcas de guía.
- **`audit_log` desde las 11:30**
  - Todas las acciones `acc_*` son del demo, hechas por dueños del demo: «Dueño QA», y «Socios (demo)» en sus 4
    filas.
  - El único otro bar es `hub`, con 3 `salon_reservation.created` de usuarios que no son del demo: la operación
    normal del bar.
- **`tenants` y `memberships`:** nada nuevo ni cambiado desde las 11:30. Las 2 membresías del demo creadas desde la
  medianoche UTC son de la noche del 07/10, de antes de esta pasada.
- **ARCA en toda la base:**
  - no hay ninguna conexión de producción;
  - hay **0** facturas emitidas con ARCA y **0** filas en la caché del padrón.

---

## 3. Qué se recorrió punta a punta

### 3.1 ARCA

**1. CUIT de la SAS** (a 390)

- En Ajustes › Datos de la SAS se cargó 30-71234567-1 y salió «Datos guardados.».
- La pestaña ARCA pasó del estado A («Primero cargá la CUIT») al B:
  - «Producción · 1 de 9 pasos listos»;
  - los 11 pasos;
  - «Seguir con la guía».
- En la guía, el paso 0 quedó «Hecho» y con «Desmarcar».
- Las maquetas muestran «DEMO ADMINISTRACIÓN SAS [30-71234567-1]», el alias `demoadministracionplataforma` y el DN
  `SERIALNUMBER=CUIT 30712345671`.

**2. Producción:** no se tocó, a propósito.

**3. Pruebas (homologación):** se recorrieron todas las escrituras.

- **Pedido**, con la CUIT personal 20-12345678-6 y el alias `demoadministraciontest`.
  - `openssl` confirma el sujeto del `.csr`.
  - «Copiar el alias» y «Ver el texto del pedido» andan.
  - Después de recargar, «Descargar de nuevo» baja un archivo idéntico byte a byte.
- **«Empezar de cero»:** se confirmó en el `AlertDialog` y se generó un segundo par de claves.
- **Punto de venta 1:** «Listo: guardamos el punto de venta 0001.»
- **Certificado**, firmado por una CA local de descarte:
  - el del pedido viejo se rechaza con «Este certificado es de otro pedido…», sin escribir nada;
  - el bueno se acepta: «Listo: certificado válido hasta el 07/10/2028…».
- **«Probar conexión», una sola vez, contra el ARCA de homologación real:** 14,5 s en el navegador y 12,7 s en el
  servidor.
  - «ARCA responde» pasó (FEDummy OK).
  - El segundo chequeo falló con el error real del WSAA, `cms.cert.untrusted`. Es lo esperable con un certificado
    que no salió de WSASS, y destapó el texto equivocado (§4.1).

### 3.2 Importadores

**Los archivos** son sintéticos:

- los arma `visual-2/importar/tools/make-demo-files.mts` con los helpers del repo;
- los valida `check-demo-files.mts` con los mismos planes de subida que usa la app.

| Archivo | Qué trae |
|---|---|
| `Mis Comprobantes Recibidos - septiembre 2026.zip` | 23 comprobantes de septiembre (formato G3) de 11 proveedores de bar: uno en dólares, 2 que ya estaban cargados, 1 nota de crédito A y 2 con «Otros tributos» |
| `liquidaciones-mercadopago-07-al-08-oct-2026.csv` | 22 movimientos. El saldo inicial coincide con el de los libros |
| `Banco Nacion - movimientos 01-10 al 07-10-2026.xlsx` | 14 movimientos, con títulos que la app no conoce a propósito. El saldo final coincide con los libros después de cargar |

**1. Mis Comprobantes** (1280 y 390)

1. **Detección:** «Encontramos 23 comprobantes de compras», 11 proveedores, $ 7.617.565,00 y 1 en moneda
   extranjera.
2. **Subida** con progreso y, después, la revisión.
3. **«Proveedores nuevos (8)».**
   - Sin ARCA conectado, ofrece «Conectá ARCA para completarlos solos».
   - Se cargaron nombres prolijos y cuentas habituales: 5 sugeridas y 3 elegidas a mano.
   - Después, «Crear 8 proveedores».
4. **Proveedores que ya existían:** se les puso la cuenta habitual a 2.
5. **«Otros tributos»:** el de una factura de la cervecería se clasificó como percepción de IIBB Córdoba.
6. **Revisión:** filtros, chips, «Ver asiento», «Revisar de nuevo» y el resumen.
7. **Carga:** «Cargar 18 compras», con progreso, terminó en «Listo: Se cargaron 18 comprobantes».
8. **Volver a subir el mismo archivo:** «Ese archivo ya se importó el 08/10/2026 (lo subió Dueño QA)…», con «Ver esa
   importación», y no se crea otro lote.

**2. Mercado Pago**

1. Se configuró la tarjeta: la billetera, QR → «QR Mercado Pago», transferencias → «Transferencia» y día
   calendario.
2. Subida y revisión.
3. Se cargaron 5 comprobantes del 08/10. El 07/10 se saltea porque ese día se cargó a mano.

**3. Banco**

1. Apareció «Contanos qué es cada columna» y se completó a 390 y a 1280. El formato quedó guardado.
2. Se creó la regla «Luz del local (débito automático)».
3. Se cargaron 4 comprobantes. Las 4 transferencias que ya estaban en los libros se saltean.

**4. Cómo arrancar.** «Plataformas» se marcó y salió el toast con «Deshacer». Se deshizo, se marcó de nuevo y, al
recargar, siguió marcado. En el log quedan las tres llamadas: `true`, `false`, `true`.

**5. Resumen:** al final, capturado a 1280 y 390 (§5.1).

---

## 4. Qué se rompió y cómo se arregló

### 4.1 ARCA (8)

1. **El texto del error real decía lo contrario** (`lib/arca/errors.ts`).
   - El problema: en homologación, `cms.cert.untrusted` decía «es de pruebas y lo estás usando en producción, o al
     revés».
   - El arreglo: `describeArcaErrorKey` usa textos de WSASS en homologación. El título ahora es «ARCA de pruebas no
     reconoce el certificado».
   - Lo mismo para `arca_not_authorized` (wsfe y padrón), `arca_cuit_not_in_token`, `arca_cert_expired`,
     `arca_key_mismatch` y `arca_already_authenticated`, que mandan a «Crear autorización a servicio».
   - Producción no cambia.
   - Test nuevo `arca-homologacion-copy` (5), hecho con la falla real y el `last_test` que quedó guardado.
2. **«Cómo se arregla» mandaba a la guía de producción** (`#paso-6`).
   - Ahora, en homologación, lleva al paso de las pruebas: `homologacionStepFor` y `homologacionStepAnchor` en
     `arca-guide-model.ts`, más los anclas `#homologacion-paso-N`.
   - Archivos: `arca-checks.tsx`, `arca-test-action.tsx` y `arca-homologacion.tsx`.
   - Test nuevo `arca-homologacion-render` (3, SSR).
3. **`arca_key_missing` y `arca_not_ready` decían «paso 5/6»** y el botón abría la guía de producción
   (`arca-shared.tsx`).
   - En homologación ahora dicen «Primero generá el pedido (paso 1)…» o «Primero subí el certificado de WSASS (paso
     2)…», con «Ir al paso 1/2» en la misma tarjeta.
   - `ArcaFailureNotice` recibe el ambiente desde todos los lugares que lo usan, incluido
     `arca-connection-controls.tsx`.
4. **Toasts del pedido** (`lib/arca/actions.ts`).
   - En homologación decían «Bajalo y subilo a ARCA en el paso 6.». Ahora dicen «Pegá su texto en WSASS…».
   - «Este certificado es de otro pedido» también apunta a WSASS.
   - Producción: «Listo: generamos el pedido. Subilo a ARCA en el paso 6.».
5. **El botón de descarga se salía de la pantalla a 390** (`arca-certificate-actions.tsx`).
   - Decía «Descargar arca-demoadministraciontest.csr»; ahora dice «Descargar de nuevo».
   - Los diálogos de homologación ya no hablan de «paso 6» ni de que «la emisión se apaga».
6. **«…es el 0001 .» tenía un espacio antes del punto** (`arca-step-actions.tsx`). Ahora es una sola frase; en
   homologación dice «Las pruebas usan el punto de venta 0001.».
7. **«Punto de venta 1» en vez de «0001»** en el resumen de las pruebas (`arca-homologacion.tsx`). Además,
   «Desconectar» ocupa todo el ancho en el teléfono, como en la tarjeta de producción.
8. **«Hecho · Hecho el 08/10 por Dueño QA»** (`ajustes/arca/_components/guide-steps.tsx`). Ahora dice «Hecho el
   08/10 por Dueño QA».

### 4.2 Importadores (16)

**De números y datos**

1. **Las notas de crédito sumaban en vez de restar** (`lib/imports/server/types.ts` y `queries.ts`).
   - Afectaba «Listos para cargar», «Lo listo va a los libros de…», el resumen antes de cargar y el total de un
     proveedor nuevo: la NC contaba +$ 48.400 en vez de −$ 48.400.
   - La subida ya la restaba.
   - El arreglo es `signedTotalCents()`, con test.
2. **Las propuestas salían por clave, o sea por CUIT** (`queries.ts`). Ahora van por fecha y después por clave.
3. **«Ya estaban cargados» no contaba todo** (`queries.ts`).
   - No contaba el día de Mercado Pago cargado a mano (`manual_overlap`) ni lo que ya entró por otra importación.
   - En Mercado Pago mostraba 0 con una fila salteada.
4. **Las «ya cargadas» salían con el nombre de ARCA en mayúsculas** (`proposals/arca.ts`). Ahora llevan el nombre
   que el proveedor tiene en los libros.

**De pantalla y textos**

5. **El diálogo de «Cargar»** (`post-bar.tsx`).
   - Cada «Cargar» dejaba 2 errores de Radix («DialogContent requires a DialogTitle»): un `id` propio rompía el
     cableado de aria.
   - Mientras cargaba seguía diciendo «Antes de cargar». Ahora el título cambia según la fase: «Cargar N …», «Dejá
     esta pestaña abierta…» y «Listo».
6. **Meses con mayúscula en medio de la frase** (`post-bar.tsx` y `importar/[batchId]/page.tsx`). «Libro de Octubre
   2026» pasó a «octubre de 2026» (`formatMonthYear`).
7. **«Banco · Banco Nación»** pasó a «Banco Nación» en el título de la revisión.
8. **El tipo de cambio** decía «× 1465,5»; ahora «× 1.465,50», sin redondear (`need-block.tsx`; `formatFxRate`, con
   test).
9. **En el teléfono, el importe apretaba el título** (`proposal-row.tsx`).
   - El importe pasó a la línea del estado.
   - Los números de comprobante ya no se cortan en el guion.
   - Las salteadas sin plata no muestran «$ 0,00».
10. **Un movimiento genérico resuelto por una regla seguía diciendo «Para revisar».** Ahora dice «Otro movimiento»
    (`labels.ts`).
11. **«Contanos qué es cada columna»** (`bank-column-mapper.tsx`).
    - El select de la fila de títulos ya no se sale de la tarjeta.
    - Arma 2 columnas con container query cuando no entran 3.
    - Las descripciones se leen enteras en el teléfono.
12. **Las fechas de Excel** se ven «01/10/2026» y no «2026-10-01» (`bank-mapping.ts`).
13. **Historial** (`import-history.tsx`).
    - A 1280, con el menú abierto, ya no se tapa «Estado»: «Repetidas» y «Quién» se muestran solo desde 2xl.
    - La columna «Ya estaban» pasó a «Repetidas», porque se confundía con «Ya estaban cargados» de la revisión.
14. **Un lote a medio cargar decía «Cargando» con spinner para siempre** (`labels.ts` y `status-badge.tsx`). Ahora
    dice «A medio cargar», sin spinner.
15. **«Proveedores nuevos»** (`new-suppliers.tsx`).
    - «Plazo (días) (opcional)» se partía en 3; ahora es «Plazo (días)».
    - El botón deshabilitado decía «Crear 0 proveedores»; ahora dice «Crear los proveedores».
16. **«Gastos fijos» decía «Hay 2 cargados.»** sin decir qué faltaba (`lib/accounting/onboarding.ts`). Ahora agrega
    «: sumá los que falten.».

Después de los arreglos, en lo capturado a 390 y 1280: 0 páginas con scroll horizontal y 0 errores de consola.

---

## 5. Los datos que quedaron en el bar demo (para contarle a los socios)

**Cómo contarlo:** el demo es un bar que el 08/10 hace tres cosas:

- baja de ARCA las compras de **septiembre**;
- sube las liquidaciones de **Mercado Pago** del 07 y el 08/10;
- sube el extracto de **Banco Nación** del 01 al 07/10.

Lo que ya se había cargado a mano no se repite: la plataforma lo reconoce y lo saltea. Tres compras quedaron a
propósito sin cargar, para mostrar en vivo cómo se resuelven.

### 5.1 Lo que se ve en el Resumen (`/demo-administracion/administracion`, al 08/10)

**Las cuatro tarjetas**

| Tarjeta | Valor |
|---|---|
| Plata disponible | **$ 42.729.594**: Caja $ 394.757 · Mercado Pago $ 471.410 · Banco Nación $ 41.863.428 |
| Le debés a proveedores | **$ 6.960.135**, de los que **$ 4.188.335 están vencidos** |
| Te deben | **$ 5.469.828**, de los que $ 587.359 están atrasados |
| IVA de octubre | **$ 856.984** a pagar (estimado) |

**De dónde salen los $ 6.960.135 que se deben**

- Son las facturas impagas.
- Hay $ 108.900 en dos notas de crédito todavía sin aplicar:
  - la de Distribuidora de Bebidas Demo SA, $ 60.500, que ya estaba en el demo;
  - la importada de Cervecería Artesanal Sierras SRL, $ 48.400.
- Neto, el saldo con proveedores en los libros es **$ 6.851.235** (verificado por SQL).

**«Necesita atención»**

- 8 filas «Pagar», porque las compras importadas quedaron impagas y los proveedores nuevos tienen plazo 0:
  - Tostadero, 3 comprobantes, $ 1.373.350;
  - Hielo, $ 139.755;
  - Verdulería, $ 317.135;
  - Panificadora, $ 166.855;
  - Descartables, $ 331.540;
  - Cervecería, FA 0002-00003390, $ 644.800;
  - Carnicería, FA 0005-00004298, $ 419.900;
  - Gómez, FC 0002-00000184, $ 85.000.
- Al final, «Compras de ARCA para revisar y cargar», con «Revisar».

**«Este mes» (01 al 08/10):** vendiste $ 8.008.970; compras y gastos, $ 1.277.016.

### 5.2 Datos de la SAS y ARCA

**Datos de la SAS:** CUIT **30-71234567-1** (sintética), cargada por el formulario a las 12:56.

**Guías**

- ARCA: paso 0 marcado por «Dueño QA» a las 12:36, desde la pasada visual. El paso 0 dice «Hecho el 08/10 por Dueño
  QA», con «Desmarcar», y el paso 1 dice «Te toca».
- La pestaña ARCA dice «Producción · 1 de 9 pasos listos».
- «Cómo arrancar»: «Plataformas» marcado a las 13:53.

**ARCA de producción: sin tocar.**

- No hay conexión de producción, así que no hay pedido, punto de venta, Factura A ni certificado.
- Ajustes › Puntos de venta sigue igual: 0003 Salón y 0004 Delivery.

**ARCA de pruebas (homologación):** una conexión, plegada en «Pruebas (homologación) · para desarrolladores».

| Dato | Valor |
|---|---|
| Estado | **«Con un problema»** (`error`, `arca_wrong_environment`) |
| Alias | `demoadministraciontest` |
| CUIT del certificado | 20-12345678-6 (sintética) |
| Representada | 30-71234567-1 |
| Punto de venta | 0001 |
| Certificado | de descarte: serie `7B46CCE5AAC6C49E`, emisor «C=AR, O=QA local - no es ARCA, CN=QA Throwaway Test CA», vence el 07/10/2028 |
| Última prueba (13:13) | servicio OK; permiso de wsfe rechazado con `cms.cert.untrusted` |
| Emisión | apagada |
| Ticket de wsfe | sin token, con `cooldown_manual = true` |
| Secreto | 1 (la clave privada del segundo pedido, cifrada) |

**Auditoría de ARCA:**

- `acc_arca.keypair_generated` ×2 (la segunda es «Empezar de cero»);
- `connection_saved`, por el punto de venta;
- `certificate_saved`;
- `tested`.

**Para borrarla:** en Pruebas, «Desconectar» (hay que escribir DESCONECTAR). Borra la clave y el certificado; la fila
queda como historia. **Hay que hacerlo antes del smoke con un certificado real de WSASS**, o directamente subir el
certificado real.

### 5.3 Importación de Mis Comprobantes (septiembre)

**El lote**

- Archivo: «Mis Comprobantes Recibidos - septiembre 2026.zip», del 01/09 al 30/09.
- Estado: **«A medio cargar»** (`posting`). Es una revisión en curso, a propósito.
- Link: `/demo-administracion/administracion/importar/094abd87-b0c7-4622-bcb5-b0748dc7c2e1`.
- Propuestas: 23. Se cargaron 18, se saltearon 2 y quedan 3 pendientes.

**Cargadas (18)**

| Fecha | Comprobante | Proveedor | Total |
|---|---|---|---|
| 02/09 | FA 0003-00004512 | Tostadero Serrano SA | $ 459.800,00 |
| 03/09 | FA 0002-00021877 | Hielo Cristal del Centro SA | $ 65.340,00 |
| 04/09 | FA 0004-00009120 | Verdulería Los Álamos SRL | $ 106.632,50 |
| 05/09 | FA 0001-00031244 | Panificadora La Espiga SRL | $ 79.560,00 |
| 07/09 | FA 0005-00007781 | Descartables Córdoba SRL | $ 179.080,00 |
| 09/09 | FA 0002-00003390 | Cervecería Artesanal Sierras SRL | $ 644.800,00 |
| 11/09 | FA 0005-00004298 | Carnicería Demo SRL | $ 419.900,00 |
| 12/09 | FA 0004-00009187 | Verdulería Los Álamos SRL | $ 97.461,00 |
| 16/09 | FA 0003-00004601 | Tostadero Serrano SA | $ 477.950,00 |
| 17/09 | FA 0003-00001155 | Distribuidora de Bebidas Demo SA | $ 992.200,00 |
| 18/09 | FA 0002-00022410 | Hielo Cristal del Centro SA | $ 74.415,00 |
| 19/09 | FA 0001-00031702 | Panificadora La Espiga SRL | $ 87.295,00 |
| 21/09 | FC 0002-00000184 | Gómez María Lucía (monotributo) | $ 85.000,00 |
| 22/09 | NC A 0002-00000412 | Cervecería Artesanal Sierras SRL | −$ 48.400,00 |
| 26/09 | FA 0004-00009251 | Verdulería Los Álamos SRL | $ 113.041,50 |
| 28/09 | FA 0005-00007902 | Descartables Córdoba SRL | $ 152.460,00 |
| 29/09 | FA 0003-00004688 | Tostadero Serrano SA | $ 435.600,00 |
| 30/09 | FA 0003-00001201 | Distribuidora de Bebidas Demo SA | $ 774.400,00 |

**Totales de las cargadas**

- 17 compras por **$ 5.244.935,00**, menos la NC de $ 48.400: neto **$ 5.196.535,00**.
- IVA: **$ 821.835,00**, repartido bien entre 21 % y 10,5 %.
- La NC lleva $ 8.400 de IVA.
- Percepción de IIBB Córdoba: **$ 15.600**, en la cuenta 1.1.03.04.030, jurisdicción 904.
- La Factura C va entera a «Limpieza e higiene».

**Salteadas (2):** ya estaban cargadas a mano.

- FA 0003-00001100, Distribuidora de Bebidas Demo SA, $ 1.210.000,00;
- FA 0005-00004321, Carnicería Demo SRL, $ 497.250,00.

**Pendientes, a propósito (3).** Se pueden resolver en vivo con los socios:

| Fecha | Comprobante | Proveedor | Importe | Qué falta |
|---|---|---|---|---|
| 01/09 | FA 0007-00015873 | Sistemas Gastronómicos del Sur SA | US$ 107,69 × 1.465,50 = $ 157.819,70 | confirmar «La conversión está bien» |
| 15/09 | FA 0002-00000061 | Limpieza Demo SA | $ 118.580,00 | elegir la cuenta habitual del proveedor |
| 23/09 | FA 0002-00003455 | Cervecería Artesanal Sierras SRL | $ 595.200,00 | decir qué son $ 14.400 de «Otros tributos» |

### 5.4 Importación de Mercado Pago (07 y 08/10)

**El lote**

- Archivo: «liquidaciones-mercadopago-07-al-08-oct-2026.csv».
- Estado: **Terminada**.
- Link: `/importar/45747ecb-0593-44b5-9e02-5e779e012354`.

**Cargados (5), todos del 08/10**

| Comprobante | Importe (bruto) |
|---|---|
| Cobros con QR | $ 129.600,00 |
| Cobros con transferencias | $ 45.000,00 |
| Impuesto a los débitos y créditos (Ley 25.413) | $ 1.047,60 |
| Retención de IIBB (SIRTAC) | $ 1.240,00 |
| Rendimientos de octubre | $ 243,18 |

- Mercado Pago depositó netos $ 127.447,28 por el QR y $ 44.595 por las transferencias.
- El impuesto a los débitos y créditos es la suma del de los dos cobros: $ 777,60 + $ 270 = $ 1.047,60.

**Salteados:** «Movimientos de Mercado Pago del 07/10» (10 movimientos), porque ese día se cargó a mano.

**Los dos cobros quedan «a favor» de Mercado Pago** hasta que se cargue el cierre del 08/10. La app lo avisa: «Falta
el cierre del día».

### 5.5 Importación del banco (Banco Nación, 01 al 07/10)

**El lote**

- Archivo: «Banco Nacion - movimientos 01-10 al 07-10-2026.xlsx».
- Estado: **Terminada**.
- Link: `/importar/93dc2d92-bd1e-440b-bcf0-6d99a3c4d42e`.

**Cargados (4)**

| Fecha | Comprobante | Importe | Detalle |
|---|---|---|---|
| 01/10 | Gastos bancarios | $ 86.760,00 | comisiones $ 69.000 + IVA $ 14.490, percepción de IVA $ 2.070 y Ley 25.413 $ 1.200 |
| 05/10 | Gastos bancarios | $ 34.020,00 | SIRCREB $ 11.340 y Ley 25.413 $ 22.680 |
| 07/10 | Gastos bancarios | $ 3.488,40 | Ley 25.413 |
| 07/10 | Luz («DEBAUT SERVICIO LUZ») → «Energía eléctrica» | $ 186.400,00 | por la regla «Luz del local (débito automático)» |

**Salteados (4):** ya estaban en los libros.

- 01/10: extracción por caja, $ 200.000;
- 05/10: depósito en efectivo, $ 1.584.000;
- 05/10: transferencia de Mercado Pago, $ 2.196.000;
- 07/10: transferencia de Mercado Pago, $ 395.000.

### 5.6 Proveedores y configuración

**Proveedores nuevos (8).** Todos tienen plazo 0.

| Proveedor | CUIT (sintética) | Cuenta habitual |
|---|---|---|
| Tostadero Serrano SA | 30-71444556-8 | Compras: café e infusiones |
| Cervecería Artesanal Sierras SRL | 30-70888999-3 | Compras: bebidas con alcohol |
| Descartables Córdoba SRL | 30-71222333-9 | Compras: descartables y packaging |
| Verdulería Los Álamos SRL | 30-70777888-8 | Compras: alimentos |
| Panificadora La Espiga SRL | 30-71333444-4 | Compras: panadería y pastelería |
| Sistemas Gastronómicos del Sur SA | 30-71555666-5 | Software y suscripciones |
| Hielo Cristal del Centro SA | 30-71111222-3 | Compras: otros insumos |
| Gómez María Lucía (monotributo) | 27-31222333-9 | Limpieza e higiene |

**Proveedores que ya existían:** se les puso la cuenta habitual.

- Distribuidora de Bebidas Demo SA: «Compras: bebidas sin alcohol»;
- Carnicería Demo SRL: «Compras: alimentos».

**Configuración guardada**

- **Mercado Pago:** solo CSV (`csv_only`), sin token.
  - Billetera y partícipe: «Mercado Pago».
  - QR → «QR Mercado Pago» y transferencias → «Transferencia».
  - Día calendario.
- **Banco:**
  - 1 regla: «Luz del local (débito automático)», que manda «SERVICIO LUZ» (débito) a «Energía eléctrica»;
  - 1 formato de extracto guardado para el XLSX de Banco Nación.

### 5.7 Lo que no es de esta pasada

- **«Socios (demo)», a las 11:44,** cargó la FA 0002-00000129 de Limpieza Demo SA por $ 150.000, **pagada en el
  momento** (compra y pago en el mismo envío).
- **A las 11:58** bajó una exportación (`acc_export.downloaded`).
- Si los socios miraron el demo a la mañana, desde entonces cambió:
  - la CUIT, que antes estaba vacía;
  - los 8 proveedores nuevos;
  - las compras de septiembre, impagas, con sus «Pagar»;
  - los 3 lotes en Importar.

### 5.8 Lo que no se escribió

- No se escribió nada por SQL: solo lecturas.
- No se tocó ningún otro bar ni se usó `service_role`.
- La subida repetida no creó un lote.
- El mapeo de columnas con la variante de títulos no guardó nada.
- El ensayo de los proveedores no creó ninguno.
- No hay facturas de ARCA ni caché del padrón.

---

## 6. Lo que sigue pendiente

### 6.1 Necesita un certificado real de WSASS (homologación)

**Antes de empezar:** «Desconectar» en Pruebas (§5.2), o subir el certificado real. La conexión de hoy tiene un
cooldown manual y un certificado que ARCA siempre va a rechazar.

**Lo que no se pudo probar:**

- **«Probar conexión» → Conectado**, con los textos de chequeo aprobado, y el estado C real de la pestaña.
- **«Completar con ARCA»:**
  - en las altas;
  - en «Proveedores nuevos» («Completar todos con ARCA»), donde la segunda consulta tiene que salir de la caché;
  - «Verificado en ARCA» en la ficha del proveedor.
- **«Emitir una factura de prueba»** (B, A y NC B), cómo sale impresa, y que el Resumen **no** avise por las de
  prueba.
- **La guía:** los estados «Revisar» y «No anduvo» de los pasos 7 y 8.
- **La variante con la delegación mal hecha:** «La SAS no está en el permiso», el permiso descartado y la fila
  `acc_arca.ticket_dropped`.
- **Los toasts nuevos de homologación** después de «Generar el pedido» y «Empezar de cero». No se recapturaron a
  propósito, porque generar otro par invalidaba el certificado subido. Es un cambio de un solo string.
- **P-T1:** todo lo de hoy salió del servidor local. Falta la «Probar conexión» desde la **preview de Vercel**.

### 6.2 Necesita la conexión de producción del bar real

- Los estados C y D de producción, el modo ARCA en Ventas › Factura de venta y la tarjeta «Autorización de ARCA».
- Renovar el certificado.
- Los avisos del Resumen: certificado por vencer y facturas para verificar.
- La Factura A (P-O4).

### 6.3 Necesita archivos reales de HUB (P-O6 y P-O8)

- Calibrar con un Mis Comprobantes, un reporte de Mercado Pago y un extracto de Banco Nación de verdad. Los de hoy
  son sintéticos.
- El extracto del demo está curado:
  - su saldo final coincide con los libros;
  - su saldo inicial ($ 38.349.096,10) **no** coincide con el saldo de los libros al 30/09;
  - se le sacaron los movimientos que la plataforma no reconoce como ya cargados (§6.6).

### 6.4 Necesita una contadora de verdad

Ningún bar tiene un miembro con rol `accountant`. La vista de la contadora (Resumen, guías, importar, la pestaña ARCA
y la guía) solo se verificó en el código y con vistas previas locales.

### 6.5 Bugs abiertos (fuera de las áreas de esta pasada; el cierre no los tocó)

1. **En modo oscuro, un checkbox tildado se ve vacío** (`components/ui/checkbox.tsx`).
   - La causa: `dark:bg-input/30` le gana a `data-[state=checked]:bg-primary`. Se ve sin fondo y con el tilde
     invisible.
   - Pega en las casillas de «Proveedores nuevos», «Recordarlo para…», «Los leí: cargarlos igual» y en **todos** los
     checkbox de la app.
   - El arreglo de shadcn v4 es agregar `dark:data-[state=checked]:bg-primary`.
   - No se aplicó porque es un componente de shadcn (CLAUDE.md: «no editar a mano»), cambia toda la app y es
     visual: **necesita el OK de Nacho**.
2. **`/favicon.ico` se trata como si fuera un bar.**
   - En el log de dev, cada carga de página deja «⨯ Error [TenantNotFoundError]: Bar no encontrado.» (unas 1.480
     veces en el log de hoy).
   - El pedido tarda entre 0,6 y 1,4 s.
   - Es del ruteo de la raíz o del `proxy.ts`.
3. **La hoja «Nuevo gasto»** (`components/administracion/acciones`) deja el aviso de Radix «Missing Description or
   aria-describedby for {DialogContent}». Sigue estando: aparece en el log al abrir
   `/guias/como-arrancar?accion=gasto`.
4. **El aviso cuando falla el copiado** (`components/ui/copy-button.tsx`) dice «Copialo a mano desde la barra.»,
   también cuando se copia el alias o el pedido.
5. **Next 16 en dev escribe en el log los argumentos de las server actions.** Entre ellos van la CUIT personal de
   `startArcaCertificate` y el certificado en base64. Pasa solo en dev y no es secreto, pero es dato personal en texto
   claro (CLAUDE.md §9).

**Chicos, que quedan como están**

- Cuando la prueba se corta en el chequeo 2, el 7 («Certificado», local) también dice «No se llegó a probar».
- En homologación, la falla se lee dos veces: en el aviso y en la fila del chequeo, igual que en la guía de
  producción.

### 6.6 Decisiones de producto

1. **Mercado Pago: el chequeo de lo cargado a mano es por día** (`lib/imports/server/stage.ts`, `loadManualMpDays`).
   - Un «Ajuste de saldo de Mercado Pago» semanal cargado a mano solo bloquea su propia fecha.
   - Un reporte que cubra los otros días crea cobros sin nada que aplicar, que quedan «a favor» y duplican la plata
     de la billetera.
   - Por eso hoy se importó solo el 07 y el 08/10.
   - Opciones:
     - tratar como manuales los días cuyos cobros ya se cobraron con un comprobante no importado;
     - tratar como manuales los días hasta el último ajuste manual.
2. **Banco: solo se reconoce como ya cargado** lo siguiente (`lib/imports/server/proposals/bank.ts`):
   - las transferencias, con ±3 días;
   - los gastos bancarios del mismo día.

   Los pagos a proveedores, los cobros y las acreditaciones de tarjetas cargados a mano se vuelven a proponer, y la
   única salida es «No es nuestro». Por eso al extracto del demo se le sacaron esas filas.
3. **Compras importadas impagas** (consecuencia en el demo).
   - Las 17 compras importadas quedaron impagas.
   - Ya salen vencidas en el Resumen y en Compras:
     - las de los 8 proveedores nuevos, que tienen plazo 0;
     - la de Carnicería, que tiene plazo 7.
   - Las dos de Distribuidora (plazo 21) vencen el 08/10 y el 21/10.
   - Para mostrarlo prolijo hay dos caminos: registrar algunos pagos con «Pagar», o contarlo como «así se ve un mes
     sin pagos cargados».

### 6.7 Avisos

- **Tiempos en dev.** Con el servidor local hablando con Supabase (us-east-1) desde Córdoba, las server actions
  tardaron mucho más que en producción:

  | Acción | Promedio | Máximo |
  |---|---|---|
  | `postImportProposals` (por tanda de 15) | 11 s | 17,7 s |
  | `testArcaConnection` | 12,7 s | — |
  | `createImportSuppliers` | 8,4 s | — |
  | `resolveImportNeeds` | 6,4 s | 9,3 s |

  Están lejos del `maxDuration` de 60 s. En la preview (Vercel iad1, la misma región) tendrían que bajar mucho:
  conviene mirarlo ahí.
- **`.env.example`** tiene un cambio sin commitear del 08/09 (`NEXT_PUBLIC_LANDINGS_HOST`, de las páginas HTML). No
  es de esta fase: dejarlo fuera del commit.
- **Sigue abierto lo de `fase3-estado.md`:**
  - §7: decisiones del dueño y de la contadora;
  - §8: pendientes de `BACKLOG.md`, como el freno en la base para anular comprobantes con CAE y `acc_guide_mark` con
    `do update`;
  - el alias por defecto `hub*` de la #2, que ya está aplicada.

---

## 7. Archivos

**En el repo, sin commitear (26 modificados + 2 nuevos)**

ARCA:
- `lib/arca/errors.ts`
- `lib/arca/actions.ts`
- `components/administracion/guias/arca-guide-model.ts`
- `app/(manager)/[tenantSlug]/administracion/ajustes/_components/`:
  - `arca-checks.tsx`
  - `arca-test-action.tsx`
  - `arca-homologacion.tsx`
  - `arca-shared.tsx`
  - `arca-certificate-actions.tsx`
  - `arca-step-actions.tsx`
  - `arca-connection-controls.tsx`
- `app/(manager)/[tenantSlug]/administracion/ajustes/arca/_components/guide-steps.tsx`
- Nuevos: `tests/lib/arca-homologacion-copy.test.ts` y `tests/lib/arca-homologacion-render.test.ts`

Importadores:
- `lib/imports/server/types.ts`
- `lib/imports/server/queries.ts`
- `lib/imports/server/proposals/arca.ts`
- `lib/imports/ui/labels.ts`
- `lib/imports/ui/bank-mapping.ts`
- `lib/accounting/onboarding.ts`
- `app/(manager)/[tenantSlug]/administracion/importar/[batchId]/page.tsx`
- `components/administracion/importar/review/`:
  - `post-bar.tsx`
  - `proposal-row.tsx`
  - `need-block.tsx`
  - `new-suppliers.tsx`
- `components/administracion/importar/`:
  - `bank-column-mapper.tsx`
  - `import-history.tsx`
  - `status-badge.tsx`
- `tests/lib/imports-ui-filters.test.ts`

Diff: 26 archivos, +454/−98, más 325 líneas de tests nuevos. No quedó código temporal: `TEMP-PREVIEW` no aparece, y
tampoco `bg-[--` ni parecidos.

**En el scratchpad**

- `visual-2/arca/`: 91 capturas.
  - `ca/` tiene la CA local de descarte; no sirve para ARCA.
  - `tools/` tiene los scripts de CDP.
- `visual-2/importar/`:
  - `shots/`: 187 capturas (`mc`, `mp`, `banco`, `resumen`, `guia`, `final`);
  - `files/`: los tres archivos sintéticos;
  - `tools/`: el generador, el validador y los flujos de CDP;
  - `page.tsx.bak`: copia de la vista previa temporal, que no está en el repo.
- `cierre-datos/`: los logs de este cierre.
