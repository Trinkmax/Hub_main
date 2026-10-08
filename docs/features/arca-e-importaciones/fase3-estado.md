# Fase 3 · Estado al cierre (pantallas de ARCA, importadores y guías de Administración)

> **Fecha:** 08/10/2026 · **Rama:** `feat/administracion` · **Nada commiteado.** De las 14 migraciones,
> solo la #1 está aplicada.
>
> **Insumos:**
> - `diseno.md` (§2 a §5 y §7) y `fase2-estado.md` (§5 y §6);
> - los reportes de los seis paquetes de la fase 3: WP5b (arreglos del servidor), WP7 (Conectar ARCA),
>   WP8 (Completar con ARCA), WP9 (emisión), WP10 (importadores) y WP11 (Cómo arrancar y Resumen).
>
> Lo escribió el paquete de cierre después de:
> - revisar los contratos C1 a C4 punta a punta;
> - revisar la frontera cliente/servidor, los secretos y los permisos;
> - integrar lo que faltaba entre paquetes;
> - correr todos los chequeos y el build.
>
> Es el punto de partida de la **pasada visual** (§6) y del commit de la fase.

---

## 0. Resumen

- **Todo verde.**
  - `tsc` completo (sin incremental): 0 errores.
  - `npm run lint`: 0 diagnósticos en 1694 archivos.
  - `npm run test:ci`: **261 archivos y 4673 tests OK**. Se saltean 33 archivos y 282 tests, los de RLS,
    que corren en el job de CI.
  - Los 22 archivos de tests de la fase 3 solos: **449 OK**.
  - `npx next build` (Turbopack): **OK, 0 avisos**. Una corrida intermedia falló al bajar la fuente
    Fraunces de Google (`next/font/google`, `app/layout.tsx`, que no cambió); se repitió sin tocar nada
    y anduvo. Detalle en §1.
- **Los contratos C1 a C4 andan punta a punta** (§3):
  - imports resueltos y props iguales al contrato;
  - todas las rutas y anclas existen;
  - los links de todo el código nuevo apuntan a páginas, pestañas (`?tab=`) y anclas (`#paso-N`,
    `#renovar`, `#homologacion`, `#historial`) reales.
- **Frontera y seguridad** (§1):
  - Ninguno de los 471 componentes `'use client'` del repo llega a código de servidor. El escáner se
    corta en los módulos `'use server'`.
  - Ninguna acción devuelve ni loguea secretos: los 32 `console.error` nuevos llevan operación, clave y
    código.
  - Todas las acciones exportadas autorizan antes de hacer nada.
  - La contadora no ve botones de carga.
  - No quedó ningún `bg-[--x]`.
  - La plata se muestra en pesos (`Amount`, `formatCents`, `MoneyInput`).
- **El cierre hizo 6 arreglos de integración chicos** (§4). Dos son de datos:
  - el Resumen ya no avisa para siempre por las facturas **de prueba**;
  - «Anular» desde el **cobro del mismo envío** ya no anula una factura que está en ARCA.
- **Migración nueva:** `20261008120400_acc_arca_ticket_drop.sql` (#14). Ensayo con rollback contra
  producción, **repetido por el cierre: 30/30** (§5).
- **Lo que falta afuera del código:**
  - el **«sí» del dueño** para aplicar las 13 pendientes (#2 a #14);
  - un **certificado de homologación** (WSASS) para el smoke real;
  - las decisiones de §7.

---

## 1. Chequeos (resultados exactos)

**Calidad del código**

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit -p … --incremental false`, al empezar | exit 0 (14,9 s) |
| `npx tsc --noEmit -p … --incremental false`, al terminar | exit 0 |
| `npm run lint` (Biome), al empezar | exit 0 · «Checked 1693 files in 717ms. No fixes applied.» |
| `npm run lint` (Biome), al terminar | exit 0 · «Checked 1694 files in 706ms. No fixes applied.» |
| `npm run test:ci`, al empezar (10:43) | exit 0 · 260 archivos OK / 33 salteados · 4670 tests OK / 282 salteados (11,7 s) |
| `npm run test:ci`, al terminar | exit 0 · **261 archivos OK / 33 salteados · 4673 tests OK / 282 salteados** (11,5 s) |
| Tests de la fase 3 (22 archivos, reporte JSON) | **449/449 OK** (detalle abajo) |

Detalle de los 449:

| Paquete | Archivos y tests |
|---|---|
| WP5b | `arca-session` 35 · `arca-actions` 65 · `arca-deadline` 11 · `arca-lookup-batch` 14 |
| WP7 | `arca-guide-ui` 37 · `arca-guide-render` 43 |
| WP8 | `arca-lookup-fill` 53 |
| WP9 | `arca-emit` 28 · `arca-print` 12 · `arca-letter` 20 |
| WP10 | `imports-ui-chunks` 11 · `imports-ui-filters` 10 · `imports-ui-upload` 12 · `section-tabs-config` 27 · `section-tabs-render` 13 |
| WP11 | `accounting-onboarding` 14 · `-copy` 12 · `-query` 5 · `-resumen` 6 · `-guide` 10 · `-index` 8 |
| Cierre | `arca-views-checks` 3 (nuevo) |

**Build**

| Corrida | Resultado |
|---|---|
| `npx next build` #1 | exit 0 en 28,6 s. «Compiled successfully in 9.4s» y TypeScript en 16,4 s. Las 9 rutas nuevas salen como `ƒ` |
| `npx next build` #2 (después de los arreglos del cierre) | exit 1. «Turbopack build failed with 12 errors», todos `next/font/google queries have exactly one entry` / `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` en `fraunces_….module.css` ← `app/layout.tsx`. Es la descarga de Google Fonts al compilar: `app/layout.tsx` no cambió |
| `npx next build` #3 (sin tocar nada) | **exit 0** en 27,6 s · 0 líneas con «warn» o «error» |
| `maxDuration` en el build | `.next/server/functions-config-manifest.json`: las 37 rutas de `/[tenantSlug]/administracion/**` tienen `{ maxDuration: 60 }`, heredado del layout |

**Frontera, links y seguridad**

| Chequeo | Resultado |
|---|---|
| Clausura de imports de cliente (`cierre-f3/tools/closure3.py`) | Recorre los **471** archivos `'use client'` del repo. Se corta en los módulos `'use server'`, que viajan como referencia, e ignora `import type` y los `{ type X }`. **0** llegan a `server-only`, `next/headers`, `next/cache`, `@/lib/supabase/{server,service}`, `node:*` ni módulos de Node. Control: `lib/arca/queries.ts` y `emit-queries.ts` sí se marcan |
| Props de función de servidor a cliente (`cierre-f3/tools/rsc_props.py`) | Un solo hallazgo, y es falso: `readyCount` es un número. `ListPagination` recibe una función, pero es un componente de servidor |
| Links internos (`cierre-f3/tools/links.py`) | En el código nuevo y en los `lib/*` que arman links: todas las rutas existen. Pestañas de Ajustes usadas: sas, arca, accesos, medios, cajas, participes, puntos-de-venta, integridad. Compras: proveedores, gastos-fijos. Ventas: facturas, clientes. Las anclas `#paso-N` (`stepAnchor`), `#renovar`, `#homologacion` e `#historial` tienen su `id` |
| `'use server'` (`lib/arca/{actions,emit-actions}.ts`, `lib/imports/{actions,review-actions}.ts`) | Solo exportan funciones `async` y tipos. Las 34 acciones arrancan con `authorizeAccounting`, directo o a través de `asWriter` |
| Logs | 32 `console.error` en lo nuevo o tocado: operación, clave, código o `e.name`. `amounts` loguea códigos de WSFE (`10051`) y `consult mismatch` solo nombres de campos. Ningún componente `.tsx` nuevo loguea |
| Secretos al navegador | Las acciones de emisión devuelven CAE, número, etiqueta e ids. `request` (el FECAEDetRequest **sin** `Auth`) solo lo lee el servidor para la factura impresa. `secretsKey()` se lee en `emitSession` y en las acciones de la fase 2. Ningún `token`/`sign` sale de `lib/arca/session.ts` |
| `bg-[--x]` y parecidos (`-\[--…\]`, `-\[var(--…)\]`) en lo nuevo | 0 |
| «Thinkeon», «HUB» y CUIT en textos de pantalla | 0. Quedan «Thinkeon» en comentarios viejos y en una palabra clave de búsqueda de ⌘K, `cierre` (de antes). «HUB» solo en un comentario de `connection-test.ts` |
| Plata en pesos | Todo `…Cents` que se muestra pasa por `Amount`, `formatCents` o `MoneyInput`. Ningún texto pide centavos |
| Contadora | Hub, historial y revisión sin botones (`editable`). Las páginas de carga muestran `ReadOnlyNotice`. La pestaña ARCA sale en texto. La guía, sin «Ya lo hice». El test de comprobante, oculto. La tarjeta de ARCA del comprobante, sin acciones. «Cómo arrancar», sin marcas |

**Producción (solo lectura y ensayo con rollback, por MCP)**

| Chequeo | Resultado |
|---|---|
| Última migración aplicada | `20261008115646 acc_arca_core` (la #1) |
| ¿Lo aplicado es el archivo? | md5 de `statements` = `6512cf9fbc9abdfe4e661ff66fd44971` = md5 de `20261008120000_acc_arca_core.sql` |
| Ensayo de la #14 (con la #4 como requisito), `begin…rollback` | `{"total":30,"passed":30,"failed":[]}` |
| Después del ensayo | 0 bares `acct-dryrun%`, 0 funciones `acc_arca_ticket_*`, última migración sin cambios |

---

## 2. Qué entregó cada paquete

### WP5b · Arreglos del servidor (ARCA)

- **Plazos duros** (`lib/arca/session.ts`):
  - `arcaDeadline`, `deadlineTimeout`, `withDeadline`, `canStartLogin`, `deadlineFault` e
    `isDeadlineFault`;
  - «Probar conexión» corta a los **50 s** y «Completar con ARCA» a los **40 s**;
  - un login al WSAA solo empieza con ≥ 20 s por delante;
  - el margen es de 3 s.
  - Un chequeo que no llegó a empezar queda `{ timeout: true, not_started: true }`.
- **Descartar el permiso (TA) que ARCA rechaza:**
  - `session.dropTicket(servicio)`, con `isTicketRejection` y `ticketRejectedBy`;
  - lo usa la prueba (chequeos 3 y siguientes), el padrón y la emisión (WP9);
  - RPC nueva `acc_arca_ticket_drop` (migración #14).
- **Contrato C2:** `lookupCuits(slug, { cuits: 1–250, purpose? })` → `PadronBatchResult`.
  - Primero la caché del bar en un solo select; lo que falta va en una sola `getPersonaList_v2`.
  - Cuenta como una consulta del tope de 30/min.
  - Las CUIT inválidas vuelven por ítem.
- **Archivos:** `lib/arca/{session,connection-test,lookup,actions}.ts` · migración #14 · tests
  `arca-{session,actions,deadline,lookup-batch}`.

### WP7 · Conectar ARCA

**Rutas**

- `/{slug}/administracion/ajustes?tab=arca`. La pestaña «ARCA» va después de «Datos de la SAS»; son
  9 pestañas, y «Medios de cobro» pasó a decir «Medios» en desktop.
  - Estados de la tarjeta:
    - A: sin empezar, con el aviso de la CUIT;
    - B: a medio camino, «N de 9 pasos listos» con la lista de 11 pasos;
    - C: conectado, con la última prueba, el certificado y el switch de emisión con confirmación;
    - D: error, con el paso que lo arregla.
  - Aviso de facturas para verificar.
  - «Pruebas (homologación) · para desarrolladores», plegado; `#homologacion` lo abre.
- `/{slug}/administracion/ajustes/arca`: la guía de 11 pasos (0 a 10, de los que 9 cuentan).
  - «Antes de arrancar», «Las 3 reglas de oro» y el glosario plegado.
  - En desktop, riel con avance. En el teléfono, barra «Te toca: N…» y la lista de pasos en un Sheet.
  - Maquetas del portal de ARCA personalizadas con razón social, CUIT, alias y punto de venta.
  - `#paso-N` abre el paso y lo enfoca.
  - Al pie: renovar (`#renovar`), «Si algo sale mal», la nota para quien programa y los instructivos
    oficiales.

**Componentes**

- La pestaña: `ajustes/_components/arca-{panel,homologacion,shared,step-actions,certificate-actions,checks,test-action,connection-controls}.tsx`.
- La guía: `ajustes/arca/_components/{arca-guide-shell,guide-intro,guide-steps,guide-footer}.tsx`.
- Kit reutilizable en `components/administracion/guias/`:
  - `guide-step`, `guide-rail`, `guide-nav`, `guide-status`, `step-screens`;
  - `arca-guide-model.ts` (puro);
  - `arca-mock/**`, con 20 pantallas;
  - `how-to/**` (C1).
- `ADM/layout.tsx`: `export const maxDuration = 60`.

**Contratos:** da C1 y usa C3, deshabilitado hasta que homologación quede conectada.

### WP8 · Completar con ARCA

- **`lib/arca/lookup-fill.ts`** (puro): `planLookupFill`, `lookupPatch`, `lookupIvaTarget` y los textos.
  - Completa lo vacío y pregunta antes de pisar lo escrito.
  - Lo que se tipeó y es el comienzo del nombre de ARCA se completa sin preguntar.
- **`components/administracion/arca-lookup.tsx`:** `useArcaLookup`, `ArcaLookupTrigger` (botón +
  región `role="status"`) y `ArcaLookupPanel` (tarjeta «Según ARCA» + la pregunta).
  - El estado viene del servidor o de `fetchArcaLookupStatus`, con caché de 60 s.
  - La contadora no lo ve.
- **Dónde está:**
  - los diálogos de alta rápida (`cajas-ventas/quick-party-dialog.tsx`, que se usa en Ventas y en el
    cierre);
  - `configurar/_components/new-party-dialog.tsx`;
  - el bloque «Proveedor nuevo» de `compras/nueva/_components/purchase-form.tsx`;
  - la ficha del proveedor: `supplier-data-form.tsx`, más «Verificado en ARCA el …» en
    `arca-verification.tsx`.
- **Sin conexión**, aparece el link discreto «Conectá ARCA para completar esto solo», que abre
  `?tab=arca` en otra pestaña.

### WP9 · Emisión

**Acciones** (`lib/arca/emit-actions.ts`, `'use server'`)

- `getArcaNextNumber`, `emitArcaSalesVoucher`, `previewArcaVoucherPosting`, `postAuthorizedArcaVoucher`,
  `reconcileArcaVoucher`, `emitArcaTestVoucher` (solo homologación; nunca contabiliza) y
  `ensureArcaFinalConsumer`.
- Topes por minuto: 30 números, 10 emisiones, 20 verificaciones y 6 de prueba.

**La saga** (`lib/arca/emit.ts`)

- Presupuesto de 50 s. El CAE se pide solo con ≥ 22 s por delante.
- Si se pierde la respuesta → `needs_reconcile` → `FECompConsultar`. Pasados 90 s, si ARCA no la
  tiene, queda `failed`.
- Nunca se reemite.
- Lo que nunca llegó a ARCA (plazo, `ECONNREFUSED`) no queda «en verificación».
- Si ARCA rechaza el permiso, se descarta (`dropTicket`).

**Lecturas y puros**

- `lib/arca/emit-queries.ts`: `getArcaEmissionSetup`, `getArcaVoucherCard` y `getInvoicePrintData`.
- `lib/arca/emit-form.ts`, `lib/arca/print.ts` (leyendas, QR, modelo de la factura) y
  `lib/accounting/letter.ts`.

**Pantallas**

- Ventas › Factura de venta: modo ARCA cuando la emisión de producción está prendida, con la letra
  propuesta, el número de ARCA, la confirmación (`AlertDialog`) y la verificación automática de las
  pendientes (`ArcaVoucherAttention`).
- Comprobante: tarjeta «Autorización de ARCA», «Imprimir» y «Anularla con una nota de crédito». Las de
  producción no muestran «Anular».
- `/print/factura/{slug}/{documentId|voucherId}`, A4, con el banner PRUEBA en homologación.
- Componentes: `components/administracion/arca/**`, que incluye `test-voucher-button.tsx` (C3).
- `post-document.ts` exporta `postBuiltBundle`.

### WP10 · Importadores

**Rutas** (C4)

- `/importar[?origen=…&antes=…#historial]`
- `/importar/arca`, `/importar/mercado-pago` y `/importar/banco`
- `/importar/{batchId}[?ver=revisar|listas|cargadas|no-se-cargan|todos&falta=<NeedKey>&pagina=N]`

Cada una tiene su `loading.tsx`. La pestaña «Importar» va después de «Cajas», con acceso de lectura.

**Componentes** (`components/administracion/importar/**`)

- `ImportUploader`: lee el archivo en el navegador, avisa si es el equivocado y sube en tandas de
  500 filas o 1 MB.
- `BankColumnMapper`: «Contanos qué es cada columna».
- `BankRulesCard`, `MpSettingsCard` y `MpConnectCard`, que queda reservado para WP12.
- `ImportSourceCard` e `ImportHistory`.
- La revisión:
  - `NewSuppliers`, con «Completar todos con ARCA» (C2) y las cuentas sugeridas;
  - `NeedBlock`, `ProposalRow` y `ProposalList`;
  - `PostBar`, que carga de a 15 con progreso y avisos aceptables;
  - `BatchActions`.

**Servidor y puros**

- Servidor: `lib/imports/review-actions.ts` (`fetchPostQueue`, `fetchProposalItemIds`,
  `previewImportProposal`) y `lib/imports/server/review.ts`.
- `listImportProposals` suma el filtro `need`.
- Puros en `lib/imports/ui/*`: etiquetas, tandas, progreso, filtros, subida y mapeo de columnas.

**Fuera de la ruta**

- Botón «Importar de ARCA» en Compras y accesos en Cajas.
- ⌘K: `acc-import`, `acc-connect-arca` y `acc-getting-started`.
- Los códigos 51, 52 y 53 se llaman «… A sujeta a retención».

### WP11 · Cómo arrancar y Resumen

**Rutas:** `/guias` (índice) y `/guias/como-arrancar`, cada una con su `loading.tsx`.

**«Cómo arrancar»** (`components/administracion/guias/onboarding/**`)

- 21 ítems en 4 secciones: Día 1, Todos los días, Todas las semanas y Todos los meses. 19 cuentan para
  el avance.
- Cada ítem dice:
  - qué es, dónde (link exacto) y cómo (2 a 4 pasos);
  - si va, la mini guía «¿Cómo lo bajo?» (C1);
  - si va, el botón que abre la hoja «Nuevo gasto» o «Ajustar saldo».
- «Lo próximo», marcas manuales con Deshacer (`useOptimistic` + toast) y «Tené a mano».
- El mensaje para los proveedores con los datos de la SAS, según su condición de IVA, con Copiar y
  WhatsApp.
- Al pie, tres tarjetas: «Qué sigue a mano», «Qué hace sola la plataforma» y «Palabras».

**Puro** (`lib/accounting/onboarding.ts`)

- Ítems nuevos: `platforms`, `chart_review` y `access`, que ahora también se marca a mano. Quedan 6
  pasos manuales.
- `booksStartDate`.
- `month_close` está hecho mientras los libros empezaron este mes.

**Resumen**

- Segunda fuente de «Necesita atención»: `getIntegrationAttention`, solo para quien carga.
- Links a «Guías» en el encabezado y en «Más ▾», y en FirstSteps.

---

## 3. Contratos (verificados por el cierre)

| Contrato | Quién da → quién usa | Estado |
|---|---|---|
| **C1** `components/administracion/guias/how-to/index.ts` → `HowToMisComprobantes`, `HowToMercadoPago`, `HowToBanco` `({ defaultOpen?, className? })` | WP7 → WP10 (`importar/{page,arca,mercado-pago,banco}`), WP11 (`onboarding/how-to-slot.tsx`), WP7 (paso 10 de la guía) | OK: los tres son `'use client'`, con `<details>`, y los props coinciden. Test SSR en `arca-guide-render` |
| **C2** `lookupCuits(slug, { cuits, purpose? }) → PadronBatchResult` (`lib/arca/actions.ts`) | WP5b → WP10 (`review/new-suppliers.tsx`, tandas de 200) | OK: tipo exportado y llamada con `{ cuits, purpose: 'supplier' }`. `ok: false` lleva `step` al paso de la guía |
| **C3** `ArcaTestVoucherButton({ slug, disabled? })` (`components/administracion/arca/test-voucher-button.tsx`) | WP9 → WP7 (`arca-homologacion.tsx`, paso 5) | OK: solo para quien carga y deshabilitado hasta que homologación quede `connected` |
| **C4** rutas | todos | OK: las 9 rutas nuevas salen en el build. `ajustes?tab=arca`, `#homologacion`, `ajustes/arca#paso-0…10` y `#renovar`, `importar/*`, `guias`, `guias/como-arrancar` y `/print/factura/{slug}/{id}` (fuera de C4, de WP9) |

---

## 4. Lo que cambió el cierre (integración)

1. **El Resumen ya no avisa para siempre por las facturas de prueba** (`lib/accounting/queries/integrations.ts`).
   - El problema: `vouchersAttention` contaba las `authorized` de homologación, que nunca van a los
     libros (`aavo_homo_no_books`). Después de «Emitir una factura de prueba», el Resumen mostraba
     «Hay 1 factura de ARCA para verificar…» en rojo, sin forma de sacarlo.
   - El arreglo: `.eq('environment', 'produccion')`.
   - En la misma consulta:
     - el aviso del certificado lleva a `/ajustes/arca#renovar` (lo sugirió WP7);
     - el de facturas lleva a **`/ventas/nueva-factura`**, que es donde corre la verificación
       automática y está «Cargarla ahora». `/ventas` no tiene nada de eso.
   - Tests de los tres links en `accounting-onboarding.test.ts`.
2. **El aviso de la pestaña ARCA lleva al mismo lugar** (`ajustes/_components/arca-panel.tsx`). «Ver»
   va a `/ventas/nueva-factura` para quien carga y a `/ventas?tab=facturas` para la contadora.
3. **«Anular» ya no aparece en el cobro del mismo envío que una factura emitida con ARCA**
   (`comprobantes/[id]/page.tsx`).
   - El problema: una factura con «cobrado ahora» se guarda como `[factura, cobro]` en un solo envío.
     Desde la página del **cobro**, «Anular» corría `voidDocument({ withBundle: true })` y anulaba
     también la factura, que ya está en ARCA. WP9 lo había bloqueado solo en la página de la factura.
   - El arreglo: `arcaEmittedSibling()` mira los hermanos que son de venta con `getArcaVoucherCard`
     (producción, `authorized`/`posted`). Si encuentra uno, oculta «Anular» y muestra una nota con el
     link a la factura: «Se cargó junto con una factura emitida con ARCA…».
   - Solo consulta si el comprobante se podía anular y quien mira puede cargar.
   - Si no se puede leer, se comporta como antes, igual que con la factura misma.
   - El freno en la base sigue pendiente (§8).
4. **Textos de «Probar conexión»** (`lib/arca/views.ts`, pendiente de WP5b a WP7).
   - Un chequeo que no llegó a empezar dice «No se llegó a probar». Antes decía «ARCA tardó
     demasiado».
   - Si el permiso se descartó, el chequeo suma: «ARCA rechazó el permiso guardado y ya lo descartamos:
     esperá unos minutos y volvé a probar.»
   - Test nuevo: `tests/lib/arca-views-checks.test.ts` (3).
5. **Texto neutro para la contadora** (`lib/arca/guide.ts`). Pasos 7 y 8: «Antes se puede marcar «Ya
   lo hice»», en vez de «podés».
6. **⌘K «Guías de Administración»** (`components/command-palette/command-config.ts`, pedido de WP11).
   Lleva a `/administracion/guias`, con acceso de lectura para el dueño y la contadora.

**Documentación:**

- `docs/features/arca-e-importaciones.md` (nuevo): qué hace, puesta en marcha, `META_TOKEN_KEY` idéntica
  en todos lados, homologación primero y límites.
- `BACKLOG.md`: subsección «ARCA e importadores — lo que quedó de la fase 3 (08/10/2026)» bajo
  «Administración».

---

## 5. Migraciones: 1 aplicada y 13 pendientes

### 5.1 La lista (md5 confirmados por el cierre)

**Necesitan el «sí» explícito del dueño, porque el Supabase remoto es producción.** Van en este orden,
una por `apply_migration`, con `name` = lo que va después del prefijo. Antes de cada una se confirma el
md5.

| # | Archivo | Bytes | md5 | Líneas | Estado |
|---|---|---|---|---|---|
| 1 | `20261008120000_acc_arca_core.sql` | 27487 | `6512cf9fbc9abdfe4e661ff66fd44971` | 445 | **Aplicada** (versión `20261008115646`, md5 igual) |
| 2 | `20261008120100_acc_arca_rpc_connection.sql` | 16633 | `10985ba199d138935456c70581158b34` | 302 | pendiente (ver §7, alias por defecto) |
| 3 | `20261008120105_acc_arca_rpc_certificate.sql` | 9568 | `e072f15ebaebcb8aafea3825ea408882` | 175 | pendiente |
| 4 | `20261008120110_acc_arca_rpc_tickets.sql` | 9997 | `e2c68caf835f78271bc566fecc86d8c2` | 180 | pendiente |
| 5 | `20261008120115_acc_arca_rpc_session.sql` | 15335 | `0210dececb17183c82e689edfc6ac719` | 283 | pendiente |
| 6 | `20261008120120_acc_arca_rpc_vouchers.sql` | 17190 | `7ef5be1775e0a64b8439fb9cac6e4968` | 314 | pendiente |
| 7 | `20261008120200_acc_imports_core.sql` | 25102 | `ccb6ff86566a5ac3f53aca3cee0c273d` | 369 | pendiente |
| 8 | `20261008120300_acc_imports_rpc_batches.sql` | 17597 | `f80e183592b80b84da43d210bbccfeb9` | 338 | pendiente |
| 9 | `20261008120310_acc_imports_rpc_proposals.sql` | 10408 | `0c1baf803edf4f104a8cc7d3a85eaef7` | 187 | pendiente |
| 10 | `20261008120315_acc_imports_rpc_posting.sql` | 13409 | `accf99f9b0f0ce16c085e78d880e77c0` | 235 | pendiente |
| 11 | `20261008120320_acc_imports_rpc_rules.sql` | 20179 | `7c8feaf8679b4238db63947758d5340d` | 359 | pendiente |
| 12 | `20261008120330_acc_mp_rpc.sql` | 21514 | `8ce9485c434ddd7a7f999d261dc07a69` | 436 | pendiente |
| 13 | `20261008120340_acc_arca_imports_addendum.sql` | 35321 | `530a697bfc3bc85dd1bfc118ef50a8ec` | 660 | pendiente |
| **14** | **`20261008120400_acc_arca_ticket_drop.sql`** | **2883** | **`7d6c4c9229a448ad9a64a3e284a1f10a`** | **58** | **pendiente (nueva, de WP5b)** |

Las md5 de la #1 a la #13 son las mismas de `fase2-estado.md` §2.1. La #14 es la del reporte de WP5b.
No hay prefijos repetidos.

### 5.2 La #14 · `acc_arca_ticket_drop`

**Qué crea:** `public.acc_arca_ticket_drop(p_tenant_id uuid, p_environment text, p_service text) returns boolean`.

- Es `SECURITY DEFINER`, con `search_path = ''` y `EXECUTE` solo para `authenticated`.
- Llama a `acc_assert_writer` y toma el advisory lock del bar.
- Borra `token_enc`, `sign_enc` y las fechas del ticket de ese servicio. Tiene `WHERE` (safeupdate) y no
  toca el lease ni el cooldown.
- Audita `acc_arca.ticket_dropped`, con solo `environment` y `service` en el payload.
- Devuelve `true` si había un ticket y `false` si no (sin conexión o sin ticket).

**Dependencias:** solo la #1 (que está aplicada) y helpers viejos. Igual va en la tanda, **después de la
#13**, porque en tiempo de ejecución el servidor la llama junto con `acc_arca_ticket_get`/`put` (#4).
Mientras no esté, el código recibe `unavailable` y sigue como hoy, sin descartar el permiso.

**Ensayo contra producción** (`scratchpad/sqltests/wp5b/dry_120400.sql`, 20118 bytes, que incluye la #4
minificada; `begin…rollback`): **30/30 OK**. Lo corrió WP5b y lo repitió el cierre el 08/10 sobre la
misma base, con solo la #1 aplicada. Cubre:

- **permisos:**
  - anon → 42501 «permission denied»;
  - contadora, dueño sin acceso y otro bar → 42501 «forbidden»;
- **validación:** ambiente o servicio inválido o nulo → `invalid_payload`; sin conexión → `false`;
- **descarte:**
  - borra solo el servicio pedido y deja el otro;
  - una segunda vez da `false`;
  - conserva el lease y el cooldown;
- **auditoría:** 2 filas sin token, sign ni CUIT;
- **detectores:** privilegios (`f|t|f|t|search_path=""|boolean|v`), `acc_privilege_gaps()` y
  `acc_rpc_isolation_gaps()` dan 0.

### 5.3 Después de aplicar (de la #2 a la #14)

1. `acc_privilege_gaps()`, `acc_isolation_gaps()` y `acc_rpc_isolation_gaps()` tienen que dar **0 filas**.
   Revisar también `get_advisors` (seguridad).
2. Verificar el md5 de cada una contra `supabase_migrations.schema_migrations.statements`, como se hizo
   con la #1.
3. Regenerar `types/database.ts` por MCP (`generate_typescript_types`) y volver a agregar los exports
   manuales, porque `db:types` está roto. Tiene que traer `acc_import_proposals.previous_document_id`.
4. **No subir `statement_timeout` de `authenticated` por encima de 10 s** (hoy es 8 s), o bien poner
   `auto_explain.log_parameter_max_length = 0`. Si no, `auto_explain` registraría los parámetros, y entre
   ellos van el PEM de la clave y `META_TOKEN_KEY`.
5. El PR dispara el job `rls` de CI: es la primera corrida de las 14 juntas en un Supabase de verdad.
6. Smoke de homologación desde una **preview** (P-T1, §6.4).

---

## 6. Pasada visual: checklist combinado

### 6.1 Antes de empezar

**El bar demo `demo-administracion`** (leído el 08/10 en producción):

- razón social «Demo Administración SAS»;
- **CUIT vacía**;
- responsable inscripto;
- libros desde el **01/09/2026**, con saldos iniciales cargados;
- 81 comprobantes y 4 proveedores;
- 1 banco **sin CBU** y 1 billetera **sin CVU**;
- partícipe «Mercado Pago» presente;
- 2 puntos de venta;
- 0 conexiones de ARCA;
- 3 miembros, **todos dueños**.

**Contadora:** no hay ningún miembro con rol `accountant` en ningún bar. Para las vistas de la contadora
hay que sumar un usuario de QA con rol «Contabilidad» en el bar demo (Configuración › Equipo; la página
no lee `?rol=`, así que hay que elegirlo a mano) y crear su sesión con `tools/qa-session.mjs`.

**Matriz:** cada pantalla se mira a **375 px** y a **1280 px** (con el menú abierto y plegado), en
**claro y oscuro** (cookie `hub_theme`), como **dueño** y como **contadora**, con teclado (Tab, Enter,
Esc) y con un lector de pantalla para lo que se anuncia (`role="status"` y `aria-live`).

En todas se revisa:

- que no haya scroll horizontal a 375;
- que los toques sean de 44 px y los botones de ancho completo en el teléfono;
- que el estado se lea también en texto, no solo en color;
- que se vea el foco;
- que los esqueletos (`loading.tsx`) aparezcan;
- que los errores tengan «Reintentar».

**«Requiere»:**

| Valor | Quiere decir |
|---|---|
| **hoy** | se ve ya, con solo la #1 aplicada |
| **M** | necesita las migraciones #2 a #14 |
| **H** | además, la conexión de homologación andando (certificado WSASS de quien programa) |
| **P** | solo con la conexión de producción del bar real: no se llega en el demo sin datos reales |
| **datos** | hay que cargar algo antes en el demo |

### 6.2 Por pantalla (rutas bajo `/demo-administracion/administracion`)

**A. Resumen · `/`**

| Estado | Cómo llegar | Requiere |
|---|---|---|
| Sin avisos de integraciones; FirstSteps con link a «Guías»; «Más ▾ › Guías y cómo arrancar» | entrar | hoy |
| «Necesita atención» con «Compras de ARCA para revisar y cargar» (o «Mercado Pago…», «Movimientos del banco…») → `/importar/{lote}` | subir un archivo y dejarlo en revisión | M |
| «Bajá Mis Comprobantes de <mes> y subilo» | desde el día 11, con ARCA usado o conectado y sin lote que cubra el mes anterior | M + datos |
| Certificado por vencer o vencido → `/ajustes/arca#renovar` | — | P |
| «Hay N facturas de ARCA para verificar…» → `/ventas/nueva-factura` | — | P (las de prueba **no** avisan desde el cierre) |
| Contadora: sin «Necesita atención», con el estado de los libros | sesión de contadora | hoy |

**B. Guías · `/guias`**

- **Hoy:**
  - tarjeta «Cómo arrancar» con «Todavía no marca tu avance sola…»;
  - «Conectar ARCA» con «N de 9 pasos hechos · Te toca: …»;
  - «Bajá los archivos» con tres bloques, cada uno con su «¿Cómo lo bajo?» y el botón Importar.
- **Contadora:** sin botones de carga.

**C. Cómo arrancar · `/guias/como-arrancar`**

| Estado | Cómo llegar | Requiere |
|---|---|---|
| «Todavía no podemos marcar tu avance solos…», los 21 ítems numerados sin estado y sin «Ya lo hice» | entrar | hoy |
| «Por dónde arrancar: Datos de la SAS» con «Completar los datos» | entrar (la CUIT del demo está vacía) | hoy |
| Mensaje para los proveedores (Copiar / WhatsApp) | está aunque falte la CUIT; revisar cómo se lee sin CUIT | hoy |
| «Tené a mano»: las casillas tildan y el conteo se actualiza | tocar | hoy |
| Avance «N de 19 listos», «Lo próximo» con «Cómo se hace» abierto y estados (Listo / Al día / Falta / Te toca / «Marcado por vos») | entrar | M |
| Marca manual + toast con Deshacer; recargar y que siga; «Desmarcar» | «Ya las revisé» en Plataformas | M |
| Hojas «Nuevo gasto» y «Ajustar saldo» sobre la guía | tocar sus botones | hoy |
| Contadora: sin marcas ni botones | sesión de contadora | hoy |

**D. Ajustes › ARCA · `/ajustes?tab=arca`**

| Estado | Cómo llegar | Requiere |
|---|---|---|
| **A** «Conectá ARCA y que la plataforma trabaje por vos» (3 beneficios + «Conectar ARCA») **más** «Primero cargá la CUIT de la SAS» con «Ir a Datos de la SAS» | entrar | hoy (con la #1 aplicada la lectura anda: **no** sale «No pudimos cargar esto», como decía el smoke de WP7) |
| A sin el aviso de la CUIT | cargar una CUIT válida en Datos de la SAS (los fixtures usan 30-71234567-1) | datos |
| **B** «Conexión con ARCA · Producción · 1 de 9 pasos listos», barra, lista de 11 pasos, «Seguir con la guía» → `#paso-1` abierto y enfocado | «Ya revisé todo» en el paso 0 de la guía (o guardar el punto de venta del paso 2) | M |
| **C** conectado / **D** error (producción) | — | P |
| Aviso rojo de facturas para verificar → «Ver» | — | P |
| «Pruebas (homologación)»: plegado; `#homologacion` lo abre; 5 pasos (pedido, certificado WSASS, punto de venta, probar, factura de prueba deshabilitada) | `?tab=arca#homologacion` | M (los pasos andan con M; la factura de prueba, con H) |
| Pestañas: a 1280 con el menú abierto entran las 9, «Integridad» visible. A 375 la barra se desliza y centra «ARCA» | entrar | hoy |
| Contadora: estado en texto, sin botones | sesión de contadora | hoy |

**E. Guía · `/ajustes/arca`**

| Estado | Cómo llegar | Requiere |
|---|---|---|
| La guía completa, con «Te toca» en el paso 0 y las maquetas personalizadas (razón social; con la CUIT vacía, ver cómo se leen) | entrar | hoy |
| «Ya revisé todo» o «Guardar» → mensaje del servidor «Esta función todavía no está disponible…», sin romperse | tocar | hoy |
| Avance real en el riel (Hecho / Te toca / Pendiente / Opcional / Revisar / No anduvo) | marcar pasos | M |
| `#paso-0` … `#paso-10` abren y enfocan; `#renovar` | URL con ancla | hoy |
| Teléfono: barra «Te toca: N…» + «N de 9» + «Pasos», que abre un Sheet; elegir un paso cierra el Sheet, baja hasta el paso y lo enfoca | 375 px | hoy |
| Maquetas a 375 (escaladas, con «Puede verse distinto»), en claro y oscuro | — | hoy |
| Contadora: sin «Ya lo hice»; los pasos 7 y 8 dicen «se puede marcar» | sesión de contadora | hoy |

**F. Completar con ARCA**

Dónde está:

- Compras › Nueva compra › Proveedor › «Crear «…»» (bloque «Proveedor nuevo»);
- Ventas › Factura de venta › nuevo cliente;
- Ventas › Cierre;
- Configurar › Nuevo proveedor/cliente;
- Proveedor › Datos › Editar datos (solo con CUIT o CUIL).

| Estado | Requiere |
|---|---|
| Link discreto «Conectá ARCA para completar esto solo», que abre `?tab=arca` en otra pestaña sin perder lo escrito | hoy |
| «Completar con ARCA» → «Consultando ARCA…» (se anuncia) → tarjeta «Según ARCA» → «Usar estos datos» → «Listo: completamos…» con el foco en esa línea | H |
| La pregunta inline «Esto ya estaba completo y ARCA dice otra cosa…» con «Usar lo de ARCA» / «Dejar lo mío» | H |
| CUIT inválida, no encontrada, tope por minuto: mensaje en su lugar, con el link al paso si hace falta | H |
| Ficha del proveedor: «Verificado en ARCA el …» | H (después de una consulta) |
| Contadora: no aparece | hoy |

En el visual hay que mirar:

- la tarjeta «Según ARCA» adentro del panel teñido de «Proveedor nuevo», un panel dentro de otro;
- el campo de CUIT, que se achica con el botón al lado en los diálogos a 1280;
- dónde cae la línea de verificación en el encabezado del proveedor.

**G. Emisión**

| Estado | Cómo llegar | Requiere |
|---|---|---|
| Ventas › Factura de venta en modo manual, igual que hoy | entrar | hoy |
| «Emitir una factura de prueba» (B a consumidor final, A a una CUIT, NC B) → «Pidiendo el CAE a ARCA…» → resultado verde con CAE de 14 dígitos, vencimiento y «Factura B 000X-…»; toast | `?tab=arca#homologacion`, paso 5 | H |
| `/print/factura/demo-administracion/{voucherId}`: banner PRUEBA / sin validez fiscal, B · Cód. 006, ORIGINAL, Ley 27.743, CAE y QR; «Imprimir o guardar PDF» en una A4 sin botones | «Ver cómo sale impresa» | H |
| Modo ARCA en la factura (letra, número, confirmación) y la tarjeta «Autorización de ARCA» en el comprobante | — | P |
| Cobro del mismo envío que una factura con CAE: sin «Anular», con la nota «Se cargó junto con una factura emitida con ARCA…» | — | P |

**H. Importar · `/importar` y siguientes**

| Estado | Cómo llegar | Requiere |
|---|---|---|
| Hub: «No pudimos cargar esto» + Reintentar; las 3 tarjetas con «¿Cómo lo bajo?»; «Lo que sigue a mano»; historial sin lista | entrar | hoy |
| Hub con «Todavía no importaste nada», el historial y los filtros (Todos / ARCA / MP / Banco) con `aria-current` | entrar | M |
| Pestaña «Importar» después de «Cajas», marcada | entrar | hoy |
| `/importar/arca`: soltar `tests/fixtures/imports/mc-g3-recibidos-nov.zip` → «Encontramos 539 comprobantes de compras…» | con la CUIT de la SAS = 30-71234567-1 | hoy (la subida da «todavía no está disponible»); M para subir |
| Archivos equivocados: `mc-g2-emitidos.zip` («…Emitidos…»), `mc-g3-recibidos-pasado-por-excel.csv` («…Excel…»), `mp-liquidaciones.csv` (con «Ir a Mercado Pago») | soltarlos | hoy |
| Revisión de Mis Comprobantes con propuestas | ⚠ los ZIP son de nov/dic 2025 y los libros del demo empiezan el 01/09/2026, así que salen como «No se pudo armar». Sirve para ver ese estado; para ver propuestas hacen falta fechas desde 09/2026 o un bar de prueba | M |
| `/importar/mercado-pago`: `mp-liquidaciones.csv` (oct 2026, que entra en los libros) | darle un CVU a la billetera en Ajustes › Cajas | M + datos |
| `/importar/banco`: `banco-dc.csv`, `banco-signo.txt`, `banco-columnas.xlsx` («Contanos qué es cada columna»), `banco-html.xls` | elegir la cuenta (el banco del demo no tiene CBU) | M |
| `/importar/{lote}`: cuatro números arriba; «Proveedores nuevos (N)» con «Completar todos con ARCA» (en homologación avisa que son datos de prueba) y «Usar las cuentas sugeridas»; pestañas Para revisar / Listas / Cargadas / No se cargan / Todos, con chips `?falta=`; barra «Cargar N» con «Cargando 45 de 142…» | subir y revisar | M (+H para «Completar todos») |
| Volver a subir el mismo archivo → «ya importaste…», que retoma si quedó a medio subir | subirlo de nuevo | M |
| Cancelar importación (`AlertDialog`) | «Más» del lote | M |
| Contadora: hub e historial sin botones; las rutas de carga con `ReadOnlyNotice` y el link al historial; la revisión sin acciones | sesión de contadora | hoy / M |

**I. Comprobante · `/comprobantes/{id}`**

- Sin cambios visibles hoy: la tarjeta de ARCA aparece solo con comprobantes emitidos en producción.
- Mirar igual que no se rompa en un comprobante cualquiera del demo.

**J. ⌘K**

- «Importar de ARCA, Mercado Pago o el banco», «Conectar ARCA» (solo para quien carga), «Cómo arrancar
  con Administración» y «Guías de Administración» (dueño y contadora). Cada uno abre su ruta.

### 6.3 Lo que solo se verifica con ARCA de verdad (lo cubren tests con reloj y transporte falsos)

- Plazos de 50 y 40 s, y el login que no empieza con menos de 20 s.
- `ARCA_FAKE_TIMEOUT=1` (solo local): CAE perdido → `needs_reconcile` → reconciliado.
- «ya posee un TA válido» → cooldown de 600 s y su mensaje.

### 6.4 Smoke de homologación (orden sugerido, desde una preview de Vercel, con M aplicadas)

1. CUIT de la SAS en el demo.
2. Pruebas (homologación):
   1. pedido con la CUIT personal;
   2. certificado WSASS autorizado a `wsfe` y `ws_sr_constancia_inscripcion`, representando a la SAS;
   3. subirlo;
   4. punto de venta;
   5. «Probar conexión» → Conectado.
3. Variante con la delegación mal hecha: el chequeo 3 dice «La SAS no está en el permiso», más el texto
   de permiso descartado, y deja una fila `acc_arca.ticket_dropped` en `audit_log`.
4. Factura de prueba B, A y NC B. Verla impresa.
5. «Completar con ARCA» en un alta de proveedor y en «Proveedores nuevos». La segunda consulta tiene que
   salir de la caché.
6. El Resumen **no** tiene que mostrar «facturas para verificar» por las de prueba.

---

## 7. Decisiones pendientes

### 7.1 Del dueño

1. **El «sí» para aplicar las migraciones #2 a #14** (§5).
2. **Alias por defecto `hubplataforma`/`hubpruebas`** en `private.acc_arca_conn_new`, migración #2 (hallazgo
   de WP7).
   - Es multi-bar: lo ve cualquier bar que guarde el punto de venta (paso 2) antes de generar el pedido
     (paso 5). La pantalla propone el alias del bar, pero la fila queda con «hub…» hasta el pedido.
   - Propuesta: cambiarlo a `plataforma`/`pruebas` **antes** de aplicar. Cambia el md5 de la #2 y hay
     que volver a ensayarla.
   - El cierre no tocó el archivo porque las migraciones podían aplicarse mientras trabajaba.
3. **Regla de «completar»** de WP8.
   - En las altas nuevas, lo tipeado que es el comienzo del nombre de ARCA se completa sin preguntar.
     En la ficha, se pregunta todo.
   - Para pisar lo escrito se pregunta en línea, no con `AlertDialog`: es reversible y evita un modal
     sobre otro en el teléfono. ¿Va así?
4. **Rótulo «Medios»** en las pestañas de Ajustes, para que entren las 9 a 1280 px. El resto del panel
   dice «Medios de cobro».
5. **Bares sin Mercado Pago:** las rutinas «Mercado Pago» semanal y «Factura de Mercado Pago» quedan «Te
   toca» sin opción «no aplica». Cajas y cuentas se puede cerrar a mano. ¿Sumamos «No uso Mercado
   Pago»?
6. **Reinicio del bar** (de la fase 2): borra las conexiones de ARCA, homologación incluida, y se niega
   si hay facturas de producción en ARCA.
7. **Freno en la base** para no anular ni revertir comprobantes ligados a facturas de producción con
   CAE, ni sus envíos. Pide una migración nueva (§8).
8. **Lo que sigue abierto del diseño (§8.1):**
   - P-O1, CUIT de la SAS: el bar real `hub` todavía no tiene Administración configurada;
   - P-O2, quién es el administrador de relaciones, con nivel 3;
   - P-O3, puntos de venta del sistema de caja de hoy;
   - P-O4, Factura A;
   - P-O5, la cuenta de Mercado Pago;
   - P-O6 y P-O8, archivos reales para calibrar;
   - **P-O7**: que alguien con clave fiscal recorra la guía contra el ARCA real y ajuste las maquetas
     «Puede verse distinto». La constancia del F. 3283/E no está dibujada.
9. **Texto «Factura M»** del aviso `voucher_m`, frente a «Factura A sujeta a retención» del código 51.

### 7.2 De la contadora

1. **Mes cerrado entre el CAE y «Cargarla ahora»** (WP9): la fecha contable pasa al primer día abierto,
   y con ella su mes del Libro IVA Ventas, mientras la factura conserva su fecha. ¿Está bien?
2. **P-C1:** el concepto por defecto (1, 2 o 3) y las fechas de servicio. Una NC de servicios pide su
   propio «Vence el pago».
3. **P-C9:** «Otros Impuestos Nacionales Indirectos» (Ley 27.743) impreso en $ 0.
4. **P-C8:** los gastos bancarios en el Libro IVA Compras (hoy no entran).
5. **Lo demás de §8.2:**
   - P-C2: recibos;
   - P-C3: «Otros tributos» de Mis Comprobantes;
   - P-C4: propinas;
   - P-C5: día calendario o de servicio en Mercado Pago;
   - P-C6: Ley 25.413;
   - P-C7: IIBB;
   - P-C10: prorrata;
   - P-C11: facturas que llegan tarde.
6. **El plan de cuentas:** el paso manual `chart_review` de «Cómo arrancar».

### 7.3 Técnicas, a confirmar con tráfico real

- **P-T1:** ARCA desde Vercel (la «Probar conexión» de homologación en una preview).
- La forma real de `relations` en el token. Si se leyera mal, cada prueba descartaría el permiso.
- 602/11002 en homologación.
- **P-T11:** la base del QR, `arca.gob.ar`.
- **P-T12:** el tope de la B anónima, $ 10.000.000.
- El filtro `?falta=`, que usa `cs` de PostgREST sobre `jsonb`.
- **P-T9:** `DecompressionStream`.

---

## 8. Pendientes (candidatos a `BACKLOG.md`)

Ya están en `BACKLOG.md`, en «Administración › ARCA e importadores — lo que quedó de la fase 3».

**Base (cada uno pide migración)**

1. Freno de anulación y reversión para comprobantes con CAE de producción y sus envíos. Hoy solo lo
   frena la pantalla.
2. `acc_guide_mark` con `on conflict do nothing`: pasar a `do update` de `done_at`.
3. El alias por defecto `hub*`, si no se cambia antes de aplicar.
4. `acc_report_onboarding.arca_vouchers_attention` cuenta las de homologación. Hoy no se usa en
   pantalla.

**Pantallas**

5. `/ventas` no verifica solo las facturas de ARCA pendientes. Montar `ArcaVoucherAttention`.
6. La ficha del cliente no tiene «Verificado en ARCA».
7. «Cargarla a mano» solo precarga el proveedor: faltan `?pv=&numero=&fecha=&total=` en `/compras/nueva`.
8. Nueva compra no tiene «Es la factura mensual de comisiones de Mercado Pago».
9. Mercado Pago queda bloqueado sin el partícipe «Mercado Pago».
10. Re-subir un extracto eligiendo otra cuenta retoma el lote viejo, con un texto confuso.
11. Cada tanda de 15 que se carga revalida toda la revisión: lento con miles.
12. `components/ui/progress.tsx` no le pasa `value` a Radix: sin `aria-valuenow` en toda la app.
13. `IIBB_REGIME_LABELS` dice «Local (Córdoba)» para todos los bares.
14. «Factura M» frente al rótulo del código 51.
15. Las server actions van de a una por pestaña: hasta 50 s de espera mientras ARCA contesta.

**Tests y documentación**

16. Los topes por minuto viven en memoria de cada instancia.
17. `tests/rls` no cubre las RPC de emisión ni anular → volver a cargar.
18. `.env.example` y CLAUDE.md §15 tienen que decir que ARCA reusa `META_TOKEN_KEY` (idéntica en local,
    preview y producción). CLAUDE.md pide el OK del dueño.

**Avisos que no son pendientes de código**

- Mientras la #11 no esté, `getOnboarding` deja una línea `[acc.query]` en el log en cada visita a la
  guía. Se va al aplicar.
- Los fixtures de Mis Comprobantes necesitan libros desde el 01/11/2025 o antes.
- Fase 4: Mercado Pago por API (WP12) y «Emitidos» → cierres (WP13).

---

## 9. Archivos del cierre

**En el repo:**

- **Editados:**
  - `lib/accounting/queries/integrations.ts`
  - `app/(manager)/[tenantSlug]/administracion/ajustes/_components/arca-panel.tsx`
  - `app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/page.tsx`
  - `lib/arca/views.ts`
  - `lib/arca/guide.ts`
  - `components/command-palette/command-config.ts`
  - `tests/lib/accounting-onboarding.test.ts`
  - `BACKLOG.md` (agregado bajo «Administración»)
- **Nuevos:**
  - `tests/lib/arca-views-checks.test.ts`
  - `docs/features/arca-e-importaciones.md`

**En el scratchpad** (`cierre-f3/`):

- **Logs:** `logs/tsc-{1,2}.txt`, `logs/lint-{1,2}.txt`, `logs/test-{1,2}.txt`, `logs/build-{1,2,3}.txt` y
  `logs/phase3-tests.json`.
- **Herramientas:** `tools/closure3.py` (clausura que se corta en `'use server'`), `tools/links.py`
  (rutas, pestañas y anclas) y `tools/rsc_props.py` (funciones de servidor a cliente).
- **Salidas:** `closure-all.txt`, `client-files.txt`, `changed.txt` y `link-files.txt`.

**Lo que no se hizo:**

- Sin `npm install`.
- Sin comandos de git que cambien estado.
- Sin tocar `.env*`, CLAUDE.md ni las migraciones.
- Sin `apply_migration`. En producción solo hubo lecturas y el ensayo con `rollback`.
- Sin levantar un servidor de desarrollo ni sacar capturas.
