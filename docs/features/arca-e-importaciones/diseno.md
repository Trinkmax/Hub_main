# Diseño construible — ARCA, importadores y guías de Administración (HUB! Coffee & Bar)

> **Fecha:** 08/10/2026 · **Rama base:** `feat/administracion` · **Estado:** diseño, sin código ni cambios en la base.
> **Insumos:** `arca-tecnico.md`, `arca-pasos.md`, `arca-mis-comprobantes.md`, `mercadopago.md`, `banco.md` (misma carpeta),
> el código de `lib/accounting/**`, las pantallas de `app/(manager)/[tenantSlug]/administracion/**`, `components/administracion/**`,
> `lib/meta/crypto.ts`, las migraciones `supabase/migrations/2026100712*.sql`, `CLAUDE.md`, `BACKLOG.md` y la guía de estilo
> `scratchpad/design/admin-ui.md` (regla 0: la UI se arma con los componentes actuales del panel).
> **Convenciones:** los nombres técnicos van como en el código. **A CONFIRMAR** = no verificado o decisión pendiente.
> Las afirmaciones normativas o técnicas no obvias citan su fuente (al final, §9) o el archivo de investigación donde está la cita.

---

## 0. Resumen ejecutivo

**Qué se construye (cuatro bloques):**

1. **Conexión con ARCA** dentro de Administración › Ajustes, en una pestaña nueva «ARCA».
   - La plataforma genera la clave y el pedido de certificado (CSR). La clave nunca sale del servidor.
   - La persona sube el `.crt` que bajó de ARCA, carga el punto de venta y aprieta «Probar conexión».
   - Todo se acompaña con una guía visual paso a paso que marca cada paso como hecho o pendiente.
2. **Usos inmediatos de ARCA:**
   - «Completar con ARCA» al dar de alta un proveedor o cliente (padrón `ws_sr_constancia_inscripcion`).
   - Emitir facturas, notas de crédito y notas de débito **sueltas** (eventos, catering) con CAE desde «Ventas › Factura de venta».
     Primero en homologación, después en producción y detrás de un interruptor.
3. **Importadores que sacan carga manual:**
   - «Mis Comprobantes» (ZIP/CSV/Excel) → compras.
   - Reporte de Liquidaciones de Mercado Pago (CSV; después también por API diaria) → acreditaciones, comisiones, retiros y rendimientos.
   - Extracto bancario (CSV/TXT/XLSX) → gastos bancarios, transferencias y pagos.
   - Los tres usan el mismo esquema: subir → revisar → confirmar, y contabilizan con el motor actual (`build*` + `acc_post_bundle`).
4. **Dos guías in-app con el estilo actual del panel:**
   - «Conectar ARCA»: muy visual, con maquetas de cada pantalla de ARCA dibujadas en HTML.
   - «Cómo arrancar»: qué cargar, dónde y cómo, con checklist de progreso calculado desde la base.

**Decisiones de diseño clave (propuestas; las que necesitan el OK del dueño están en §8):**

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Un certificado por bar** (situación 1 de ARCA), con la clave RSA generada en el servidor | La SAS es dueña de su certificado y el dueño no toca OpenSSL. Delegar a una CUIT de studiOS (situación 2) queda para cuando haya varios bares ([ADMINREL.DelegarWS](https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf); `arca-tecnico.md` §3.4). |
| D2 | **Dos conexiones por bar**: `homologacion` y `produccion`, cada una con su certificado | No se mezclan: un certificado de pruebas contra producción da `cms.cert.untrusted`. La homologación la hace studiOS con su CUIT personal en WSASS, representando a la SAS, en el bar demo (`arca-pasos.md` §6). |
| D3 | **Cliente SOAP propio sobre `node:https`** con un `https.Agent` que solo ofrece suites ECDHE. Sin dependencias npm nuevas | `servicios1.afip.gov.ar` negocia DHE de 1024 bits y Node 22.20+ corta con `ERR_SSL_DH_KEY_TOO_SMALL`. El fix por agente no baja la seguridad del resto del proceso (`arca-tecnico.md` §6.1, probado). |
| D4 | **Secretos cifrados con pgcrypto** (`pgp_sym_encrypt`, AES-256) con una clave de entorno nueva `ACC_SECRETS_KEY`. Viven en tablas `acc_*` **sin ningún GRANT** y se leen o escriben solo por RPC `SECURITY DEFINER` con `acc_assert_writer` | Cumple CLAUDE.md §5 y §8 (mismo mecanismo que los tokens de Meta) sin usar `service_role` en flujos de usuario (§4.4). El navegador nunca ve la clave privada ni la puede descifrar. Alternativa en §8 (P-T3). |
| D5 | **Emisión «CAE primero, asiento después»**: una saga persistida en `acc_arca_vouchers` (reservado → pidiendo → autorizado → contabilizado) con reconciliación por `FECompConsultar` ante timeouts | Así lo pide el manual de WSFEv1 («no reenviar a ciegas»). Un comprobante con CAE existe aunque falle el asiento: el asiento se reintenta con el mismo `client_ref` (idempotente). |
| D6 | **Importadores con parsers puros** (corren igual en el navegador y en el servidor), staging en `acc_import_*` y **un comprobante por `acc_post_bundle`** con `client_ref` determinístico | `acc_post_bundle` acepta 1–10 comprobantes con composiciones fijas y es la única puerta. El `client_ref` determinístico hace idempotente cualquier reintento. Parsear en el navegador esquiva el límite de 1 MB de las server actions y de 4,5 MB de Vercel. |
| D7 | **El cron solo prepara; contabiliza una persona** | `acc_post_bundle` exige `acc_assert_writer` (con `auth.uid()`): `service_role` no puede contabilizar, y está bien así porque la contadora pidió control. El sync de Mercado Pago deja los días listos para revisar y confirmar en un clic. |
| D8 | **«Mis Comprobantes» semiautomático** (bajar el ZIP una vez por mes y arrastrarlo) | No hay web service oficial para listar recibidos, y automatizar el portal con la clave fiscal está prohibido por la Disposición AFIP 74/2022, art. 11 (`arca-mis-comprobantes.md` §7). |
| D9 | **Ahora se emiten solo facturas sueltas**; el salón sigue facturando con Thinkeon hasta el POS | Punto de venta propio de web services para no chocar la numeración (error 10016) y alcance acotado (§3.3). |
| D10 | **UI con los componentes actuales** (`PageShell`, `PageHeader`, `SectionNav`, `Callout`, `DataTable*`, `StatCard`, `Stepper`, `CopyButton`, `Progress`, `AlertDialog`, `EmptyState`) | Regla 0 de `admin-ui.md` (el dueño rechazó el rediseño). Las maquetas de ARCA son ilustraciones encapsuladas dentro de un marco «así se ve en ARCA», no un estilo nuevo del panel. |

**Hallazgos en el repo que el diseño corrige o tiene en cuenta:**

1. **Región de Vercel: `pdx1` (Oregon, AWS us-west-2), no `iad1`.**
   - Lo dice `vercel.json` (`"regions": ["pdx1"]`, commit `42ac517`) y la memoria del proyecto: Supabase está en us-west-2.
   - La investigación midió HTTP 200 contra todos los endpoints de ARCA desde **us-east-1 y desde us-west-2 (Boardman)** (`arca-tecnico.md` §6.3).
   - Lo que sigue sin probar es el POST autenticado desde AWS. Se valida en el primer smoke desde una preview de Vercel (§3.2.8).
2. **`letterFor()` del formulario de factura de venta devuelve «B» para un monotributista** (`ventas/nueva-factura/_components/sales-invoice-form.tsx`).
   - Un responsable inscripto le factura **A** a un monotributista (RG 5003/2021, leyenda de la Ley 27.618).
   - En WSFE, `CondicionIVAReceptorId = 6` solo vale para las clases A y C: una B con 6 sale rechazada con el error 10243 (`arca-tecnico.md` §4.6).
   - Se corrige en el paquete de emisión (WP9).
3. **El código 51 se sigue llamando «Factura M»** en `VOUCHER_CATALOG`.
   - Desde el 01/12/2025 es «Factura A con leyenda “Operación sujeta a retención”» (RG 5762/2025).
   - Es solo un cambio de etiqueta: la clave `factura_m` y el código siguen iguales (WP10).
4. **El índice `adoc_purchase_dup_uq` deduplica por `voucher_type`, no por código ARCA.**
   - Factura A (1) y FCE A (201) con el mismo punto de venta y número chocarían (`arca-mis-comprobantes.md` §8.8).
   - Como la v1 del importador no acepta FCE (un bar chico no recibe FCE), queda en `BACKLOG.md`.
5. **`acc_post_bundle` no se puede llamar desde cron** (ver D7). Consecuencia: todo lo automático termina en «para revisar».
6. **Ajustes ya tiene 8 pestañas** y el código pide que entren enteras a 1280 px con el menú abierto. Sumar «ARCA» obliga a revisar el ancho (§2.2).

---

## 1. Restricciones del repo que mandan sobre el diseño

### 1.1 El patrón `acc_*` (base)

- **Lectura:**
  - Toda tabla `acc_*` tiene RLS, `revoke all from anon, authenticated` y `grant select to authenticated`.
  - La política es una sola, `<prefijo>_select_readers`, con `using (tenant_id in (select public.acc_reader_tenant_ids()))`.
  - Leen la contadora y los dueños con acceso vigente, con el flag `accounting` prendido (`20261007120500_acc_access_rls.sql`).
- **Escritura:**
  - Solo por RPC `SECURITY DEFINER`, con `set search_path = ''`, `perform public.acc_assert_writer(p_tenant_id)` y `pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id))`.
  - Se audita en la misma transacción con `private.acc_audit(p_tenant, p_user, p_action, p_entity, p_entity_id, p_payload)`.
  - Los errores salen con `private.acc_raise('<clave>', detail)` (P0001, el mensaje es la clave) y TS los traduce en `lib/accounting/errors.ts`.
  - Este apartamiento del `grant select, insert, update, delete` genérico de CLAUDE.md §5 es deliberado y está documentado (`20261007120400_acc_core_tables.sql`, sección 4).
- **Detectores que tienen que seguir en 0 filas:**
  - `public.acc_privilege_gaps()`: ningún privilegio de escritura para `authenticated` sobre `acc_*` y nada para `anon`.
  - `public.acc_isolation_gaps()`: el prefijo `acc_` exime de la RESTRICTIVE `<tabla>_no_accountant`.
  - **Por eso todas las tablas nuevas empiezan con `acc_`.**
- `audit_log` ya muestra las filas `acc_*` a los lectores de Administración (políticas `audit_log_acc_*`). Las entidades nuevas (`acc_arca_connection`, `acc_import_batch`…) quedan cubiertas solas.

### 1.2 `acc_post_bundle` es la única puerta para contabilizar

`acc_post_bundle(p_tenant_id, p_client_ref, p_bundle)`, en `20261007120830_acc_rpc_posting_core_post.sql`:

- Exige escritor (`auth.uid()`) e idempotencia por `client_ref`: el mismo pedido devuelve lo ya guardado con `replayed: true`; otro pedido con la misma clave da `idempotency_conflict`.
- Exige un `preview_hash` de 64 hexadecimales y entre 1 y 10 comprobantes en composiciones fijas:
  - uno solo de los tipos habilitados;
  - `[purchase, payment]`;
  - `[sales_close, collection…]`;
  - `[sales_invoice, collection]`;
  - `[collection, treasury_adjustment]`.
- Vuelve a validar todo y audita cada comprobante.
- **Implicancias:** un importador manda **un bundle por comprobante**, el cron no contabiliza y la emisión con ARCA contabiliza con el mismo `buildSalesInvoice` de hoy.

### 1.3 «La vista previa es lo que se guarda» (E.7)

- Los `build*` de `lib/accounting/posting/*` son puros.
- El hash (`hashProposalSync`, SHA-256 de la forma canónica) es el `previewHash` que manda el formulario.
- La server action recarga el contexto **desde la base**, vuelve a armar y compara: si cambió, devuelve `preview_stale` con la vista previa nueva (`lib/accounting/server/post-document.ts`).
- Los importadores y la emisión respetan lo mismo: lo que la persona vio en la revisión es lo que se guarda o se le vuelve a mostrar.

### 1.4 Cron con plan Hobby

- `vercel.json` tiene solo 2 crons diarios.
- Lo periódico corre con pg_cron, que llama cada minuto a `/api/cron/dispatch`. Las tareas «gated» se filtran por minuto y hora UTC en `lib/cron/schedule.ts` y corren en `lib/cron/dispatch.ts`.
- El pg_cron `hub-dispatch` solo llama a Vercel si hay trabajo vencido o si `minuto % 15 = 0` (memoria `perf-auth-fastpath`).
- Una tarea diaria nueva tiene que caer en un minuto múltiplo de 15 (§4.2.4).

### 1.5 Runtime, tamaños y dinero

- Las llamadas a ARCA corren en **runtime Node.js**: las server actions lo son por defecto y los route handlers llevan `export const runtime = 'nodejs'`. Edge no permite `node:https` ni configurar ciphers.
- **Límites de tamaño:** las server actions aceptan **1 MB** de cuerpo por defecto (Next.js, `serverActions.bodySizeLimit`) y una función de Vercel acepta **4,5 MB** de request.
  - Los archivos grandes (un reporte de Mercado Pago de 60 días) se parsean en el navegador.
  - Se mandan filas normalizadas en tandas de hasta 800 por llamada.
- **Dinero:** en TS son centavos `number` (`Number.isSafeInteger`); en la UI, pesos (memoria `dinero-ui-pesos`). En ARCA los importes van con 2 decimales y se formatean desde enteros, nunca con `float`.

### 1.6 UI

Rige la regla 0 de `scratchpad/design/admin-ui.md`:

- Los encabezados se arman con `PageShell` + `PageHeader eyebrow="Administración"`.
- Las pestañas `?tab=` van con `SectionNav`, y en el celular la barra se desliza y centra la activa.
- Los avisos usan `Callout` (`ajustes/_components/form-bits.tsx`) y los badges suaves `border-success/30 bg-success/10 text-success`.
- La plata se muestra con `Amount` o `formatCents` y las fechas con `formatIsoDay`.
- Los controles miden `h-11 text-base md:h-10 md:text-sm`.
- Todo lo irreversible pasa por `AlertDialog`, y lo frecuente se guarda sin confirmar y deja «Deshacer».

---

## 2. Conexión con ARCA

### 2.1 Modelo

Una fila de `acc_arca_connections` por bar y por ambiente (`produccion` | `homologacion`):

| Campo | Producción | Homologación |
|---|---|---|
| `represented_cuit` (va en `Auth.Cuit` de WSFE y en `cuitRepresentada` del padrón) | CUIT de la SAS (`acc_settings.cuit`) | CUIT de la SAS (WSASS permite representarla) |
| `cert_cuit` (va en el `serialNumber` del CSR y del certificado) | CUIT de la SAS | CUIT personal de quien usa WSASS («los certificados generados por WSASS siempre se emiten para la CUIT de una persona física», `arca-pasos.md` §6) |
| `alias` (`CN` del CSR = alias en ARCA) | Lo propone la plataforma, por ejemplo `hubplataforma` (solo letras y números) | `hubtest…` |
| `point_of_sale` | Punto de venta propio **«RECE para aplicativo y web services»**, distinto de los de Thinkeon | Cualquier número; si da 11002, el mismo de producción (A CONFIRMAR, `arca-pasos.md` §6) |

Estados de la conexión:

```
draft ──(Generar pedido)──▶ key_ready ──(Subir .crt válido)──▶ cert_ready ──(Probar: todo OK)──▶ connected
   ▲                              │                                  │                              │
   └──────(Desconectar)───────────┴──────────────────────────────────┴───── error ◀── (Probar falla)┘
```

- `key_ready`: ya hay una clave privada cifrada y un CSR.
- `cert_ready`: el certificado coincide con la clave, tiene la CUIT esperada y está vigente.
- `connected`: la última prueba dio OK en el servicio, el ticket de `wsfe`, el punto de venta y el ticket del padrón.
- `error`: la última prueba falló. Se guarda la clave del error y el paso de la guía que lo arregla.
- `disconnected`: se borraron la clave y los tickets. La fila queda como historia.
- **Cambiar el certificado** (renovación) vuelve a `cert_ready` e invalida los tickets.

### 2.2 Ajustes › ARCA (la pestaña)

**Dónde va:** `app/(manager)/[tenantSlug]/administracion/ajustes/page.tsx`. Se suma `{ value: 'arca', label: 'ARCA' }` a `TABS`, **después de «Datos de la SAS»** (es dato fiscal), y un `case 'arca'` que carga la conexión con `getArcaOverview(tenantId)` (`lib/arca/queries.ts`).

**Chequeo visual obligatorio:** el comentario de `TABS` pide que las ocho pestañas actuales entren a 1280 px con el menú abierto. Con nueve hay que verificarlo. Si «Integridad» queda escondida, el plan B es acortar «Medios de cobro» a «Medios» también en compu, porque `shortLabel` hoy solo aplica debajo de `sm`.

Componente: `ajustes/_components/arca-panel.tsx` (server-safe) + `ajustes/_components/arca-actions.tsx` (cliente). Hay cuatro estados:

**A · Sin configurar** (no hay fila de producción):

- Tarjeta `card-hairline rounded-xl border bg-card p-6`:
  - Título serif: **«Conectá ARCA y que la plataforma trabaje por vos»**.
  - Tres renglones con ícono: «Completá proveedores y clientes con solo poner la CUIT», «Emití facturas de eventos con CAE sin salir de acá», «Probá en un clic que todo esté en regla».
  - Pie: «Lleva unos 40 minutos. Lo hace quien maneja la clave fiscal de la SAS (el administrador de relaciones)».
- Botón principal **«Empezar a conectar»** → `/administracion/ajustes/arca`.
- Si falta la CUIT en Datos de la SAS: `Callout tone="warning"` «Primero cargá la CUIT de la SAS» con link a `?tab=sas`.

**B · En curso:**

- Encabezado «Conexión con ARCA · 4 de 9 pasos» + `Progress`.
- Lista compacta de pasos (número, título, chip de estado) con el botón **«Seguir donde quedaste»**, que lleva al primer paso pendiente (`/ajustes/arca#paso-5`).

**C · Conectado:**

- Fila de estado:
  - `Badge` suave verde «Conectado» · «Producción» · «CUIT 30-71234567-1» · «Punto de venta 0005».
  - «Certificado hasta el 10/09/2028». Pasa a aviso si faltan menos de 30 días.
  - «Última prueba: hoy 10:32».
- Lista de chequeos de la última prueba (§2.6), con ✓ o ✗ y su texto.
- `Switch` **«Emitir facturas desde la plataforma»**:
  - Descripción: «Para facturas de eventos y ventas sueltas. Las ventas del salón las sigue facturando Thinkeon».
  - Deshabilitado hasta que la prueba esté OK.
  - Al prenderlo, `AlertDialog` (no destructivo): «Desde ahora, en Ventas › Factura de venta vas a poder emitir con CAE. Cada factura emitida es real: si te equivocás, se anula con una nota de crédito». Botones [Cancelar] [Prender].
- `Select` **«¿Qué Factura A te autorizó ARCA?»**: «Todavía no tengo Factura A» · «A común» · «A con “Operación sujeta a retención”» · «A con “Pago en CBU informada”». Cambia las letras que ofrece la emisión (§3.2).
- Botones: [Probar conexión] (principal) · [Ver la guía] · [Renovar certificado] · [Desconectar].
  - Desconectar es destructivo y pide `AlertDialog` con `bg-destructive`: «Se borra la clave de la plataforma. Para volver a facturar vas a tener que repetir los pasos 5 a 9».
- Plegado al final: «Pruebas (homologación) · para desarrolladores», con el estado de esa conexión y el botón **«Emitir una factura de prueba»** (§3.2.8).

**D · Error:**

- `Callout tone="error"` con el texto en palabras simples (§2.7) y el botón «Cómo se arregla», que lleva al paso exacto de la guía.

**Contadora (solo lectura):** ve el estado, los chequeos y las fechas, sin botones (`ReadOnlyBadge` en el título, como el resto de Ajustes).

### 2.3 Acciones de la plataforma (las que embebe el asistente)

Todas en `lib/arca/actions.ts` (`'use server'`). Empiezan con `authorizeAccounting(slug, 'write')`, validan con zod (`lib/arca/schemas.ts`) y devuelven `AccActionState` (`lib/accounting/action-state.ts`), igual que las acciones actuales. Nunca loguean datos personales ni secretos (CLAUDE.md §9).

| Acción | Entrada (zod) | Qué hace | Devuelve |
|---|---|---|---|
| `startArcaCertificate(slug, input)` | `{ environment: 'produccion'\|'homologacion', alias: /^[a-z0-9]{3,30}$/, certCuit?: cuit }` (en producción `certCuit` = CUIT de la SAS y no se acepta otro) | 1) `generateRsaKeyPair()` (RSA 2048, `node:crypto`). 2) `buildCsr({ privateKeyPem, org: acc_settings.legal_name, cn: alias, cuit: certCuit })`. 3) RPC `acc_arca_store_keypair(...)` con el PEM de la clave y `ACC_SECRETS_KEY`. Si ya había una clave **con certificado subido**, pide `confirmReplace: true` antes de pisarla | `{ alias, csrPem, fileName: 'arca-<alias>.csr' }`. El navegador arma el archivo con un `Blob`: no hace falta ruta de descarga |
| `uploadArcaCertificate(slug, input)` | `{ environment, fileBase64 (≤ 16 KB) }` | `classifyUpload` (§2.4.2) → `inspectCertificate` → chequeos: es un certificado, la clave pública coincide (sha256 de SPKI contra la guardada), `serialNumber` = `CUIT <certCuit>`, `CN` = alias (si difiere, aviso, no error) y vigencia. Después, RPC `acc_arca_save_certificate` | `{ notAfter, serial, subjectCn }` |
| `saveArcaPointOfSale(slug, input)` | `{ environment, pointOfSale: 1..99998 }` | RPC `acc_arca_save_connection` (`point_of_sale`). En producción, además, `acc_save_sales_point` crea «0005 · Plataforma (ARCA)» con canal `events` si no existe, para que el punto aparezca en los formularios de venta | — |
| `testArcaConnection(slug, input)` | `{ environment }` | Los chequeos de §2.6, en orden. Guarda el resultado con RPC `acc_arca_record_test` | `ArcaTestResult` |
| `saveArcaSettings(slug, input)` | `{ environment, allowedClasses, defaultConcepto: 1\|2\|3, emissionEnabled }` | RPC `acc_arca_save_connection` (la base exige `connected` para prender la emisión) | — |
| `markGuideStep(slug, input)` | `{ guide: 'arca'\|'arranque', step: /^[a-z0-9_]{2,40}$/, done: boolean }` | RPC `acc_guide_mark` | — |
| `disconnectArca(slug, input)` | `{ environment, confirm: 'DESCONECTAR' }` | RPC `acc_arca_disconnect` (borra la clave y los tickets, deja la fila en `disconnected`) | — |
| `lookupCuit(slug, input)` | `{ cuit, purpose: 'supplier'\|'customer' }` | §3.1 | `PadronLookupResult` |
| `getArcaNextNumber(slug, input)` | `{ cbteTipo: 1\|2\|3\|6\|7\|8 }` | `FECompUltimoAutorizado` + 1 y la última fecha emitida (de `acc_arca_vouchers`) | `{ pointOfSale, nextNumber, lastIssueDate }` |
| `emitArcaSalesVoucher(slug, input)` | §3.2.3 | La saga de emisión | `AccActionState` con `{ documentId, cae, label }` |
| `postAuthorizedArcaVoucher(slug, input)` | `{ voucherId, previewHash }` | Recupera «autorizada y no contabilizada» (§3.2.5) | `AccActionState` |
| `reconcileArcaVoucher(slug, input)` | `{ voucherId }` | `FECompConsultar` + actualización del estado | estado nuevo |
| `emitArcaTestVoucher(slug)` | — | Solo homologación: una Factura B a consumidor final por $121 (neto 100 + IVA 21). No contabiliza | `{ cae, number }` |

### 2.4 Módulos `lib/arca/*` (y piezas compartidas)

La regla es separar lo **puro** (testeable sin red, sin base) de lo **servidor** (`import 'server-only'`).

#### 2.4.1 Mapa de archivos

| Archivo | Tipo | Exporta (firma) |
|---|---|---|
| `lib/xml/mini.ts` | puro (navegador + Node) | `parseXml(text: string): XmlNode` (elementos, texto, CDATA; **ignora los prefijos de namespace**: `soap:Body` se lee como `Body`) · `child(n, name)` · `childrenNamed(n, name)` · `textAt(n, 'a/b/c'): string \| null` · `escapeXml(s)` · `decodeEntities(s)`. Lo usan ARCA y el lector de XLSX |
| `lib/arca/der.ts` | puro Node (`Buffer`) | `tlv, seq, set, setOf, int, oid, nul, octet, utf8, printable, bitString, utcTime, explicit, implicitConstructed, readTLV, children` (port 1:1 de `research/ref/der.mjs`, verificado contra OpenSSL) |
| `lib/arca/pem.ts` | puro Node | `toPem(der: Buffer, label: 'CERTIFICATE'\|'CERTIFICATE REQUEST'): string` · `fromPem(text): { label: string; der: Buffer } \| null` · `classifyUpload(bytes: Uint8Array): 'certificate'\|'csr'\|'private_key'\|'pkcs12'\|'unknown'` (PEM por encabezado; DER por la forma ASN.1) |
| `lib/arca/csr.ts` | `node:crypto` | `generateRsaKeyPair(): { privateKeyPem: string; publicKeySpkiDer: Buffer }` · `buildCsr(o: { privateKeyPem; org; cn; cuit }): string` (subject `C=AR` PrintableString, `O` y `CN` UTF8String, `serialNumber` = `CUIT nnnnnnnnnnn` PrintableString; firma `sha256WithRSAEncryption`) · `publicKeySha256(spkiDer): string` |
| `lib/arca/cert.ts` | `node:crypto` | `inspectCertificate(bytes): CertInfo` con `{ pem; serialHex; subjectCuit: string \| null; subjectCn: string \| null; issuer: string; notBefore: Date; notAfter: Date; publicKeySha256 }`. Usa `new X509Certificate(buf)`, que acepta PEM o DER |
| `lib/arca/cms.ts` | `node:crypto` | `buildTra(service: 'wsfe'\|'ws_sr_constancia_inscripcion', now: Date): string` (`uniqueId` = segundos unix, ventana ±10 min, `toISOString()`) · `signTra(traXml, certPem, keyPem, now): string` (base64 de una línea; SignedData SHA-256 + RSA PKCS#1 v1.5, contenido adjunto, certificado incluido, atributos firmados `contentType` + `signingTime` + `messageDigest`). Port de `research/ref/cms.mjs`, verificado: `openssl cms -verify` OK y el WSAA lo parsea |
| `lib/arca/endpoints.ts` | puro | `ARCA_ENDPOINTS: Record<Env, { wsaa; wsfe; padronA5; padronA13 }>` con hosts `*.afip.gov.ar` (los `*.arca.gob.ar` están incompletos o tienen TLS que no coincide: `arca-tecnico.md` §1.2) · `ARCA_SERVICE = { wsfe: 'wsfe', padron: 'ws_sr_constancia_inscripcion' }` |
| `lib/arca/transport.ts` | servidor | `type ArcaTransport = (r: { url: string; headers: Record<string,string>; body: string; timeoutMs: number }) => Promise<{ status: number; body: string }>` · `httpsTransport` (§2.9) · `relayTransport` (opcional, solo si existe `ARCA_RELAY_URL`, §2.9) · `getTransport()` |
| `lib/arca/soap.ts` | puro + transporte | `envelope11(prefix, nsUri, bodyXml)` · `soapCall(t: ArcaTransport, { url; soapAction; body; timeoutMs? }): Promise<XmlNode>`. Tira `ArcaFault { kind: 'fault'\|'http'\|'network'\|'timeout'; code: string; message: string }`. El SOAPAction va **exacto** en WSFE (`"http://ar.gov.afip.dif.FEV1/<Metodo>"`; vacío da HTTP 500) y `""` en WSAA y padrón |
| `lib/arca/wsaa.ts` | puro + transporte | `loginCmsBody(cmsB64)` · `parseLoginCmsResponse(xml): { token; sign; generationTime: Date; expirationTime: Date }` (decodifica entidades y tolera CDATA) · `decodeTokenRelations(token): string[]` (CUITs de `relations` del SSO) · `wsaaLogin(t, env, service, certPem, keyPem, now): Promise<Ta>` |
| `lib/arca/wsfe.ts` | puro + transporte | **Builders:** `feDummyBody()`, `ultimoAutorizadoBody(auth, pv, tipo)`, `caeSolicitarBody(auth, req: CaeRequest)` (orden exacto del WSDL, `CantReg = 1`), `compConsultarBody(auth, tipo, pv, nro)`, `ptosVentaBody(auth)`. **Parsers:** `parseFeDummy`, `parseUltimoAutorizado`, `parseCaeResponse(xml): CaeResult` (`{ resultado: 'A'\|'R'\|'P'; cae?; caeDue?; fchProceso?; obs: Msg[]; errors: Msg[]; events: Msg[] }`), `parseCompConsultar`, `parsePtosVenta` (`{ nro; emisionTipo; bloqueado; fchBaja }[]`). **Cliente:** `createWsfe(t, env, getAuth)` |
| `lib/arca/padron.ts` | puro + transporte | `getPersonaV2Body(token, sign, cuitRepresentada, idPersona)` · `getPersonaListV2Body(…, ids ≤ 250)` · `parsePersona(xml): PadronPersona \| { notFound: true; message }` · `condicionFromPersona(p): { condicionIvaReceptorId: number \| null; ivaCondition: IvaCondition }` (precedencia de pyafipws: 32 → exento; 34 → no alcanzado; 30 activo → RI; monotributo 20/21 → 6; si no, sin datos o CF; `arca-tecnico.md` §5.3) |
| `lib/arca/vouchers.ts` | puro | `CBTE_TIPO: Record<'factura_a'\|'nota_debito_a'\|'nota_credito_a'\|'factura_b'\|'nota_debito_b'\|'nota_credito_b', 1\|2\|3\|6\|7\|8>` · `voucherTypeForCbte(n)` · `docTipoFor(taxIdType): 80\|86\|96\|99` · `CONDICION_IVA_RECEPTOR` (id, texto, clases; tabla del anexo v4.7, `arca-tecnico.md` §4.6) · `condicionFromIvaCondition(ivaCondition): number \| null` · `letterForCondicion(id): 'A'\|'B'` · `qrPayload(o): string` (§3.2.6) |
| `lib/arca/importes.ts` | puro | `wsfeAmounts(fv: FiscalVoucherAmounts): WsfeAmounts` (`ImpTotal`, `ImpTotConc` = no gravado, `ImpNeto` = Σ netos, `ImpOpEx` = exento, `ImpTrib` = 0, `ImpIVA` = Σ IVA, `Iva[]` con `Id` de `AFIP_ALIQUOT_ID`, que ya existe en `lib/accounting/iva.ts`) · `formatCents2(c: number): string` (BigInt, sin `float`) · `checkWsfeAmounts(a): string[]` (las validaciones 10048, 10061, 10023 y 10051 hechas acá antes de llamar a ARCA) |
| `lib/arca/errors.ts` | puro | `ARCA_ERRORS: Record<ArcaErrorKey, { title: string; body: string; step: ArcaGuideStep \| null; retry: 'now'\|'later'\|'after_fix' }>` · `classifyArcaError(e: unknown): ArcaErrorKey` (faults del WSAA, `Err.Code` de WSFE, submensajes de 10000, red) |
| `lib/arca/guide.ts` | puro | `ARCA_GUIDE_STEPS` (claves `s0_prereq` … `s10_mis_comprobantes`, título, quién lo hace, fuente de verificación) · `arcaGuideState(conn, progress, lastTest): StepState[]` (`done` \| `todo` \| `pending` \| `check` \| `failed` + motivo) |
| `lib/arca/schemas.ts` | puro | zod de las acciones de §2.3 y `arcaEmitSchema` (§3.2.3) |
| `lib/arca/secrets.ts` | servidor | `secretsKey(): string` (`requireEnv('ACC_SECRETS_KEY')`, ≥ 32 bytes) · `loadCredentials(supabase, tenantId, env)` → RPC `acc_arca_get_credentials` |
| `lib/arca/session.ts` | servidor | `openArcaSession(auth, env): Promise<ArcaSession>` → `{ conn; auth(service): Promise<{ token; sign; cuit }>; wsfe; padron }` con el caché del ticket (§2.5) |
| `lib/arca/emit.ts` | servidor | `emitSalesVoucher(auth, input): Promise<AccActionState>` (la saga de §3.2.4) |
| `lib/arca/queries.ts` | servidor | `getArcaOverview(tenantId)` (conexiones sin secretos + progreso de la guía + vouchers con problemas) · `getArcaVoucherForDocument(documentId)` |
| `lib/arca/actions.ts` | `'use server'` | las de §2.3 |

#### 2.4.2 Validación del archivo que sube la persona

Cada caso tiene un texto en palabras simples:

| Caso detectado | Qué se le dice |
|---|---|
| PEM `-----BEGIN CERTIFICATE REQUEST-----` (subió el `.csr`) | «Subiste el **pedido** (.csr), no el certificado. El certificado lo bajás de ARCA en el paso 6, con el ícono de *Descargar*.» |
| PEM `PRIVATE KEY` | «Eso es una clave privada: no la subas a ningún lado. La plataforma ya tiene la suya.» No se guarda nada ni queda en logs |
| PKCS#12 / `.p12` / `.pfx` | «Ese archivo trae clave y certificado juntos. Bajá de ARCA solo el certificado (.crt).» |
| La clave no coincide | «Este certificado es de **otro pedido**. Volvé a ARCA y subí el .csr de este paso (alias *hubplataforma*).» |
| `serialNumber` ≠ CUIT esperada | Producción: «El certificado es de la CUIT 20-…, no de la SAS. En el paso 6, en *¿En nombre de quién?*, elegí la SAS.» |
| Vencido o con fecha futura | «El certificado venció el 10/09/2026: generá uno nuevo con *Renovar certificado*.» |
| Ilegible o mayor a 16 KB | «No pudimos leer el archivo. Tiene que ser el .crt que bajaste de ARCA.» |

### 2.5 Secretos, ticket de acceso (TA) y concurrencia

**Cifrado (D4):**

- Clave nueva `ACC_SECRETS_KEY` en `.env.local` y en Vercel: 32 bytes aleatorios en base64. Va documentada en `.env.example` y en CLAUDE.md §15 (WP14).
- Las RPC cifran adentro con `pgp_sym_encrypt(p_plaintext, p_key, 'cipher-algo=aes256, compress-algo=0')`, el mismo formato que `encrypt_meta_token`.
- **Tablas con secretos y sin GRANT para `anon` ni `authenticated`:**
  - `acc_secrets`: la clave privada y los tokens de Mercado Pago;
  - `acc_arca_tickets`: token y sign del TA.
- Solo las RPC `SECURITY DEFINER` las tocan:
  - las de usuario hacen `acc_assert_writer`;
  - las de cron se llaman `*_service` y son ejecutables solo por `service_role`.
- Descifrar exige la clave de entorno, que solo tiene el servidor: un dueño que llame a la RPC desde el navegador no puede leer nada.
- **Nunca se loguea:** el TRA firmado, el PEM, el token, el sign ni la clave de entorno.

**Caché y lease del TA:**

- El TA vale 12 h y ARCA pide reusarlo. Si se piden dos a la vez, el segundo da `coe.alreadyAuthenticated` (`arca-tecnico.md` §2.5).
- En serverless cada instancia arranca vacía, así que el TA vive en la base y la renovación va bajo un **lease** persistido. No sirve un lock transaccional, porque el login es HTTP y dura más que una transacción de PostgREST.

```ts
// lib/arca/session.ts (servidor) — pseudocódigo exacto
async function getTicket(sb, tenantId, env, service, opts = { clearManualCooldown: false }): Promise<{ token: string; sign: string }> {
  for (let i = 0; i < 7; i++) {
    const r = await rpc(sb, 'acc_arca_ticket_get', { p_tenant_id: tenantId, p_environment: env, p_service: service,
                                                     p_secret_key: secretsKey(), p_lease_seconds: 60,
                                                     p_clear_manual_cooldown: i === 0 && opts.clearManualCooldown }) // true solo desde «Probar conexión»
    if (r.status === 'valid') return { token: r.token, sign: r.sign }              // vence en > 10 min
    if (r.status === 'cooldown') throw new ArcaError(r.last_error_key)             // no volver a pedir (política WSAA)
    if (r.status === 'busy') { await sleep(1500); continue }                       // otra instancia está logueando
    // r.status === 'lease': me toca a mí
    try {
      const creds = await loadCredentials(sb, tenantId, env)                      // clave + certificado (RPC)
      const ta = await wsaaLogin(getTransport(), env, service, creds.certificatePem, creds.privateKeyPem, new Date())
      await rpc(sb, 'acc_arca_ticket_put', { …, p_lease_id: r.lease_id, p_result: { ok: true, ...ta }, p_secret_key: secretsKey() })
      return ta
    } catch (e) {
      const key = classifyArcaError(e)
      const cooldown = COOLDOWN[key]   // 'wsaa_unavailable'|'network' → 60 s · 'already_authenticated' → 120 s prod / 600 s homo · 'not_authorized'|'cms_*' → manual
      await rpc(sb, 'acc_arca_ticket_put', { …, p_lease_id: r.lease_id, p_result: { ok: false, key, cooldown } })
      throw e
    }
  }
  throw new ArcaError('arca_busy')
}
```

Reglas:

- **Reusar** el TA hasta `expiration_time − 10 min`.
- **Cooldown** según la política del WSAA, que pide no pedir TA nuevos después de ciertos errores (spec 1.2.2):
  - 60 s después de `wsaa.*` o `wsn.unavailable`;
  - **manual** (hasta que la persona cambie algo y vuelva a probar) después de `coe.notAuthorized` y de `cms.*`. «Probar conexión» borra el cooldown manual, porque es una acción explícita después de arreglar.
- Al guardar un certificado nuevo se borran los tickets de esa conexión.
- Si justo después de renovar llega `coe.alreadyAuthenticated`, el mensaje explica que hay que esperar de 2 a 10 minutos. Si eso pasa por certificado o por DN queda A CONFIRMAR (`arca-tecnico.md` §9.6).

### 2.6 «Probar conexión»

En orden; se corta en el primer chequeo fatal. Cada uno guarda `{ key, ok, detail | error }`:

| # | Chequeo | Llamada | OK cuando | Si falla → paso de la guía |
|---|---|---|---|---|
| 1 | «ARCA responde» | `FEDummy` (sin autenticación) | `AppServer`, `DbServer` y `AuthServer` = `OK` | — (ARCA caído o red: «probá en unos minutos») |
| 2 | «El certificado es válido y está autorizado para Facturación Electrónica» | ticket `wsfe` (del caché o login) | hay TA | `coe.notAuthorized` → paso 7 · `cms.cert.untrusted` → ambiente cruzado · `cms.cert.expired` → renovar |
| 3 | «La SAS está dentro del certificado» | `decodeTokenRelations(token)` | `represented_cuit ∈ relations` | paso 7: se autorizó a la persona y no a la SAS (equivale al error 601) |
| 4 | «Tu punto de venta 0005 está habilitado» | `FEParamGetPtosVenta` | el número está, con `EmisionTipo` CAE, `Bloqueado = N` y sin `FchBaja` | paso 2: no existe o no es RECE; si es nuevo, «puede tardar unas horas en verse» (sin plazo oficial) |
| 5 | «Numeración» | `FECompUltimoAutorizado` para (PV, 6) y, si hay A habilitada, (PV, 1) | responde | Se muestra «Última Factura B: 0005-00000000 (todavía ninguna)» |
| 6 | «Padrón (constancia de inscripción)» | ticket `ws_sr_constancia_inscripcion` + `getPersona_v2(represented_cuit)` | la persona existe y está ACTIVA. Se muestran razón social, IVA y domicilio | `coe.notAuthorized` → paso 8. Si la razón social difiere de `acc_settings.legal_name`, aviso suave |
| 7 | «Certificado» | — | faltan más de 30 días para el vencimiento | aviso «Renovalo antes del …» |

Forma guardada en `acc_arca_connections.last_test`:

```json
{ "at": "2026-10-08T13:32:10Z", "environment": "produccion", "status": "connected",
  "checks": [ {"key":"service","ok":true,"detail":{"app":"OK","db":"OK","auth":"OK"}},
              {"key":"wsfe_ticket","ok":true},
              {"key":"relations","ok":true},
              {"key":"point_of_sale","ok":true,"detail":{"nro":5,"emisionTipo":"CAE","bloqueado":"N"}},
              {"key":"numbering","ok":true,"detail":{"6":0}},
              {"key":"padron","ok":true,"detail":{"name":"HUB COFFEE & BAR SAS","iva":"responsable_inscripto"}},
              {"key":"certificate","ok":true,"detail":{"days_left":701}} ] }
```

### 2.7 Errores en palabras simples (catálogo de `lib/arca/errors.ts`)

| Clave | Viene de | Título | Texto | Paso |
|---|---|---|---|---|
| `arca_unavailable` | red, timeout, `wsaa.unavailable`, `wsaa.internalError`, `wsn.unavailable`, HTTP 5xx | ARCA no responde | «ARCA no contestó. Suele pasar un rato; probá de nuevo en unos minutos.» | — |
| `arca_not_authorized` | `coe.notAuthorized` | Falta autorizar el certificado | «ARCA dice que este certificado no está autorizado para *Facturación Electrónica*. Hacé el paso 7 eligiendo la SAS y el alias *hubplataforma*.» (padrón → paso 8) | 7/8 |
| `arca_wrong_environment` | `cms.cert.untrusted`, 600 «No validó la firma digital» | Certificado del ambiente equivocado | «Este certificado es de pruebas (homologación) y lo estás usando en producción, o al revés.» | 6 |
| `arca_cert_expired` | `cms.cert.expired` | El certificado venció | «Los certificados de ARCA duran 2 años. Renovalo: es el paso 6 con *Agregar certificado* sobre el mismo alias.» | 6 |
| `arca_key_mismatch` | `cms.sign.invalid` | La clave no es la del certificado | «El certificado no corresponde a la clave de la plataforma. Generá un pedido nuevo (paso 5) y repetí el 6.» | 5 |
| `arca_clock` | `xml.generationTime.invalid`, `xml.expirationTime.*`, `cms.cert.invalid` | Problema de horario | «El pedido salió con la hora corrida. Avisanos: es un problema nuestro.» (bug: se loguea) | — |
| `arca_already_authenticated` | `coe.alreadyAuthenticated` | ARCA ya dio un permiso a este certificado | «¿Estás usando este mismo certificado en otro sistema, como Thinkeon? La plataforma necesita su propio alias. Si recién lo probaste, esperá 2 minutos.» | 6 |
| `arca_cuit_not_in_token` | 601, `relations` sin la SAS | La SAS no está en el permiso | «Autorizaste el certificado a tu nombre y no al de la SAS. En el paso 7, arriba tiene que decir *Actuando en representación de HUB … SAS*.» | 7 |
| `arca_pos_not_enabled` | 11002, 10005, PV ausente en `FEParamGetPtosVenta` | El punto de venta no es de web services | «El 0005 no está habilitado para la plataforma. Tiene que ser *RECE para aplicativo y web services*. Si lo creaste hoy, puede tardar unas horas en aparecer.» | 2 |
| `arca_pos_blocked` | `Bloqueado = S` | ARCA bloqueó el punto de venta | «Entrá a *Administración de puntos de venta y domicilios* y regularizalo.» | 2 |
| `arca_issuer_problem` | 10000 con submensajes 01, 02, 03, 05, 06, 11 | La SAS no está habilitada para facturar | Un texto por submensaje: 01 «no figura como responsable inscripto», 02 «no está habilitada a emitir electrónicos o la fecha es anterior al alta», 03 «el domicilio fiscal tiene un problema», 05 «la CUIT no está activa», 06 «no tiene ninguna actividad activa», 11 «no tiene activo el Domicilio Fiscal Electrónico» (`arca-pasos.md` §2.4) | 0 |
| `arca_class_a_not_enabled` | 10000/04, 10000/09, observación 10234 | Todavía no tenés Factura A | «Para hacer Factura A primero hay que hacer la habilitación (F. 856). Mientras tanto emití B.» | 3 |
| `arca_number_mismatch` | 10016 | El número o la fecha no son los que espera ARCA | «Otro comprobante tomó ese número, o la fecha es anterior a la del último. Volvé a intentar: tomamos el número que corresponde.» | — |
| `arca_receiver_condition` | 10242, 10243, 10246 | La condición del cliente no va con la letra | «Para *Monotributo* corresponde Factura A; para *Consumidor final*, Factura B.» | — |
| `arca_amounts` | 10048, 10061, 10023, 10051, 10018 | Los importes no cuadran | «ARCA no aceptó los importes. Es un problema nuestro: ya lo estamos viendo.» (bug: se loguea) | — |
| `arca_in_flight` | lease de voucher ocupado | Hay otra factura emitiéndose | «Esperá unos segundos y volvé a intentar.» | — |
| `arca_unknown_state` | timeout y la reconciliación también falla | No sabemos si se emitió | «ARCA no contestó y no pudimos confirmar si la autorizó. **No la vuelvas a emitir**: la verificamos sola en unos minutos.» | — |
| `arca_authorized_not_posted` | `acc_post_bundle` falló después del CAE | Emitida, pero falta en los libros | «ARCA autorizó la Factura B 0005-00000105 (CAE …), pero no pudimos cargarla en los libros: {motivo}. Tocá *Cargarla ahora*.» | — |
| `arca_busy` | lease del TA ocupado por más de 9 s | ARCA está ocupado | «Reintentá en unos segundos.» | — |

### 2.8 Tests sin red (Vitest, `environment: node`)

**Fixtures generados una vez con OpenSSL** (script `scripts/arca/make-fixtures.sh`, se corre a mano y se commitean los archivos en `tests/fixtures/arca/`):

```bash
# CUIT sintéticas con dígito verificador válido: persona 20-12345678-6, SAS 30-71234567-1
openssl genrsa -out test.key 2048 && openssl genrsa -out other.key 2048
openssl req -new -key test.key -subj "/C=AR/O=Bar de Prueba SAS/CN=plataformatest/serialNumber=CUIT 20123456786" -out openssl.csr
openssl req -x509 -key test.key -in openssl.csr -days 3650 -out test.crt          # autofirmado (mismo subject)
openssl x509 -in test.crt -outform DER -out test.crt.der
# tra.xml: TRA fijo (uniqueId y fechas fijas), escrito a mano en la carpeta de fixtures.
openssl cms -sign -in tra.xml -signer test.crt -inkey test.key -nodetach -outform DER -out openssl.cms.der
# A mano, una vez: validar el CMS que genera NUESTRO código.
#   npx tsx scripts/arca/emit-cms-fixture.mts > our.cms.der
#   openssl cms -verify -inform DER -in our.cms.der -noverify   → «CMS Verification successful»
```

**Por qué hay CUIT de prueba de 20 y de 30:** WSASS emite el certificado a la persona y en producción va la SAS; el código tiene que manejar las dos.

**Archivos de test y qué verifican:**

| Archivo | Qué verifica |
|---|---|
| `tests/lib/arca-der.test.ts` | Ida y vuelta de TLV, `INTEGER` con bit alto, OID multibyte, orden de `SET OF` |
| `tests/lib/arca-csr.test.ts` | `buildCsr` con `test.key`: estructura PKCS#10, tipos de cada RDN, `serialNumber = 'CUIT 20123456786'` y firma verificada con `crypto.verify('sha256', certificationRequestInfo, spki, signature)`. Rechaza una CUIT inválida |
| `tests/lib/arca-cert.test.ts` | `inspectCertificate` en PEM y en DER (CUIT, CN, fechas), `classifyUpload` (crt, csr, key, basura) y clave coincidente o no (`other.key`) |
| `tests/lib/arca-cms.test.ts` | `signTra` con un `now` fijo: tipos de contenido, digest sha256, `eContent` igual al TRA, certificado incluido, `sid` igual a issuer + serial copiados del certificado, `messageDigest = sha256(TRA)` y la firma RSA verificada sobre el DER del `SET` (tag `0x31`). Es determinístico. `buildTra`: ventana ±10 min, ISO con `Z` y validación del servicio |
| `tests/lib/xml-mini.test.ts` | Entidades, CDATA, prefijos, repetidos como arrays |
| `tests/lib/arca-wsaa.test.ts` | Faults reales capturados en la investigación (`cms.cert.untrusted`, `cms.bad.base64`) → `ArcaFault.code`. `loginTicketResponse` del manual (cap. 6.2) con entidades escapadas. `decodeTokenRelations` con un SSO sintético |
| `tests/lib/arca-wsfe.test.ts` | Snapshots de cada builder (orden del WSDL, escape) y el header SOAPAction por método. Parse del `FEDummy` real de producción, del `Err 600` real, de un CAE `A` con `Observaciones`, de un `R` con `Errors`, de `FECompConsultar` y de `FEParamGetPtosVenta` |
| `tests/lib/arca-padron.test.ts` | `parsePersona` con casos RI, monotributo, exento, sin datos, `errorConstancia` y el fault «Token malformado». Tabla de `condicionFromPersona` |
| `tests/lib/arca-importes.test.ts` | Casi 500 casos generados (totales al azar; 21, 10,5, 27, 0 y combinaciones): `ImpTotal = suma`, `ImpNeto = Σ BaseImp`, `ImpIVA = Σ Importe`, `\|iva − r·neto\| ≤ 0,01 × n`. Formato sin `float` (`1234567` → `"12345.67"`) |
| `tests/lib/arca-errors.test.ts` | Cada fixture va a su clave, y cada clave tiene texto y paso |
| `tests/lib/arca-transport.test.ts` | Transporte falso que registra headers y cuerpo. Timeout → `ArcaFault.kind = 'timeout'`; conexión rechazada → `'network'`. Opciones del agente: los `ciphers` solo tienen suites `ECDHE-` y `minVersion: 'TLSv1.2'` |
| `tests/lib/arca-emit.test.ts` | La saga con transporte y RPC falsos: camino feliz, el número cambió → `preview_stale`, timeout → reconciliación (encontrada, no encontrada, falla), rechazo → texto, falla el asiento después del CAE → `arca_authorized_not_posted`, lease ocupado → `arca_in_flight` |

**Datos reales:** las muestras de la investigación (`research/samples*`) tienen CUIT y razones sociales reales de terceros. **No se commitean.** Los fixtures de importadores salen de un generador sintético (WP4).

**Smoke con red, opcional y fuera de CI:** `scripts/arca/smoke.mts` corre `FEDummy` en homologación y en producción y un `WSAA` de homologación con el certificado del desarrollador (desde variables de entorno locales). La prueba que importa —**POST autenticado desde AWS**— se hace con «Probar conexión» en una **preview de Vercel** (§3.2.8).

### 2.9 Región, IP y TLS

- **TLS:**

  ```ts
  // lib/arca/transport.ts
  const arcaAgent = new https.Agent({
    keepAlive: true, maxSockets: 4,
    ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
    minVersion: 'TLSv1.2',
  })
  ```

  - Los requests llevan timeout de **25 s** por llamada y cortan respuestas de más de 2 MB.
  - **Prohibido** tocar `tls.DEFAULT_CIPHERS` o `NODE_OPTIONS`: bajaría la seguridad de Supabase y de Meta en todo el proceso (`arca-tecnico.md` §6.1).
- **No se fija (pin) ningún certificado:** los de ARCA son de Sectigo y rotan (el de `servicios1` vence el 18/10/2026).
- **Región:** las funciones corren en `pdx1` (AWS us-west-2). No se encontró bloqueo geográfico: hubo HTTP 200 desde us-east-1 y us-west-2 (`arca-tecnico.md` §6.3).
- **Si algún día bloquean:**
  - `ArcaTransport` permite cambiar a `relayTransport`, un relay HTTPS mínimo en un VPS con IP argentina, autenticado con HMAC (`ARCA_RELAY_URL` + `ARCA_RELAY_SECRET`), que **solo** reenvía a `*.afip.gov.ar`.
  - No se implementa ahora: queda la interfaz y un test.
  - Las IP estáticas de Vercel no resuelven un bloqueo geográfico.
- **Sin reintentos ciegos** de `FECAESolicitar` (§3.2.4). Las llamadas idempotentes (dummy, último autorizado, consultas, padrón) se reintentan **una** vez ante errores de red.
- **Soporte de ARCA:** las consultas piden fecha, hora e IP de origen. El log de cada llamada guarda método, ambiente, duración y código, sin datos personales.

---

## 3. Usos de ARCA que salen ahora (antes del POS)

### 3.1 «Completar con ARCA» (padrón)

**Dónde aparece:** en todos los lugares donde hoy se carga la CUIT de un proveedor o cliente.

- `components/administracion/cajas-ventas/quick-party-dialog.tsx`: alta rápida de cliente o socio.
- `app/(manager)/[tenantSlug]/administracion/configurar/_components/new-party-dialog.tsx`: puesta en marcha.
- `app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/supplier-data-form.tsx`: ficha del proveedor.
- `app/(manager)/[tenantSlug]/administracion/compras/nueva/_components/purchase-form.tsx`: «proveedor nuevo» en línea (H.5).
- El paso «Proveedores nuevos» del importador de Mis Comprobantes, en lote (§4.1).

**Pieza nueva:** `components/administracion/arca-lookup.tsx` (cliente).

- `ArcaLookupButton({ tenantSlug, cuit, onResult, size })`.
- `useArcaLookup(tenantSlug)` → `{ state, lookup(cuit) }`.
- Botón `variant="outline"` con ícono `BadgeCheck`, al lado derecho del campo CUIT, con el texto «Completar con ARCA». Se habilita cuando `parseCuit(cuit).ok`.
- **Automático:** al salir del campo con una CUIT válida y el nombre vacío, consulta solo.
- Mientras consulta: «Consultando ARCA…» (`aria-live="polite"`).
- Con resultado aparece una tarjeta chica debajo del campo:
  - «✓ Según ARCA: **DISTRIBUIDORA EJEMPLO SA** · Responsable inscripto · Córdoba (Av. … 123)».
  - Botón [Usar estos datos], que completa razón social, condición frente al IVA y domicilio sin pisar lo que la persona ya escribió a mano. Si el nombre estaba vacío, se completa solo.
- **Avisos:**
  - CUIT INACTIVA: `Callout tone="warning"` «ARCA dice que esta CUIT está inactiva: no te sirve su factura para el crédito fiscal».
  - Monotributista: «Es monotributista: te va a hacer Factura C (no da crédito fiscal)».
  - La CUIT no existe: «ARCA no encontró esa CUIT. Revisá los números».
- **Sin ARCA conectado:** el botón no se muestra. En su lugar va un link discreto «Conectá ARCA para completar esto solo», que lleva a `?tab=arca`.

**Servidor:** `lookupCuit(slug, { cuit, purpose })`.

1. `authorizeAccounting(slug, 'write')`.
2. Rate limit en memoria con `rateLimit({ key: 'arca-padron:' + tenantId, limit: 30, windowMs: 60_000 })` (`lib/rate-limit.ts`).
3. Caché: `acc_arca_padron_cache` (lectura por RLS de lectores) con `fetched_at` de menos de **30 días**. Si está, se devuelve con `source: 'cache'`.
4. Si no está: `openArcaSession(auth, 'produccion')`, o `'homologacion'` si es lo único conectado (el resultado se marca «datos de prueba»). Después `getPersona_v2(represented_cuit, cuit)` → `parsePersona` → `condicionFromPersona`.
5. RPC `acc_arca_padron_cache_put(p_tenant_id, p_environment, p_rows)`.
6. Devuelve:

```ts
type PadronLookupResult =
  | { ok: true; data: {
      cuit: string; name: string; personKind: 'fisica' | 'juridica'; active: boolean
      ivaCondition: IvaCondition                    // acc_parties.iva_condition
      condicionIvaReceptorId: number | null         // para WSFE (1, 4, 5, 6, 13, 15, 16…)
      monotributoCategory: string | null
      address: string | null; locality: string | null; province: string | null
      activity: { code: string; description: string } | null
      source: 'arca' | 'cache'; environment: 'produccion' | 'homologacion'; fetchedAt: string } }
  | { ok: false; code: 'arca_not_connected' | 'invalid_cuit' | 'not_found' | 'arca_unavailable'
                      | 'arca_not_authorized' | 'rate_limited' | 'forbidden'; message: string }
```

**Mapeo de la condición:**

| Padrón | `iva_condition` | `CondicionIVAReceptorId` |
|---|---|---|
| Impuesto 30 (IVA) activo | `responsable_inscripto` | 1 |
| Monotributo (impuesto 20/21) activo | `monotributo` | 6 (13 y 16 no se distinguen bien: A CONFIRMAR, `arca-tecnico.md` §5.3. La emisión deja elegirlo a mano) |
| Impuesto 32 (IVA exento) | `exento` | 4 |
| Impuesto 34 (IVA no alcanzado) | `no_alcanzado` | 15 |
| Nada de lo anterior | `sin_datos` (persona: `consumidor_final`) | 5, a confirmar por la persona |

**Privacidad:** el padrón de una persona humana trae su nombre (dato personal).

- La caché es **por bar** (tabla `acc_*` con `tenant_id`) y no se loguea ni la CUIT ni el nombre.
- En la ficha del proveedor se muestra «Verificado en ARCA el 08/10/2026» leyendo la caché.

### 3.2 Emitir facturas y notas con CAE desde «Ventas › Factura de venta»

#### 3.2.1 Alcance

- Se emiten: **Factura A (1), ND A (2), NC A (3), Factura B (6), ND B (7) y NC B (8)**.
  - Son los mismos tipos que ya admite `salesInvoiceSchema`, salvo los tiques factura, que son de controlador fiscal.
  - Solo por el punto de venta de la plataforma (`acc_arca_connections.point_of_sale`).
  - Solo en producción, con `emission_enabled = true`.
- **Para qué:** ventas que **no** pasan por el cierre del día de Thinkeon (eventos, catering, sponsoreo).
  - Es el uso que ya documenta la pantalla: «Para las ventas que se facturan aparte del cierre del día».
- Las facturas que ya se hicieron en otro sistema se siguen cargando como hoy, con número a mano.

#### 3.2.2 Cambios de UX en el formulario (`ventas/nueva-factura/_components/sales-invoice-form.tsx`)

Se agregan bloques. El aspecto y las piezas no cambian.

1. **«¿Cómo la facturás?»** (`ChoiceChips`). Solo aparece si la emisión está prendida.
   - Opciones: **«La emito ahora con ARCA»** (por defecto) · «Ya la emití en otro sistema».
   - En el segundo caso, el formulario queda exactamente como hoy.
2. **Modo ARCA:**
   - **Punto de venta:** texto fijo «0005 · Plataforma (ARCA)».
   - **Número:** «Lo asigna ARCA · próximo **0005-00000104**». Se carga con `getArcaNextNumber` al abrir y al cambiar el tipo. Mientras carga, `Skeleton`; si falla, «No pudimos consultar ARCA [Reintentar]».
   - **Fecha:**
     - `min = max(hoy − 5, última fecha emitida, primer día abierto)` y `max = hoy`.
     - Con Concepto 1, ARCA acepta hasta 5 días para atrás y no antes del último comprobante del mismo tipo (`arca-tecnico.md` §4.3). Hacia adelante se limita a hoy, más conservador.
   - **Letra:** se elige sola según la condición del cliente y lo que haya habilitado (`allowed_classes`).
     - **A:** responsable inscripto, monotributo, monotributo social y monotributo promovido (1, 6, 13, 16).
     - **B:** el resto (4, 5, 7, 8, 9, 10, 15).
     - Si corresponde A y no está habilitada, va un aviso con el link a la guía (paso 3). Por RG 5003/2021, a un monotributista le corresponde A; con A común no habilitada no se puede emitir.
     - Este cambio **corrige `letterFor()`**, que hoy devuelve B para monotributo.
     - **A con leyenda** («Operación sujeta a retención», código 51, o «Pago en CBU informada»): la v1 **no las emite**. El 51 exige además que `adoc_voucher_kind` acepte `factura_m` en ventas (una migración) y la de CBU puede pedir datos opcionales (A CONFIRMAR, P-T14). Si `allowed_classes` no trae `'A'`, la plataforma ofrece solo B y explica por qué.
   - **«Condición frente al IVA del cliente»:** `Select` obligatorio con las 11 opciones de RG 5616, precargado desde el cliente (`condicionFromIvaCondition`). Si el cliente está en `sin_datos`, hay que elegirla.
   - **«Concepto»:** Productos / Servicios / Productos y servicios. Por defecto, el de `default_concepto` (1). Con 2 o 3 aparecen «Período del servicio» (desde y hasta) y «Vence el pago», que son obligatorios para ARCA (10049). Qué concepto corresponde a cada caso lo define la contadora (A CONFIRMAR).
   - **«Detalle para la factura»:** textarea obligatorio de 3 a 500 caracteres, por ejemplo «Servicio de catering para 40 personas, evento del 12/10». Va impreso en la factura; WSFEv1 no lleva ítems (§3.2.6).
   - **Cliente:**
     - El `PartyCombobox` de siempre, más una fila fija **«Consumidor final (sin identificar)»** que usa el partícipe de sistema `consumidor_final` (`acc_ensure_final_consumer`).
     - Solo para B y por debajo del monto que obliga a identificar al consumidor final. La normativa dice $10.000.000 (RG 5700/2025); el valor exacto que valida el WS está A CONFIRMAR.
     - El alta rápida trae «Completar con ARCA».
3. **Validación en línea, antes de habilitar el botón:**
   - La A exige CUIT y condición 1, 6, 13 o 16.
   - La B anónima tiene el tope.
   - La fecha tiene que estar en la ventana.
   - NC y ND exigen elegir la factura (emitida por la plataforma) que corrigen.
4. **Botón** «Emitir Factura B · $ 12.100» → `AlertDialog`:
   - Título: «¿Emitimos la factura?».
   - Resumen: tipo, cliente, total y fecha.
   - Texto: «Una vez emitida no se borra: si hay un error, se anula con una nota de crédito».
   - Botones [Cancelar] [Emitir]. Mientras corre: «Pidiendo el CAE a ARCA…».
5. **Resultado OK:**
   - `toast.success('Factura B 0005-00000104 emitida · CAE 76412345678901')`.
   - Lleva a `/administracion/comprobantes/[id]`, que muestra la tarjeta «Autorización de ARCA» y el botón **[Imprimir factura]**.

#### 3.2.3 Entrada de la acción

```ts
// lib/arca/schemas.ts
export const arcaEmitSchema = salesInvoiceSchema            // mismos campos y reglas que hoy (centavos, alícuotas, collectNow…)
  .safeExtend({
    arca: obj({
      predictedNumber: voucherNumberField,                   // el que vio la persona (entra al hash vía `number`)
      condicionIvaReceptorId: z.number().int().refine((n) => CONDICION_IDS.has(n)),
      concepto: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
      serviceFrom: optionalIsoDay.default(null), serviceTo: optionalIsoDay.default(null), paymentDue: optionalIsoDay.default(null),
      detail: z.string().trim().min(3).max(500),
      relatedVoucherId: uuidField().nullable().default(null),  // NC/ND: el acc_arca_vouchers de la factura
    }),
  })
  .superRefine(/* tipo ∈ {factura_a,…,nota_credito_b} sin tiques; number === arca.predictedNumber;
                  concepto 2|3 ⇒ fechas de servicio; NC/ND ⇒ relatedVoucherId; A ⇒ condición ∈ {1,6,13,16};
                  B ⇒ condición ∈ {4,5,7,8,9,10,15} */)
```

**Por qué el número entra al hash:**

- La vista previa del navegador se arma con `number = predictedNumber`.
- Si en el servidor ARCA dice otro número, el hash no coincide y se devuelve `preview_stale` con la propuesta nueva, igual que hoy.
- En la práctica no pasa: el punto de venta es exclusivo de la plataforma.

#### 3.2.4 La saga de emisión (`lib/arca/emit.ts`)

```
emitSalesVoucher(slug, raw):
 1  auth = authorizeAccounting(slug, 'write')
    conn = conexión de producción; exigir status = 'connected' y emission_enabled; la letra tiene que estar en allowed_classes
 2  input = arcaEmitSchema.parse(raw); exigir pointOfSale === conn.point_of_sale
 3  { ctx, firstOpenDate } = loadDocumentContext(auth.tenantId, refs)       // contexto DESDE LA BASE
    built = buildSalesInvoice(input con number = predictedNumber)          // el mismo builder de hoy
    si built.hash ≠ input.previewHash → preview_stale (vista previa + hash nuevos)
    avisos del motor sin aceptar → needs_confirmation
 4  chequeos fiscales locales (no gastan una llamada a ARCA):
      documento del receptor (80/86/96/99 según tax_id_type), condición vs letra, tope de la B anónima,
      ventana de fecha, checkWsfeAmounts(wsfeAmounts(fiscal voucher del bundle)),
      NC/ND: relatedVoucher autorizado, del mismo tipo de letra y del mismo cliente
 5  reserva = RPC acc_arca_voucher_reserve(tenant, 'produccion', pv, cbteTipo, { form: input sin meta, total, issueDate })
      → { voucher_id, client_ref }                          (client_ref = la idempotencia del asiento)
      → 'arca_in_flight' si hay otra emisión viva para ese PV y tipo (índice único parcial)
      → { needs_reconcile: voucher_id } si quedó una colgada hace más de 3 min → reconcile(voucher_id) y reintentar la reserva una vez
 6  last = wsfe.ultimoAutorizado(pv, cbteTipo); next = last + 1
    si next ≠ predictedNumber → RPC update(voucher → 'abandoned', reason 'number_changed')
                                → preview_stale con build(number = next) y su hash, más el texto «Ahora el número es 0005-00000105»
 7  req = caeRequest(built.fiscalVoucher, party, input.arca, next)        // Concepto, DocTipo/DocNro, CbteFch (fecha en Córdoba),
                                                                            // importes de wsfeAmounts, MonId PES, MonCotiz 1,
                                                                            // CondicionIVAReceptorId SIEMPRE, CbtesAsoc en NC/ND
    RPC update(voucher → 'requesting', number = next, request = req, request_sha256)
 8  try   res = wsfe.caeSolicitar(req)              // timeout 25 s, SIN reintento automático
    catch (red, timeout, 5xx, fault de protocolo):
          RPC update(→ 'needs_reconcile')
          r = wsfe.compConsultar(cbteTipo, pv, next)   // el manual: consultar antes de reenviar
          · está y Resultado = A → seguir en 9 como autorizada (CAE = CodAutorizacion)
          · error 602 «no existe»  → RPC update(→ 'failed') → 'arca_unavailable' («la factura NO se emitió, probá de nuevo»)
          · la consulta también falla → queda en needs_reconcile → 'arca_unknown_state' («no la vuelvas a emitir»)
 9  res.resultado = 'A' → RPC update(→ 'authorized', cae, caeDue, observaciones, eventos, fchProceso)
    res.resultado = 'R' → RPC update(→ 'rejected', errores u observaciones) → classifyArcaError → texto (§2.7)
10  post = acc_post_bundle(tenant, client_ref, toRpcPayload(built.bundle, built.hash))
      OK    → RPC update(→ 'posted', document_id)
      error → queda 'authorized' sin documento → 'arca_authorized_not_posted' con el motivo (mapAccError)
11  revalidateAdministracion(slug) → { ok: true, result: { documentId, cae, label } }
```

**Notas:**

- No hay lock de base durante las llamadas HTTP. La exclusión la da el **índice único parcial** de vouchers vivos por (bar, ambiente, PV, tipo). Así se evitan el 10016 y el 502 «Transacción activa» (`arca-tecnico.md` §4.11).
- El asiento es **el mismo que hoy** para `sales_invoice`, `sales_debit_note` y `sales_credit_note` (E.5.9): D Deudores por ventas [cliente] / H Ventas «canal»: facturadas / H IVA débito fiscal por alícuota.
  - «Ya la cobraste» sigue armando `[sales_invoice, collection]` con la imputación.
  - La CAE no va al asiento: vive en `acc_arca_vouchers` (vinculada por `document_id`) y se muestra en el comprobante.
- La refactorización mínima de `post-document.ts` consiste en exportar `postBuiltBundle(op, slug, tenantId, clientRef, built, ctx)`, el paso 6–8 de hoy que ya mapea errores y avisos de la base. Así la saga no duplica ese código. Lo toca solo WP9.

#### 3.2.5 Estados de `acc_arca_vouchers` y cómo se recupera cada uno

| Estado | Qué significa | Qué ve la persona | Recuperación |
|---|---|---|---|
| `reserved` | Lease tomado, todavía sin pedir el CAE | — (dura milisegundos) | A los 3 min, la próxima reserva lo pasa a `abandoned` |
| `requesting` | Se mandó `FECAESolicitar` | «Pidiendo el CAE…» | Si la función murió, en la próxima reserva o en `reconcile` → `FECompConsultar` |
| `needs_reconcile` | No sabemos si ARCA la autorizó | `Callout` en Ventas: «La Factura B 0005-00000105 está en verificación. **No la vuelvas a emitir.** [Verificar con ARCA]» | `reconcileArcaVoucher`: también se dispara solo al abrir Ventas o la pestaña ARCA |
| `authorized` | Tiene CAE y no tiene asiento | `Callout` destructivo: «Emitida en ARCA pero no cargada en los libros. [Cargarla ahora]» | `postAuthorizedArcaVoucher`: muestra el asiento (vista previa del servidor) y lo guarda con el mismo `client_ref`. Si el mes se cerró, la fecha contable va al primer día abierto (regla H.5) |
| `posted` | Tiene CAE y asiento | Normal | — |
| `rejected` | ARCA la rechazó (sin CAE) | El error en palabras simples | Corregir y volver a emitir (es otra fila) |
| `failed` | No se emitió (confirmado) | «No se emitió» | Volver a intentar |
| `abandoned` | Se canceló antes de pedir el CAE | — | — |

La lista de vouchers con problemas sale de `getArcaOverview` y aparece también en la lista «Para atender» del Resumen (§5.2.4).

#### 3.2.6 La factura impresa (representación)

- **Ruta:** `app/print/factura/[tenantSlug]/[documentId]/page.tsx`.
  - Fuera del shell, como las demás `/print/*`; `print` ya es un slug reservado del proxy.
  - Acceso: `requireAccountingAccess(tenantSlug, 'read')`. Lee `acc_documents`, `acc_fiscal_vouchers`, `acc_arca_vouchers` y `acc_settings` por RLS de lectores; no hace falta `service_role`.
  - Botón «Imprimir o guardar PDF» (`window.print()`) y CSS A4 (`@page { size: A4; margin: 12mm }`).
- **Contenido** (RG 1415 y lo relevado en `arca-tecnico.md` §4.7 y §4.12):
  - Recuadro con la letra y el código («B · Cód. 006») y la leyenda «ORIGINAL».
  - Datos del emisor: razón social, domicilio comercial (`fiscal_address`), «IVA Responsable Inscripto», CUIT, Ingresos Brutos e inicio de actividades.
  - Punto de venta y número (`0005-00000104`) y fecha de emisión.
  - Receptor: documento, nombre, condición frente al IVA y domicilio (si lo hay; obligatorio en las A).
  - Detalle (`arca.detail`) con su importe.
  - Subtotales:
    - En las A: neto por alícuota, IVA por alícuota, no gravado, exento y total.
    - En las B: solo el total.
  - **Leyendas:**
    - B a consumidor final: «Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)» con «IVA Contenido: $ X» y «Otros Impuestos Nacionales Indirectos: $ 0» (RG 5614/2024). Si ese último renglón se muestra solo cuando es mayor a cero, y qué le corresponde a HUB, queda A CONFIRMAR con la contadora.
    - A a monotributista (condición 6, 13 o 16): «El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618».
  - «CAE N° 76412345678901 · Vto. CAE 18/10/2026».
  - **QR** (con `qrcode`, que ya está en `package.json`):
    - URL: `https://www.arca.gob.ar/fe/qr/?p=<base64(JSON)>`.
    - JSON versión 1: `{ver:1, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda:'PES', ctz:1, tipoDocRec?, nroDocRec?, tipoCodAut:'E', codAut}`.
    - Entre `www.arca.gob.ar` y `www.afip.gob.ar`, y si van `tipoDocRec` y `nroDocRec` con documento 99: A CONFIRMAR (`arca-tecnico.md` §4.12).
- Mandar la factura por mail o WhatsApp queda para después: la persona descarga el PDF y lo envía.

#### 3.2.7 Notas de crédito y débito

- En la v1 se pueden emitir **solo contra comprobantes emitidos por la plataforma**.
  - `relatedVoucherId` → `CbtesAsoc` = `{ Tipo, PtoVta, Nro, Cuit: represented_cuit, CbteFch }`.
  - En los libros sigue `relatedDocumentId` (la NC se imputa sola contra la factura, como hoy).
- Para anular una factura hecha en Thinkeon se usa Thinkeon. Asociar NC a comprobantes de otros puntos de venta (observación 10041) queda para el POS.

#### 3.2.8 Primero homologación (plan de smoke)

1. **studiOS** adhiere WSASS con su CUIT personal y crea el certificado y la autorización a `wsfe` y a `ws_sr_constancia_inscripcion` representando a la CUIT de la SAS, o a la propia para no confundir (`arca-pasos.md` §6).
2. En el **bar demo** (`demo-administracion`), en Ajustes › ARCA › «Pruebas (homologación)», genera el CSR, sube el certificado de WSASS y elige un punto de venta.
3. **Desde una preview de Vercel** (`pdx1`) aprieta «Probar conexión». Esto confirma el POST autenticado desde AWS, que la investigación dejó pendiente.
4. Aprieta «Emitir una factura de prueba» (B, consumidor final, $121). Se repite con una A a una CUIT de prueba y con una NC B. Se verifica el CAE y que `acc_arca_vouchers` quede `authorized` y **sin asiento** (homologación nunca contabiliza: `check environment = 'produccion' or document_id is null`).
5. Recién entonces los socios hacen la guía de producción.
   - El smoke de producción es **«Probar conexión»**, sin factura: no se emiten comprobantes reales de prueba porque después habría que anularlos.
   - La primera emisión real es la primera venta suelta real. Antes de eso se prende el interruptor.

### 3.3 Qué sale ahora y qué espera al POS

| Capacidad | Ahora | Con el POS |
|---|---|---|
| Conexión con ARCA, prueba, aviso de vencimiento del certificado | ✓ | — |
| «Completar con ARCA» en altas y en el importador | ✓ | En el alta rápida del cliente en caja |
| Facturas, ND y NC **sueltas** con CAE (eventos, catering) + impresión A4/PDF con QR | ✓ (producción después de homologar) | — |
| Factura B por ticket o mesa al cobrar | ✗ (sigue Thinkeon) | ✓ |
| Emisión automática y en segundo plano con reintentos, CAEA de contingencia, lotes | ✗ | ✓ |
| Ticket de 80 mm y envío por WhatsApp o mail | ✗ | ✓ |
| NC contra comprobantes de otro sistema | ✗ | ✓ |
| Importar «Mis Comprobantes Emitidos» para completar lo facturado del cierre del día | Fase 4, recomendado (§4.4) | Lo reemplazan las ventas propias |
| Constatación WSCDC de comprobantes cargados a mano | Después | — |
| Chequeo semanal de proveedores apócrifos (APOC, archivo público) | Después (§8) | — |

---

## 4. Importadores para cortar la carga manual

### 4.0 Arquitectura común (los tres importadores)

```
 [Archivo]                                              (navegador: lib/imports/*, puro)
    │  detectar fuente → decodificar (UTF-8 / Windows-1252) → ZIP/XLSX/CSV → encabezados → filas
    │  normalizar (centavos sin float, fechas en Córdoba, sin datos personales) → SHA-256 del archivo
    ▼
 createImportBatch ──▶ addImportItems (tandas ≤ 800)          (servidor: zod estricto, clave natural, duplicados)
    │                         └─▶ acc_import_batches / acc_import_items
    ▼
 buildImportProposals (contexto DESDE LA BASE + build* del motor + previewDocumentForm → hash)
    │                         └─▶ acc_import_proposals (valores del formulario + preview_hash + client_ref)
    ▼
 [Revisar]  la persona completa lo que falta (cuenta habitual, tipo de percepción, proveedor, «no es nuestro»)
    ▼
 postImportProposals (tandas de 15) ──▶ por cada una: rebuild + comparar hash ──▶ acc_post_bundle (1 comprobante)
                                                                               └─▶ acc_import_mark_posted
```

**Rutas y entradas:**

| Ruta (`app/(manager)/[tenantSlug]/administracion/…`) | Qué es |
|---|---|
| `importar/page.tsx` | **Hub «Importar»**. Tres tarjetas (estilo grilla de `configuracion/page.tsx`): «Comprobantes recibidos de ARCA», «Mercado Pago» y «Banco». Cada una muestra la última importación, lo pendiente de revisar y un botón [Importar]. Abajo, «Historial» (`DataTable`): fecha, origen, archivo, período, nuevas, ya cargadas, para revisar, cargadas, estado y quién |
| `importar/arca/page.tsx` | Paso 1 de Mis Comprobantes: zona para soltar el archivo y «¿Cómo lo bajo?» (§5.1.4) |
| `importar/mercado-pago/page.tsx` | Paso 1 de Mercado Pago: configuración (una vez) y subir el CSV. Después, conexión por token (fase 3) |
| `importar/banco/page.tsx` | Paso 1 del banco: elegir la cuenta, subir el archivo y, si el formato es nuevo, mapear las columnas |
| `importar/[batchId]/page.tsx` | **Revisar y confirmar** un lote (los tres orígenes comparten la página; cambian las columnas) |

- **Entradas contextuales:**
  - Compras: botón «Importar de ARCA» en el encabezado de `compras/page.tsx`, junto a «Nueva factura» (el encabezado se ve desde `lg`; en el celular se llega por el hub, el Resumen o ⌘K).
  - Cajas: en `cajas-header-actions.tsx`, «Más ▾» suma «Importar Mercado Pago» e «Importar movimientos del banco».
  - El Resumen muestra los lotes pendientes (§5.2.4), y ⌘K suma tres entradas.
- **Pestañas de sección:** el hub no agrega pestaña. La barra de Administración tiene `showWhenNoneActive: true` y se ve sin ninguna activa, como en Ajustes.
- **Contadora:** ve el hub y el historial en solo lectura (`ReadOnlyNotice` en las rutas de carga).

**Archivos puros (`lib/imports/*`, sin `server-only`; corren igual en el navegador, en el servidor y en el cron):**

| Archivo | Exporta |
|---|---|
| `bytes.ts` | `decodeText(bytes): { text; encoding: 'utf-8'\|'windows-1252' }` (UTF-8 estricto y, si falla, Windows-1252; saca el BOM; detecta mojibake) |
| `csv.ts` | `sniffDelimiter(firstLine)` (`;` `,` `\t` `\|` fuera de comillas) · `parseCsv(text, delim): string[][]` (comillas `""`, CRLF/LF) |
| `zip.ts` | `listZip(bytes)` · `readZipEntry(bytes, name, inflateRaw: (u8) => Promise<Uint8Array>)`. Lee el directorio central y descomprime con métodos 0 (store) y 8 (deflate). El que descomprime se inyecta: `DecompressionStream('deflate-raw')` en el navegador y `zlib.inflateRawSync` en Node |
| `xlsx.ts` | `readFirstSheet(bytes, inflateRaw): Cell[][]` con **valores crudos** (`sharedStrings`, `inlineStr`, números y fechas seriales). Usa `lib/xml/mini.ts`. Los `.xls` BIFF (`D0 CF 11 E0`) se rechazan con «Guardalo como CSV»; los `.xls` que en realidad son HTML van a `html-table.ts` |
| `html-table.ts` | `readHtmlTable(text): string[][]` (para exports de banco «.xls» que son HTML; A CONFIRMAR con una muestra de NE24) |
| `hash.ts` | `sha256Hex(bytes)`: Web Crypto si existe y, si no, SHA-256 puro. En HTTP de red local `crypto.subtle` no existe (el mismo problema que ya resolvió `lib/accounting/preview.ts`) · `uuidV8FromSha256(text)` (los primeros 16 bytes del SHA-256 con versión 8 y variante RFC 9562: el `client_ref` determinístico) |
| `amounts.ts` | `parseAmountToCents(raw, decimal: ',' \| '.' \| 'auto'): number \| null`. Sin `float`, rechaza notación científica («archivo pasado por Excel»), acepta `1.234,56-`, `(1.234,56)` y `$` |
| `dates.ts` | `toIsoDay(raw)` (ISO, `d/m/aaaa`, `d/m/aa`, `AAAAMMDD`, serial de Excel) · `instantToCordobaDay(iso, cutoffHour)` (lee el offset del texto y pasa a `America/Argentina/Cordoba`) |
| `headers.ts` | `normalizeHeader(s)` (NFD, minúsculas, sin palabras vacías, `10,5` → `10.5`; `arca-mis-comprobantes.md` §9.2) |
| `detect.ts` | `detectSource({ bytes, fileName }): 'arca_recibidos' \| 'arca_emitidos' \| 'portal_iva_compras' \| 'mp_release' \| 'mp_settlement' \| 'bank' \| 'unknown'` |
| `arca/mis-comprobantes.ts` | `parseMisComprobantes(rows, meta): { generation: 'g1'\|'g2'\|'g3'; kind: 'recibidos'\|'emitidos'; titleCuit; items: McItem[]; rowErrors }`. Es el port de `research/scripts/mc-parse.ts`, validado contra 2.146 filas reales: G1, G2, G3, Excel, variante «del Emisor», CAE en notación científica y Windows-1252 |
| `mercadopago/release.ts` | `parseReleaseReport(rows, ctx: { sasCuit; ownCbus: string[]; cutoffHour }): { items: MpItem[]; initialBalance; finalBalance; fileChecks }` |
| `bank/statement.ts` | `parseBankStatement(rows, layout?): { items: BankItem[]; layoutSignature; needsMapping; balanceCheck }` |
| `bank/rules.ts` | `DEFAULT_BANK_RULES` (las 21 de `banco.md` §2.10, con tests de `banco-scripts/check-rules.mjs`) · `classifyBankItem(item, rules): Classification` |
| `bank/grouping.ts` | `groupDailyCharges(items)`: madre e hijas del mismo día por proporción (comisión → IVA 21 % o 10,5 % → percepción 3 %; crédito → 25.413 al 0,6 %) |
| `types.ts` | `McItem`, `MpItem`, `BankItem`, `ImportSource`, `ProposalForm` (abajo) |

**Formas normalizadas** (el servidor las vuelve a validar con zod `.strict()`: una clave de más se rechaza, y así no entra ningún dato personal):

```ts
type McItem = { kind: 'mc'; issueDate: IsoDate; code: number; pointOfSale: number; number: number; numberTo: number
  authCode: string | null; issuerCuit: string; issuerName: string; receiverDocType: number | null; receiverDoc: string | null
  currency: string; fxRate: string /* decimal exacto, «1475,006» → "1475.006" */
  net: Record<'r0'|'r25'|'r5'|'r105'|'r21'|'r27', Cents>; vat: Record<'r25'|'r5'|'r105'|'r21'|'r27', Cents>
  nonTaxed: Cents; exempt: Cents; otherTaxes: Cents; vatTotal: Cents; total: Cents; generation: 'g1'|'g2'|'g3' }

type MpItem = { kind: 'mp'; rowKey: string; sourceId: string | null; recordType: string; description: string
  releasedAt: string; approvedAt: string | null; businessDate: IsoDate
  netCredit: Cents; netDebit: Cents; gross: Cents /* con signo */; mpFee: Cents; financingFee: Cents; couponCents: Cents
  taxes: Cents; taxesDetail: Array<{ entity: string; detail: string; amount: Cents }>; balanceAfter: Cents | null
  channel: 'qr'|'point'|'link'|'transfer_in'|'payout_own'|'payout_third'|'yield'|'iibb_later'|'perception'
         |'refund'|'chargeback'|'reserve'|'tip'|'loan'|'fee_advance'|'digital_change'|'other'
  signals: Partial<Record<'operationTags'|'subUnit'|'businessUnit'|'poiId'|'posId'|'storeId'|'paymentMethodType'|'paymentMethod', string>>
  payoutLast4: string | null; payoutIsOwn: boolean | null; fromOwnCuit: boolean | null; externalReference: string | null }

type BankItem = { kind: 'bank'; date: IsoDate; valueDate: IsoDate | null; description: string; voucher: string | null
  amount: Cents /* + crédito, − débito */; balance: Cents | null; counterpartyCuit: string | null; counterpartyName: string | null
  reference: string | null; ordinal: number; direction: 'columns'|'sign'|'dc'|'balance_diff'|'text'; balanceOk: boolean | null }
```

- `fromOwnCuit` y `payoutIsOwn` se calculan **en memoria** dentro del parser, comparando `PAYER_ID_NUMBER` con la CUIT de la SAS y `PAYOUT_BANK_ACCOUNT_NUMBER` con los CBU/CVU propios. El valor original no sale del navegador.
- Del número de cuenta destino se guardan solo los últimos 4 dígitos (`mercadopago.md` §4.5).

**Idempotencia, en cuatro capas:**

1. **Archivo:** único por (bar, origen, SHA-256) entre lotes no cancelados. El aviso dice: «Ya importaste este archivo el 03/10 (Nacho). [Ver esa importación]».
2. **Fila:** clave natural única entre filas vivas, con `source_family` (índice único parcial). Una fila repetida queda `duplicate` con `duplicate_of` y no se vuelve a proponer.
   - Mis Comprobantes: `mc:R:<cuit emisor>:<código>:<pv>:<número>`. Siempre con el **código ARCA**, nunca la letra, y sin usar el CAE, que en CAEA se repite (`arca-mis-comprobantes.md` §8).
   - Mercado Pago: `mp:<sha256(SOURCE_ID|DESCRIPTION|RECORD_TYPE|DATE|NET_CREDIT|NET_DEBIT|GROSS)>` (`mercadopago.md` §4.5).
   - Banco: `bank:<caja>:<sha256(fecha|importe|descripción normalizada|comprobante|saldo)>:<ordinal>`.
3. **Comprobante:** `client_ref = uuidV8FromSha256('acc-import:' + tenantId + ':' + proposalKey + ':' + attempt)` (versión 8 de RFC 9562: `z.uuid()` de zod 4 la acepta).
   - Un reintento devuelve lo ya guardado (`replayed`).
   - Si la propuesta cambió, la base devuelve `idempotency_conflict` → la propuesta pasa a `error`: «Ya se cargó con otros datos».
   - Si el comprobante se anuló después y hay que cargarlo de nuevo, `attempt + 1`.
4. **Contra lo cargado a mano:**
   - Compras: coincidencia fuerte (proveedor + tipo + PV + número) y débil (proveedor + total + fecha ±3 días). Es la lógica de `acc_possible_duplicate`, en una RPC por lote: `acc_import_match_purchases`.
   - Transferencias: mismas cajas, mismo importe y ±3 días contra `transfer` ya contabilizadas. Cubre que el retiro de Mercado Pago aparezca en los dos importadores (§4.3.4).
   - **Mercado Pago contra «Ajustar saldo» o cobros cargados a mano:** si en el período del lote ya hay `collection` o `treasury_adjustment` de Mercado Pago cargados a mano (el circuito de hoy, E.5.8), esos días **no se proponen**. Se marcan «Ya registrados a mano entre el 01/10 y el 05/10: importá desde el 06/10 o anulá lo manual». Si no, la partida «a acreditar» ya estaría cancelada y el cobro importado quedaría duplicado como saldo a favor.
   - **Banco contra gastos bancarios cargados a mano:** misma cuenta, mismo día y mismo total contra `bank_expense` existentes → «Ya registrado».

**Estados:**

| Fila (`acc_import_items.status`) | Propuesta (`acc_import_proposals.status`) |
|---|---|
| `new`, `duplicate`, `ignored` («no es nuestro», se recuerda por clave), `review`, `posted`, `cancelled` | `needs_input` (falta algo: `needs` lo dice), `ready` (tiene `preview_hash`), `posting`, `posted`, `stale` (cambió algo en la base: vista previa nueva), `error`, `skipped` |

**Confirmar en tandas:**

- `postImportProposals(slug, { batchId, items: [{ key, previewHash }] ≤ 15 })`.
- El cliente llama en bucle y muestra `Progress`: «Cargando 45 de 142…». Se puede cortar y retomar; lo ya cargado se saltea por estado y por `client_ref`.
- Cada propuesta se rearma con contexto fresco. Si el hash difiere, pasa a `stale` y se vuelve a mostrar, igual que `preview_stale`.
- Las tandas chicas hacen que funcione con cualquier límite de duración de funciones del plan de Vercel (A CONFIRMAR en Hobby; §8).
- **No hay «Deshacer» masivo.** Cada comprobante se anula como hoy. «Anular la importación» (anular en lote lo que está en meses abiertos) queda en `BACKLOG.md`.

**Server actions (`lib/imports/actions.ts`):**

- `createImportBatch(slug, { source, fileName, fileSha256, fileSize, detectedFormat, periodFrom, periodTo, treasuryAccountId?, meta })`.
- `addImportItems(slug, { batchId, items })`.
- `buildImportProposals(slug, { batchId })`.
- `resolveImportNeeds(slug, { batchId, changes })`. Cada `change` puede ser:
  - `{ kind: 'supplier_account', partyId | newSupplierKey, accountId }`
  - `{ kind: 'other_taxes_as', proposalKey | partyId, as: 'perc_iibb' | 'perc_iva' | 'internal' | 'account', accountId?, remember }`
  - `{ kind: 'ignore' | 'unignore', itemIds }`
  - `{ kind: 'channel_method', channel, salesMethodId }`
  - `{ kind: 'pick_party', proposalKey, partyId }`
  - `{ kind: 'link_credit_note', proposalKey, documentId }`
  - `{ kind: 'accept_warning', proposalKey, warning }`
- `createImportSuppliers(slug, { batchId, suppliers })`.
- `postImportProposals(slug, { batchId, items })`.
- `cancelImportBatch(slug, { batchId, reason })`.
- `saveImportRule`, `deleteImportRule`, `saveImportLayout`.

Todas empiezan con `authorizeAccounting(slug, 'write')`.

### 4.1 «Mis Comprobantes» (Recibidos) → compras

**Por qué es lo primero:** lo que más tiempo lleva hoy es cargar compras, y casi todas las facturas de proveedores ya están en ARCA.

**Paso 1 · Subir** (`importar/arca`):

- Zona para soltar: «Arrastrá el **ZIP** que bajaste de *Mis Comprobantes › Recibidos*. No lo abras con Excel».
- Acepta `.zip`, `.csv` y `.xlsx`.
- Debajo, plegado, va «¿Cómo lo bajo?» con las maquetas M-03 → M-05 (§5.1.4).
- **Rechaza:**
  - un archivo de **Emitidos** («Este es de *Emitidos*. Acá van los *Recibidos*». En fase 4 se ofrece el otro importador);
  - un CSV abierto con Excel (fechas `d/m/aaaa` o CAE con `E+`): «Subí el ZIP tal cual lo bajaste».
- **Valida** que `Nro. Doc. Receptor` sea la CUIT de la SAS. Si es otra: «Este archivo es de otra CUIT (30-…)».

**Paso 2 · Revisar** (`importar/[batchId]`), en este orden:

1. **Resumen** (`StatCard`): Nuevos · Ya cargados · Para revisar · Ignorados, y el total en pesos del período.
2. **«Proveedores nuevos (N)»**, tabla:
   - Razón social según ARCA · CUIT · Condición (con ARCA conectado viene del padrón por lote, `getPersonaList_v2` de hasta 250; si no, se infiere por la letra: A/M → RI, C → monotributo o exento, B → RI que no le hizo A a HUB).
   - **«¿En qué gastás con él?»** (`AccountCombobox` filtrado a `purchase_selectable`). Viene con una sugerencia según la actividad del padrón (CLAE) y palabras de la razón social: «gaseosas» → Bebidas sin alcohol, «cervecería» → Bebidas con alcohol, «EPEC» → Energía. La sugerencia nunca se aplica sola.
   - Plazo de pago (opcional).
   - Botón **«Crear N proveedores»**, que llama a `saveParty` uno por uno con la cuenta habitual en `default_account_id`.
   - **Casos especiales:** si la CUIT es de Mercado Pago (MercadoLibre S.R.L., 30-70308853-4, A CONFIRMAR) o de un procesador de tarjetas, se ofrece «Es la factura mensual de comisiones de Mercado Pago». Eso le carga la CUIT al partícipe de sistema y propone la compra con `settlesCommissions: true`, el circuito que ya existe para la factura de comisiones ya descontadas (`mercadopago.md` §1.5).
3. **«Comprobantes»** (`DataTable` + tarjetas en el celular):
   - Filtros `SlidingTabs`: Todos · Listos · Para revisar · Ya cargados · Ignorados.
   - Columnas: Fecha · Proveedor · Comprobante (`FA 0003-00110266`) · Va a (cuenta) · Neto · IVA · Otros · Total · Mes del libro · Estado.
   - Acciones por fila: «Ver asiento» (`EntryPreview` en `Sheet`), «No es nuestro» y «Cargarla a mano». Esta última ignora la fila y abre `/compras/nueva` con proveedor, tipo, número, fecha e importes precargados por query string.
4. **Pie fijo:** «Cargar 142 compras · $ 12.345.678» (los botones en el celular tienen 44 px). Antes de cargar se muestra un resumen sin `AlertDialog`, porque no es destructivo y cada comprobante se puede anular: cuántas, total, IVA crédito y meses del libro. Si hay meses cerrados: «12 comprobantes de septiembre (cerrado) se van a cargar el 01/10».

**De la fila a la compra** (`lib/imports/server/proposals/arca.ts`):

| Código ARCA | `voucherType` | Documento |
|---|---|---|
| 1, 2, 3 | `factura_a`, `nota_debito_a`, `nota_credito_a` | `purchase`, `purchase_debit_note`, `purchase_credit_note` |
| 6, 7, 8 | `factura_b`, `nota_debito_b`, `nota_credito_b` | ídem |
| 11, 12, 13 | `factura_c`, `nota_debito_c`, `nota_credito_c` | ídem |
| 51, 52, 53 | `factura_m`, `nota_debito_m`, `nota_credito_m` (etiqueta nueva: «A sujeta a retención») | ídem; el motor pide aceptar el aviso `voucher_m` |
| 81, 82, 83, 111 | `tique_factura_a`, `tique_factura_b`, `tique`, `tique_factura_c` | `purchase` |
| 4, 9, 15 (recibos) | `recibo_a`, `recibo_b`, `recibo_c` | **Para revisar**: «¿Es el recibo de una factura ya cargada (ignorar) o un gasto sin factura?». Lo decide la contadora (A CONFIRMAR, `arca-mis-comprobantes.md` §3.4) |
| 201–213 (FCE), 17/18, 109, 110, 112–117, 54 y otros | — | **Para revisar**: «Este tipo no se importa todavía: cargalo a mano» |

```ts
// Valores de PurchaseValues que arma el importador (mismo esquema que el formulario: purchaseSchema)
{
  docKind, partyId, newParty: null, voucherType, pointOfSale: it.pointOfSale, number: it.number,
  issueDate: it.issueDate, accountingDate: null /* el motor elige el primer día abierto si el mes está cerrado */, dueDate: null,
  amountMode: 'detail', total: null,
  lines: discrimina(voucherType)                               // A, M, tique A: renglones `net` por alícuota
    ? [...netPorAlicuota(it).map(r => ({ role: 'net', accountId, amountCents: r.net, vatRateBp: r.bp })),
       it.nonTaxed && { role: 'non_taxed', accountId, amountCents: it.nonTaxed },
       it.exempt   && { role: 'exempt',    accountId, amountCents: it.exempt }]
    : [{ role: 'gross', accountId, amountCents: it.total - it.otherTaxes - it.exempt - it.nonTaxed }, …],   // B, C y tiques
  vat: discrimina ? alicuotasConIva(it).map(r => ({ vatRateBp: r.bp, adjustCents: 0, givenCents: r.vat })) : [], // «el IVA de la factura»
  perceptions: otrosComo === 'perc_iibb' ? [{ taxKind: 'iibb', amountCents: it.otherTaxes, jurisdictionCode: 904 }]
             : otrosComo === 'perc_iva'  ? [{ taxKind: 'iva', amountCents: it.otherTaxes, jurisdictionCode: null }] : [],
  otherTaxes: otrosComo === 'account' ? [{ accountId: cuentaElegida, amountCents: it.otherTaxes }] : [],
  // otrosComo === 'internal' → un renglón { role: 'internal_tax', accountId, amountCents }
  controlTotalCents: it.total, relatedDocumentId: ncSugerida ?? null,
  settlesCommissions: esFacturaMensualDeComisiones, payNow: null,
  notes: 'Importado de Mis Comprobantes (ARCA)', warningsAck: avisosAceptadosEnLaRevision,
}
```

**Reglas de cada fila:**

- **«Otros Tributos» viene en un solo número** (percepción de IVA, de IIBB, internos o municipales sin discriminar; `arca-mis-comprobantes.md` §6.4).
  - Si es mayor a 0, queda en `needs_input` con botones rápidos: [Percepción IIBB Córdoba] [Percepción IVA] [Impuestos internos] [Otra cuenta…].
  - La casilla «Recordar para este proveedor» guarda una regla en `acc_import_rules` (`source = 'arca_recibidos'`, `match = { party_id }`, `action = { other_taxes_as }`).
  - El CSV de compras de Portal IVA, que sí discrimina, queda como enriquecimiento opcional para una fase posterior (§8).
- **Redondeo de ARCA:** con `|total − componentes| ≤ $1`, el residuo se absorbe en el neto de la alícuota más grande, así `afv_total` cierra exacto. Si es mayor a $1 y positivo, va a «revisar percepciones». Si es negativo, a revisión manual (`arca-mis-comprobantes.md` §6.3).
- **Moneda extranjera:** cada columna se multiplica por `Tipo Cambio` (half-up a centavos) y la fila **siempre** queda para revisar, mostrando la conversión.
- **Condición que no cierra:** si la matriz de `voucherConditionCheck` rechaza (A de un proveedor cargado como monotributo), la fila queda para revisar con la sugerencia del padrón: «ARCA dice que ahora es responsable inscripto: [Actualizar el proveedor]».
- **Avisos del motor:**
  - `voucher_condition` (B de un RI) se explica en la revisión: «Factura B: no da crédito fiscal. Pedile A». Se acepta con la confirmación del lote.
  - `possible_duplicate` queda para revisar con [Es otro, cargalo] [Es el mismo, ignorar].
- **NC:** la vinculación con su factura es solo una **sugerencia** (mismo proveedor, posterior, total menor o igual al pendiente). Se confirma a mano y, si no, la NC queda a favor del proveedor, como hoy.
- **Llegan tarde:** las facturas pueden aparecer hasta 5 o 10 días después de su fecha (`arca-mis-comprobantes.md` §1). La guía dice: «bajá del 1 del mes anterior a hoy, después del día 11». Los solapes son seguros por la clave natural.

**Qué queda a mano:** tiques sin la CUIT de HUB, comprobantes en papel o de contingencia, facturas del exterior, sueldos, impuestos (DDJJ y VEP), gastos sin comprobante y lo que «Para revisar» mande a «Cargarla a mano».

### 4.2 Mercado Pago (reporte de Liquidaciones; después también por API)

**Fuente principal:** el reporte **«Liquidaciones»** (`release_report`), el extracto con saldo inicial, movimientos y saldo corrido. Ojo con el nombre al revés: «Todas las transacciones» es el `settlement_report` (`mercadopago.md` §0).

#### 4.2.1 Configuración (una vez)

En `importar/mercado-pago`, tarjeta «Antes de la primera importación»:

1. **«¿A qué medio del cierre del día corresponde cada canal?»**:
   - QR → «QR Mercado Pago».
   - Point → ¿«Débito» y «Crédito», o un medio propio? Depende de si cobran tarjetas con Point o con Posnet: A CONFIRMAR con el dueño.
   - Transferencias recibidas → «Transferencia».
   - Link de pago → el medio que corresponda.
   - Se guarda en `acc_mp_connections.channel_methods`.
2. **«¿Qué día cuenta para el cobro?»**: día calendario (corte 00:00) o día de servicio (corte 05:00, como el tablero operativo). Lo decide la contadora (A CONFIRMAR) y va a `day_cutoff_hour`.
3. Chequeo de **CBU/CVU propios**: tienen que estar cargados en Ajustes › Cajas (`acc_treasury_accounts.cbu_cvu`) para distinguir un retiro al banco propio de un pago a un tercero.
4. **Guía del reporte**: qué columnas tildar en *Liquidaciones › Configuración* (la lista de `mercadopago.md` §2.2), zona horaria GMT-3, encabezados en inglés y separador coma. Con el token conectado (fase 3), la plataforma aplica esta configuración sola por API (`PUT /v1/account/release_report/config`).

#### 4.2.2 Subir y revisar

- Se sube el **CSV de Liquidaciones** de hasta 60 días. Se parsea en el navegador, porque un reporte de 60 días puede pasar de 4,5 MB.
- **Controles:**
  - por fila: `NET_CREDIT − NET_DEBIT = GROSS + MP_FEE + FINANCING_FEE + SHIPPING_FEE + TAXES`;
  - del archivo: `initial_available_balance + Σ = total`;
  - `Σ TAXES_DISAGGREGATED = TAXES_AMOUNT`, leyendo de forma tolerante el JSON sin comillas que a veces manda Mercado Pago (`mercadopago.md` §1.2).
- Si algo no cierra, la fila queda para revisar. Nunca se descarta nada.
- **La página del lote muestra:**
  - **Encabezado:** período, saldo inicial y final según Mercado Pago y saldo de libro de la caja «Mercado Pago».
  - **Tabla por día:** Día · Cobrado por canal (QR, Point, transferencias; bruto) · Lo que dice el cierre del día · Diferencia · Comisión · IVA de la comisión · IIBB (SIRTAC/SIRCUPA) · Ley 25.413 · Neto · Estado.
  - **«Otros movimientos»:** retiros, rendimientos, impuestos y percepciones debitados, y lo que hay que revisar (devoluciones, contracargos, propinas, pagos a terceros).

#### 4.2.3 De los movimientos a los comprobantes (`lib/imports/server/proposals/mp.ts`)

| Qué | Comprobante propuesto | Detalle |
|---|---|---|
| Cobros del día por canal (QR, Point, link, transferencia recibida que **no** viene de la propia CUIT) | **`collection`** de Mercado Pago (E.5.7): una por día y por medio | `applications`: las partidas abiertas «Mercado Pago a acreditar» de ese día y medio, creadas por el cierre del día con medio `settled_now`, por `min(abierto, bruto)`. `deductions`: `comision` = Σ comisión ÷ 1,21; `iva_comision` = el resto, con `commissionVoucher: { mode: 'later' }` (a `vat_credit_pending` hasta que llegue la factura mensual); `ret_iibb` = SIRTAC; `sircupa` = SIRCUPA. `received`: la caja Mercado Pago por **neto + Ley 25.413** del día. Si no hay cierre ese día, el cobro queda **a favor** de Mercado Pago con el aviso «Falta el cierre del 05/10» y se imputa solo cuando se carga (`acc_allocate` ya existe) |
| Ley 25.413 del día (cobros y pagos) | **`bank_expense`** sobre la caja Mercado Pago (E.5.11): `ley25413CreditCents` y `ley25413DebitCents` | Se separa en computable (33 %, o 100 % si es micro o pequeña MiPyME) y gasto, como hoy. **Por qué aparte:** las deducciones de `collection` no aceptan 25.413 (lo restringe `private.acc_validate_line`, regla `collection_deduction`). Así no se toca el motor. Agregar `ley_25413` como deducción queda como mejora (§8, P-T5) |
| `payout` a una cuenta propia | **`transfer`** de Mercado Pago al banco (E.5.10) | Antes se busca una `transfer` ya contabilizada con el mismo importe y ±3 días (por ejemplo, la importada del banco) |
| `payout` a un tercero | **`payment`** en `needs_input` («¿A qué proveedor le pagaste? ¿Qué facturas cancela?») | Se sugieren las facturas abiertas del proveedor elegido, primero las más viejas |
| `asset_management` (rendimientos) | **`cash_movement`** `shortcut: 'mp_yield'` (entra; contrapartida: intereses y rendimientos) | **Uno por mes** (la suma), con fecha del último día del lote en ese mes, para no llenar el diario de renglones diarios |
| `tax_withdholding` (IIBB que no se pudo retener en el cobro) | **`cash_movement`** sale, contra `iibb_withholdings` (SIRTAC) o `iibb_sircupa` | — |
| Débito de la factura mensual o de percepciones (`tax_iva`, `tax_payment_iibb…`) | **`payment`** a Mercado Pago | Cancela la factura mensual cargada como compra con `settlesCommissions` (que llega por el importador de ARCA o a mano). Si todavía no está, queda a favor |
| `reserve_*` en pares que se compensan | Se ignoran | Si al cierre del lote un par queda abierto, se informa «dinero retenido» |
| `refund`, `chargeback`, `dispute`, `restriction`, `credit_payment`, `fee_release_in_advance`, `digitalchange_transaction` | Para revisar, con una explicación de cada uno | — |
| `tip` (propinas por QR) | Para revisar hasta que exista la cuenta «Propinas a distribuir» | Plan de cuentas y tratamiento: A CONFIRMAR con la contadora (`mercadopago.md` §4.9) |

**Control de saldo después de confirmar:**

- Si el saldo de libro de la caja Mercado Pago al final del período no coincide con el `total` del reporte, aparece un `Callout`: «Después de importar, Mercado Pago queda en $ X en los libros y el reporte dice $ Y».
- Con el botón [Ajustar saldo] se abre la hoja `?accion=ajustar` (E.5.8) con la diferencia precargada.

**La factura mensual de Mercado Pago** (comisiones e IVA) entra como compra con `settlesCommissions = true`. Libera el `vat_credit_pending` y deja las percepciones. Es el circuito que ya existe en el módulo (`mercadopago.md` §4.6).

#### 4.2.4 Sincronización por API (fase 3, después de calibrar con el primer reporte real)

1. **Conectar:** el dueño crea una aplicación en «Tus integraciones», activa las credenciales de producción y pega el **Access Token** (`APP_USR-…`) en «Importar › Mercado Pago › Conectar» (`mercadopago.md` §3.1).
   - `connectMercadoPago(slug, { accessToken })` valida con `GET https://api.mercadolibre.com/users/me` (guarda `id` y `site_id = MLA`) y lo cifra con la RPC `acc_mp_store_token`.
   - En pantalla se muestran solo los últimos 4 caracteres.
2. **Cron** (tarea gated `'mp_sync'` en `lib/cron/schedule.ts`, `hour === 10 && minute === 45` UTC = 07:45 en Argentina; el minuto es múltiplo de 15 para que pg_cron llame):
   - **Tick A:** por cada bar conectado (RPC de servicio `acc_mp_sync_targets_service(p_secret_key)`), `POST /v1/account/release_report` para el día anterior, en UTC y según el corte de día. Guarda el pedido en `acc_mp_connections.pending_report`.
   - **Ticks siguientes (cada 15 min):** consulta el estado y, cuando está, baja el archivo con `GET /v1/account/release_report/{file_name}`. Lo parsea con **el mismo** `parseReleaseReport` y crea un lote `origin = 'api'` con `created_by_name = 'Sincronización automática'`.
   - **No contabiliza** (D7). El Resumen avisa: «Mercado Pago: 1 día nuevo para revisar».
   - **Errores:**
     - 401 → `status = 'reconnect'` y aviso «Reconectá Mercado Pago».
     - 203 al generar → reintento con las fechas que sugiere Mercado Pago.
     - 429 o 5xx → backoff.
   - Todo queda registrado en `last_sync_status` y `last_error_key`.
3. **Botón «Traer ahora»:** `syncMercadoPagoNow(slug)` hace lo mismo como usuario (escritor).
4. **OAuth** (180 días con refresh) recién cuando haya más bares, igual que Meta. Queda anotado (§8).

### 4.3 Banco (Banco Nación: NE24 o BNA+ Empresas)

#### 4.3.1 Qué se sube

- **v1:** la exportación de movimientos (CSV, TXT, XLS(X) o HTML) de **Nación Empresa 24**, o de BNA+ Empresas si exporta.
  - Los formatos exactos están A CONFIRMAR con una exportación real de la SAS (`banco.md` §1.2–1.3).
  - NE24 guarda **3 meses**: la guía pide exportar **una vez por semana**.
- **PDF del resumen mensual:** fase posterior. Necesita sacar el texto con coordenadas (pdf.js, dependencia nueva) y el signo sale de la diferencia de saldos (`banco.md` §1.4).
- **Interbanking API:** fase posterior, si la SAS contrata un plan con APIs (precio A CONFIRMAR).

#### 4.3.2 Detección y mapeo de columnas

- `parseBankStatement` busca la fila de encabezados en las primeras 40, con sinónimos: `fecha`, `fecha_valor`, `descripcion`, `comprobante`, `debito`, `credito`, `importe`, `dc`, `saldo`.
- Exige `fecha` + `descripción` + (`importe` o `débito` + `crédito`).
- Lee el CBU y la cuenta de los metadatos previos.
- **Formato desconocido:** aparece el paso «**Contanos qué es cada columna**» (vista de las primeras 10 filas con un `Select` por columna). El mapeo se guarda en `acc_import_layouts`, con una firma que es el sha256 de los encabezados normalizados más el separador. La próxima vez no se pregunta.
- **Débito o crédito:** se resuelve por los cuatro casos de `banco.md` §3.4 (columnas, signo, columna D/C o diferencia de saldo). **Nunca por el texto.**
- **Saldo por fila:** se verifica, con 1 centavo de tolerancia. Si no cierra, **no frena**: aviso en ámbar «revisá el 14/10».
- Se descartan los movimientos «del día» o «pendientes» (provisorios) y quedan los conformados o históricos.

#### 4.3.3 Reglas y agrupación

- **Reglas por defecto:** las 21 de `banco.md` §2.10, en orden; gana la primera. Ejemplos: Ley 25.413, SIRCREB, percepción RG 2408, IVA, intereses, comisiones, cheques, tarjetas, PCT, Mercado Pago, tarjeta corporativa, ARCA, Rentas, sueldos, débitos automáticos, efectivo y transferencias.
- Más las **reglas del bar** (`acc_import_rules`, `source = 'bank'`): prioridad, sentido, regex sobre la descripción normalizada, CUIT de la contraparte, rango de importe y caja → acción (componente de gasto bancario, transferencia a una caja, pago a un partícipe, movimiento con una cuenta, ignorar o revisar).
- Cuando la persona reclasifica una fila, se ofrece **«Crear regla»**. Después de 2 reclasificaciones iguales se propone sola (`banco.md` §3.9).
- **Agrupación madre e hijas del mismo día** por proporción: comisión → IVA (0,21, o 0,105 si la madre es un interés) → percepción (0,03). Explica cada cargo y valida la clasificación.

#### 4.3.4 De las filas a los comprobantes (`lib/imports/server/proposals/bank.ts`)

| Clasificación | Comprobante | Notas |
|---|---|---|
| Comisiones + IVA + RG 2408, Ley 25.413 (créditos y débitos), SIRCREB, intereses (por día) | **`bank_expense`** (E.5.11), uno por día | `includeInIvaBook`: por defecto `false`, salvo que el banco tenga CUIT cargada y la contadora lo pida. Tipo y número del comprobante para el Libro IVA: A CONFIRMAR (`banco.md` §2.3) |
| Crédito desde Mercado Pago o desde la propia CUIT | **`transfer`** Mercado Pago → banco | Si ya existe la `transfer` (importada de Mercado Pago), la fila queda «Ya registrada (desde Mercado Pago)» y no se propone nada. Si no, se crea, y Mercado Pago la reconoce después |
| Depósito de efectivo | **`transfer`** Caja → Banco | — |
| Acreditación de tarjetas (Posnet, Payway, +Pagos) | **`collection`** del procesador en `needs_input` | El banco trae el **neto**. Se precargan descuentos estimados con las tasas del partícipe (`prefillDeductions`, que ya existe) y se pide confirmar con la liquidación: «estimado, corregilo con la liquidación» |
| Transferencia a un proveedor (CUIT reconocida) | **`payment`** en `needs_input` | Se sugieren el proveedor por CUIT y las facturas abiertas |
| VEP de ARCA, Rentas o municipalidad | **`payment`** al organismo (`arca`, `rentas`, `municipalidad`) en `needs_input` | Cancela el impuesto a pagar que corresponda |
| Sueldos (un débito por el total) | **`payment`** a «Personal (sueldos)» en `needs_input` | — |
| Retiro o aporte de socio | **`cash_movement`** con el atajo de socio, en `needs_input` («¿qué socio?») | — |
| Pago de la tarjeta corporativa | **`transfer`** banco → tarjeta (E.5.10: «pagar el resumen de la tarjeta es mover del banco a la tarjeta») | — |
| Sin identificar | «Cobros a identificar» o «Pagos a identificar» | `needs_input` |

**Qué queda a mano:**

- Elegir qué facturas cancela cada pago (va sugerido).
- Los detalles de las liquidaciones de tarjetas hasta que haya importador de liquidaciones.
- Sueldos y cargas, cheques, y los VEP sin su DDJJ cargada.

### 4.4 (Recomendado, fase 4) «Emitidos» → lo facturado del cierre del día

- El cierre diario es la carga más frecuente. Su parte «facturada» (rangos y alícuotas por punto de venta y tipo) hoy se tipea desde Thinkeon.
- **Mis Comprobantes › Emitidos** trae cada comprobante con neto e IVA por alícuota (`arca-mis-comprobantes.md` §3.3), y muestra lo emitido **hasta ayer**: justo el día que se carga el cierre.
- **Propuesta:**
  - en «Cierre del día», un botón **«Traer lo facturado desde ARCA»**;
  - toma el último lote de Emitidos y arma las filas facturadas de ese día: agrupa por PV y tipo en rangos contiguos con totales por alícuota;
  - deja para revisar los huecos de numeración.
- La parte «cómo te pagaron» sigue pegándose desde el cierre de caja de Thinkeon (`parsePastedColumn`, que ya existe).
- Para automatizar eso también hace falta una **muestra del cierre de caja de Thinkeon** (§8).

### 4.5 Resumen: qué se sigue cargando a mano

| Qué | Dónde | Por qué no se automatiza todavía |
|---|---|---|
| Ventas por medio de cobro del día | Ventas › Cargar cierre (pegar la columna de Thinkeon) | Hasta tener el POS propio o una exportación de Thinkeon |
| Gastos chicos sin factura (hielo, verdulería) | «Nuevo gasto» (⌘K o la barra del celular) | No están en ARCA |
| Sueldos y cargas sociales | Asiento manual o pago a «Personal» | Fuera del sprint (lo dijo la contadora) |
| Liquidaciones de tarjetas (bruto, arancel, retenciones) | Registrar un cobro (con precarga por tasas) | Hace falta importador de Payway, Fiserv o +Pagos (después) |
| Facturas del exterior, papel y contingencia | Compras › Nueva compra | No figuran en Mis Comprobantes |
| Los saldos iniciales | Configurar › Saldos iniciales | Es una sola vez (§5.2) |

---

## 5. Las dos guías in-app (estilo actual del panel)

Rige la regla 0 (`admin-ui.md`). Todo se arma con `PageShell`, `PageHeader`, `Callout`, `card-hairline rounded-xl border bg-card`, `Badge`, `Progress`, `CopyButton`, `Button` y `Stepper`, con texto rioplatense, de vos y corto. Lo único con aspecto propio son las **maquetas de ARCA**: ilustraciones dentro de un marco «Así se ve en ARCA», con la paleta de ARCA, para que la persona reconozca la pantalla real.

### 5.1 Guía «Conectar ARCA» (`/administracion/ajustes/arca`)

#### 5.1.1 Estructura de la página

- **Ruta:** `app/(manager)/[tenantSlug]/administracion/ajustes/arca/page.tsx` + `loading.tsx` (esqueleto del riel y de dos tarjetas).
- **Acceso:** `requireAccountingAccess(slug, 'read')`. La contadora la ve en solo lectura, sin acciones.
- **Encabezado:**
  - Link «← Volver a Ajustes».
  - `PageHeader` eyebrow «Administración», título **«Conectar ARCA»**, descripción «Unos 40 minutos. Lo hace quien maneja la clave fiscal de la SAS. Vamos marcando cada paso solos.»
- **Arriba, dos tarjetas:**
  1. `Callout tone="info"` **«Antes de arrancar»**: «Necesitás tu CUIT y tu clave fiscal **nivel 3**, la CUIT de la SAS y esta página abierta al lado de ARCA (en otra pestaña o ventana)».
  2. **«Las 3 reglas de oro»**, una tarjeta con tres renglones numerados y una mini maqueta cada uno:
     - «Siempre elegí **la SAS**: arriba tiene que decir *Actuando en representación de HUB…*».
     - «El punto de venta tiene que ser **RECE para aplicativo y web services**, nuevo y distinto del de Thinkeon».
     - «A ARCA le subís el **.csr**; de ARCA te traés el **.crt**» (`arca-pasos.md` §11).
- **Cuerpo**, en compu `grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]`:
  - **Riel izquierdo** (`nav aria-label="Pasos para conectar ARCA"`, `lg:sticky lg:top-20`):
    - lista numerada de pasos con ícono y texto de estado: ✓ «Hecho» en `text-success`, ● «Te toca» en `text-primary`, ○ «Pendiente», ! «Revisar» en `text-warning-text`, ✗ «No anduvo» en `text-destructive`;
    - cada paso es link a `#paso-N`;
    - arriba del riel va `Progress` y «5 de 9».
  - **En el celular:** el riel se reemplaza por una barra «Paso 5 de 9 · Te toca: Creá el certificado» con `Progress`, y un `Sheet` con la lista completa.
  - **Columna principal:** un `GuideStep` por paso, en acordeón (encabezados `button` con `aria-expanded`):
    - el paso «Te toca» viene abierto;
    - los hechos, cerrados, con el resumen «Hecho el 08/10 por Nacho» (de `acc_guide_progress` o de la conexión).
- **Pie de la columna:** «Renovar el certificado (cada 2 años)», «Si algo sale mal» (la tabla de §2.7 más los errores del portal de `arca-pasos.md` §8.1) y links a los instructivos oficiales de ARCA ([O1](https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf), [O2](https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf), [O3](https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)).

**Anatomía de un paso** (`components/administracion/guias/guide-step.tsx`, cliente):

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ (6)  Creá el certificado en ARCA y bajalo         [En ARCA] ≈ 3 min · Admin.  │  ← número con color de estado
│      Te toca                                                                   │
├───────────────────────────────────────────────────────────────────────────────┤
│ Para qué  · Con esto ARCA reconoce a la plataforma como «computador fiscal».  │
│ Qué vas a ver   [maqueta C-04 escalada, con «Tocá acá» y flecha roja]         │
│                 «Así se ve en ARCA» · pie de foto en texto                     │
│ Qué tocás       1. «Agregar alias»  2. Alias: hubplataforma [Copiar] …        │
│ Qué te traés    ┌ Subí el .crt ─────────────────────────────┐                  │
│                 │  [ zona para soltar · 44 px · teclado ]   │  ← acción embebida
│                 └───────────────────────────────────────────┘                  │
│ Chequeá que…    ✓ arriba dice «Actuando en representación de HUB…»             │
│ Si algo sale mal ▸ El CUIT que aparece es el tuyo …   ▸ «Alias repetido» …     │
├───────────────────────────────────────────────────────────────────────────────┤
│ Estado: se marca solo cuando subas un certificado válido.   [Siguiente paso →] │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Estado de cada paso** (`lib/arca/guide.ts` → `arcaGuideState`):
  - **automático** cuando la plataforma lo puede verificar: el CSR existe, el certificado es válido, el punto de venta está guardado, o los chequeos de la última prueba (wsfe, padrón, punto de venta);
  - **manual** con la casilla «Ya lo hice», para los pasos que solo pasan en ARCA (`markGuideStep`, tabla `acc_guide_progress`). Un paso manual se marca «Revisar» si la prueba posterior falla por su causa: por ejemplo, `arca_not_authorized` vuelve a abrir el paso 7.
- **Accesibilidad:**
  - cada paso es una `section aria-labelledby`;
  - el estado se dice con texto, no solo con color;
  - las maquetas llevan `role="img"` con un `aria-label` que describe la pantalla, y **todas** las instrucciones están también en texto;
  - después de una acción embebida, el foco va al resultado (`aria-live="polite"`);
  - todo se maneja con teclado.
- **Celular (375 px):** las maquetas se escalan (`ScaledMock`), los botones ocupan todo el ancho con 44 px y la página no scrollea de costado.
- **Modo oscuro:** la página usa los tokens del panel; la maqueta conserva su paleta clara dentro de su marco, con borde visible en los dos temas.

#### 5.1.2 Kit de maquetas (`components/administracion/guias/arca-mock/*`)

| Pieza | Props | Qué dibuja |
|---|---|---|
| `scaled-mock.tsx` · `ScaledMock` | `{ width?: 720; label: string; caption?: string; children }` | Lienzo de ancho fijo (720 px) que se escala con `ResizeObserver` (`transform: scale(min(1, w / 720))`) y compensa el alto. `role="img"` + `aria-label`; los hijos `aria-hidden`. Debajo, el `caption` en texto |
| `browser-frame.tsx` · `BrowserFrame` | `{ url?: 'arca.gob.ar'; children }` | Ventana con tres puntos y la barra de dirección |
| `legacy-screen.tsx` · `LegacyScreen` | `{ title; acting?: { user: string; represented: string }; children }` | Servicios viejos: barra izquierda negra con «ARCA» en blanco, botones «›››ACCESO CON CLAVE FISCAL» (celeste) y «TRÁMITES Y SERVICIOS» (borde amarillo), lista de categorías; a la derecha, la caja celeste «Bienvenido Usuario … / Actuando en representación de …» y las cajas de contenido (capturas de `arca-pasos.md` P-04 a P-09 y C-03 a C-06) |
| `portal-screen.tsx` · `PortalScreen` | `{ userName; children }` | Portal nuevo: cabecera blanca «ARCA \| AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO», franja azul marino con íconos circulares, buscador grande «¿Qué necesitás?» (P-01 a P-03 y M-01) |
| `modal.tsx` · `ArcaModal` | `{ title; children }` | Ventana gris con barra de título gris azulada y «?» rojo (PV-05) |
| `mis-comprobantes-screen.tsx` | `{ step: 'inicio' \| 'consulta' \| 'resultados' }` | Banner azul «Mis Comprobantes», tarjetas Emitidos y Recibidos, filtros, botonera «Excel · PDF · CSV» (M-03 a M-05) |
| `primitives.tsx` | `MockButton({ variant: 'legacy'\|'portal'\|'modal' })` · `MockSelect({ value, open?, options? })` · `MockInput({ value, placeholder })` · `MockFile({ fileName })` · `MockTable({ columns, rows })` | Controles con la apariencia de cada familia (los botones viejos en MAYÚSCULAS y azul) |
| `spotlight.tsx` · `Spotlight` | `{ label: string; n?: number; side?: 'left'\|'right'\|'bottom'; children }` | Envuelve el control objetivo: anillo rojo, número, globito («Tocá acá», «Elegí la SAS», «Copiá este número») y **flecha roja curva** en SVG, como las capturas de los tutoriales. Pulso suave que se apaga con `prefers-reduced-motion` |
| `screens.tsx` | ver la lista de abajo | Las pantallas armadas, cada una con sus `Spotlight` |

**Personalización:**

- `MockDataProvider` le pasa a todas las pantallas `{ sasName: legal_name en mayúsculas, sasCuit: formatCuit(cuit), alias, pointOfSale, csrFileName, personLabel: 'TU NOMBRE [TU CUIT]' }`.
- La maqueta muestra **exactamente** lo que la persona tiene que ver o escribir («HUB COFFEE & BAR SAS [30-71234567-1]», «hubplataforma», «arca-hubplataforma.csr»).
- No se inventa la CUIT personal: se muestra «TU CUIT».

**Pantallas** (`screens.tsx`; la fuente de cada una entre paréntesis):

- `ScreenLogin` (P-02)
- `ScreenPortalSearch({ query, resultTitle, resultDesc })` (P-03, PV-01, C-01, M-01)
- `ScreenAutoridad` (P-04)
- `ScreenMenuRelaciones` (P-05)
- `ScreenNuevaRelacion({ service?, representative? })` (P-06)
- `ScreenArbolServicios({ folder: 'Servicios Interactivos' | 'WebServices', service })` (P-07, con la advertencia sobre «MTXCA» en WebServices)
- `ScreenRepresentantePersona` (P-08a)
- `ScreenComputadorFiscal({ alias })` (P-08b, la captura de §3 de la investigación)
- `ScreenConstancia3283({ service })` (P-09)
- `ScreenPvListado` (PV-04)
- `ScreenPvAlta({ suggestedNumber })` (PV-05: «Sistema: RECE para aplicativo y web services» resaltado)
- `ScreenCertLista` (C-03)
- `ScreenCertAgregar({ alias, csrFileName })` (C-04)
- `ScreenCertDetalle({ alias, sasCuit })` (C-06: el ícono de *Descargar* resaltado)
- `ScreenMisComprobantes*` (M-03, M-04, M-05)

**Fidelidad:**

- Los textos de botones y campos son los **exactos** documentados en `arca-pasos.md`.
- Donde la investigación dice «A CONFIRMAR» (los botones del alta de «Locales y Establecimientos», las pantallas del F. 856 después de la RG 5762, la ubicación de «Mis Comprobantes» en el árbol), la maqueta lleva un sello «Puede verse distinto» y el texto dice qué buscar.
- **Antes de publicar,** alguien con clave fiscal recorre la guía contra el ARCA real y saca capturas para ajustar los textos (§8, P-O7).

#### 5.1.3 Los pasos (contenido)

| # | Título (dónde) | Quién · tiempo | Qué vas a ver → qué tocás | Qué copiás o traés | Chequeo / estado | Si algo sale mal |
|---|---|---|---|---|---|---|
| **0** | **Antes de empezar** (ARCA) | Administrador de relaciones · 10 min | Checklist: ① clave fiscal **nivel 3** (se sube desde la app de ARCA escaneando el DNI y la cara; por homebanking solo llega a nivel 2); ② CUIT de la SAS (✓ automático si está en Datos de la SAS); ③ en la «Constancia de CUIT» (botón de la portada de arca.gob.ar) la SAS figura como **Responsable inscripto** y con **actividad**; ④ **Domicilio Fiscal Electrónico** activo; ⑤ anotá los **puntos de venta de Thinkeon** (los ves en el paso 2 o en cualquier factura de Thinkeon: el número antes del guion) | — | Manual «Ya revisé todo» + CUIT automática | «No sé si soy el administrador de relaciones»: entrá con tu CUIT a *Administrador de relaciones*; si en el desplegable aparece la SAS, sos vos (inferencia A CONFIRMAR). «La CUIT no aparece activa»: hablalo con la contadora antes de seguir (error 10000) |
| **1** | **Entrá a ARCA y elegí la SAS** (Administrador de Relaciones) | Admin · 2 min | P-02: CUIT **personal** sin guiones → «Siguiente» → clave → «INGRESAR». P-03: buscá «Administrador de relaciones». P-04: en el desplegable elegí **HUB … SAS [30-…]**. P-05: mirá la cabecera | — | Manual. El texto grande dice: «Arriba tiene que decir *Actuando en representación de HUB … SAS*» | Si dice tu nombre: volvé y elegí la SAS en el desplegable. **Nunca** uses la CUIT de la SAS para entrar (no tiene clave) |
| **2** | **Creá el punto de venta de la plataforma** (Administración de puntos de venta y domicilios) | Admin · 5 min + propagación | PV-01: buscá «puntos de venta». PV-02: elegí la SAS. PV-03: «A/B/M de Puntos de Venta». PV-04: anotá los números que ya hay (Thinkeon) → «Agregar». PV-05: Número (el que propone o uno libre fácil de reconocer), Nombre fantasía «Plataforma HUB», **Sistema: «RECE para aplicativo y web services»**, Nuevo domicilio: el local → «Aceptar» → «Sí» | **El número** → campo «Número de punto de venta» en la guía [Guardar] (se guarda en la conexión y en Ajustes › Puntos de venta como «Plataforma (ARCA)», canal Eventos) | «Hecho (lo verificamos al probar la conexión)» → se confirma en el chequeo 4 | El local no aparece en «Nuevo domicilio»: hay que declararlo como **«Locales y establecimientos»** en *Sistema Registral › Registro Único Tributario › Domicilios* (botones A CONFIRMAR). Un punto de venta dado de baja **no se puede volver a usar** (RG 5824/2026). Si lo creaste hoy, puede tardar unas horas en aparecer. Normativa: informarlo 3 días hábiles antes de operar (si aplica a un local que ya opera: A CONFIRMAR con la contadora) |
| **3** | **(Solo si vas a hacer Factura A) Habilitá la Factura A** (Regímenes de Facturación y Registración) | Admin + socios + contadora · de 15 min a algunos días | «Habilitación de Comprobantes» → **F. 856**. Solvencia: el 33 % de los socios con bienes, o la SAS con inmuebles o autos. Si no alcanza, elegí **«A con Pago en CBU informada»** al presentar (no se puede elegir después). Resultado posible: A común · A «Operación sujeta a retención» (al cliente le retienen IVA y Ganancias: malo para empresas) · A con CBU informada (RG 5762/2025). La maqueta es genérica con el sello «Puede verse distinto» | En la guía: `Select` «¿Qué te autorizaron?» → `allowed_classes` | Manual + el `Select` | «A consumidores finales se hace B: si no vas a facturar a empresas, salteá este paso». Si ARCA lo suspende, hay 15 días para presentar documentación |
| **4** | **Habilitá «Administración de Certificados Digitales» para la SAS** (Administrador de Relaciones) | Admin · 3 min | P-05: «Nueva Relación». P-06: «BUSCAR» en Servicio. P-07: **ARCA › Servicios Interactivos › Administración de Certificados Digitales**. P-06: «BUSCAR» en Representante. P-08a: tu CUIT → «BUSCAR» → «CONFIRMAR». P-09: «CONFIRMAR» (guardá el F. 3283/E en PDF) | — | Manual «Ya me aparece el servicio» | «No me aparece»: **cerrá sesión y volvé a entrar**; si sigue sin aparecer, entrá a «Aceptación de Designación» → «Aceptar» |
| **5** | **Generá el pedido de certificado** (la plataforma) | Cualquiera con acceso de carga · 1 min | **Acción embebida:** alias propuesto (`hubplataforma`, editable; solo letras y números) → [Generar pedido] → muestra el alias con `CopyButton` y [Descargar arca-hubplataforma.csr]. Texto: «Este archivo no es secreto: es un *pedido*. La clave queda guardada en la plataforma y nunca sale de acá» | El `.csr` y el alias | **Automático** (hay CSR) | «Lo perdí»: [Descargar de nuevo] (es el mismo pedido). «Quiero empezar de cero»: [Generar uno nuevo]. Si ya subiste un certificado, avisa que hay que repetir el paso 6 |
| **6** | **Creá el certificado en ARCA y bajalo** (Administración de Certificados Digitales) | Admin · 3 min | C-01: buscá el servicio. C-02: elegí **la SAS**. C-03: «Agregar alias». C-04: verificá que la CUIT sea **la de la SAS** · Alias: **hubplataforma** · «Examinar…» → elegí **arca-hubplataforma.csr** → «Agregar alias». C-05: «Ver» en el alias. C-06: el DN dice `SERIALNUMBER=CUIT 30…, CN=hubplataforma` · Estado VALIDO → ícono **Descargar** | El **`.crt`** → **acción embebida**: zona para soltarlo [Subir certificado] → «Certificado válido hasta el 10/09/2028» | **Automático** (certificado válido, de la clave correcta y de la CUIT de la SAS) | La CUIT de C-04 es la tuya: volvé a C-02 y elegí la SAS. «Alias repetido»: usá otro o «Agregar certificado» sobre el existente. Error al subir: el archivo tiene que ser el **.csr** (no el .crt ni la .key). Los mensajes de la plataforma están en §2.4.2 |
| **7** | **Autorizá el certificado a «Facturación Electrónica»** (Administrador de Relaciones) | Admin · 3 min | P-05: «Nueva Relación». P-06: «BUSCAR». P-07: **ARCA › WebServices › Facturación Electrónica** (⚠ no «Factura Electrónica con Detalle - MTXCA», que está justo arriba, ni «Comprobantes en línea»). P-06: «BUSCAR» en Representante. P-08b: **Computador Fiscal: hubplataforma** → «CONFIRMAR». P-09: «Tipo de Autorizacion: Facturacion Electronica» → «CONFIRMAR» | — | **Se verifica al probar** (chequeos 2 y 3). Antes se puede marcar «Ya lo hice» | Desplegable «Computador Fiscal» vacío: el certificado quedó a tu nombre → repetí el paso 6 eligiendo la SAS. La prueba dice «la SAS no está en el permiso»: lo hiciste representándote a vos (paso 1) |
| **8** | **Autorizá también «Consulta de constancia de inscripción»** (Administrador de Relaciones) | Admin · 2 min | Igual que el 7, pero en P-07: **ARCA › WebServices › Consulta de constancia de inscripción** (el técnico es `ws_sr_constancia_inscripcion`). Sirve para completar proveedores y clientes con la CUIT | — | **Se verifica al probar** (chequeo 6) | Igual que el 7. Un mismo certificado sirve para los dos servicios: no hace falta otro |
| **9** | **Probá la conexión** (la plataforma) | Cualquiera con acceso de carga · 1 min | **Acción embebida:** [Probar conexión] → los 7 chequeos de §2.6 con ✓ o ✗ y el texto de cada uno | — | **Automático** (`connected`). Cuando todo da ✓: «¡Listo! ARCA quedó conectado» y los próximos pasos: «Probá *Completar con ARCA* en un proveedor» · «Prendé *Emitir facturas desde la plataforma* cuando vayas a facturar un evento» | Cada ✗ trae su arreglo y el link al paso (§2.7) |
| **10** | **(Opcional) Habilitá «Mis Comprobantes» para quien baje las compras** (Administrador de Relaciones) | Admin · 3 min | P-05: «Nueva Relación» → P-07: **ARCA › Servicios Interactivos › Mis Comprobantes** (la ubicación en el árbol está A CONFIRMAR) → P-08a: tu CUIT o la de la contadora → «CONFIRMAR» | — | Manual. Link a «Importar de ARCA» y a §5.1.4 | Cerrá sesión y volvé a entrar |

**Renovar el certificado (cada 2 años, sección al pie):**

- La plataforma avisa 30 días antes: en la pestaña ARCA y en «Para atender» del Resumen.
- [Renovar certificado] genera una clave y un CSR nuevos **con el mismo alias**. En ARCA: C-06 → **«Agregar certificado»** → subir el CSR nuevo → bajar el `.crt` → subirlo acá.
- **La conexión sigue andando mientras tanto:** la clave nueva queda como `pending_private_key` (con `pending_csr_pem` y `pending_public_key_sha256` en la conexión) y recién reemplaza a la vigente cuando se sube un certificado que coincide con ella. Hasta entonces se sigue facturando con el certificado actual.
- Con el mismo alias **no hace falta volver a autorizar** los servicios (`arca-pasos.md` §7.6; el formulario exacto de «Agregar certificado» está A CONFIRMAR).

**Para desarrolladores (plegado):** cómo hacer la homologación con WSASS (H-01 a H-05 de `arca-pasos.md` §6), con su maqueta `WsassScreen`. Lo hace studiOS, no los dueños.

#### 5.1.4 Mini guías de descarga (las reusan los importadores y «Cómo arrancar»)

`components/administracion/guias/how-to/*` (cada una es un plegable «¿Cómo lo bajo?»: un `<details>` con el estilo de las tarjetas del panel, porque `components/ui` no tiene `Collapsible`):

| Mini guía | Pasos |
|---|---|
| **Mis Comprobantes (Recibidos)** | 1) ARCA → buscá «Mis Comprobantes» (M-01). 2) Si representás a varios, elegí la SAS (M-02). 3) **«Recibidos»** (M-03). 4) Fecha: del 1 del mes anterior a hoy, o «Mes pasado» → «Aplicar» → «BUSCAR» (M-04; el rango máximo es de 365 días). 5) **«CSV»**, que baja un ZIP (M-05). 6) **Arrastrá el ZIP tal cual**: no lo abras con Excel. Cuándo: **del día 11 en adelante**, porque las facturas pueden llegar tarde y ARCA muestra lo emitido **hasta ayer** (`arca-pasos.md` §10) |
| **Mercado Pago (Liquidaciones)** | 1) Desde la **compu** (el reporte no se genera desde el celular). 2) *Informes y facturación › Reportes de ventas y extractos de cuenta* › **Liquidaciones** › «Crear reporte». 3) Fechas: hasta 60 días. 4) Esperá el mail y bajalo en **.csv**. 5) La primera vez, en *Configuración*, tildá las columnas de la lista (o conectá el token y lo hacemos solos) (`mercadopago.md` §4.3) |
| **Banco Nación** | NE24: *Consultas › Movimientos* → cuenta → rango de fechas → exportar **CSV, TXT o XLS**. Guarda 3 meses: hacelo una vez por semana. BNA+ Empresas: A CONFIRMAR qué exporta. Mientras no tengamos una muestra real, la mini guía muestra solo texto y pide «Mandanos una exportación de prueba» (`banco.md` §1.2) |

### 5.2 Guía «Cómo arrancar» (`/administracion/guias/como-arrancar`)

#### 5.2.1 Estructura

- **Rutas:**
  - `app/(manager)/[tenantSlug]/administracion/guias/page.tsx`: índice con la grilla de `configuracion/page.tsx`. Tarjetas: «Cómo arrancar» · «Conectar ARCA» (→ `/ajustes/arca`) · «Bajar compras de ARCA» · «Bajar el reporte de Mercado Pago» · «Exportar el banco».
  - `guias/como-arrancar/page.tsx` + `loading.tsx`.
- **Encabezado:** «Cómo arrancar con Administración» · «Qué se carga una sola vez, qué todos los días y qué hace la plataforma sola. Te vamos marcando lo que ya está.»
- **Tarjeta de progreso:** `Progress` + «9 de 15 listos» y, al lado, **«Lo próximo que te conviene hacer»**: el primer pendiente, con su botón.
- **Tarjeta «Qué tener a mano»** (casillas que no se guardan, solo de ayuda):
  - constancia de CUIT de la SAS y de Rentas (IIBB);
  - el último resumen del banco (saldo a la fecha de arranque);
  - el saldo de Mercado Pago de ese día;
  - el efectivo contado de la caja;
  - la lista de facturas impagas a proveedores (proveedor, número, importe y vencimiento);
  - lo que te deben (tarjetas y plataformas a acreditar, clientes);
  - los gastos fijos con su día de vencimiento;
  - los puntos de venta de Thinkeon.
- **Cuatro secciones por frecuencia:**
  - «Día 1 · una sola vez»;
  - «Todos los días (≈ 5 minutos)»;
  - «Todas las semanas»;
  - «Todos los meses».
- **Cada ítem es una fila tarjeta:**
  - ícono de estado;
  - título;
  - chip «Dónde» con link;
  - «Qué cargás» (una línea);
  - «Cómo» (3 viñetas, plegable);
  - «La plataforma lo hace sola» (si aplica, en `text-muted-foreground`);
  - tiempo estimado;
  - botón de acción.
- **Al pie:** «Lo que hace la plataforma sola»:
  - completa proveedores y clientes con ARCA;
  - detecta comprobantes repetidos;
  - separa comisión, IVA e impuestos de Mercado Pago;
  - arma los gastos bancarios del día;
  - propone la cuenta de cada proveedor;
  - numera las facturas con ARCA;
  - avisa vencimientos (gastos fijos y certificado).

#### 5.2.2 Contenido

| Sección | Ítem | Dónde | Qué cargás · cómo | Listo cuando (fuente) |
|---|---|---|---|---|
| Día 1 | **Datos de la SAS** | Ajustes › Datos de la SAS | Razón social, CUIT, IIBB (número y régimen: local o Convenio Multilateral), inicio de actividades, domicilio fiscal. «Copialos de la constancia de inscripción» | `acc_settings`: CUIT, número de IIBB, inicio de actividades y domicilio cargados |
| Día 1 | **Cajas y cuentas** | Ajustes › Cajas y cuentas | Caja (efectivo), Banco Nación (CBU, alias y número de cuenta), Mercado Pago (CVU y alias), tarjeta de crédito de la empresa si hay. «Los CBU y CVU sirven para reconocer tus transferencias entre cuentas» | Al menos un banco con CBU y, si cobran con QR o transferencias, una billetera con CVU |
| Día 1 | **Medios de cobro** | Ajustes › Medios de cobro | El orden del cierre de caja de Thinkeon y adónde va cada medio | Medios activos (vienen de la puesta en marcha) |
| Día 1 | **Puntos de venta** | Ajustes › Puntos de venta | Los de Thinkeon con su canal. El de la plataforma lo crea «Conectar ARCA» | Al menos uno |
| Día 1 | **Saldos iniciales** | Configurar › Saldos iniciales | A la fecha de arranque de los libros: efectivo contado, banco según el resumen, Mercado Pago según la app, facturas impagas a proveedores, lo que te deben, impuestos a pagar y aportes de socios. Si no hay nada, «Arrancar en cero» | `opening_status` ∈ (`posted`, `skipped`) |
| Día 1 | **Accesos** | Ajustes › Accesos | Los socios que van a cargar, y la contadora (solo lectura) | `partner_granted` y `accountant_added` (los mismos de Primeros pasos) |
| Día 1 | **Conectar ARCA** | `/ajustes/arca` | La guía de §5.1 | Conexión de producción en `connected` |
| Día 1 | **Proveedores y compras del mes pasado** | Importar › ARCA | Bajá el ZIP de Mis Comprobantes del mes anterior y arrastralo: **se crean los proveedores**, y vos solo elegís en qué se gasta con cada uno | Al menos un lote de Mis Comprobantes confirmado |
| Día 1 | **Gastos fijos** | Compras › Gastos fijos | Alquiler, luz (EPEC), gas, agua, internet, Thinkeon, contador, seguros… con su día de vencimiento. «Te avisamos antes de cada uno» | 3 o más activos, o «Ya cargué los que tengo» |
| Día 1 | **(Opcional) Conectar Mercado Pago** | Importar › Mercado Pago | Configurar el reporte o pegar el token (fase 3) | `acc_mp_connections.status = 'connected'` o un lote de Mercado Pago confirmado |
| Día 1 | **Pedíselo a tus proveedores** | — | Mensaje listo para copiar (`CopyButton`): «Hola, desde ahora facturanos a **HUB COFFEE & BAR SAS**, CUIT **30-…**, **Responsable inscripto**, con **Factura A**. ¡Gracias!». «Sin eso, la compra no aparece en ARCA o aparece como B y se pierde el crédito fiscal» | Manual |
| Todos los días | **Cierre del día** | Ventas › Cargar cierre | Pegá la columna del cierre de caja de Thinkeon. Lo facturado lo trae ARCA en la fase 4 | Últimos 7 días con cierre (lista de días que faltan, como ya hace el Resumen) |
| Todos los días | **Gastos chicos** | «Nuevo gasto» (⌘K o la barra del celular) | Hielo, verdulería, una compra suelta | Solo informativo |
| Semanal | **Mercado Pago** | Importar › Mercado Pago | Bajar Liquidaciones y subirlas; si está conectado, revisar y confirmar los días nuevos | Último lote de hace 8 días o menos |
| Semanal | **Banco** | Importar › Banco | Exportar de NE24 y subir. «Guarda 3 meses: no lo dejes pasar» | Último lote de hace 8 días o menos |
| Mensual | **Compras de ARCA** (del 11 en adelante) | Importar › ARCA | Mis Comprobantes del mes anterior y el actual | Un lote que cubra el mes anterior |
| Mensual | **Factura de Mercado Pago** | Compras › Nueva compra (o llega por Importar › ARCA) | Marcar «Es la factura mensual de comisiones» | Compra con `settles_commissions` en el mes |
| Mensual | **Ajustar saldos** | Cajas › Ajustar saldo | Contar el efectivo y comparar el banco y Mercado Pago | `last_checked_on` dentro del mes para cada caja |
| Mensual | **Cerrar el mes con la contadora** | Libros › Cierres | Revisar la lista y cerrar. La contadora baja el «Paquete del mes» | Mes anterior cerrado |

#### 5.2.3 De dónde sale el estado

- **RPC nueva `acc_report_onboarding(p_tenant_id)`:** INVOKER, `stable`, con `acc_assert_reader` primero. Devuelve un jsonb con los booleanos, conteos y fechas de la tabla anterior en una sola consulta. Es el mismo estilo que `first_steps` de `acc_report_summary`, sin tocar esa función.
- **Espejo TS:**
  - `lib/accounting/queries/onboarding.ts` → `getOnboarding(tenantId)`;
  - `lib/accounting/onboarding.ts` (puro) → `ONBOARDING_ITEMS` y `onboardingState(data, manualProgress)`.
- **Ítems manuales:** `acc_guide_progress` con `guide = 'arranque'`.

#### 5.2.4 Integración con el Resumen

- La tarjeta «Primeros pasos» (`_resumen/first-steps.tsx`) suma el link **«Ver la guía completa»** → `/guias/como-arrancar`.
- **«Para atender»** (`_resumen/attention-list.tsx`) recibe una segunda fuente TS, `getIntegrationAttention(tenantId)` en `lib/accounting/queries/integrations.ts`, con los mismos tonos `danger`, `warning` e `info` y botón de acción:
  - ARCA en error;
  - certificado que vence en menos de 30 días;
  - comprobantes de ARCA en `needs_reconcile` o `authorized` sin asiento (`danger`);
  - lotes de importación esperando revisión;
  - «Reconectá Mercado Pago»;
  - desde el día 11, «Bajá Mis Comprobantes de septiembre» si no hay un lote que cubra el mes anterior.
- No se toca `acc_report_summary`.

---

## 6. Cambios de base (migraciones)

**Cómo se aplican** (memorias `migraciones-prod-autorizacion` y `supabase-env-remote`):

- El Supabase remoto **es producción**. Cada migración se ensaya antes con `begin … rollback` en el bar temporal `acct-dryrun` (scripts en `scratchpad/sqltests/`).
- Se aplica con `apply_migration` **solo con el «sí» explícito de Nacho**, y después se verifica el md5 del archivo contra `schema_migrations.statements`.
- **Nunca** se editan las `2026100712*` ya aplicadas.
- `lib/accounting/**` no usa `types/database.ts` (las RPC van por `callRpc`), así que la regeneración de tipos no bloquea. Igual se regenera por MCP para el DoD y se vuelven a agregar los exports manuales.

**Archivos** (prefijos del 08/10 para no chocar con nada):

| Archivo | Contenido | Fase |
|---|---|---|
| `20261008120000_acc_arca_core.sql` | Tablas `acc_arca_connections`, `acc_secrets`, `acc_arca_tickets`, `acc_arca_vouchers`, `acc_arca_padron_cache`, `acc_guide_progress` + RLS, grants, índices, triggers | 2 |
| `20261008120100_acc_arca_rpc.sql` | RPC de ARCA, de la guía y `acc_ensure_final_consumer` | 2 |
| `20261008120200_acc_imports_core.sql` | Tablas `acc_import_batches`, `acc_import_items`, `acc_import_proposals`, `acc_import_rules`, `acc_import_layouts`, `acc_mp_connections` | 2 |
| `20261008120300_acc_imports_rpc.sql` | RPC de importación, `acc_import_match_purchases`, `acc_report_onboarding` y las de Mercado Pago (las de token y servicio también, aunque se usen en la fase 3) | 2 |

Todas arrancan con `set local lock_timeout = '5s';` y terminan con `notify pgrst, 'reload schema';`, como las del Sprint 1.

### 6.1 Reglas comunes de las tablas nuevas

```sql
-- Lectura (las tablas SIN secretos): como las 18 acc_* del Sprint 1.
alter table public.<t> enable row level security;
revoke all on public.<t> from anon, authenticated;
grant select on public.<t> to authenticated;
create policy <prefijo>_select_readers on public.<t> for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));

-- Tablas CON secretos (acc_secrets, acc_arca_tickets): RLS encendida, SIN política y SIN grant.
-- Quedan invisibles para la Data API a propósito. CLAUDE.md §5 pide el GRANT para que una tabla
-- SE VEA; acá NO se tiene que ver. Solo las tocan las RPC SECURITY DEFINER de abajo.
alter table public.<t> enable row level security;
revoke all on public.<t> from anon, authenticated;
```

- Escritura: solo por RPC `SECURITY DEFINER` con `set search_path = ''`, `acc_assert_writer` (o `service_role` en las `*_service`), `pg_advisory_xact_lock(private.acc_lock_key(tenant))` y `private.acc_audit` en la transacción.
- Las FK compuestas `(x_id, tenant_id)` siguen el patrón del Sprint 1, con índices que las cubren.
- `updated_at` lo mantiene `public.set_updated_at()`.
- Ninguna va a Realtime.
- Después de aplicar, `acc_privilege_gaps()` y `acc_isolation_gaps()` tienen que seguir devolviendo **0 filas**. El prefijo `acc_` exime de la RESTRICTIVE `_no_accountant`.

### 6.2 Tablas

```sql
-- ═══ 20261008120000_acc_arca_core.sql ═══════════════════════════════════════════════════════

create table public.acc_arca_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  environment text not null,                          -- produccion | homologacion
  status text not null default 'draft',               -- draft | key_ready | cert_ready | connected | error | disconnected
  represented_cuit text not null,                     -- la SAS: Auth.Cuit (WSFE) y cuitRepresentada (padrón)
  cert_cuit text not null,                            -- serialNumber del certificado (prod = la SAS; homo = la persona de WSASS)
  alias text not null,                                -- CN del CSR = alias en ARCA
  csr_pem text,                                       -- público (no es secreto)
  public_key_sha256 text,                             -- sha256(SPKI DER) de la clave guardada
  pending_csr_pem text, pending_public_key_sha256 text,  -- renovación en curso (la clave vigente sigue andando)
  certificate_pem text,                               -- público
  cert_serial text, cert_issuer text, cert_not_before timestamptz, cert_not_after timestamptz,
  point_of_sale int,
  allowed_classes text[] not null default '{B}',      -- B | A (común) | A51 (sujeta a retención) | ACBU (pago en CBU informada)
  default_concepto smallint not null default 1,       -- 1 productos · 2 servicios · 3 ambos
  emission_enabled boolean not null default false,
  services jsonb not null default '{}',               -- {"wsfe":"ok","ws_sr_constancia_inscripcion":"not_authorized"}
  last_test_at timestamptz, last_test jsonb, last_error_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aacn_id_tenant_uq unique (id, tenant_id),
  constraint aacn_one_per_env unique (tenant_id, environment),
  constraint aacn_env check (environment in ('produccion', 'homologacion')),
  constraint aacn_status check (status in ('draft', 'key_ready', 'cert_ready', 'connected', 'error', 'disconnected')),
  constraint aacn_cuits check (public.acc_cuit_is_valid(represented_cuit) and public.acc_cuit_is_valid(cert_cuit)
                               and (environment <> 'produccion' or cert_cuit = represented_cuit)),
  constraint aacn_alias check (alias ~ '^[a-z0-9]{3,30}$'),
  constraint aacn_pem check ((csr_pem is null or (csr_pem like '-----BEGIN CERTIFICATE REQUEST-----%' and char_length(csr_pem) <= 4000))
                         and (certificate_pem is null or (certificate_pem like '-----BEGIN CERTIFICATE-----%' and char_length(certificate_pem) <= 8000))),
  constraint aacn_key_hash check ((public_key_sha256 is null or public_key_sha256 ~ '^[0-9a-f]{64}$')
                              and (pending_public_key_sha256 is null or pending_public_key_sha256 ~ '^[0-9a-f]{64}$')
                              and (pending_csr_pem is null) = (pending_public_key_sha256 is null)
                              and (pending_csr_pem is null or (pending_csr_pem like '-----BEGIN CERTIFICATE REQUEST-----%' and char_length(pending_csr_pem) <= 4000))),
  constraint aacn_pos check (point_of_sale is null or point_of_sale between 1 and 99998),
  constraint aacn_classes check (allowed_classes <@ array['A', 'B', 'A51', 'ACBU']::text[] and 'B' = any (allowed_classes)),
  constraint aacn_concepto check (default_concepto in (1, 2, 3)),
  constraint aacn_cert_coherent check (status not in ('cert_ready', 'connected') or
                                       (certificate_pem is not null and cert_not_after is not null and public_key_sha256 is not null)),
  constraint aacn_emission check (not emission_enabled or
                                  (environment = 'produccion' and status = 'connected' and point_of_sale is not null))
);

-- Secretos: clave privada de ARCA y tokens de Mercado Pago. Sin GRANT (ver 6.1).
create table public.acc_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  arca_connection_id uuid,
  mp_connection_id uuid,
  name text not null,                                 -- private_key | pending_private_key (renovación) | access_token | refresh_token
  ciphertext text not null,                           -- base64(pgp_sym_encrypt(texto, ACC_SECRETS_KEY, 'cipher-algo=aes256, compress-algo=0'))
  key_version smallint not null default 1,            -- para rotar ACC_SECRETS_KEY
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asec_owner check ((arca_connection_id is null) <> (mp_connection_id is null)),
  constraint asec_name check (name in ('private_key', 'pending_private_key', 'access_token', 'refresh_token')
                              and (name not in ('private_key', 'pending_private_key') or arca_connection_id is not null)),
  constraint asec_len check (char_length(ciphertext) between 16 and 20000),
  constraint asec_arca_fk foreign key (arca_connection_id, tenant_id) references public.acc_arca_connections (id, tenant_id) on delete cascade
  -- la FK a acc_mp_connections se agrega en 20261008120200 (la tabla nace ahí)
);
create unique index asec_arca_uq on public.acc_secrets (arca_connection_id, name) where arca_connection_id is not null;
create unique index asec_mp_uq on public.acc_secrets (mp_connection_id, name) where mp_connection_id is not null;
create index asec_tenant_idx on public.acc_secrets (tenant_id);

-- Ticket de acceso (TA) del WSAA, cacheado y cifrado, con lease para renovarlo una sola instancia. Sin GRANT.
create table public.acc_arca_tickets (
  connection_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service text not null,                              -- wsfe | ws_sr_constancia_inscripcion
  token_enc text, sign_enc text,
  generation_time timestamptz, expiration_time timestamptz,
  lease_id uuid, lease_until timestamptz,
  cooldown_until timestamptz, cooldown_manual boolean not null default false,
  last_error_key text, last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (connection_id, service),
  constraint atkt_conn_fk foreign key (connection_id, tenant_id) references public.acc_arca_connections (id, tenant_id) on delete cascade,
  constraint atkt_service check (service in ('wsfe', 'ws_sr_constancia_inscripcion')),
  constraint atkt_ta_coherent check ((token_enc is null) = (sign_enc is null) and (token_enc is null) = (expiration_time is null))
);
create index atkt_tenant_idx on public.acc_arca_tickets (tenant_id);

-- Comprobantes emitidos por WSFE (la saga de §3.2.4). Legible para lectores: no tiene secretos.
create table public.acc_arca_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  environment text not null,
  point_of_sale int not null,
  cbte_tipo smallint not null,                        -- 1 2 3 6 7 8
  number bigint,                                      -- se fija al pedir el CAE
  status text not null default 'reserved',
  client_ref uuid not null default gen_random_uuid(), -- idempotencia del asiento (acc_post_bundle)
  form jsonb not null,                                -- valores del formulario (para «Cargarla ahora»)
  request jsonb, request_sha256 text,                 -- FECAEDetRequest enviado, SIN Auth
  cae text, cae_due date, result text, fch_proceso timestamptz,
  observations jsonb not null default '[]', errors jsonb not null default '[]', events jsonb not null default '[]',
  document_id uuid,
  related_voucher_id uuid,                            -- NC/ND → la factura asociada
  total_cents bigint not null,
  issue_date date,
  reason text,                                        -- abandoned/failed: por qué
  created_by uuid not null, created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aavo_id_tenant_uq unique (id, tenant_id),
  constraint aavo_conn_fk foreign key (connection_id, tenant_id) references public.acc_arca_connections (id, tenant_id),
  constraint aavo_doc_fk foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint aavo_related_fk foreign key (related_voucher_id, tenant_id) references public.acc_arca_vouchers (id, tenant_id),
  constraint aavo_env check (environment in ('produccion', 'homologacion')),
  constraint aavo_tipo check (cbte_tipo in (1, 2, 3, 6, 7, 8)),
  constraint aavo_status check (status in ('reserved', 'requesting', 'needs_reconcile', 'authorized', 'posted', 'rejected', 'failed', 'abandoned')),
  constraint aavo_pos check (point_of_sale between 1 and 99998),
  constraint aavo_number check (number is null or number between 1 and 99999999),
  constraint aavo_cae check (cae is null or cae ~ '^[0-9]{14}$'),
  constraint aavo_cae_coherent check ((status in ('authorized', 'posted')) = (cae is not null)),
  constraint aavo_number_coherent check (status in ('reserved', 'abandoned') or number is not null),
  constraint aavo_posted check ((status = 'posted') = (document_id is not null)),
  constraint aavo_homo_no_books check (environment = 'produccion' or document_id is null),
  constraint aavo_total check (total_cents between 0 and 1000000000000000)
);
-- Una emisión viva por (bar, ambiente, PV, tipo): exclusión entre instancias sin lock durante el HTTP.
create unique index aavo_in_flight_uq on public.acc_arca_vouchers (tenant_id, environment, point_of_sale, cbte_tipo)
  where status in ('reserved', 'requesting', 'needs_reconcile');
create unique index aavo_number_uq on public.acc_arca_vouchers (tenant_id, environment, point_of_sale, cbte_tipo, number)
  where status in ('requesting', 'needs_reconcile', 'authorized', 'posted');
create unique index aavo_document_uq on public.acc_arca_vouchers (document_id) where document_id is not null;
create index aavo_conn_idx on public.acc_arca_vouchers (connection_id, tenant_id);
create index aavo_related_idx on public.acc_arca_vouchers (related_voucher_id, tenant_id) where related_voucher_id is not null;
create index aavo_attention_idx on public.acc_arca_vouchers (tenant_id) where status in ('needs_reconcile', 'authorized');
-- Trigger private.acc_tg_arca_vouchers_bu (BEFORE UPDATE/DELETE): number, cae, cae_due, request y client_ref
-- son inmutables una vez fijados; DELETE prohibido salvo la cascada del bar (mismo escape que acc_tg_accounts_biu).

create table public.acc_arca_padron_cache (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  environment text not null,
  cuit text not null,
  found boolean not null,
  data jsonb not null,             -- {name, person_kind, active, iva_condition, condicion_iva_receptor_id, monotributo_category, address, locality, province, activity}
  fetched_at timestamptz not null default now(),
  primary key (tenant_id, environment, cuit),
  constraint apad_env check (environment in ('produccion', 'homologacion')),
  constraint apad_cuit check (public.acc_cuit_is_valid(cuit)),
  constraint apad_data_size check (pg_column_size(data) <= 4096)
);

create table public.acc_guide_progress (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guide text not null,                               -- arca | arranque
  step text not null,
  done_at timestamptz not null default now(),
  done_by uuid references auth.users(id) on delete set null,
  done_by_name text not null,
  primary key (tenant_id, guide, step),
  constraint agpr_guide check (guide in ('arca', 'arranque')),
  constraint agpr_step check (step ~ '^[a-z0-9_]{2,40}$')
);
-- Lectura: aacn, aavo, apad, agpr con la política _select_readers. asec y atkt sin nada (6.1).
```

```sql
-- ═══ 20261008120200_acc_imports_core.sql ════════════════════════════════════════════════════

create table public.acc_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                               -- arca_recibidos | arca_emitidos | mp_release | bank_statement
  origin text not null default 'upload',              -- upload | api
  file_name text, file_sha256 text, file_size int,
  detected_format text,                               -- mc_g3 | mc_g2 | mc_g1 | mc_xlsx | mp_release | bank:<firma>
  period_from date, period_to date,
  treasury_account_id uuid,                           -- banco o billetera del extracto
  status text not null default 'staging',             -- staging | review | posting | done | cancelled
  counts jsonb not null default '{}',                 -- {items, new, duplicate, ignored, review, proposals, ready, needs_input, posted}
  meta jsonb not null default '{}',                   -- saldos del archivo, corte de día, generación, CUIT del título (sin datos personales)
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,                      -- «Sincronización automática» en origin = api
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  constraint aibt_id_tenant_uq unique (id, tenant_id),
  constraint aibt_source check (source in ('arca_recibidos', 'arca_emitidos', 'mp_release', 'bank_statement')),
  constraint aibt_origin check (origin in ('upload', 'api')),
  constraint aibt_status check (status in ('staging', 'review', 'posting', 'done', 'cancelled')),
  constraint aibt_file check ((origin = 'api') or (file_sha256 ~ '^[0-9a-f]{64}$' and file_size between 1 and 20971520)),
  constraint aibt_name_len check (file_name is null or char_length(file_name) <= 200),
  constraint aibt_period check (period_to is null or period_from is null or period_to >= period_from),
  constraint aibt_treasury_fk foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id)
);
create unique index aibt_file_uq on public.acc_import_batches (tenant_id, source, file_sha256)
  where file_sha256 is not null and status <> 'cancelled';
create index aibt_tenant_idx on public.acc_import_batches (tenant_id, created_at desc);
create index aibt_treasury_idx on public.acc_import_batches (treasury_account_id, tenant_id) where treasury_account_id is not null;

create table public.acc_import_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null,
  row_no int not null,
  source_family text not null,                        -- arca_recibidos | arca_emitidos | mp | bank:<treasury_id>
  natural_key text not null,
  data jsonb not null,                                -- McItem | MpItem | BankItem (zod estricto, sin datos personales)
  status text not null default 'new',                 -- new | duplicate | ignored | review | posted | cancelled
  duplicate_of uuid,
  issues jsonb not null default '[]',
  proposal_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aiit_id_tenant_uq unique (id, tenant_id),
  constraint aiit_row_uq unique (batch_id, row_no),
  constraint aiit_batch_fk foreign key (batch_id, tenant_id) references public.acc_import_batches (id, tenant_id) on delete cascade,
  constraint aiit_dup_fk foreign key (duplicate_of, tenant_id) references public.acc_import_items (id, tenant_id),
  constraint aiit_status check (status in ('new', 'duplicate', 'ignored', 'review', 'posted', 'cancelled')),
  constraint aiit_key_len check (char_length(natural_key) between 3 and 200),
  constraint aiit_family check (source_family ~ '^(arca_recibidos|arca_emitidos|mp|bank:[0-9a-f-]{36})$'),
  constraint aiit_data_size check (pg_column_size(data) <= 8192),
  constraint aiit_dup_coherent check ((status = 'duplicate') = (duplicate_of is not null))
);
-- Una fila VIVA por clave natural (los «no es nuestro» quedan vivos: se recuerdan para siempre).
create unique index aiit_live_key_uq on public.acc_import_items (tenant_id, source_family, natural_key)
  where status not in ('duplicate', 'cancelled');
create index aiit_batch_idx on public.acc_import_items (batch_id, tenant_id, status);
create index aiit_dup_idx on public.acc_import_items (duplicate_of, tenant_id) where duplicate_of is not null;

create table public.acc_import_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null,
  key text not null,                                  -- 'mc:R:30…:1:3:110266' · 'mp:2026-10-05:collection:<method>' · 'bank:<t>:2026-10-05:expense'
  form text not null,                                 -- purchase | purchase_credit_note | collection | bank_expense | transfer | cash_movement | payment
  form_values jsonb not null,                         -- *Values del formulario, sin clientRef ni previewHash
  summary jsonb not null,                             -- {date, label, counterparty, total_cents, month} para la lista
  preview_hash text,
  client_ref uuid not null,                           -- uuidV8(sha256('acc-import:'+tenant+':'+key+':'+attempt))
  attempt smallint not null default 1,
  status text not null default 'needs_input',         -- needs_input | ready | posting | posted | stale | error | skipped
  needs jsonb not null default '[]',                  -- [{key:'supplier_account', party_id}, {key:'other_taxes_as'}, …]
  warnings_ack text[] not null default '{}',
  document_id uuid, posted_at timestamptz, error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aipr_id_tenant_uq unique (id, tenant_id),
  constraint aipr_key_uq unique (batch_id, key),
  constraint aipr_batch_fk foreign key (batch_id, tenant_id) references public.acc_import_batches (id, tenant_id) on delete cascade,
  constraint aipr_doc_fk foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint aipr_form check (form in ('purchase', 'purchase_credit_note', 'collection', 'bank_expense', 'transfer', 'cash_movement', 'payment')),
  constraint aipr_status check (status in ('needs_input', 'ready', 'posting', 'posted', 'stale', 'error', 'skipped')),
  constraint aipr_hash check (preview_hash is null or preview_hash ~ '^[0-9a-f]{64}$'),
  constraint aipr_ready check (status not in ('ready', 'posting') or preview_hash is not null),
  constraint aipr_posted check ((status = 'posted') = (document_id is not null)),
  constraint aipr_key_len check (char_length(key) between 3 and 200),
  constraint aipr_values_size check (pg_column_size(form_values) <= 32768)
);
create unique index aipr_posted_key_uq on public.acc_import_proposals (tenant_id, key) where status = 'posted';
create unique index aipr_client_ref_uq on public.acc_import_proposals (tenant_id, client_ref);
create index aipr_batch_idx on public.acc_import_proposals (batch_id, tenant_id, status);
create index aipr_doc_idx on public.acc_import_proposals (document_id, tenant_id) where document_id is not null;

create table public.acc_import_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                               -- arca_recibidos | mp_release | bank_statement
  priority smallint not null default 100,
  label text not null,                                -- el «motivo» que ve la persona
  match jsonb not null,                               -- {direction?, pattern?, counterparty_cuit?, amount_min?, amount_max?, treasury_account_id?, party_id?}
  action jsonb not null,                              -- {kind, account_id?, party_id?, treasury_account_id?, field?, other_taxes_as?, jurisdiction_code?}
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint airu_id_tenant_uq unique (id, tenant_id),
  constraint airu_source check (source in ('arca_recibidos', 'mp_release', 'bank_statement')),
  constraint airu_label_len check (char_length(btrim(label)) between 2 and 120),
  constraint airu_priority check (priority between 1 and 1000),
  constraint airu_pattern check (match ->> 'pattern' is null or char_length(match ->> 'pattern') <= 200)
);
create index airu_tenant_idx on public.acc_import_rules (tenant_id, source, priority) where active;

create table public.acc_import_layouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                               -- bank_statement (por ahora)
  signature text not null,                            -- sha256(encabezados normalizados + separador)
  mapping jsonb not null,                             -- {date: 0, description: 2, debit: 4, credit: 5, balance: 6, header_row: 3, decimal: ','}
  treasury_account_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint ailo_uq unique (tenant_id, source, signature),
  constraint ailo_sig check (signature ~ '^[0-9a-f]{64}$'),
  constraint ailo_treasury_fk foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id)
);

create table public.acc_mp_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  treasury_account_id uuid not null,                  -- la caja «Mercado Pago»
  party_id uuid not null,                             -- el partícipe «Mercado Pago» (system_key mercado_pago)
  status text not null default 'csv_only',            -- csv_only | connected | reconnect | disconnected
  mp_user_id bigint, site_id text, token_last4 text, scopes text[],
  channel_methods jsonb not null default '{}',        -- {"qr":"<sales_method_id>","point":…,"transfer_in":…,"link":…}
  day_cutoff_hour smallint not null default 0,        -- 0 = día calendario · 5 = día de servicio (A CONFIRMAR)
  report_config_applied_at timestamptz,
  pending_report jsonb,                               -- {id, begin, end, requested_at} mientras Mercado Pago lo genera
  synced_through date, last_sync_at timestamptz, last_sync_status text, last_error_key text,
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint ampc_id_tenant_uq unique (id, tenant_id),
  constraint ampc_status check (status in ('csv_only', 'connected', 'reconnect', 'disconnected')),
  constraint ampc_cutoff check (day_cutoff_hour between 0 and 8),
  constraint ampc_site check (site_id is null or site_id = 'MLA'),
  constraint ampc_last4 check (token_last4 is null or token_last4 ~ '^[A-Za-z0-9-]{4}$'),
  constraint ampc_treasury_fk foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id),
  constraint ampc_party_fk foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id)
);
alter table public.acc_secrets add constraint asec_mp_fk
  foreign key (mp_connection_id, tenant_id) references public.acc_mp_connections (id, tenant_id) on delete cascade;
-- Lectura: aibt, aiit, aipr, airu, ailo y ampc con _select_readers (la contadora ve historial y reglas, sin tokens).
```

### 6.3 Funciones (RPC)

Todas son `public`, `language plpgsql`, `security definer`, `set search_path = ''`, con `revoke all … from public, anon`.

- `grant execute … to authenticated`, salvo las `*_service`, que llevan `revoke … from authenticated` y `grant … to service_role`.
- Las que leen son INVOKER `stable` con `acc_assert_reader` primero.

**ARCA** (`20261008120100_acc_arca_rpc.sql`):

| Firma | Qué hace | Errores |
|---|---|---|
| `acc_arca_save_connection(p_tenant_id uuid, p_environment text, p_patch jsonb, p_expected_updated_at timestamptz) → jsonb` | Crea la fila si no existe (`represented_cuit` = `acc_settings.cuit`, que es obligatoria) o edita: `point_of_sale`, `allowed_classes`, `default_concepto`, `emission_enabled`. Claves en lista blanca y chequeo de `stale`. Cambiar el alias con un certificado subido, error. Prender la emisión exige el CHECK `aacn_emission`. Audita `acc_arca.connection_saved` `{environment, fields}` | `sas_cuit_missing`, `stale`, `invalid_payload`, `arca_alias_locked`, `arca_emission_requires_connection` |
| `acc_arca_store_keypair(p_tenant_id, p_environment, p_alias text, p_cert_cuit text, p_private_key_pem text, p_csr_pem text, p_public_key_sha256 text, p_secret_key text, p_mode text default 'new') → jsonb` | `p_mode`: `new` (primera vez), `replace` (empezar de cero: exige confirmación si ya hay certificado) o `renew` (guarda `pending_private_key` y `pending_*` sin tocar la clave vigente). Valida formas: `-----BEGIN PRIVATE KEY-----` de hasta 4000, CSR, hash, alias y CUIT; en producción, `cert_cuit = represented_cuit`. Si ya hay certificado y `p_mode = 'new'` → error. Upsert en `acc_secrets` con `pgp_sym_encrypt`. Conexión → `key_ready`, limpia los campos del certificado, `emission_enabled = false` y borra los tickets. Audita `acc_arca.keypair_generated` `{environment, alias, public_key_sha256}`, **sin** secretos | `arca_key_replace_requires_confirm`, `invalid_payload`, `arca_cuit_mismatch` |
| `acc_arca_save_certificate(p_tenant_id, p_environment, p_certificate_pem text, p_meta jsonb, p_expected_updated_at timestamptz) → jsonb` | `p_meta = {serial_hex, subject_cuit, subject_cn, issuer, not_before, not_after, public_key_sha256}`, calculado en Node. Exige `public_key_sha256` = la guardada **o** la pendiente (renovación: la pendiente pasa a vigente y se borra la vieja), `subject_cuit = cert_cuit` y vigencia. Conexión → `cert_ready` y borra tickets. Audita `acc_arca.certificate_saved` `{environment, serial, not_after}` | `arca_certificate_key_mismatch`, `arca_certificate_cuit_mismatch`, `arca_certificate_expired`, `arca_key_missing` |
| `acc_arca_get_credentials(p_tenant_id, p_environment, p_secret_key text) → jsonb` | `{connection: (sin secretos), private_key_pem: pgp_sym_decrypt(…), certificate_pem}`. Solo en `cert_ready`, `connected` o `error`. No audita cada lectura (pasa cada 12 h por servicio) | `arca_key_missing`, `arca_not_ready` |
| `acc_arca_ticket_get(p_tenant_id, p_environment, p_service text, p_secret_key text, p_lease_seconds int default 60, p_clear_manual_cooldown boolean default false) → jsonb` | Ver el cuerpo de abajo | `arca_not_ready` |
| `acc_arca_ticket_put(p_tenant_id, p_environment, p_service, p_lease_id uuid, p_result jsonb, p_secret_key text) → void` | Si el lease coincide: si `ok`, guarda token y sign cifrados con generation y expiration; si no, `cooldown_until = now() + cooldown` (`manual` → `cooldown_manual = true`, sin fecha) y `last_error_*`. Siempre libera el lease | `arca_lease_lost` (se ignora en TS) |
| `acc_arca_record_test(p_tenant_id, p_environment, p_result jsonb) → jsonb` | Valida la forma (`checks[]` con `key` y `ok`). Guarda `last_test*`, `services` y `status` (`connected` si los chequeos 1 a 4 y 6 dan OK; si no, `error`). Si no quedó conectada → `emission_enabled = false`. Audita `acc_arca.tested` `{environment, status, failed}` | `invalid_payload` |
| `acc_arca_disconnect(p_tenant_id, p_environment, p_confirm text) → void` | Exige `p_confirm = 'DESCONECTAR'` y que no haya vouchers vivos. Borra secretos y tickets; estado `disconnected`. Audita | `confirmation_required`, `arca_voucher_in_flight` |
| `acc_arca_voucher_reserve(p_tenant_id, p_environment, p_point_of_sale int, p_cbte_tipo smallint, p_payload jsonb) → jsonb` | Exige la conexión `connected`. En producción, además, `emission_enabled` y el PV de la conexión. Lo vivo de más de 3 min: `reserved` → `abandoned`; si es `requesting` o `needs_reconcile`, devuelve `{needs_reconcile: id}`. Si no, inserta `reserved` y devuelve `{voucher_id, client_ref}` | `arca_not_connected`, `arca_emission_disabled`, `arca_point_of_sale_mismatch`, `arca_voucher_in_flight` (23505 del índice único) |
| `acc_arca_voucher_update(p_tenant_id, p_voucher_id uuid, p_to text, p_patch jsonb) → jsonb` | Transiciones válidas: `reserved` → `requesting` \| `abandoned`; `requesting` → `authorized` \| `rejected` \| `needs_reconcile`; `needs_reconcile` → `authorized` \| `failed`; `authorized` → `posted`. Para pasar a `posted`, `document_id` tiene que existir, ser `posted`, `sales_*`, con el mismo PV, número y `voucher_type` (`voucherTypeForCbte`). Audita `acc_arca.voucher_<estado>` `{environment, pv, tipo, number, total_cents, cae}` | `arca_voucher_transition`, `arca_voucher_document_mismatch` |
| `acc_arca_padron_cache_put(p_tenant_id, p_environment, p_rows jsonb) → integer` | Upsert de hasta 250 filas | `invalid_payload` |
| `acc_guide_mark(p_tenant_id, p_guide text, p_step text, p_done boolean) → void` | Inserta o borra en `acc_guide_progress` (con `acc_actor_name`) | `guide_step_invalid` |
| `acc_ensure_final_consumer(p_tenant_id) → uuid` | Crea el partícipe de sistema `consumidor_final` si no existe: `kind customer`, «Consumidor final», `tax_id_type none`, `iva_condition consumidor_final`, cuentas `payable_suppliers` y `receivable_customers`. Usa `on conflict (tenant_id, system_key) do nothing`. Audita `acc_party.saved` | — |

Cuerpo de referencia del lease (el resto sigue el mismo estilo):

```sql
create function public.acc_arca_ticket_get(p_tenant_id uuid, p_environment text, p_service text, p_secret_key text,
                                           p_lease_seconds int default 60, p_clear_manual_cooldown boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.acc_arca_connections;
  t public.acc_arca_tickets;
  v_lease uuid := gen_random_uuid();
begin
  perform public.acc_assert_writer(p_tenant_id);
  select * into c from public.acc_arca_connections x
   where x.tenant_id = p_tenant_id and x.environment = p_environment;
  if not found or c.status not in ('cert_ready', 'connected', 'error') then
    perform private.acc_raise('arca_not_ready');
  end if;
  insert into public.acc_arca_tickets (connection_id, tenant_id, service) values (c.id, p_tenant_id, p_service)
    on conflict (connection_id, service) do nothing;
  select * into t from public.acc_arca_tickets x where x.connection_id = c.id and x.service = p_service for update;
  if p_clear_manual_cooldown then
    t.cooldown_manual := false; t.cooldown_until := null;
  end if;
  if t.expiration_time is not null and t.expiration_time > now() + interval '10 minutes' then
    return jsonb_build_object('status', 'valid',
      'token', extensions.pgp_sym_decrypt(decode(t.token_enc, 'base64'), p_secret_key),
      'sign',  extensions.pgp_sym_decrypt(decode(t.sign_enc,  'base64'), p_secret_key),
      'expires_at', t.expiration_time);
  end if;
  if t.cooldown_manual or (t.cooldown_until is not null and t.cooldown_until > now()) then
    return jsonb_build_object('status', 'cooldown', 'until', t.cooldown_until, 'last_error_key', t.last_error_key);
  end if;
  if t.lease_until is not null and t.lease_until > now() then
    return jsonb_build_object('status', 'busy', 'retry_after_ms', 1500);
  end if;
  update public.acc_arca_tickets x
     set lease_id = v_lease, lease_until = now() + make_interval(secs => greatest(15, least(p_lease_seconds, 120))),
         cooldown_manual = t.cooldown_manual, cooldown_until = t.cooldown_until, updated_at = now()
   where x.connection_id = c.id and x.service = p_service;
  return jsonb_build_object('status', 'lease', 'lease_id', v_lease);
end $$;
-- pgcrypto vive en el schema `extensions` (lo confirma 20260607120200_security_hardening.sql): con search_path = ''
-- todas las llamadas van calificadas: extensions.pgp_sym_encrypt(...) / extensions.pgp_sym_decrypt(...).
```

**Importación y Mercado Pago** (`20261008120300_acc_imports_rpc.sql`):

| Firma | Qué hace | Errores |
|---|---|---|
| `acc_import_create_batch(p_tenant_id, p_batch jsonb) → jsonb` | Claves en lista blanca. Si el archivo ya está → error con detalle `{batch_id, created_at, created_by_name}`. Inserta `staging`. Audita `acc_import.batch_created` `{source, period, file_sha256}` | `import_file_already`, `invalid_payload` |
| `acc_import_add_items(p_tenant_id, p_batch_id uuid, p_items jsonb) → jsonb` | Hasta 1000 por llamada. Cada ítem `{row_no, source_family, natural_key, data, issues}`. Si ya hay una viva con la misma clave → `duplicate` con `duplicate_of`. Devuelve `{new, duplicate}` | `import_batch_closed`, `import_too_many_items` |
| `acc_import_put_proposals(p_tenant_id, p_batch_id, p_proposals jsonb) → jsonb` | Hasta 500. Upsert por `(batch_id, key)`: `form`, `form_values`, `summary`, `preview_hash`, `status`, `needs`, `warnings_ack` y `item_ids` (actualiza `proposal_keys` y el estado de las filas). `client_ref` y `attempt` solo al insertar. No toca las `posted` ni las `posting`. Si la clave ya está `posted` en otro lote → `skipped` | `import_proposal_posted`, `invalid_payload` |
| `acc_import_set_items(p_tenant_id, p_batch_id, p_changes jsonb) → jsonb` | `ignore` o `unignore` (con `issues` = motivo) | `import_batch_closed` |
| `acc_import_mark_posted(p_tenant_id, p_batch_id, p_key text, p_document_id uuid) → jsonb` | Verifica que el documento sea del bar, esté `posted` y que **su bundle tenga `client_ref` = el de la propuesta** (`acc_bundles.client_ref`). Pasa la propuesta y sus filas a `posted` y recalcula los conteos. Si no queda nada pendiente → lote `done` y auditoría `acc_import.batch_done` `{counts}` | `import_document_mismatch` |
| `acc_import_cancel_batch(p_tenant_id, p_batch_id, p_reason text) → void` | Lote `cancelled`; filas no cargadas → `cancelled`; propuestas no cargadas → `skipped`. Lo ya cargado queda. Audita | — |
| `acc_import_match_purchases(p_tenant_id, p_rows jsonb) → jsonb` (INVOKER, `stable`) | Para cada `{key, party_id, voucher_type, point_of_sale, number, total_cents, issue_date, credit}` devuelve la mejor coincidencia `{key, match: 'number'\|'amount', document_id, label}`. Es la lógica de `acc_possible_duplicate`, de a muchas filas | — |
| `acc_import_save_rule(p_tenant_id, p_rule jsonb, p_expected_updated_at) → jsonb` · `acc_import_delete_rule(p_tenant_id, p_rule_id uuid) → void` | Alta, edición o baja de reglas (el regex se valida al guardar con `'' ~ pattern`) | `invalid_payload`, `stale` |
| `acc_import_save_layout(p_tenant_id, p_layout jsonb) → jsonb` | Upsert por firma | `invalid_payload` |
| `acc_report_onboarding(p_tenant_id) → jsonb` (INVOKER, `stable`) | Los datos de §5.2.3 en una consulta | — |
| `acc_mp_save_connection(p_tenant_id, p_patch jsonb, p_expected_updated_at) → jsonb` | Crea o edita: caja, partícipe, `channel_methods` (los medios tienen que existir y estar activos) y `day_cutoff_hour` | `stale`, `invalid_payload` |
| `acc_mp_store_token(p_tenant_id, p_token text, p_meta jsonb, p_secret_key text) → jsonb` | Valida la forma (`^APP_USR-…`, A CONFIRMAR) y la cifra. Guarda `token_last4`, `mp_user_id`, `site_id`, `scopes` y `status = 'connected'`. Audita `acc_mp.connected` `{mp_user_id}` | `invalid_payload` |
| `acc_mp_get_token(p_tenant_id, p_secret_key) → text` | Para «Traer ahora» (escritor) | `mp_not_connected` |
| `acc_mp_disconnect(p_tenant_id) → void` | Borra los tokens; estado `disconnected`. Audita | — |
| `acc_mp_sync_targets_service(p_secret_key) → jsonb` · `acc_mp_sync_record_service(p_tenant_id, p_patch jsonb) → void` | **Solo `service_role`.** Bares con flag `accounting` y Mercado Pago `connected`, con su token descifrado, caja, corte y estado del sync / registrar el resultado del tick | — |
| `acc_import_create_batch_service(p_tenant_id, p_batch jsonb)` · `acc_import_add_items_service(p_tenant_id, p_batch_id, p_items jsonb)` | **Solo `service_role`.** Mismas reglas, con `created_by = null` y `created_by_name = 'Sincronización automática'` | — |

### 6.4 Claves de error nuevas (texto en `lib/accounting/errors.ts`, bloque nuevo)

`sas_cuit_missing` (ya existe como aviso de cierre: se reusa el texto), `arca_not_ready`, `arca_not_connected`, `arca_alias_locked`, `arca_cuit_mismatch`, `arca_key_missing`, `arca_key_replace_requires_confirm`, `arca_certificate_key_mismatch`, `arca_certificate_cuit_mismatch`, `arca_certificate_expired`, `arca_emission_requires_connection`, `arca_emission_disabled`, `arca_point_of_sale_mismatch`, `arca_voucher_in_flight`, `arca_voucher_transition`, `arca_voucher_document_mismatch`, `arca_lease_lost`, `confirmation_required`, `guide_step_invalid`, `import_file_already`, `import_batch_closed`, `import_too_many_items`, `import_proposal_posted`, `import_document_mismatch`, `mp_not_connected`.

**Los textos de ARCA** (los que vienen del web service y no de la base) viven en `lib/arca/errors.ts` (§2.7).

### 6.5 Antes de pedir el OK para aplicar

1. Correr los `scratchpad/sqltests/acc_arca_*.sql` y `acc_imports_*.sql` con `begin … rollback` en `acct-dryrun`:
   - creación, CHECK, índices únicos parciales (dos emisiones vivas chocan; dos filas vivas con la misma clave chocan) y transiciones válidas e inválidas;
   - lease del ticket: dos llamadas seguidas → la segunda da `busy`;
   - cifrado y descifrado con una clave de prueba;
   - lectura como contadora (ve conexiones y vouchers, **no** secretos ni tickets);
   - lectura como dueño sin acceso (no ve nada);
   - `anon` no ve nada.
2. `select * from public.acc_privilege_gaps()` y `select * from public.acc_isolation_gaps()` → 0 filas.
3. Tests de RLS en CI (`tests/rls/acc-arca.test.ts`, `tests/rls/acc-imports.test.ts`): aislamiento entre bares y contadora sin escritura en las RPC.
4. **`pgcrypto` está en el schema `extensions`.** Lo confirma `20260607120200_security_hardening.sql`, que les fijó a `encrypt_meta_token` y `decrypt_meta_token` `search_path = public, extensions, pg_temp`. Las RPC nuevas usan `search_path = ''` (regla del módulo) y por eso califican `extensions.pgp_sym_encrypt` y `extensions.pgp_sym_decrypt`.

---

## 7. Plan por fases y paquetes de trabajo (archivos disjuntos)

**Reglas del plan:**

- **Cada archivo pertenece a un solo paquete.** Los compartidos tienen dueño:
  - `lib/accounting/errors.ts` → WP3;
  - `lib/xml/mini.ts` → WP2;
  - `components/administracion/guias/**` → WP7 (WP10 y WP11 lo importan);
  - `lib/accounting/server/post-document.ts` → WP9;
  - `lib/accounting/voucher-types.ts` → WP10.
- Commits chicos con Conventional Commits.
- Cada paquete cierra con sus tests unitarios en verde, `npm run typecheck`, `npm run lint` y un **smoke manual documentado** (CLAUDE.md §10–§11).
- Todo lo visual se le muestra a Nacho antes de `main` (memoria `vista-previa-antes-de-produccion`).
- **No se borran los datos del bar demo:** las pruebas de homologación se hacen ahí.

### Fase 0 · Decisiones y prerrequisitos (dueño y contadora, en paralelo con la fase 1)

- Responder las preguntas de §8 que bloquean: P-O1 a P-O4, P-T3 y P-O10.
- Crear `ACC_SECRETS_KEY` en Vercel (producción y preview) y en `.env.local` (`openssl rand -base64 32`), y **guardarla en un gestor de contraseñas**: si se pierde, no se pueden descifrar los secretos (R9).

### Fase 1 · Cimientos sin UI (cuatro paquetes en paralelo)

| WP | Archivos (todos nuevos salvo que se diga) | Depende de | Hecho cuando |
|---|---|---|---|
| **WP1 · Cripto de ARCA** | `lib/arca/der.ts`, `pem.ts`, `csr.ts`, `cert.ts`, `cms.ts` · `scripts/arca/make-fixtures.sh`, `scripts/arca/emit-cms-fixture.mts` · `tests/fixtures/arca/*` (clave, CSR, certificado y CMS de prueba; CUIT sintéticas) · `tests/lib/arca-{der,csr,cert,cms}.test.ts` | — | Tests verdes. `openssl cms -verify` OK sobre el CMS generado (a mano, documentado en el PR) |
| **WP2 · SOAP de ARCA** | `lib/xml/mini.ts` · `lib/arca/{endpoints,transport,soap,wsaa,wsfe,padron,vouchers,importes,errors,guide}.ts` · `tests/fixtures/arca/xml/*` (respuestas reales anonimizadas de la investigación y las de los manuales) · `tests/lib/{xml-mini,arca-wsaa,arca-wsfe,arca-padron,arca-importes,arca-errors,arca-transport,arca-guide}.test.ts` · `scripts/arca/smoke.mts` (con red, fuera de CI) | WP1 solo para `wsaaLogin` (interfaz acordada: `signTra(tra, certPem, keyPem, now)`) | Tests verdes. `smoke.mts` hace `FEDummy` en homologación y en producción desde la compu del dev |
| **WP3 · Base** | `supabase/migrations/2026100812{0000,0100,0200,0300}_*.sql` · `scratchpad/sqltests/acc_{arca,imports}_*.sql` · `tests/rls/acc-arca.test.ts`, `tests/rls/acc-imports.test.ts` · `lib/accounting/errors.ts` (bloque de claves nuevas) | — | Ensayo con `rollback` en `acct-dryrun`. Detectores en 0. **Aplicada solo con el OK de Nacho** (P-O10) |
| **WP4 · Parsers de importación** | `lib/imports/{bytes,csv,zip,xlsx,html-table,hash,amounts,dates,headers,detect,types}.ts` · `lib/imports/arca/mis-comprobantes.ts` (port de `mc-parse.ts`) · `lib/imports/mercadopago/release.ts` · `lib/imports/bank/{statement,rules,grouping}.ts` · `scripts/imports/make-fixtures.mts` (**generador sintético**: G1, G2 y G3, Excel, Windows-1252, «pasado por Excel», Liquidaciones con `TAXES_DISAGGREGATED` sin comillas, extracto con D/C, signo y saldo) · `tests/fixtures/imports/*` · `tests/lib/imports-*.test.ts` | WP2 (`lib/xml/mini.ts`, para XLSX) | Tests verdes. Las 53 descripciones de `banco-scripts/check-rules.mjs` caen en su regla. Los conteos de `arca-mis-comprobantes.md` §9.5 se reproducen con fixtures sintéticos de la misma forma |

### Fase 2 · Servidor (dos paquetes en paralelo)

| WP | Archivos | Depende de | Hecho cuando |
|---|---|---|---|
| **WP5 · Servidor de ARCA** | `lib/arca/{schemas,secrets,session,queries,actions}.ts` · `tests/lib/arca-session.test.ts` (RPC y transporte falsos: lease, cooldown, reintento) | WP1, WP2, WP3 | Desde la consola de la preview (o con un test de integración con la base de ensayo): generar CSR, subir el certificado de WSASS, guardar PV, **«Probar conexión» en homologación desde la preview de Vercel** (P-T1) |
| **WP6 · Servidor de importaciones** | `lib/imports/server/{stage,post,queries}.ts` · `lib/imports/server/proposals/{arca,mp,bank}.ts` · `lib/imports/actions.ts` · `lib/accounting/onboarding.ts` · `lib/accounting/queries/{onboarding,integrations}.ts` · `tests/lib/imports-proposals-{arca,mp,bank}.test.ts` (con `tests/lib/accounting-core-context.ts`: cada propuesta pasa por zod y por su `build*` y cuadra) | WP3, WP4 (WP5 opcional, para el padrón en lote) | Un lote sintético de cada origen: se arma, se propone y se confirma contra la base de ensayo. Reintentar no duplica (idempotencia por `client_ref`) |

### Fase 3 · Pantallas (cinco paquetes en paralelo; arrancan con stubs de las acciones)

| WP | Archivos | Depende de | Hecho cuando (smoke) |
|---|---|---|---|
| **WP7 · Pestaña y guía de ARCA** | `ajustes/page.tsx` (TABS + `case 'arca'`) · `ajustes/_components/{arca-panel,arca-actions}.tsx` · `ajustes/arca/{page,loading}.tsx` · `components/administracion/guias/{guide-step,guide-rail}.tsx` · `components/administracion/guias/arca-mock/**` · `components/administracion/guias/how-to/**` | WP5 | Recorrer la guía completa en homologación (bar demo): estados automáticos y manuales, maquetas a 375 px y 1280 px, claro y oscuro, teclado. Pestañas de Ajustes a 1280 px con el menú abierto (§2.2) |
| **WP8 · Completar con ARCA** | `components/administracion/arca-lookup.tsx` · ediciones en `components/administracion/cajas-ventas/quick-party-dialog.tsx`, `configurar/_components/new-party-dialog.tsx`, `compras/proveedores/[id]/_components/supplier-data-form.tsx` y `compras/nueva/_components/purchase-form.tsx` (solo el bloque de proveedor nuevo) | WP5 | Alta de un proveedor por CUIT en homologación: datos de prueba, caché, CUIT inválida, sin conexión |
| **WP9 · Emisión** | `lib/arca/emit.ts` · `ventas/nueva-factura/{page.tsx,_components/sales-invoice-form.tsx}` (modo ARCA y arreglo de `letterFor`) · `comprobantes/[id]/page.tsx` (tarjeta «Autorización de ARCA» + [Imprimir factura]) · `app/print/factura/[tenantSlug]/[documentId]/{page.tsx,_components/*}` · `lib/accounting/server/post-document.ts` (exportar `postBuiltBundle`) · `tests/lib/arca-emit.test.ts`, `tests/lib/arca-print.test.ts` (leyendas y QR) | WP5, WP3 | En homologación (bar demo, **sin asiento**): «Emitir una factura de prueba» B, A y NC B. Con red cortada a mano (`ARCA_FAKE_TIMEOUT=1`, que se ignora si `NODE_ENV === 'production'`): queda `needs_reconcile` y se reconcilia. En producción solo después del OK y con una venta real |
| **WP10 · Pantallas de importación** | `importar/{page,loading}.tsx` · `importar/arca/*` · `importar/mercado-pago/*` (deja `components/administracion/importar/mp-connect-card.tsx` como lugar reservado para WP12) · `importar/banco/*` · `importar/[batchId]/*` · `components/administracion/importar/**` · botón en `compras/page.tsx` · `cajas/_components/cajas-header-actions.tsx` · etiqueta del código 51 en `lib/accounting/voucher-types.ts` · entradas de ⌘K en `components/command-palette/command-config.ts` | WP6 | Los tres importadores con archivos sintéticos en el bar demo: subir, revisar, completar lo que falta, confirmar en tandas, reimportar el mismo archivo («ya importaste…») y un archivo solapado (duplicados) |
| **WP11 · Cómo arrancar y Resumen** | `guias/{page,loading}.tsx` · `guias/como-arrancar/{page,loading}.tsx` · `components/administracion/guias/onboarding/**` · `_resumen/first-steps.tsx` (link) · `_resumen/attention-list.tsx` + `administracion/page.tsx` (suma la segunda fuente) | WP6 | Checklist con el estado real del bar demo, ítems manuales, «Lo próximo», 375 px y 1280 px |

### Fase 4 · Automatización extra

| WP | Archivos | Depende de | Hecho cuando |
|---|---|---|---|
| **WP12 · Mercado Pago por API** | `lib/mercadopago/{client,reports}.ts` · `lib/cron/schedule.ts` (tarea `'mp_sync'`) · `lib/cron/dispatch.ts` · `components/administracion/importar/mp-connect-card.tsx` · `tests/lib/mercadopago-*.test.ts` | WP10, WP6, WP3. **Primero calibrar el parser con un reporte real de HUB** (P-O8) | Token conectado en el bar real (con OK), un día sincronizado y confirmado, 401 simulado → «Reconectá» |
| **WP13 · Emitidos → cierres** (opcional) | `lib/imports/arca/emitidos-to-close.ts` · `ventas/cierre/_components/sales-close-form.tsx` (botón «Traer lo facturado desde ARCA») | WP4, WP10 | Un día de Emitidos sintético completa las filas facturadas del cierre y cuadra |
| **WP14 · Documentación** | `.env.example` (`ACC_SECRETS_KEY`; `ARCA_RELAY_URL` y `ARCA_RELAY_SECRET` comentadas) · CLAUDE.md §15 (variable nueva; requiere OK) · `docs/features/arca-e-importaciones.md` · `BACKLOG.md` (lo de §8 que queda afuera) | Todos | README de la feature y PR con el smoke |

**Camino crítico al primer valor:** WP1+WP2+WP3 → WP5 → WP7 (conexión) → WP8 (padrón). En paralelo: WP4 → WP6 → WP10 (Mis Comprobantes primero) → WP11. La emisión (WP9) entra cuando el smoke de homologación está OK y el dueño lo aprueba.

---

## 8. Riesgos y preguntas abiertas

### 8.1 Lo que tiene que dar el dueño (P-O)

| # | Qué | Para qué | Bloquea |
|---|---|---|---|
| P-O1 | **CUIT de la SAS** y confirmación de: responsable inscripto, actividad (CLAE; ¿561014?), Domicilio Fiscal Electrónico activo y el local declarado como «Locales y establecimientos» | CSR, prueba de conexión y que ARCA no rechace con 10000 | WP5 en producción |
| P-O2 | **Quién es el administrador de relaciones** de la SAS y si tiene clave fiscal **nivel 3** | Es quien hace la guía | Conexión de producción |
| P-O3 | **Puntos de venta que usa Thinkeon**, y si Thinkeon emite por web services o por controlador fiscal | Elegir uno libre para la plataforma (10016) | Paso 2 |
| P-O4 | **¿Tienen Factura A habilitada?** (resultado del F. 856) y si van a facturar a empresas | Letras que ofrece la emisión | WP9 en producción |
| P-O5 | Mercado Pago: ¿la cuenta es de la SAS? ¿Las tarjetas se cobran con Point o con Posnet? ¿Liberación al instante? ¿Van a crear el token? | Mapeo de canales a medios y sync | WP10 (Mercado Pago), WP12 |
| P-O6 | Banco: ¿NE24 o BNA+ Empresas? **Una exportación de movimientos real** (CSV, XLS o TXT) y el **PDF del resumen** del mismo período. ¿Interbanking? | Calibrar el parser y el mapeo | WP10 (banco) |
| P-O7 | Que quien tenga clave fiscal **recorra la guía contra el ARCA real** y saque capturas (sirve hacerlo durante la conexión real) | Corregir los textos A CONFIRMAR de las maquetas | Publicar la guía «final» |
| P-O8 | El **primer ZIP real de Mis Comprobantes Recibidos** y un **CSV de Liquidaciones** de Mercado Pago (se anonimizan antes de usarlos como fixtures) | Calibrar los importadores con datos de HUB | Cerrar WP10 y WP12 |
| P-O9 | Una **exportación del cierre de caja de Thinkeon** | Automatizar la parte «cómo te pagaron» del cierre del día | Futuro (fase 4+) |
| P-O10 | **OK para aplicar las migraciones en producción** (el Supabase remoto es producción) | WP3 | Fase 2 |
| P-O11 | **OK para crear `ACC_SECRETS_KEY`** en Vercel y para documentarla en CLAUDE.md §15 | Cifrado | WP5 |
| P-O12 | ¿Quién de los socios tiene acceso de escritura en Administración en el bar real? Ver, conectar y emitir exige `write` | Asignar accesos antes de la guía | Conexión |

### 8.2 Decisiones de la contadora (P-C)

| # | Pregunta | Default de este diseño mientras tanto |
|---|---|---|
| P-C1 | ¿Concepto 1 (productos), 2 (servicios) o 3 para eventos y catering? ¿Fechas de servicio? | 1, editable por factura |
| P-C2 | Recibos recibidos (4, 9, 15): ¿gasto o constancia de pago de una factura? | Para revisar, sin cargar solos |
| P-C3 | «Otros Tributos» de Mis Comprobantes: ¿cómo se clasifica por defecto? ¿Usamos el CSV de Portal IVA para discriminarlos? | Para revisar, con «recordar por proveedor» |
| P-C4 | Propinas por QR: ¿cuenta «Propinas a distribuir» (pasivo)? | Para revisar |
| P-C5 | Mercado Pago y cierres: ¿día calendario o día de servicio (corte 05:00)? | Calendario |
| P-C6 | Ley 25.413: ¿HUB es micro o pequeña MiPyME (100 % computable) o queda en 33 %? | 33 % (el `bank_tax_*_computable_bp` actual) |
| P-C7 | IIBB: ¿contribuyente local de Córdoba o Convenio Multilateral? | Lo que diga Datos de la SAS |
| P-C8 | Comisiones bancarias en el Libro IVA: ¿con qué tipo y número de comprobante? | Fuera del libro (al costo) hasta que lo defina |
| P-C9 | Factura impresa: «Otros Impuestos Nacionales Indirectos» (Ley 27.743) para HUB y leyenda provincial de Córdoba | IVA contenido; el otro renglón en $ 0 |
| P-C10 | Prorrata del crédito fiscal (`vat_computable_cents`) | Todo el IVA de A y M computable |
| P-C11 | Facturas que llegan tarde: ¿mes del libro según la fecha de la factura o la de recepción? | La de la factura (y el primer día abierto si el mes está cerrado) |

### 8.3 Técnicas a confirmar (P-T)

| # | Qué | Cómo se confirma o se mitiga |
|---|---|---|
| P-T1 | POST autenticado a ARCA desde Vercel **pdx1** (AWS us-west-2) | «Probar conexión» de homologación desde una preview (WP5). Plan B: `relayTransport` |
| P-T2 | Formato del `.crt` de producción (PEM o DER) | Se aceptan los dos (`classifyUpload`) |
| P-T3 | **Cifrado:** pgcrypto en RPC (D4, la clave en texto plano y la de entorno viajan a la base en la misma llamada, igual que hoy con Meta) contra **AES-256-GCM en Node** (`node:crypto`; la clave nunca sale de la función y la base guarda solo el texto cifrado; se aparta de la letra de CLAUDE.md §5) | Decisión del dueño. El diseño queda con D4 por CLAUDE.md. Si se elige Node, cambian solo las RPC de secretos (reciben y devuelven texto cifrado) y `lib/arca/secrets.ts`. Con D4, verificar que `log_min_duration_statement` y pgaudit no registren parámetros |
| P-T4 | Duración máxima de funciones en el plan de Vercel (Hobby) y tamaño de las server actions | Diseño en tandas (≤ 15 comprobantes, ≤ 800 filas): funciona con cualquier límite razonable |
| P-T5 | Sumar `ley_25413` a las deducciones de `collection` (tocar `private.acc_validate_line` y `DEDUCTION_KINDS`) | v1: `bank_expense` aparte sobre Mercado Pago. v2: un comprobante con la extensión del motor |
| P-T6 | `coe.alreadyAuthenticated` después de renovar (¿por certificado o por DN?) | Mensaje «esperá 2 a 10 minutos» y cooldown |
| P-T7 | Mercado Pago: `SUB_UNIT` y `OPERATION_TAGS` de Point y link en Argentina; SIRTAC y SIRCUPA de Córdoba en `TAXES_DISAGGREGATED`; si una app sin `write` genera reportes; si el token vence | Primer reporte real (P-O8). Reglas editables y lo desconocido a revisión |
| P-T8 | Mis Comprobantes: «más de 500 → solo CSV», celdas de Excel con tipo, otras monedas | Se pide el CSV/ZIP; el parser tolera |
| P-T9 | `DecompressionStream('deflate-raw')` en los navegadores de los socios (Safari ≥ 16.4) | Respaldo: se manda el ZIP (≤ 1 MB) al servidor y lo descomprime `zlib` |
| P-T10 | Fecha oficial del rechazo sin `CondicionIVAReceptorId` (01/12/2026 según fuentes secundarias) y manual v4.8 | Da igual: se manda siempre |
| P-T11 | Base del QR (`arca.gob.ar` o `afip.gob.ar`) y documento del receptor con documento 99 | Configurable en `lib/arca/vouchers.ts` |
| P-T12 | Tope del monto de la B anónima que valida el WS (RG 5700: $10.000.000) | Constante configurable. Si ARCA rechaza, el error lo dice |
| P-T13 | Ancho de las 9 pestañas de Ajustes a 1280 px | Chequeo visual en WP7 |
| P-T14 | Facturas «A con leyenda» por web services: el 51 («Operación sujeta a retención») y la de «Pago en CBU informada» (¿código 1 con el CBU en `Opcionales`?) | Fuera de la v1. Si la SAS queda con alguna de esas, se suma el tipo (`aavo_tipo`, `adoc_voucher_kind` en ventas y `CBTE_TIPO`) en una migración propia |

### 8.4 Producto y normativa (P-P)

- **P-P1** Modelo de certificados: uno por bar (v1) o delegación a una CUIT de studiOS cuando haya varios bares (mejor UX: el bar solo «delega»). Exige que studiOS tenga CUIT y asuma el rol de proveedor (`arca-tecnico.md` §3.4).
- **P-P2** Mis Comprobantes **sin automatizar el portal**, por la Disposición AFIP 74/2022, art. 11. Si el dueño quisiera automatización total, es una decisión de riesgo suya: tercerizarla con su propia clave delegada y nunca guardar la clave fiscal en la plataforma (CLAUDE.md §9; `arca-mis-comprobantes.md` §7.3).
- **P-P3** ¿Confirmar solo lo que cuadra al centavo cuando llega por cron (Mercado Pago)? v1: no; siempre lo confirma una persona (D7).
- **P-P4** Chequeo semanal de proveedores apócrifos (archivo público APOC): sería una tabla de referencia **sin `tenant_id`**, una excepción a CLAUDE.md §4.1, y necesita OK. Queda en `BACKLOG.md`.
- **P-P5** Mandar la factura al cliente por mail o WhatsApp desde la plataforma: después (en v1, PDF y descarga).
- **P-P6** Mercado Pago por OAuth (180 días + refresh) cuando haya varios bares: queda anotado.

### 8.5 Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Las pantallas de ARCA cambian y la guía queda vieja | Sellos «Puede verse distinto», textos exactos donde están confirmados, P-O7 y links a los PDF oficiales |
| R2 | El punto de venta nuevo tarda en verse en WSFE | El texto lo anticipa; la prueba se puede repetir |
| R3 | Thinkeon comparte el certificado o el punto de venta | Alias y PV propios (pasos 2 y 6); mensaje específico para `alreadyAuthenticated` y 10016 |
| R4 | Hay CAE pero falla el asiento | Saga persistida, aviso destacado, «Cargarla ahora» idempotente; **nunca** se reemite |
| R5 | ARCA empieza a bloquear IP de afuera | `ArcaTransport` + relay en Argentina (diseñado, no implementado) |
| R6 | Mercado Pago o ARCA cambian columnas sin avisar | Parsers por encabezados con sinónimos, firma del formato, «lo desconocido a revisión» y fixtures por generación |
| R7 | Duplicados entre lo cargado a mano y lo importado | Coincidencias fuerte y débil, transferencias ±3 días y revisión |
| R8 | Lotes grandes (60 días de Mercado Pago) | Parseo en el navegador, tandas, agrupado por día |
| R9 | Se pierde `ACC_SECRETS_KEY` | Guardarla fuera de Vercel. Sin ella: «Desconectar» y repetir los pasos 5 a 9 (la clave se regenera) y volver a pegar el token de Mercado Pago. `key_version` permite rotar |
| R10 | Las facturas de proveedores llegan tarde a ARCA | Ventana solapada «del 1 del mes anterior a hoy, después del 11» |
| R11 | Cambios normativos (WSFE v4.8, RG nuevas) | Campos obligatorios siempre enviados (`CondicionIVAReceptorId`). Errores mapeados con un texto genérico de respaldo, con el código |
| R12 | La contadora no está de acuerdo con un mapeo | Todo pasa por revisión, las reglas son editables y nada se contabiliza sin confirmar |

---

## 9. Fuentes

**Investigación de esta tarea** (todas con sus citas a fuentes oficiales y secundarias): `arca-tecnico.md`, `arca-pasos.md`, `arca-mis-comprobantes.md`, `mercadopago.md`, `banco.md`. El código de referencia probado está en `research/ref/` (`der.mjs`, `csr.mjs`, `cms.mjs`) y `research/scripts/mc-parse.ts`, y las reglas del banco en `banco-scripts/check-rules.mjs`.

**Oficiales citadas en este diseño:**

- WSFEv1, manual del desarrollador v4.7: https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
- WSAA, especificación técnica 1.2.2: https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf · manual del desarrollador: https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf
- Certificado de producción: https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf · asociarlo a un WSN: https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf · delegación: https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf
- WSASS (homologación): https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf
- Constancia de inscripción (padrón): https://www.afip.gob.ar/ws/WSCI/manual_ws_sr_ws_constancia_inscripcion.pdf
- QR del comprobante: https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
- RG 5614/2024 (Transparencia Fiscal al Consumidor): https://www.argentina.gob.ar/normativa/nacional/norma-407183/texto
- RG 5824/2026 (puntos de venta): https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5824-2026-423160/texto
- RG 5762/2025 (fin de la Factura M, A con leyendas): https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5762.pdf
- Mercado Pago, reporte de Liquidaciones (API y campos): https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/api · https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/report-fields
- Mercado Pago, credenciales: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/credentials

**Secundarias citadas:**

- Disposición AFIP 74/2022 (prohíbe automatizar el portal): https://www.iprofesional.com/impuestos/361599-contadores-afip-prohibio-la-simplificacion-mediante-bots
- Problema de DH de 1024 bits con OpenSSL ≥ 3.2: https://openssl-library.org/news/openssl-3.2-notes · Node 22.20.0 trae OpenSSL 3.5.2: https://nodejs.org/en/blog/release/v22.20.0 · arcasdk #104: https://github.com/ralcorta/arcasdk/issues/104
- Leyendas del PDF (Ley 27.743 y Ley 27.618): https://github.com/ralcorta/arcasdk/issues/224
- Fecha de rechazo sin condición de IVA del receptor (01/12/2026): https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/

**Repo (solo lectura):**

- `supabase/migrations/20261007120400_acc_core_tables.sql` (tablas, CHECK, RLS cerrada).
- `…120500_acc_access_rls.sql` (lectores y escritores, asserts, auditoría).
- `…120830_acc_rpc_posting_core_post.sql` (`acc_post_bundle`).
- `…120930_acc_periods_integrity.sql` (`acc_privilege_gaps`).
- `…120200_accountant_isolation.sql` (`acc_isolation_gaps`).
- `20260504050000_phase5_meta_channels.sql` y `20260607120200_security_hardening.sql` (pgcrypto en `extensions`).
- `lib/accounting/{server/post-document.ts,server/document-forms.ts,posting/*,schemas.ts,voucher-types.ts,iva.ts,preview.ts,access.ts}`.
- `lib/meta/crypto.ts`, `lib/cron/{schedule,dispatch}.ts`, `vercel.json`.
- `app/(manager)/[tenantSlug]/administracion/{ajustes,ventas/nueva-factura,compras,cajas,_resumen,configurar}/**`, `components/administracion/**`, `components/shell/section-tabs*.ts*`.
- Guía de estilo: `scratchpad/design/admin-ui.md`.
