# Fase 1 · Estado al cierre (ARCA e importadores de Administración)

> **Fecha:** 08/10/2026 · **Rama:** `feat/administracion` · **Nada commiteado ni aplicado a la base.**
> Insumos: `diseno.md` (§1, §2, §4, §6, §7) y los cinco reportes de paquete (WP1 cripto, WP2 SOAP + `lib/xml`,
> WP3 base, WP4 parsers). Este archivo lo escribió el paquete de cierre después de revisar los contratos entre
> paquetes y la seguridad, y de correr todos los chequeos.

---

## 0. Resumen

- **Todo verde.** `tsc` (completo, sin incremental) 0 errores · `npm run lint` 0 diagnósticos · `npm run test:ci`
  235 archivos y 4136 tests OK (33 archivos / 282 tests salteados, entre ellos los 27 de RLS que necesitan el
  Supabase de CI).
- **El cierre cambió tres cosas** (detalle en §5 y §7):
  1. `acc_arca_ticket_get` (migración 120110, sin aplicar): con una clave de servidor equivocada ya **no borra** un
     ticket del WSAA vigente; corta con `secret_unreadable` sin tocar nada. Antes, un deploy con otra clave (una
     preview, por ejemplo) dejaba a producción sin ARCA hasta 12 h (`coe.alreadyAuthenticated`).
  2. `readZipEntry` le pasa al descompresor el tamaño que declara el ZIP como tope: una «bomba» (ZIP que declara
     10 bytes y descomprime 50 MB) ahora corta a los 10 bytes en vez de inflar todo y recién ahí fallar.
  3. `openTable` deja de leer un CSV apenas pasa las 200.000 filas (antes armaba el archivo entero y después
     chequeaba).
- **Para arrancar la fase 2 falta una sola cosa externa:** el **«sí» de Nacho** para aplicar las 12 migraciones
  (lista exacta y orden en §6.1). El resto de la fase 2 (WP5 y WP6) puede arrancar ya contra los contratos de §6.2–§6.3.

---

## 1. Chequeos (resultados exactos)

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit -p /Users/ignaciobaldovino/Hub_main` (al empezar, incremental) | exit 0 |
| `npx tsc --noEmit -p /Users/ignaciobaldovino/Hub_main --incremental false` (al terminar) | exit 0 (12,9 s) |
| `tsc` de los dos `.mts` (fuera del `include` del tsconfig) con un tsconfig descartable que extiende el del repo | exit 0 (`scripts/arca/smoke.mts`, `scripts/imports/make-fixtures.mts`) |
| `npm run lint` (Biome) | exit 0 · «Checked 1531 files … No fixes applied.» |
| `npx biome check --write` sobre los 4 archivos que tocó el cierre | «Checked 4 files … No fixes applied.» |
| `npm run test:ci` (al empezar) | exit 0 · 234 archivos OK / 33 salteados · 4132 tests OK / 282 salteados |
| `npm run test:ci` (al terminar) | exit 0 · **235 archivos OK / 33 salteados · 4136 tests OK / 282 salteados** |
| Tests de la fase 1 solos (`xml-mini`, `arca-*`, `imports-*`, paridad, `tests/rls/acc-*`) | **739 OK · 27 salteados (RLS) · 0 fallas** |
| Paridad `raise exception '<clave>'` (migraciones `acc_*`) ↔ `ACC_ERRORS` | OK (no salteado): las 33 claves distintas de las 12 migraciones nuevas tienen texto |
| Escaneo «safeupdate» propio (comentarios y literales fuera; cuerpos de función adentro) | **41 sentencias UPDATE/DELETE, 0 sin WHERE** (coincide con un grep simple: 41) |
| Ensayo local (PG17 descartable del scratchpad, cadena completa de las 12 migraciones) | **12/12 archivos · 281/281 chequeos** (120110 ahora 22/22) |
| Ensayo en la base real con `begin … rollback` (MCP `execute_sql`) de la 120110 modificada | **21/21** · después: 0 bares `acct-dryrun*`, ni tablas ni funciones `acc_arca*` en producción |
| Privilegios en la cadena local (`has_table_privilege`) | `acc_secrets` y `acc_arca_tickets`: nada para `anon`, `authenticated` ni `service_role`, RLS prendida, 0 políticas. Legibles: `authenticated` solo SELECT, `anon` nada |
| Detectores en la cadena local | `acc_privilege_gaps` 0 · `acc_isolation_gaps` 0 · `acc_rpc_isolation_gaps` 0 |
| OpenSSL 3.6.2 sobre los fixtures de WP1 (re-hecho en el cierre) | `our.cms.der` y `our-issued.cms.der`: «CMS Verification successful», contenido = `tra.xml` byte a byte; `our-issued` también verifica la cadena contra `ca.crt`; `openssl.csr`: «self-signature verify OK» |
| Logging de la base real (solo lectura, `pg_settings` y `pg_roles`) | ver §5.1: hoy no se registran parámetros de las RPC |

Lo que **no** se pudo correr acá: los 27 tests de `tests/rls/acc-{arca,imports}.test.ts` (necesitan el Supabase
local del job `rls` de CI; corren solos en el PR) y el login real al WSAA (no hay certificado de homologación todavía).

---

## 2. Qué existe

### 2.1 Mapa de paquetes

| Paquete | Archivos | Corre en |
|---|---|---|
| `lib/xml/mini.ts` (WP2) | lector de XML sin dependencias | navegador y Node |
| WP1 · cripto | `lib/arca/{der,pem,csr,cert,cms}.ts` | `der`/`pem`: Node (`Buffer`); `csr`/`cert`/`cms`: **`server-only`** |
| WP2 · SOAP | `lib/arca/{endpoints,soap,wsfe,padron,vouchers,importes,errors,guide}.ts` (puros) · `lib/arca/{transport,wsaa}.ts` (**`server-only`**) | puros: navegador y Node |
| WP4 · parsers | `lib/imports/{types,bytes,csv,zip,xlsx,html-table,hash,amounts,dates,headers,detect}.ts` · `lib/imports/arca/mis-comprobantes.ts` · `lib/imports/mercadopago/release.ts` · `lib/imports/bank/{statement,rules,grouping}.ts` | navegador y Node (verificado: los 40 módulos alcanzables no importan `server-only` ni `node:*`) |
| WP3 · base | 12 migraciones `supabase/migrations/20261008120{000…330}_*.sql` · `tests/rls/acc-{arca,imports}.test.ts` · bloque nuevo de claves en `lib/accounting/errors.ts` | — |

### 2.2 API exportada (lo que va a usar la fase 2)

**`lib/xml/mini.ts`**: `parseXml(text): XmlNode` (raíz; ignora prefijos; nunca expande un DTD; sin recursión;
`MAX_DEPTH = 512`; `XmlParseError` sin copiar texto del documento) · `child`, `childrenNamed` (siempre array),
`nodeAt(n, 'a/b')`, `textAt(n, 'a/b'): string | null`, `findFirst`, `findAll`, `textOf`, `attr` · `decodeEntities`,
`escapeXml`.

**WP1 (`lib/arca/der|pem|csr|cert|cms`)**
- `der.ts`: `ArcaCryptoError { code: 'invalid_der'|'invalid_input'|'invalid_cuit'|'invalid_subject'|'invalid_key'|'not_a_certificate'|'key_mismatch'|'invalid_service' }`,
  constructores DER (`tlv, seq, set, setOf, int, oid, nul, octet, utf8, printable, bitString, utcTime, generalizedTime, derTime, explicit, implicitConstructed`) y lectores (`readTLV, children, parseDer, readOid, readInteger, readString, readTime`).
- `pem.ts`: `toPem(der, label)`, `pemBlocks`, `fromPem`, **`classifyUpload(bytes): 'certificate'|'csr'|'private_key'|'pkcs12'|'unknown'`** (nunca tira), `extractCertificateDer`, **`CERT_UPLOAD_MAX_BYTES = 16384`**.
- `csr.ts`: `generateRsaKeyPair()` (RSA 2048, PKCS#8 PEM) · `buildCsr({ privateKeyPem, cuit, organization, commonName })` · **`generateKeyAndCsr({ cuit, organization, commonName }) → { privateKeyPem, csrPem, publicKeySha256 }`** · `publicKeySha256(spkiDer)` · `loadRsaPrivateKey`, `normalizeCsrSubject`.
- `cert.ts`: **`parseCertificate(pemOrDer)` (= `inspectCertificate`) → `{ pem, serialHex (MAYÚSCULAS), subjectCuit, subjectCn, issuer, notBefore, notAfter, publicKeySha256, fingerprintSha256, … }`** · `certMatchesKey(cert, keyPem)` · `certificateValidity(info, now) → { status: 'valid'|'expired'|'not_yet_valid', daysLeft }` · `readTbsCertificate`.
- `cms.ts`: **`buildTra(service, now?)`** (ventana ±10 min, `uniqueId` = segundos unix) · **`signTra(traXml, certPemOrDer, privateKeyPem, now?) → base64`** (tira `key_mismatch` antes de gastar un pedido al WSAA) · `TRA_SERVICES`, `TRA_WINDOW_MS`.

**WP2 (`lib/arca/*`)**
- `endpoints.ts`: `ARCA_ENDPOINTS[env].{wsaa, wsfe, padronA5, padronA13}` (hosts `*.afip.gov.ar`), `ARCA_SERVICE = { wsfe, padron: 'ws_sr_constancia_inscripcion' }`, `ArcaEnvironment`, `ArcaWsn`, `isArcaUrl`.
- `soap.ts`: `ArcaTransport`, **`ArcaFault { kind: 'fault'|'http'|'network'|'timeout'|'protocol'|'service'; code; detail; messages; service; wsn; method }`** (el `message` es solo `ARCA <kind>: <code> (<método>)`, apto para log; `detail`/`messages` pueden traer una CUIT), `ArcaRequestError`, `envelope11/12`, `soapHeaders`, `soapCall`, `readSoapResponse`, `asEnvelope`, `readFault`, `soapResult`, `SOAP_TIMEOUT_MS = 25000`.
- `transport.ts` (servidor): `httpsTransport` (agente propio solo ECDHE, TLS ≥ 1.2, keep-alive, 4 sockets, 25 s, 2 MB, solo `https://*.afip.gov.ar`), `createHttpsTransport`, `arcaAgent()`, **`getTransport(env = process.env)`** (relay si `ARCA_RELAY_URL`; `ARCA_FAKE_TIMEOUT=1` solo fuera de producción), `createRelayTransport` (interfaz, sin relay real), `withFakeTimeout`.
- `wsaa.ts` (servidor): **`wsaaLogin(transport, env, service, certificatePem, privateKeyPem, now?, { timeoutMs? }) → ArcaTicket { token, sign, generationTime: Date, expirationTime: Date, source, destination, uniqueId }`** · `parseLoginCmsResponse` · `decodeTokenInfo` / **`decodeTokenRelations(token): string[] | null`** · `isAlreadyAuthenticated` · `loginCmsBody`, `WSAA_SOAP_ACTION = ''`.
- `wsfe.ts`: builders (`feDummyBody`, `ultimoAutorizadoBody`, `caeSolicitarBody`, `compConsultarBody`, `ptosVentaBody`, `condicionIvaReceptorBody`, `paramListBody`, …) que devuelven `{ method, soapAction, body }`; parsers (`parseFeDummy`, `parseUltimoAutorizado`, `parseCaeResponse`, `parseCompConsultar`, `parsePtosVenta → { items, errors, events }`, `pointOfSaleStatus`, …); cliente **`createWsfe(transport, env, getAuth: () => Promise<{ token, sign, cuit }>)`**.
- `padron.ts`: builders `getPersonaV2Body`, `getPersonaListV2Body` (≤ 250); **`parsePersona → PadronLookup ({ found: true, persona } | { found: false, cuit, reason, message })`**, `parsePersonaList`, **`condicionFromPersona(p) → { ivaCondition, condicionIvaReceptorId, needsReview, … }`**, **`padronCacheRow(lookup, cuit) → { cuit, found, data }`** (la forma exacta de `acc_arca_padron_cache_put`), cliente **`createPadron(transport, env, getAuth)`**.
- `vouchers.ts`: `CBTE_TIPO`, `voucherTypeForCbte`, `cbteForVoucherType`, `docTipoFor`, `docNroFor`, `CONDICION_IVA_RECEPTOR`, `condicionFromIvaCondition`, `letterForCondicion → 'A'|'B'|null`, `isCondicionValidForLetter`, `FINAL_CONSUMER_ID_THRESHOLD_CENTS`, `qrJson`/`qrPayload`/`qrUrl` (base configurable, P-T11).
- `importes.ts`: `wsfeAmounts(fiscal) → WsfeAmounts`, `checkWsfeAmounts`, `formatCents2` (BigInt), división half-even (`vatFromNetHalfEven`, `splitGrossHalfEven`, …). **Ojo:** tiene un `parseAmountToCents(text)` propio, distinto del de `lib/imports/amounts.ts` (`(raw, decimal)`); cuidado con el auto-import.
- `errors.ts`: **`ARCA_ERRORS` (24 claves)**, `classifyArcaError(e)`, `classifyArcaMessages`, `describeArcaError(e, ctx) → { key, title, body, step, retry, bug, code }`, **`wsaaCooldown(key, env) → segundos | 'manual'`**, `ArcaError(key)`.
- `guide.ts`: `ARCA_GUIDE_STEP_IDS` (`s0_prereq` … `s10_mis_comprobantes`), `ARCA_GUIDE_STEPS`, **`ARCA_CHECK_KEYS`** (`service, wsfe_ticket, relations, point_of_sale, numbering, padron, certificate`; obligatorios los mismos 5 que exige la base), `ArcaTestResult`, `arcaTestStatus`, `stepForFailedCheck`, `arcaGuideState(conn, progress, lastTest, now?)`, `guideProgressSummary`.

**WP4 (`lib/imports/*`)**
- Entrada: **`openTable({ bytes, fileName?, inflateRaw? })`** (nunca tira por un archivo roto; tope 20 MB, `IMPORT_MAX_FILE_BYTES`) y **`detectSource(input) → { source, table, issue }`** (`arca_recibidos | arca_emitidos | portal_iva_compras | mp_release | mp_settlement | bank | unknown`), `detectTableSource(rows, fileName)`.
- Lectores: `decodeText` (UTF-8 estricto → Windows-1252 propio → UTF-16; repara mojibake), `sniffContainer`, `parseCsv(text, delim, maxRows?)`, `sniffDelimiter`, `listZip`, **`readZipEntry(bytes, entry, inflateRaw?, maxSize?)`**, `inflateRawSync`, `inflateRawWithStreams`, `defaultInflateRaw`, `readWorkbookSheet` / `readFirstSheet` (async; tope 200.000 filas × 512 columnas), `readSpreadsheetMl`, `readHtmlTable`.
- Normalización: `parseAmount`/`parseAmountToCents(raw, decimal)`, `parseDecimal`, `convertCents(cents, rate)`, `toIsoDay`, `instantToCordobaDay(raw, cutoffHour)`, `normalizeHeader`, `headerSignature`.
- Parsers: **`parseMisComprobantes(rows, meta)`** (clave `mc:R:<cuit>:<código>:<pv>:<número>`, `mcNaturalKey`, `mcComponentsSum`), **`parseReleaseReport(rows, ctx)`** (Mercado Pago; `rowKey = mp:<sha256>`), **`parseBankStatement(rows, layout, { treasuryAccountId, … })`** (clave `bank:<caja>:<huella>:<ordinal>`, `detectedFormat = bank:<sha256>`), `classifyBankItem`, `compileBankRule`, `DEFAULT_BANK_RULES`, `groupDailyCharges`.
- Idempotencia: `sha256Hex` (Web Crypto o puro), `sha256HexSync`, **`importClientRef(tenantId, proposalKey, attempt)`** (UUID v8).
- Formas y zod estrictos: `McItem`, `MpItem`, `BankItem`, `ImportIssue` (+ `IMPORT_ISSUE_TEXT`), `mcItemSchema`, `mpItemSchema`, `bankItemSchema`, `importIssuesSchema`.
- **Contrato nuevo del cierre:** `InflateRaw = (data, maxSize?) => …`. Quien inyecte un descompresor tiene que cortar en `maxSize`; con `zlib`: `(d, max) => zlib.inflateRawSync(d, { maxOutputLength: max })`.

### 2.3 Scripts y fixtures

- `scripts/arca/make-fixtures.sh` + `scripts/arca/emit-cms-fixture.ts` (WP1; claves, CSR, certificados y CMS de prueba
  con CUIT sintéticas). `scripts/arca/smoke.mts` (WP2; **con red**, fuera de CI:
  `npx tsx --conditions=react-server scripts/arca/smoke.mts`; WP2 lo corrió: FEDummy y dummy del padrón OK en los dos
  ambientes, incluido `servicios1` con DHE de 1024 bits). `scripts/imports/make-fixtures.mts` (WP4; generador sintético).
- `tests/fixtures/arca/*` (incluye **`test.key` y `test.p12` sintéticos**: el secret scanning de GitHub los puede
  marcar; se regeneran con `make-fixtures.sh`), `tests/fixtures/arca/xml/*` (solo los `dummy` son capturas reales; los
  faults están reconstruidos de la investigación), `tests/fixtures/imports/*` (216 KB, todo sintético).

### 2.4 Migraciones (sin aplicar)

| # | Archivo | Bytes | md5 | Ensayo base real (MCP, `begin…rollback`) | Ensayo local (cadena completa) |
|---|---|---|---|---|---|
| 1 | `20261008120000_acc_arca_core.sql` | 27487 | `6512cf9fbc9abdfe4e661ff66fd44971` | 38/38 (WP3) | 39/39 |
| 2 | `20261008120100_acc_arca_rpc_connection.sql` | 16633 | `10985ba199d138935456c70581158b34` | 26/26 (WP3) | 26/26 |
| 3 | `20261008120105_acc_arca_rpc_certificate.sql` | 9568 | `e072f15ebaebcb8aafea3825ea408882` | 15/15 (WP3) | 16/16 |
| 4 | `20261008120110_acc_arca_rpc_tickets.sql` **(cambiada en el cierre)** | 9997 | `e2c68caf835f78271bc566fecc86d8c2` | **21/21 (cierre)** | **22/22** |
| 5 | `20261008120115_acc_arca_rpc_session.sql` | 15335 | `0210dececb17183c82e689edfc6ac719` | 22/22 (WP3) | 23/23 |
| 6 | `20261008120120_acc_arca_rpc_vouchers.sql` | 17190 | `7ef5be1775e0a64b8439fb9cac6e4968` | 12/12 (WP3) | 28/28 |
| 7 | `20261008120200_acc_imports_core.sql` | 25102 | `ccb6ff86566a5ac3f53aca3cee0c273d` | 25/25 (WP3) | 25/25 |
| 8 | `20261008120300_acc_imports_rpc_batches.sql` | 17597 | `f80e183592b80b84da43d210bbccfeb9` | 24/24 (WP3) | 29/29 |
| 9 | `20261008120310_acc_imports_rpc_proposals.sql` | 10408 | `0c1baf803edf4f104a8cc7d3a85eaef7` | 11/11 (WP3) | 12/12 |
| 10 | `20261008120315_acc_imports_rpc_posting.sql` | 13409 | `accf99f9b0f0ce16c085e78d880e77c0` | 16/16 (WP3) | 17/17 |
| 11 | `20261008120320_acc_imports_rpc_rules.sql` | 20179 | `7c8feaf8679b4238db63947758d5340d` | 20/20 (WP3) | 21/21 |
| 12 | `20261008120330_acc_mp_rpc.sql` | 21514 | `8ce9485c434ddd7a7f999d261dc07a69` | 15/15 (WP3) | 23/23 |

- La 120110 pasó de 9903 bytes (`0864466cfa87163dfdb62aa93201b026`, real 19/19, local 20/20) a la versión de arriba. Las
  otras 11 tienen el mismo md5 que reportó WP3, y sus ensayos regenerados con `build.py` salieron **idénticos byte a
  byte** a los que había dejado WP3; por eso no se volvieron a correr en la base real. WP3 aclaró que el ensayo real de
  la 120200 corrió con una versión anterior del prerrequisito compacto, que difería en una línea de comentario.
- Los ensayos de la base real usan prerrequisitos compactos (el MCP corta pedidos de más de ~34 KB); la cadena real
  completa solo corre en el PG17 local, que tiene stubs del esquema existente (`local_bootstrap.sql`): no es una
  réplica de producción. La primera corrida en un Supabase de verdad con las 12 juntas es el job `rls` de CI.
- Producción hoy: la última aplicada es `20261008010834 acc_import_accounts_where`. Las versiones remotas son el sello
  de cuando se aplicó por MCP (no el prefijo del archivo).

### 2.5 Tablas, RPC y claves de error

- **12 tablas**, idénticas al diseño §6.2 columna por columna (nombre, tipo y orden; comparado con un script). Legibles
  por lectores (`<prefijo>_select_readers`, solo SELECT): `acc_arca_connections`, `acc_arca_vouchers`,
  `acc_arca_padron_cache`, `acc_guide_progress`, `acc_import_batches`, `acc_import_items`, `acc_import_proposals`,
  `acc_import_rules`, `acc_import_layouts`, `acc_mp_connections`. **Cerradas** (RLS sin política, sin ningún
  privilegio, tampoco `service_role`): `acc_secrets`, `acc_arca_tickets`.
- **32 RPC públicas**, con los mismos nombres y parámetros (en el mismo orden) que el diseño §6.3. Todas
  `SECURITY DEFINER` con `search_path = ''`, salvo `acc_import_match_purchases` y `acc_report_onboarding`, que son
  `INVOKER stable`. Las de usuario: `revoke … from public, anon` y `grant … to authenticated`. Las 4 `*_service`:
  solo `service_role` (y además chequean `auth.role()`). Los 12 helpers `private.*`: sin EXECUTE para nadie.
- **Clave de cifrado (D4):** cada RPC que cifra o descifra recibe `p_secret_key` (hoy el valor de `META_TOKEN_KEY`,
  mínimo 16 caracteres) y nunca la guarda. Una clave equivocada da `secret_unreadable` (P0001).
- **26 claves de error nuevas** en `lib/accounting/errors.ts`: las 25 de §6.4 del diseño más `secret_unreadable`. Los
  textos de lo que contesta ARCA viven aparte, en `lib/arca/errors.ts` (24 claves).
- Desvíos de WP3 respecto del diseño, ya documentados por WP3: 12 archivos en vez de 4 (para que cada ensayo entre en
  el MCP); `revoke` también a `service_role` en las tablas cerradas; `p_clear_manual_cooldown` borra solo el cooldown
  manual; desconectar borra también CSR, certificado y hash; cambiar el punto de venta de una conexión `connected` la
  devuelve a `cert_ready`; `acc_import_mark_posted` acepta un lote cancelado; `acc_import_put_proposals` puede pisar
  una propuesta en `posting`.

---

## 3. Qué está probado

| Área | Tests | Qué cubren |
|---|---|---|
| `lib/xml/mini.ts` | 71 | entidades, CDATA, prefijos, repetidos como arrays, DOCTYPE sin expandir, errores. Además, WP2 hizo un fuzz diferencial contra expat (12.000 documentos, 0 diferencias) |
| WP1 cripto | 189 (`der` 70, `csr` 24, `cert` 60, `cms` 35) | CSR idéntico byte a byte al de OpenSSL; CMS determinístico contra fixtures verificados con OpenSSL; `sid` del emisor real; `classifyUpload`; clave que no coincide |
| WP2 SOAP | 233 (`wsaa` 20, `wsfe` 44, `padron` 32, `importes` 12, `errors` 79, `transport` 25, `guide` 21) | `wsaaLogin` de punta a punta con el `signTra` real y transporte falso; orden del WSDL; QR del ejemplo de ARCA byte a byte; 500 casos half-even; agente solo ECDHE; tope de 2 MB y timeout |
| WP4 parsers | 214 en 15 archivos | conteos de `arca-mis-comprobantes.md` §9.5 reproducidos con fixtures sintéticos; las 53 descripciones de `banco-scripts/check-rules.mjs`; zod estricto; ZIP64; inflate propio contra zlib |
| Cierre | 4 (`imports-limits`) | bomba ZIP con los tres descompresores (el tope que llega es el declarado y nadie devuelve el millón de bytes); descompresor que ignora el tope → `zip_corrupt`; ZIP honesto sigue andando; CSV de más de 200.000 filas → `file_too_many_rows`. **Prueba de mutación:** con el código viejo el test de la bomba falla («expected [undefined ×3] to deeply equal [10, 10, 10]») |
| Paridad SQL ↔ textos | 28 | toda clave de `raise exception` de las migraciones `acc_*` tiene texto |
| RLS (CI) | 27 salteados acá (12 ARCA + 15 importación) | aislamiento entre bares, contadora sin escritura, secretos cerrados, cifrado con la clave correcta, lease, una emisión viva, `service_role` en las `*_service`, auditoría sin secretos |
| SQL | 281 chequeos locales + 245 en la base real | ver §2.4 |

---

## 4. Contratos entre paquetes (revisión del cierre)

1. **WP2 → WP1 (`signTra`).** `wsaaLogin` hace `buildTra(service, now)` y `signTra(tra, certificatePem, privateKeyPem, now)`:
   es la interfaz acordada en el diseño (`signTra(tra, certPem, keyPem, now)`). `ArcaWsn` (`wsfe`,
   `ws_sr_constancia_inscripcion`) cumple el patrón del XSD que valida `buildTra`. `signTra` tira `ArcaCryptoError` antes de
   la red; `classifyArcaError` lo mapea como sugirió WP1: `key_mismatch` → `arca_key_mismatch` y el resto → `arca_internal`.
   Hay un test de punta a punta con los fixtures reales.
2. **WP2 y WP4 → `lib/xml/mini.ts`.** Lo usan `soap.ts`, `wsaa.ts`, `wsfe.ts`, `padron.ts` y `xlsx.ts`, siempre con los helpers que aceptan
   `null` y con `childrenNamed` para lo repetido. `xlsx.ts` pasa los `XmlParseError` a `xlsx_corrupt`, y `soap.ts` exige
   que la raíz sea un `Envelope` (una página XHTML de mantenimiento no pasa como SOAP). `html-table.ts` no usa el parser
   de XML, a propósito: el HTML no es XML.
3. **Claves de error.** La paridad pasa: las 33 claves distintas que levantan las 12 migraciones (`invalid_payload` sola aparece
   140 veces) están en `ACC_ERRORS`, y todos los `raise` usan la forma literal que escanea el test. Los textos con huecos
   reciben los datos con los nombres que lee `detailVars`: `import_file_already` manda `date` y `name`, que llenan
   `{fecha}` y `{nombre}`.
4. **Tablas y columnas contra el diseño:** las 12 tablas son iguales y las 32 RPC tienen los mismos nombres y parámetros (§2.5).
5. **TS ↔ SQL**: lo que se verificó y lo que la fase 2 tiene que respetar va en §6.2 y §6.3 (por ejemplo `ticket_put` en snake_case
   y `serialHex` en mayúsculas, que la SQL pasa a minúsculas).

---

## 5. Revisión de seguridad

| Punto | Resultado |
|---|---|
| Claves privadas y tokens en logs | No hay ningún `console.*` en `lib/arca`, `lib/imports` ni `lib/xml`. `smoke.mts` muestra solo el vencimiento y las CUIT de `relations` enmascaradas (`30-…-1`), nunca el token, el sign ni la clave |
| En mensajes de error | `ArcaFault.message` = `ARCA <kind>: <code> (<método>)`. `ArcaRequestError` nombra el campo, nunca el valor. `ArcaCryptoError`, `XmlParseError` y `ZipError` tienen textos fijos. `loadRsaPrivateKey` no guarda el error original (que podría traer el PEM). En SQL ningún `raise` lleva un secreto en el `detail`. Las auditorías (`acc_arca.keypair_generated`, `acc_mp.connected`…) llevan alias, hash de la clave pública o `mp_user_id`, nunca el PEM, el token ni la clave del servidor |
| Hacia el navegador | Solo devuelven secretos `acc_arca_get_credentials`, `acc_arca_ticket_get` (`valid`) y `acc_mp_get_token` (escritor + clave del servidor), y `acc_mp_sync_targets_service` (`service_role`). Sin la clave del servidor, un dueño que las llame desde el navegador no lee nada (`secret_unreadable`). Las acciones de la fase 2 no tienen que devolver ninguno de esos campos |
| `service_role` en flujos de usuario | Ninguno: la fase 1 no tiene acciones; las `*_service` solo son para el cron (CLAUDE.md §4.4) y además chequean `auth.role()` |
| TLS | Solo en el `https.Agent` propio de ARCA. Nadie toca `tls.DEFAULT_CIPHERS`, `NODE_OPTIONS`, `NODE_TLS_REJECT_UNAUTHORIZED` ni `rejectUnauthorized` (grep sin resultados). El relay usa `https.globalAgent` sin cambios |
| Archivos enormes y bombas | Topes: archivo de 20 MB; ZIP con hasta 5000 entradas y 100 MB declarados por entrada; XLSX de 200.000 × 512; respuesta de ARCA de 2 MB, cortada mientras llega; XML con 512 niveles; certificado de 16 KB; tandas SQL de ≤ 1000 filas y ≤ 500 propuestas, con `data` ≤ 8 KB e `issues` ≤ 4 KB. **Arreglado en el cierre:** el descompresor ahora recibe el tamaño declarado (antes un ZIP de 51 KB que declaraba 10 bytes inflaba 50 MB antes de fallar, y un `zlib.inflateRawSync` inyectado no tenía tope) y el CSV corta al pasar el tope de filas |
| WHERE en UPDATE/DELETE (safeupdate de PostgREST) | 41 de 41 con WHERE |
| Tablas de secretos sin privilegios | Verificado con `has_table_privilege` en la cadena local; además, los tests de RLS lo prueban por la API |
| **Arreglado en el cierre: TA borrado por una clave equivocada** | Antes, `acc_arca_ticket_get` atrapaba cualquier error al descifrar el TA vigente, lo **borraba** y daba el lease. Con otra clave tampoco se abre la clave privada, así que nunca había re-login posible. Y el WSAA no da un TA nuevo mientras el viejo siga vigente: un deploy con otra `META_TOKEN_KEY` (una preview) o un escritor que llamara la RPC desde el navegador dejaban a producción con `coe.alreadyAuthenticated` hasta 12 h. Ahora corta con `secret_unreadable` y la transacción vuelve atrás (igual que `acc_arca_get_credentials`). El chequeo del ensayo `c09_wrong_key_heals` pasó a `c09` (`secret_unreadable`), `c09b` (el TA sigue `valid` con la clave buena) y `c09c` (con el TA por vencer sí se da el lease) |

### 5.1 Parámetros de las RPC en los logs (P-T3, D4)

Con D4, el PEM de la clave privada, el token de Mercado Pago y `META_TOKEN_KEY` viajan como parámetros de la RPC. En la
base real (solo lectura):

- `log_statement = ddl` y `log_min_duration_statement = -1`: no se registran sentencias por tipo ni por duración.
- `log_parameter_max_length_on_error = 0`: con error, la sentencia sale sin parámetros.
- `pgaudit.log = none` y `pgaudit.log_parameter = off`.
- **Único camino que queda:** `auto_explain.log_min_duration = 10000` con `auto_explain.log_parameter_max_length = -1`,
  que registra los parámetros completos de lo que tarde más de 10 s. Hoy no puede pasar por PostgREST, porque
  `authenticated` y `authenticator` tienen `statement_timeout = 8s`.
- **Regla para no romperlo:** no subir ese timeout por encima de 10 s, o poner `auto_explain.log_parameter_max_length = 0`.

### 5.2 Riesgos que quedan (no bloquean)

- **Regex de las reglas del banco.** `compileBankRule` hace `new RegExp(pattern, 'i')` con el patrón que guarda el bar
  (≤ 200 caracteres) y lo corre sobre descripciones de ≤ 240. Un patrón catastrófico (`(a+)+$`) puede colgar el hilo.
  Solo lo puede guardar un escritor y afecta a su propio bar. **Fase 2:** no correr reglas del bar en el servidor, o
  limitar los patrones a un subconjunto seguro.
- **`readHtmlTable`** usa una regex tolerante que con miles de `<!--` sin cerrar se vuelve cuadrática. Corre en el
  navegador de quien sube su propio archivo, con un tope de 20 MB.
- **Archivos sintéticos con forma de clave** (`test.key`, `test.p12`): ver §2.3.

---

## 6. Lo que necesita la fase 2

### 6.1 Antes: aplicar las migraciones (solo con el «sí» explícito de Nacho, P-O10)

Aplicar **en este orden**, una por llamada a `apply_migration` (el `name` es la parte después del prefijo):

1. `20261008120000_acc_arca_core.sql` → `acc_arca_core`
2. `20261008120100_acc_arca_rpc_connection.sql` → `acc_arca_rpc_connection`
3. `20261008120105_acc_arca_rpc_certificate.sql` → `acc_arca_rpc_certificate`
4. `20261008120110_acc_arca_rpc_tickets.sql` → `acc_arca_rpc_tickets`
5. `20261008120115_acc_arca_rpc_session.sql` → `acc_arca_rpc_session`
6. `20261008120120_acc_arca_rpc_vouchers.sql` → `acc_arca_rpc_vouchers`
7. `20261008120200_acc_imports_core.sql` → `acc_imports_core`
8. `20261008120300_acc_imports_rpc_batches.sql` → `acc_imports_rpc_batches`
9. `20261008120310_acc_imports_rpc_proposals.sql` → `acc_imports_rpc_proposals`
10. `20261008120315_acc_imports_rpc_posting.sql` → `acc_imports_rpc_posting`
11. `20261008120320_acc_imports_rpc_rules.sql` → `acc_imports_rpc_rules`
12. `20261008120330_acc_mp_rpc.sql` → `acc_mp_rpc`

Antes de cada una, confirmar que el md5 del archivo es el de §2.4 (si cambió, hay que volver a ensayarla). Después:

- `select * from public.acc_privilege_gaps()`, `select * from public.acc_isolation_gaps()` y
  `select * from public.acc_rpc_isolation_gaps()` → **0 filas**. Revisar `get_advisors` (seguridad).
- Verificar que lo aplicado sea el archivo (md5 contra `supabase_migrations.schema_migrations.statements`, como pide §6 del diseño).
- Regenerar `types/database.ts` por MCP (`generate_typescript_types`) y volver a agregar los exports manuales
  (`db:types` está roto; memoria `supabase-env-remote`). `lib/accounting/**` no depende de esos tipos.
- El PR dispara el job `rls` de CI: es la primera corrida de las 12 juntas en un Supabase de verdad y de los 27 tests de RLS.

### 6.2 Para WP5 (servidor de ARCA: `lib/arca/{schemas,secrets,session,queries,actions}.ts`)

- **Un solo helper para la clave (D4):** `secretsKey()` = `requireEnv('META_TOKEN_KEY')`, como `getTokenKey()` de
  `lib/meta/env.ts`, `server-only`. Tiene que ser la **misma clave en local, en las previews y en producción**,
  porque todas usan la misma base. Si no, se cumple `secret_unreadable`.
- **`startArcaCertificate`:** `generateKeyAndCsr({ cuit, organization: acc_settings.legal_name, commonName: alias })` →
  `acc_arca_store_keypair(p_tenant_id, p_environment, p_alias, p_cert_cuit, p_private_key_pem, p_csr_pem,
  p_public_key_sha256, p_secret_key, p_mode)`. La razón social va en `O` y no puede pasar de **64 caracteres**
  (RFC 5280): si la de la SAS es más larga, `buildCsr` tira `invalid_subject`. El PEM es PKCS#8, como pide la SQL. Al
  navegador vuelven solo `{ alias, csrPem, fileName }`.
- **`uploadArcaCertificate`:**
  1. `classifyUpload(bytes)`; solo con `'certificate'` se sigue.
  2. `parseCertificate`, `certificateValidity`, comparar `subjectCuit` y `publicKeySha256`.
  3. `acc_arca_save_certificate(p_certificate_pem = info.pem, p_meta = { serial_hex: info.serialHex, subject_cuit,
     subject_cn, issuer, not_before: notBefore.toISOString(), not_after: notAfter.toISOString(),
     public_key_sha256 })`. La lista blanca es exacta: una clave de más da `invalid_payload`.
- **Ticket (`session.ts`).** `acc_arca_ticket_get` devuelve `valid | cooldown | busy | lease`, y desde el cierre
  **puede tirar `secret_unreadable`** sin haber tomado el lease: en ese caso no se llama a `ticket_put`.
  `acc_arca_ticket_put` recibe `p_result` en **snake_case**:
  - éxito: `{ ok: true, token, sign, generation_time: ta.generationTime.toISOString(), expiration_time: … }`. No sirve
    el `{ ok: true, ...ta }` del pseudocódigo del diseño: `ArcaTicket` viene en camelCase y daría `invalid_payload`;
  - falla: `{ ok: false, key, cooldown }`.
  - **Cooldown:** `wsaaCooldown(key, env)` solo para fallas que vinieron del WSAA (una `ArcaFault` de `wsaaLogin`). Si
    falló **antes** (`secret_unreadable`, `arca_key_missing` o `arca_not_ready` al cargar las credenciales), hay que
    liberar el lease con `cooldown: null`. Si no, `classifyArcaError` da `arca_internal` → `'manual'` y un deploy mal
    configurado bloquea a todos hasta «Probar conexión».
- **«Probar conexión»:** `acc_arca_record_test(p_result = { checks: [{ key, ok, detail?, error? }] })` con las claves de
  `ARCA_CHECK_KEYS`. El `error` tiene que cumplir `^[a-z][a-z0-9_]{1,59}$` (una `ArcaErrorKey` lo cumple). Van de 1 a 12
  chequeos, y todo junto no puede pasar de 12.000 bytes. `connected` solo si dan bien `service`, `wsfe_ticket`,
  `relations`, `point_of_sale` y `padron`, igual que `arcaTestStatus`.
- **Padrón:**
  - `acc_arca_padron_cache_put(p_rows)` recibe hasta 250 filas, cada una armada con `padronCacheRow(lookup, cuit)`.
  - Los clientes reciben `getAuth: () => Promise<{ token, sign, cuit }>`, que es lo que da `session.auth(service)`.
  - En homologación, `FEParamGetPtosVenta` suele contestar 602: `pointOfSaleStatus` da `'missing'` y el chequeo 4 no
    tiene que fallar ahí (nota de WP2).
- **Guías:** `acc_guide_mark(p_guide 'arca'|'arranque', p_step ∈ ARCA_GUIDE_STEP_IDS, p_done)`.
- **Pendiente de confirmar con el primer login de homologación:** la forma real de `relations` en el token SSO.
  `decodeTokenRelations` es tolerante y devuelve `null` si no lo puede leer.

### 6.3 Para WP6 (servidor de importaciones)

- **`acc_import_create_batch(p_batch)`**: lista blanca exacta `{ source, file_name, file_sha256, file_size,
  detected_format, period_from, period_to, treasury_account_id, meta }`. `source` es un `ImportSource`; `detected_format`
  cumple `^[a-z0-9_:-]{2,80}$` (`bank:<sha256>` mide 69); `file_size` va de 1 a 20 MB; el banco exige
  `treasury_account_id`. Un archivo repetido da `import_file_already`, con `{ batch_id, date, name }`.
- **`acc_import_add_items(p_items)`**:
  - Hasta 1000 ítems por llamada, cada uno `{ row_no, source_family?, natural_key, data, issues? }`.
  - `data` ≤ 8 KB e `issues` ≤ 4 KB, medidos con `pg_column_size`.
  - **Ojo:** `importIssuesSchema` acepta hasta 50 avisos por fila, pero en 4 KB entran unos 25: el servidor tiene que
    sacar los repetidos o recortar antes de mandar, porque si no se cae toda la tanda con `invalid_payload`.
  - Reintentar la misma tanda no duplica nada (`skipped`).
- **`acc_import_put_proposals`** (≤ 500): lista blanca `{ key, form, form_values, summary, client_ref, attempt?, status?,
  preview_hash?, needs?, warnings_ack?, item_ids?, error? }`. El `client_ref` lo calcula TS con
  `importClientRef(tenantId, key, attempt)`; la base no lo recalcula. Puede pisar una propuesta en `posting`: el flujo
  de contabilizado tiene que volver a leer el estado y confiar en la idempotencia de `acc_post_bundle` por `client_ref`.
- **`acc_import_mark_posted(p_batch_id, p_key, p_document_id)`** verifica que `acc_bundles.client_ref` sea el de la
  propuesta.
- **Mercado Pago:** `acc_mp_save_connection` (`channel_methods` con `qr`, `point`, `transfer_in` y `link`; `day_cutoff_hour`
  de 0 a 8) y `acc_mp_store_token` (`APP_USR-…`, `p_meta = { mp_user_id, site_id: 'MLA', scopes? }`).
- **Descompresión en el servidor** (respaldo P-T9): inyectar un descompresor que respete `maxSize` (§2.2).

### 6.4 Pendientes conocidos

1. **`private.acc_reset_tenant` no conoce las tablas nuevas.**
   - Es un reinicio que corre soporte por el MCP antes del primer cierre. Borra `acc_documents`,
     `acc_treasury_accounts`, `acc_parties` y `acc_settings`, pero no las tablas nuevas que apuntan a ellas.
   - Con una importación contabilizada, una emisión de producción, un lote del banco o Mercado Pago configurado, el
     reinicio corta con un error de FK (falla cerrado: no borra nada).
   - Hace falta una migración nueva (`create or replace`) que borre antes las filas `acc_import_*`, `acc_mp_*` y
     `acc_arca_*` del bar, después de decidir qué se hace con los comprobantes con CAE (son registros fiscales).
   - Tiene que estar antes de reiniciar un bar que haya usado los importadores, por ejemplo el demo después del smoke
     de la fase 3.
2. **Reimportar después de anular** (`attempt + 1`): `aipr_posted_key_uq` no deja una segunda propuesta `posted` con la
   misma clave. Se resuelve cuando se diseñe la anulación de lo importado.
3. **`classifyArcaError` y los errores de PostgREST:** un `PostgrestError` cae en `arca_internal`. WP5 tiene que mapear
   los errores de las RPC con `mapAccError` (`lib/accounting/errors.ts`) y dejar `classifyArcaError` para lo que viene de ARCA.
4. **Fixtures reconstruidos** (faults del WSAA, WSFE y padrón; textos de `EmisionTipo` y `FchBaja`): confirmarlos con
   tráfico real de homologación en WP5. Base del QR (`arca.gob.ar` o `afip.gob.ar`, P-T11): sigue abierta.
5. **Formatos reales a calibrar** (P-O6, P-O8): exportación de NE24 / BNA+, encabezados de Mercado Pago en castellano,
   la fila `total` de MP, SIRTAC y SIRCUPA en `TAXES_DISAGGREGATED`, y fechas y decimales de la generación G1 de Mis
   Comprobantes. Los TXT de ancho fijo y los PDF del banco quedan fuera.
6. **Decodificar Windows-1252 en Node:** el `TextDecoder('windows-1252')` de Node 25 decodifica mal 0x80–0x9F. En el
   servidor hay que usar `decodeWindows1252` de `lib/imports/bytes.ts` (nota de WP4).
7. **`.env.example`:** el cambio que está en el árbol (`NEXT_PUBLIC_LANDINGS_HOST`) es de otra tarea, no de esta fase.
   Documentar `ARCA_RELAY_URL`, `ARCA_RELAY_SECRET` y `ARCA_FAKE_TIMEOUT` es de WP14. La fase 1 no lee ninguna
   variable de entorno salvo esas tres de ARCA, en `getTransport`.

---

## 7. Archivos del cierre

**En el repo:**

- `supabase/migrations/20261008120110_acc_arca_rpc_tickets.sql` (sin aplicar): `acc_arca_ticket_get` sin el bloque que
  borraba el TA y comentario nuevo. 9997 bytes, `e2c68caf835f78271bc566fecc86d8c2`.
- `lib/imports/zip.ts`: `readZipEntry` le pasa `entry.size` al descompresor; si este se pasa, el error es
  `zip_corrupt` («el tamaño no coincide»); `defaultInflateRaw` reenvía el tope.
- `lib/imports/types.ts`: `InflateRaw` con `maxSize?` opcional y documentado.
- `lib/imports/detect.ts`: `parseCsv(text, delimiter, XLSX_MAX_ROWS + 1)` en `textTable`.
- `tests/lib/imports-limits.test.ts` (nuevo, 4 tests).

**En el scratchpad:**

- `research/fase1-estado.md` (este archivo).
- `sqltests/arca/c120110.sql` (chequeos `c09`, `c09b` y `c09c`) y su copia previa `c120110.sql.antes-del-cierre`.
- Regenerados con `build.py`: `dry_120110.sql` y `dry_local_120110.sql` … `dry_local_120330.sql`. Los otros 14 salieron
  idénticos.
- `cierre-f1/`: logs (`tsc-1.txt`, `tsc-2.txt`, `lint-1.txt`, `lint-2.txt`, `test-1.txt`, `test-2.txt`,
  `phase1-tests.json`), herramientas de revisión (`tools/scan_where.py`, `tools/scan_fns.py`, `tools/closure.py`,
  `tools/cols.py`, `tools/rpcs.py`, `tools/exports.py`), la sonda `probe/zipbomb.mts`, `privs.sql`, `tsconfig.mts.json`,
  `exports-arca.txt`, `exports-imports.txt`, `dry-antes/` (los ensayos antes de regenerar), `dry-md5-antes.txt`,
  `zip.ts.fixed` y `cms-out-*.xml`.
- El PG17 local (`pglocal/`) se prendió para los ensayos y quedó **apagado**.

Sin `npm install`, sin comandos de git que cambien estado, sin tocar `.env*`, sin `apply_migration`. A la base real solo
fueron consultas de lectura y el ensayo con `begin … rollback`.
