# Fase 2 · Estado al cierre (servidor de ARCA e importadores de Administración)

> **Fecha:** 08/10/2026 · **Rama:** `feat/administracion` · **Nada commiteado ni aplicado a la base.**
> Insumos: `diseno.md` (§1–§4, §6–§7), `fase1-estado.md` y los tres reportes de la fase 2: **WP5** (servidor de
> ARCA), **WP6** (servidor de importaciones) y el paquete de la **migración 13** («addendum»: anular lo importado y
> reiniciar el bar). Este archivo lo escribió el paquete de cierre después de revisar los contratos TS ↔ SQL y la
> seguridad, y de correr todos los chequeos. Es el punto de partida de la fase 3 (pantallas): lo de
> `fase1-estado.md` que sigue vigente está resumido o referenciado acá.

---

## 0. Resumen

- **Todo verde y el cierre no tuvo que tocar código del repo.** `tsc` completo (sin incremental) 0 errores ·
  `npm run lint` 0 diagnósticos en 1565 archivos · `npm run test:ci` 244 archivos y 4364 tests OK (33 archivos y
  282 tests salteados: los de RLS, que necesitan el Supabase de CI). Los 9 archivos de tests de la fase 2 solos: 228 OK.
- **Contratos TS ↔ SQL sin diferencias** (§3):
  - 32 lugares que llaman a 25 RPC distintas (22 nuevas y 3 que ya están en producción): mismos nombres de
    función y de parámetro, ninguno de más y ningún obligatorio faltante;
  - 16 payloads `jsonb` revisados contra la lista blanca de su RPC, sin claves de más y con topes coherentes;
  - 35 lecturas directas (`.from(...)`): todas las tablas y columnas existen;
  - 37 claves de error distintas en las 13 migraciones, todas con texto en `ACC_ERRORS`; los enums de estado de
    TS coinciden con los `CHECK` de la base.
- **Seguridad** (§4): ninguna acción ni lectura devuelve la clave privada, el certificado, el ticket ni la clave del
  servidor. El único PEM que sale es el pedido `.csr`, que es público y se sube a ARCA. Los 16 `console.error`
  nuevos llevan solo operación, clave y código. No hay `service_role` en el código nuevo, y nadie llama todavía a
  las cuatro RPC `*_service`, que son del cron de WP12.
- **Para que la fase 3 vea datos reales falta una sola cosa externa:** el **«sí» de Nacho** para aplicar las **13**
  migraciones (orden, tamaños y md5 en §2). Producción hoy (solo lectura): no está aplicada ninguna.
- **Dos hallazgos del cierre para decidir antes del smoke de homologación.** No rompen nada hoy; el detalle está
  en §6.1 y §7.1:
  1. **Duración.** «Probar conexión» puede tardar unos 84 s en el peor caso, y «Completar con ARCA» unos 60 s con
     sus topes de 25 s. Ninguna página fija `maxDuration` todavía. Si Vercel corta la función en medio de un login
     al WSAA que ARCA sí procesó, ese ticket se pierde y el servicio queda con «ya posee un TA válido» hasta 12 h.
  2. **Padrón en lote.** No hay consulta del padrón en lote: el paso «Proveedores nuevos» del importador solo puede
     usar `lookupCuit` de a una CUIT, con el tope de 30 consultas por minuto.

---

## 1. Chequeos (resultados exactos)

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit -p /Users/ignaciobaldovino/Hub_main` (al empezar, incremental) | exit 0 (2,4 s) |
| `npx tsc --noEmit -p /Users/ignaciobaldovino/Hub_main --incremental false` (al terminar) | exit 0 (15,0 s) |
| `npm run lint` (Biome), al empezar y al terminar | exit 0 las dos veces · «Checked 1565 files in 655ms / 653ms. No fixes applied.» |
| `npm run test:ci` (al empezar, 08:27) | exit 0 · 244 archivos OK / 33 salteados · 4364 tests OK / 282 salteados (10,8 s) |
| `npm run test:ci` (al terminar, 08:52) | exit 0 · **244 archivos OK / 33 salteados · 4364 tests OK / 282 salteados** (10,8 s). Entre las dos corridas no cambió ningún archivo del árbol |
| Tests de la fase 2 solos | 9 archivos · **228 OK**: `arca-session` 28, `arca-actions` 59, `imports-proposals-arca` 32, `imports-proposals-mp` 23, `imports-proposals-bank` 22, `imports-stage` 18, `imports-rebuild` 20, `imports-post` 13, `accounting-onboarding` 13 |
| Paridad `raise exception '<clave>'` (todas las migraciones `_acc_`, la 13 incluida) ↔ `ACC_ERRORS` | OK, no salteado: las 37 claves distintas de las 13 tienen texto |
| Contrato de RPC (escáner propio: `cierre-f2/tools/sigs.py` + `calls.py`) | 32 llamadas a 25 funciones: 28 comparadas solas y 4 a mano (argumentos en una variable). 0 parámetros de más, 0 obligatorios faltantes |
| Firmas en producción de las 3 RPC existentes que usa la fase 2 | `acc_save_sales_point(p_tenant_id, p_point, p_expected_updated_at)`, `acc_save_party(p_tenant_id, p_party, p_expected_updated_at)`, `acc_post_bundle(p_tenant_id, p_client_ref, p_bundle)`: iguales a las que llama TS |
| Payloads `jsonb` contra las listas blancas (revisión a mano) | 16 payloads: 15 contra su lista blanca; el de `acc_post_bundle` es el `toRpcPayload` de toda la contabilidad. 0 diferencias (§3.2) |
| Lecturas directas (`cierre-f2/tools/selects.py`) | 35 `.from()` en 6 archivos: 0 tablas o columnas inexistentes |
| Enums de estado TS ↔ `CHECK` | Iguales: conexiones de ARCA, lotes, filas, propuestas (con `voided`) y Mercado Pago |
| safeupdate (escáner `scan_where.py` de la fase 1 sobre las 13) | 58 `UPDATE`/`DELETE`, 0 sin `WHERE` (el grep simple también da 58) |
| Archivos `'use server'` nuevos (`lib/arca/actions.ts`, `lib/imports/actions.ts`) | Solo exportan funciones `async` (regla de Next) |
| Módulos para componentes de cliente (`cierre-f2/tools/closure.py`) | Ninguno llega a `server-only`, `node:*`, `next/headers` ni `@/lib/supabase/server`. Revisados: `lib/arca/{views,schemas,guide,errors}.ts`, `lib/imports/server/types.ts`, `lib/accounting/onboarding.ts` y `lib/imports/detect.ts` |
| `service_role` / RPC `*_service` en el código nuevo | 0 / 0 |
| Clave del servidor | `META_TOKEN_KEY` se lee para ARCA solo en `lib/arca/secrets.ts` (`secretsKey()`), que se llama en dos lugares: `startArcaCertificate` y `openArcaSession` |
| Producción (solo lectura, MCP `execute_sql`) | Última migración: `20261008010834 acc_import_accounts_where`. De las 13 no hay ninguna aplicada, ni tampoco las 12 tablas nuevas. La única función `acc_import_*` es `acc_import_accounts`, que ya existía. 0 bares `acct-dryrun*` |
| md5 de las 13 | Las 12 de la fase 1 coinciden con `fase1-estado.md` §2.4; la 13 coincide con el reporte de su paquete |

**Lo que no se pudo correr acá:**

- los tests de `tests/rls/acc-{arca,imports}.test.ts`, que necesitan el Supabase local del job `rls` de CI;
- el login real al WSAA y «Probar conexión» desde una preview, porque todavía no hay certificado de homologación.

---

## 2. Migraciones: la lista final (13, sin aplicar)

### 2.1 Orden de aplicación

Se aplican en este orden, una por llamada a `apply_migration`. El `name` es lo que va después del prefijo.

**Antes de cada una:** confirmar el md5. Si cambió, hay que volver a ensayarla.

**Necesitan el «sí» explícito de Nacho**, porque el Supabase remoto es producción (memoria `migraciones-prod-autorizacion`).

| # | Archivo | `name` | Bytes | md5 | Líneas |
|---|---|---|---|---|---|
| 1 | `20261008120000_acc_arca_core.sql` | `acc_arca_core` | 27487 | `6512cf9fbc9abdfe4e661ff66fd44971` | 445 |
| 2 | `20261008120100_acc_arca_rpc_connection.sql` | `acc_arca_rpc_connection` | 16633 | `10985ba199d138935456c70581158b34` | 302 |
| 3 | `20261008120105_acc_arca_rpc_certificate.sql` | `acc_arca_rpc_certificate` | 9568 | `e072f15ebaebcb8aafea3825ea408882` | 175 |
| 4 | `20261008120110_acc_arca_rpc_tickets.sql` | `acc_arca_rpc_tickets` | 9997 | `e2c68caf835f78271bc566fecc86d8c2` | 180 |
| 5 | `20261008120115_acc_arca_rpc_session.sql` | `acc_arca_rpc_session` | 15335 | `0210dececb17183c82e689edfc6ac719` | 283 |
| 6 | `20261008120120_acc_arca_rpc_vouchers.sql` | `acc_arca_rpc_vouchers` | 17190 | `7ef5be1775e0a64b8439fb9cac6e4968` | 314 |
| 7 | `20261008120200_acc_imports_core.sql` | `acc_imports_core` | 25102 | `ccb6ff86566a5ac3f53aca3cee0c273d` | 369 |
| 8 | `20261008120300_acc_imports_rpc_batches.sql` | `acc_imports_rpc_batches` | 17597 | `f80e183592b80b84da43d210bbccfeb9` | 338 |
| 9 | `20261008120310_acc_imports_rpc_proposals.sql` | `acc_imports_rpc_proposals` | 10408 | `0c1baf803edf4f104a8cc7d3a85eaef7` | 187 |
| 10 | `20261008120315_acc_imports_rpc_posting.sql` | `acc_imports_rpc_posting` | 13409 | `accf99f9b0f0ce16c085e78d880e77c0` | 235 |
| 11 | `20261008120320_acc_imports_rpc_rules.sql` | `acc_imports_rpc_rules` | 20179 | `7c8feaf8679b4238db63947758d5340d` | 359 |
| 12 | `20261008120330_acc_mp_rpc.sql` | `acc_mp_rpc` | 21514 | `8ce9485c434ddd7a7f999d261dc07a69` | 436 |
| 13 | `20261008120340_acc_arca_imports_addendum.sql` | `acc_arca_imports_addendum` | 35321 | `530a697bfc3bc85dd1bfc118ef50a8ec` | 660 |

**Total:** 239.740 bytes y 4283 líneas.

**Orden:** son las 13 últimas del directorio. No hay dos migraciones con el mismo prefijo, que fue la causa de un CI roto
(memoria `ci-roto-lock-y-migracion-duplicada`). La 13 va **última**: altera `acc_import_proposals` (de la 7) y
reemplaza (`create or replace`) funciones de la 1, la 7, la 8, la 9 y la 10, además de `private.acc_reset_tenant`, que
ya está en producción.

### 2.2 Qué trae cada grupo

**1–6 · ARCA**

- 4 tablas legibles por lectores:
  - `acc_arca_connections`;
  - `acc_arca_vouchers`;
  - `acc_arca_padron_cache`;
  - `acc_guide_progress`.
- 2 tablas cerradas, sin ningún privilegio: `acc_secrets` y `acc_arca_tickets`.
- Helpers de cifrado: `private.acc_encrypt` y `private.acc_decrypt`. Una clave equivocada da `secret_unreadable`.
- Las RPC de conexión, certificado, ticket (con lease), prueba, desconexión, padrón, guías, comprobantes y
  `acc_ensure_final_consumer`.

**7–12 · Importaciones y Mercado Pago**

- 6 tablas legibles:
  - `acc_import_batches`;
  - `acc_import_items`;
  - `acc_import_proposals`;
  - `acc_import_rules`;
  - `acc_import_layouts`;
  - `acc_mp_connections`.
- Las RPC de lotes, filas, propuestas, contabilizado, reglas, formatos y «Cómo arrancar» (`acc_report_onboarding`).
- Mercado Pago, con las cuatro `*_service` solo para `service_role`.

**13 · Addendum**

- **Estado `voided` y re-carga.**
  - Nuevo estado `voided` de la propuesta y columna `previous_document_id`.
  - `acc_import_put_proposals` vuelve a armar una anulada solo con `attempt` mayor.
  - `acc_import_mark_posted` rechaza un comprobante revertido.
  - `acc_import_cancel_batch` deja las `voided` como están.
  - Los conteos suman `voided`.
- **Sincronización con los comprobantes.** Dos constraint triggers diferidos sobre `acc_documents` (anular, revertir y
  «Corregir») llevan la propuesta a `voided` o la devuelven a `posted`. Si la carga ya se rehízo, levantan
  `import_reposted` al hacer COMMIT.
- **Reinicio del bar.** `private.acc_reset_tenant` ahora conoce las tablas nuevas. Rechaza con `reset_arca_vouchers`
  si hay facturas de producción que llegaron a ARCA, y `private.acc_tg_arca_vouchers_bu` deja borrar en el reinicio.

### 2.3 Después de aplicar

1. `select * from public.acc_privilege_gaps()`, `acc_isolation_gaps()` y `acc_rpc_isolation_gaps()` tienen que dar
   **0 filas**. Revisar también `get_advisors` (seguridad).
2. Verificar que lo aplicado sea el archivo: md5 contra `supabase_migrations.schema_migrations.statements`.
3. Regenerar `types/database.ts` por MCP (`generate_typescript_types`) y volver a agregar los exports manuales, porque
   `db:types` está roto (memoria `supabase-env-remote`).
   - Tiene que incluir `acc_import_proposals.previous_document_id`.
   - El código de `lib/arca`, `lib/imports` y `lib/accounting` no depende de esos tipos.
4. El PR dispara el job `rls` de CI. Es la primera corrida de las 13 juntas en un Supabase de verdad.
5. **No subir `statement_timeout` de `authenticated` por encima de 10 s** (hoy es 8 s), o bien poner
   `auto_explain.log_parameter_max_length = 0`. Si no, `auto_explain` registraría los parámetros de las RPC lentas,
   y entre ellos van el PEM de la clave privada y `META_TOKEN_KEY` (`fase1-estado.md` §5.1).

---

## 3. Contratos TS ↔ SQL (revisión del cierre)

### 3.1 Las 25 RPC que llama el servidor

En todas, los nombres de parámetro coinciden con la firma de la migración vigente.

| RPC | Migración | Dónde se llama | Qué lee TS de la respuesta |
|---|---|---|---|
| `acc_arca_store_keypair` | 2 | `lib/arca/actions.ts` (`startArcaCertificate`) | `status`, `updated_at` |
| `acc_arca_save_connection` | 2 | `actions.ts` (`saveArcaPointOfSale`, `saveArcaSettings`) | la fila (`to_jsonb`) → `parseConnectionRow` |
| `acc_arca_save_certificate` | 3 | `actions.ts` (`uploadArcaCertificate`) | la fila |
| `acc_arca_get_credentials` | 3 | `lib/arca/secrets.ts` (`loadCredentials`) | `private_key_pem` (queda como propiedad **no enumerable**), `certificate_pem`, `connection` |
| `acc_arca_ticket_get` | 4 | `lib/arca/session.ts` (`acquireTicket`) | `status`: `valid` (`token`, `sign`, `expires_at`) · `cooldown` (`until`, `manual`, `last_error_key`) · `busy` (`retry_after_ms`) · `lease` (`lease_id`) |
| `acc_arca_ticket_put` | 4 | `session.ts` (al liberar con error y al guardar el TA) | `void` |
| `acc_arca_record_test` | 5 | `actions.ts` (`testArcaConnection`) | la fila → `last_test` |
| `acc_arca_disconnect` | 5 | `actions.ts` (`disconnectArca`) | `void` |
| `acc_arca_padron_cache_put` | 5 | `lib/arca/lookup.ts` | `integer` (se ignora; si falla, se loguea y la consulta sigue) |
| `acc_guide_mark` | 5 | `actions.ts` (`markGuideStep`) y `lib/imports/actions.ts` (`markOnboardingStep`) | `void` |
| `acc_save_sales_point` | existente (`20261007120720`) | `actions.ts` (punto «Plataforma (ARCA)») | error `sales_point_taken` → `existing` |
| `acc_import_create_batch` | 8 | `lib/imports/server/stage.ts` | `id`, `status`, `created_at` |
| `acc_import_add_items` | 8 | `stage.ts` | `new`, `duplicate`, `skipped`, `counts` |
| `acc_import_cancel_batch` | 13 (reemplaza a la de la 8) | `lib/imports/actions.ts` | `void` |
| `acc_import_put_proposals` | 13 (reemplaza a la de la 9) | `lib/imports/server/propose.ts` (`putProposals`, también desde `post.ts`) | `counts` |
| `acc_import_set_items` | 10 | `propose.ts` («no es nuestro» / deshacer) | (se ignora; se vuelve a armar) |
| `acc_import_mark_posted` | 13 (reemplaza a la de la 10) | `lib/imports/server/post.ts` | `status`, `counts`, `replayed` |
| `acc_import_match_purchases` | 10 (INVOKER) | `stage.ts` | `[{ key, match: 'number'\|'amount', document_id, label }]` |
| `acc_import_save_rule` | 11 | `lib/imports/actions.ts`, `propose.ts` («Recordar para este proveedor») | la regla |
| `acc_import_delete_rule` | 11 | `lib/imports/actions.ts` | `void` |
| `acc_import_save_layout` | 11 | `lib/imports/actions.ts` | `id` |
| `acc_report_onboarding` | 11 (INVOKER) | `lib/accounting/queries/onboarding.ts` | las 20 claves (`today` … `manual`); `parseOnboardingData` lee las 20 |
| `acc_mp_save_connection` | 12 | `lib/imports/actions.ts`, `propose.ts` (canal → medio) | la fila |
| `acc_save_party` | existente (`20261007120710`) | `propose.ts` (alta de proveedores y edición parcial) | `id` |
| `acc_post_bundle` | existente (`20261007120830`) | `post.ts` (un reintento si choca el `client_ref`) | `parsePostBundleResult` (el de toda la contabilidad) |

### 3.2 Payloads `jsonb` contra las listas blancas

| Payload | Lo que manda TS | Contra la SQL |
|---|---|---|
| `acc_arca_save_connection.p_patch` | Solo las claves que vinieron: `alias`, `point_of_sale`, `allowed_classes` (siempre con `B`), `default_concepto`, `emission_enabled` | Lista blanca igual. Una clave ausente no se toca: un test fija que guardar `allowedClasses` no manda `emission_enabled` |
| `acc_arca_save_certificate.p_meta` | Exactamente las 7 claves. `serial_hex` va en mayúsculas (la base lo pasa a minúsculas) e `issuer` recortado a 300 | Lista blanca exacta, `issuer` ≤ 300 |
| `acc_arca_ticket_put.p_result` | Éxito: `{ ok: true, token, sign, generation_time, expiration_time }` (snake_case, ISO). Falla: `{ ok: false, key, cooldown }` con `cooldown` = 60, 120 o 600 s, `'manual'` o `null` | `key` cumple `^[a-z][a-z0-9_]{1,59}$`; `cooldown` va de 0 a 3600 o es `'manual'` |
| `acc_arca_record_test.p_result` | `{ checks: [{ key, ok, detail?, error? }] }`, de 1 a 7 chequeos con claves únicas de `ARCA_CHECK_KEYS`; `error` es una `ArcaErrorKey` | Claves y regex que cumplen las 7 de chequeo y las 24 de error; < 12.000 bytes |
| `acc_arca_padron_cache_put.p_rows` | `[padronCacheRow(lookup, cuit)]` = `[{ cuit, found, data }]` | Lista blanca igual, ≤ 250 filas |
| `acc_save_sales_point.p_point` | `{ number, label: 'Plataforma (ARCA)', default_channel: 'events' }` | `label` ≤ 60, canal válido |
| `acc_import_create_batch.p_batch` | `source`, `file_sha256`, `file_size`, `meta` y las opcionales que no son `null` | Lista blanca igual. `meta` estimado ≤ 7800 (tope 8192) |
| `acc_import_add_items.p_items` | `{ row_no, natural_key, data, issues }` de a 500. `data` estimado ≤ 7800 (tope 8192) e `issues` ≤ 3800 (tope 4096) | Tope de 1000; `source_family` la pone la base |
| `acc_import_put_proposals.p_proposals` | `key, form, form_values, summary, client_ref, attempt, status, preview_hash, needs, warnings_ack, error, item_ids`, de a 100. Nunca manda `posted` ni `voided`; `attempt` va de 1 a 100; `item_ids` ≤ 5000 por entrada | Lista blanca igual, tope de 500 |
| `acc_import_set_items.p_changes` | Un cambio por llamada: `{ kind, item_ids (≤ 1000), reason? }` | De 1 a 50 cambios |
| `acc_import_match_purchases.p_rows` | `{ key, party_id, voucher_type, point_of_sale, number, total_cents, issue_date, credit }`, de a 1000 | Hasta 1000 |
| `acc_import_save_rule.p_rule` | `{ id \| source, priority, label, match, action, active }`; los zod `.strict()` de `match` y `action` tienen las mismas claves que la SQL | Lista blanca igual |
| `acc_import_save_layout.p_layout` | `{ source: 'bank_statement', signature, mapping, treasury_account_id? }` | Lista blanca igual |
| `acc_mp_save_connection.p_patch` | Lo que vino: `treasury_account_id`, `party_id`, `channel_methods`, `day_cutoff_hour`. Desde la revisión: `{ channel_methods: { <canal>: id \| null } }` | Lista blanca igual |
| `acc_save_party.p_party` | Alta: `kind, name, tax_id_type, tax_id, iva_condition, payment_term_days, default_account_id`. Edición: `{ id, default_account_id \| iva_condition }` | Claves aceptadas por `private.acc_party_save` |
| `acc_post_bundle.p_bundle` | `toRpcPayload(bundle, hash)` de `lib/accounting/posting` | El contrato de siempre de la contabilidad |

Las claves privadas viajan como escalares de `acc_arca_store_keypair`: el PEM PKCS#8 tiene un tope de 4000 caracteres.

### 3.3 Lecturas directas de tablas

Son 35 `.from(...)`:

| Archivo | `.from(...)` |
|---|---|
| `lib/arca/queries.ts` | 9 |
| `lib/imports/server/stage.ts` | 4 |
| `lib/imports/server/queries.ts` | 8 |
| `lib/imports/server/post.ts` | 3 |
| `lib/imports/server/propose.ts` | 7 |
| `lib/accounting/queries/integrations.ts` | 4 |

- **Sesión:** todas corren con la sesión de la persona (`createClient`/`readerClient`) y filtran `tenant_id` explícito.
- **Permisos:** las tablas tienen `grant select to authenticated` y la política de lectores.
- **Tablas cerradas:** nadie lee `acc_secrets` ni `acc_arca_tickets` (además, no tienen privilegios).
- **Columnas sensibles:** de `acc_arca_connections` se leen los hashes de la clave pública, que no son secretos, y el
  CSR, que es público. Las vistas devuelven solo `hasCsr` y `renewalPending`. El CSR sale únicamente por
  `downloadArcaCsr`.

### 3.4 Claves de error

- **De la base.** Las 13 migraciones levantan 37 claves distintas y todas están en `ACC_ERRORS`. La diferencia de
  `lib/accounting/errors.ts` contra `HEAD` agrega 28: las 26 de la fase 1, más `import_reposted` y
  `reset_arca_vouchers`, que vienen de la migración 13.
- **Cómo se traducen.** En TS, los errores de la base pasan por `mapAccError`:
  - directo, con `rpcFailure`;
  - o envueltos en `ArcaStoreError` en los caminos de ARCA.
  Lo que contesta ARCA pasa por `classifyArcaError` y `describeArcaError` (`lib/arca/errors.ts`). Son 24 claves:
  - de la conexión y el certificado: `arca_unavailable`, `arca_not_authorized`, `arca_wrong_environment`,
    `arca_cert_expired`, `arca_key_mismatch`, `arca_clock`, `arca_already_authenticated`, `arca_cuit_not_in_token`,
    `arca_token_rejected`;
  - del punto de venta y el emisor: `arca_pos_not_enabled`, `arca_pos_blocked`, `arca_issuer_problem`,
    `arca_class_a_not_enabled`;
  - de la emisión: `arca_number_mismatch`, `arca_receiver_condition`, `arca_receiver_document`, `arca_fce_required`,
    `arca_amounts`, `arca_in_flight`, `arca_unknown_state`, `arca_authorized_not_posted`;
  - generales: `arca_busy`, `arca_internal`, `arca_unknown`.
- **Claves que TS arma con su propio texto** (no están en el catálogo; la pantalla muestra `message` y decide con
  `detail.key`):
  - `secrets_key_missing` (`bug`) y `rate_limited`, en ARCA;
  - `import_source_unsupported`, `mp_wallet_missing` e `invalid_change`, en importaciones;
  - `invalid_payload` con `row_no` y `reason` (`bug`) en `addImportItems`.
- **`lookupCuit` no devuelve `AccSimpleState`.** Devuelve `PadronLookupResult`, con `code` ∈ `arca_not_connected`,
  `invalid_cuit`, `not_found`, `arca_unavailable`, `arca_not_authorized`, `rate_limited`, `forbidden` o `error`, más
  `step` (el paso de la guía que lo arregla).
- **Clave nueva en flujos existentes: `import_reposted`.**
  - **Cuándo sale:** al deshacer la anulación de un comprobante importado cuya carga ya se rehízo.
  - **Cómo sale:** la levanta un trigger diferido en el COMMIT de las acciones de anular o revertir que ya existen.
  - **Qué hace la pantalla:** como está en el catálogo, llega con su texto por `mapAccError`; solo hay que no
    tragársela.

### 3.5 Las 10 RPC de las 13 que todavía nadie llama

- **WP9:** `acc_arca_voucher_reserve`, `acc_arca_voucher_update` y `acc_ensure_final_consumer`.
- **WP12, de usuario:** `acc_mp_store_token`, `acc_mp_get_token` y `acc_mp_disconnect`. Las dos primeras reciben la
  clave del servidor.
- **WP12, del cron (solo `service_role`, chequean `auth.role()`):** `acc_import_create_batch_service`,
  `acc_import_add_items_service`, `acc_mp_sync_targets_service` y `acc_mp_sync_record_service`.

En total, las 13 migraciones crean o reemplazan 32 RPC públicas: 22 tienen quien las llame y estas 10 todavía no.

---

## 4. Seguridad (revisión del cierre)

| Punto | Resultado |
|---|---|
| Lo que vuelve al navegador | Las acciones de ARCA devuelven vistas sin secretos: `ArcaConnectionView`, `ArcaTestView`, `ArcaCertificateResult` (serie, CN, CUIT, fechas), `ArcaPointOfSaleResult` y `PadronLookupResult`. El pedido `.csr` (`csrPem`) sale en `startArcaCertificate` y `downloadArcaCsr` y es público. De Mercado Pago solo sale `tokenLast4`. Los textos de error salen del catálogo, nunca el mensaje crudo de Postgres |
| Clave privada en memoria | Se genera en `startArcaCertificate` y va directo a la RPC. Al leerla, `loadCredentials` la deja como propiedad no enumerable, así que no aparece si alguien loguea el objeto |
| Ticket del WSAA | Se usa solo dentro de la sesión. El chequeo `wsfe_ticket` guarda `{ source, expires_at }`. `relations` se decodifica y no se guarda |
| Logs | 16 `console.error` en el código nuevo, todos con la operación y la clave o el código. ARCA loguea solo `e.name` de lo inesperado. Las importaciones usan `rpcFailure` (clave + SQLSTATE) y el `unexpectedFailure` existente (nombre y mensaje de una excepción; ese camino no maneja secretos). Ningún log lleva CUIT, nombres, PEM, token ni la clave del servidor |
| `service_role` | Ninguno. Todo corre con `@/lib/supabase/server` (la sesión de la persona) |
| Cron | Todavía no hay cron de importaciones: ningún archivo de `app/api/cron` ni `lib/cron` toca `lib/arca`, `lib/imports` ni `acc_*`. Cuando WP12 lo haga, tiene que usar solo las 4 `*_service` y **nunca** `acc_post_bundle` (D7: el cron prepara y una persona confirma) |
| Regex del bar en el servidor (riesgo de la fase 1 §5.2) | **Cerrado.** Las reglas del bar se evalúan con el subconjunto seguro (`lib/imports/server/safe-pattern.ts`). `saveImportRule` rechaza un patrón inseguro con `SAFE_PATTERN_HELP`. `classifyBankItem` solo corre con las reglas de fábrica |
| Archivos enormes | Topes de la fase 1, más `bodySizeLimit: '4mb'` de las server actions (`next.config.ts`) y el tope de Vercel de 4,5 MB por request |

---

## 5. API del servidor para la fase 3

### 5.1 Convenciones

- **Forma de las acciones.** Todas son `'use server'`, reciben `(slug, input)` y devuelven
  `AccSimpleState<T> = { ok: true; data: T; message } | AccFailureState`.
- **Forma de los errores.** `AccFailureState = { ok: false, code, message, fieldErrors?, detail? }`:
  - `code` ∈ `forbidden`, `disabled`, `invalid`, `preview_stale`, `needs_confirmation`, `stale`, `conflict`, `error`;
  - `message` siempre está listo para mostrar, en rioplatense;
  - `detail.key` sirve para decidir qué hacer;
  - `detail.bug` indica un problema nuestro.
- **Permisos.** Las de escritura empiezan con `authorizeAccounting(slug, 'write')`, así que la contadora recibe
  `forbidden`. Las `fetch*` son de lectura.
- **Qué aceptan.** Las de ARCA aceptan un objeto o el `FormData` del formulario; los arrays (`allowedClasses`) solo en
  objeto. Las de importaciones aceptan solo objetos.
- **Revalidación.** Después de escribir, revalidan Administración (`revalidateAccounting` / `revalidateAdministracion`).
- **Lecturas de página (RSC).** Las funciones de `queries.ts` son de servidor, no son acciones:
  1. la página llama antes a `requireAccountingAccess(slug, 'read')`;
  2. después las envuelve con `settleQuery(...)`, que devuelve `{ ok: true, data } | { ok: false, code, message }`.
- **Concurrencia optimista.** Hay que mandar el `updatedAt` que se mostró como `expectedUpdatedAt` en:
  - la conexión de ARCA (`ArcaConnectionView.updatedAt`);
  - la configuración de Mercado Pago;
  - las reglas al editarlas (ahí es obligatorio; sin él da `stale`).
  Si no viene, `saveArcaPointOfSale` y `saveArcaSettings` usan el de la base: gana la última escritura.
- **Mientras las 13 no estén aplicadas:**
  - las acciones dan `function_unavailable`;
  - las lecturas de ARCA e importaciones dan «No pudimos cargar esto»;
  - `getOnboarding` devuelve `null`;
  - `getIntegrationsStatus` devuelve `available: false`, sin avisos.

### 5.2 ARCA · acciones (`lib/arca/actions.ts`)

**`startArcaCertificate(slug, { environment, alias, certCuit?, mode? })`** → `ArcaCsrResult`

- **Entrada:**
  - `alias`: se recorta y pasa a minúsculas; tiene que cumplir `^[a-z0-9]{3,30}$`;
  - `mode`: `'new'` (por defecto), `'replace'` o `'renew'`;
  - `certCuit` en producción: la de la SAS, o se omite;
  - `certCuit` en homologación: la CUIT personal de WSASS (por defecto, la del pedido anterior).
- **Salida:** `{ environment, alias, csrPem, fileName: 'arca-<alias>.csr', mode, status, updatedAt }`. La pantalla arma
  el archivo con un `Blob`. Nunca vuelve la clave.
- **Errores:**
  - `fieldErrors.certCuit` o `fieldErrors.alias`;
  - `detail.key`: `sas_cuit_missing` (link a `?tab=sas`), **`arca_key_replace_requires_confirm`** (la pantalla
    confirma con `AlertDialog` y reenvía con `mode: 'replace'`), `arca_cuit_mismatch`, `arca_alias_locked`,
    `arca_not_ready` (renovar sin certificado), `arca_voucher_in_flight`, `secrets_key_missing`.

**`downloadArcaCsr(slug, { environment, pending? })`** → `{ alias, csrPem, fileName }`

- Con `pending: true` devuelve el pedido de la renovación.
- **Error:** `arca_key_missing`.
- Necesita escritura.

**`uploadArcaCertificate(slug, { environment, fileBase64, expectedUpdatedAt? })`** → `ArcaCertificateResult`

- **Entrada:** `fileBase64` es el base64 o el data URL de `FileReader.readAsDataURL`, de hasta 16 KB.
- **Salida:** `{ environment, serial (hex, mayúsculas), subjectCn, subjectCuit, notBefore, notAfter (ISO), daysLeft,
  renewal, warnings[], connection }`.
- **Problemas del archivo:** vuelven en `fieldErrors.fileBase64`, con los textos de §2.4.2 del diseño (subió el .csr,
  una clave privada, un .p12, algo ilegible, «es de otro pedido», CUIT equivocada, vencido o todavía no vigente).
- **Alias distinto:** si el CN no es el alias del pedido, es un **aviso** (`warnings`), no un error.
- **Errores de la base:** `arca_key_missing`, `arca_certificate_{key,cuit}_mismatch`, `arca_certificate_expired`, `stale`.

**`saveArcaPointOfSale(slug, { environment, pointOfSale, expectedUpdatedAt? })`** → `ArcaPointOfSaleResult`

- **Entrada:** `pointOfSale` va de 1 a 99998, como número o texto.
- **Salida:** `{ connection, salesPoint: { status: 'created' | 'existing' | 'failed', number, label } | null, warnings[] }`.
- **En producción:** además crea «Plataforma (ARCA)» con canal `events` en Puntos de venta si el número no existe. Si
  existe con otra etiqueta, avisa que puede ser el de Thinkeon.
- **Conexión ya probada:** cambiar el punto la devuelve a `cert_ready`; el mensaje pide volver a probar.
- **Errores:** `stale`, `arca_voucher_in_flight`, `sas_cuit_missing` (sin fila todavía), `invalid_payload`.

**`saveArcaSettings(slug, { environment, alias?, allowedClasses?, defaultConcepto?, emissionEnabled?, expectedUpdatedAt? })`** → `ArcaConnectionView`

- Viajan solo las claves que se mandan.
- `allowedClasses` ⊆ `A`, `A51`, `ACBU` y siempre suma la `B`.
- `defaultConcepto` es 1, 2 o 3.
- `emissionEnabled` es solo de producción (zod).
- **Errores:** `arca_alias_locked`, `arca_emission_requires_connection`, `stale`.

**`testArcaConnection(slug, { environment })`** → `ArcaTestView`

- **Qué hace:** corre los 7 chequeos de §2.6 y borra el cooldown manual del ticket.
- **`ok: true` quiere decir que la prueba corrió**, aunque dé `status: 'error'`. El primer problema está en
  `firstProblem`.
- **Topes:** 10 pruebas por minuto por bar y ambiente; 45 s de presupuesto para empezar chequeos; 12 s por llamada y
  15 s para el login. Ver la duración en §6.1.
- **Errores:** `arca_not_ready` (sin certificado), `rate_limited`, `secrets_key_missing`, `secret_unreadable` (otra
  clave del servidor).

**`disconnectArca(slug, { environment, confirm: 'DESCONECTAR' })`** → `{ environment }`

- La base borra la clave, el certificado y los tickets.
- **Errores:** `confirmation_required`, `arca_voucher_in_flight`, `arca_not_ready`.

**`markGuideStep(slug, { guide: 'arca' | 'arranque', step, done })`** → `{ guide, step, done }`

- En la guía `arca`, el paso tiene que ser uno de `ARCA_GUIDE_STEP_IDS`.
- **Para «Cómo arrancar» usar `markOnboardingStep`** (§5.4).

**`lookupCuit(slug, { cuit, purpose?: 'supplier' | 'customer', refresh? })`** → `PadronLookupResult`

- **No tira.** Devuelve `{ ok: true, data: PadronLookupData } | { ok: false, code, message, step }`.
- **Caché del bar:** 30 días si ARCA encontró la CUIT y 24 h si no. `refresh: true` la saltea.
- **Tope:** 30 consultas por minuto por bar.
- **`PadronLookupData`:**
  - identidad: `cuit, name, personKind, active`;
  - condición frente al IVA: `ivaCondition, condicionIvaReceptorId, needsReview, monotributoCategory`;
  - domicilio y actividad: `address, locality, province, activity`;
  - origen: `source: 'arca' | 'cache'`, `environment`, `testData`, `fetchedAt`;
  - avisos: `warnings: [{ key: 'inactive' | 'monotributo' | 'needs_review' | 'test_data', message }]`.
- **Permiso:** escritura, porque guarda en la caché.

**`fetchArcaOverview(slug)`** → `QueryOutcome<ArcaOverview>` · **`fetchArcaLookupStatus(slug)`** → `QueryOutcome<ArcaLookupStatus>`

- Son lecturas para refrescar desde componentes de cliente. Alcanza con permiso de lectura.

**No están (WP9):** `getArcaNextNumber`, `emitArcaSalesVoucher`, `postAuthorizedArcaVoucher`, `reconcileArcaVoucher` y
`emitArcaTestVoucher`.

### 5.3 ARCA · lecturas y tipos

**`lib/arca/queries.ts`** (`server-only`, para páginas)

| Función | Devuelve | Para qué |
|---|---|---|
| `getArcaOverview(tenantId, { now? })` | `ArcaOverview` | La pestaña ARCA y la guía |
| `getArcaConnection(tenantId, environment)` | `ArcaConnectionView \| null` | Una conexión |
| `getArcaLookupStatus(tenantId)` | `ArcaLookupStatus = { environment: env \| null, testData }` | Mostrar «Completar con ARCA» o el link «Conectá ARCA…» |
| `getPadronVerification(tenantId, cuit)` | `{ environment, fetchedAt, found, active } \| null` | «Verificado en ARCA el …» en la ficha (prefiere producción) |

**`ArcaOverview`:**

- `sas: { legalName, cuit }`;
- `connections: { produccion, homologacion }`, cada una `ArcaConnectionView | null`;
- `guide: { produccion, homologacion }`, cada una `ArcaGuideView = { steps, summary: { done, total, next } }`;
- `progress: ArcaGuideMark[]`;
- `lookup: ArcaLookupStatus`;
- `attention: ArcaVoucherAttention[]`: comprobantes en `needs_reconcile` o `authorized`, con `label`, `cae`,
  `totalCents`, etc.

**`ArcaConnectionView`:**

- identificación: `id`;
- ambiente: `environment` y `environmentLabel`;
- estado: `status` (`draft | key_ready | cert_ready | connected | error | disconnected`) y `statusLabel`;
- CUIT: `representedCuit` (la SAS) y `certCuit`;
- certificado y pedido:
  - `alias`, `hasCsr`, `csrFileName`, `renewalPending`;
  - `certificate: { serial, issuer, notBefore, notAfter, daysLeft, expired, renewSoon (< 30 días) } | null`;
- configuración: `pointOfSale`, `allowedClasses`, `defaultConcepto`, `emissionEnabled`;
- última prueba:
  - `services: { wsfe, padron }`, con `'ok'` o la clave del error;
  - `lastTestAt` y `lastTest: ArcaTestView | null` (solo si sigue vigente);
  - `lastError: ArcaProblemView | null`, con `title`, `body`, `step` y `retry`;
- concurrencia: `updatedAt`.

**`ArcaTestView`:**

- `{ at, environment, status, checks: ArcaCheckView[], notRun, firstProblem }`;
- cada `ArcaCheckView` = `{ key, n, label, ok, required, tone: 'ok' | 'warning' | 'error', title, message, errorKey,
  step, retry, code }`.

**Guía (`lib/arca/guide.ts`, puro):**

- `ARCA_GUIDE_STEP_IDS`: `s0_prereq`, `s1_elegir_sas`, `s2_punto_venta`, `s3_factura_a`, `s4_certificados`,
  `s5_pedido`, `s6_certificado`, `s7_wsfe`, `s8_padron`, `s9_probar`, `s10_mis_comprobantes`;
- `ArcaStepState`: `status` ∈ `done | todo | pending | check | failed`, más `reason`, `source`
  (`manual | auto | test`), `doneAt` y `doneBy`;
- también exporta `ARCA_GUIDE_STEPS`, `ARCA_CHECKS` y `ARCA_CHECK_KEYS`.

**Puros para el cliente:**

- `views.ts`: etiquetas `ARCA_ENVIRONMENT_LABELS` y `ARCA_STATUS_LABELS`, `ivaConditionText`, `arcaProblemView` y
  `arcaStepProblem`;
- `schemas.ts`: los zod, para validar al tipear; `CERT_FILE_MAX_BYTES = 16384`, `DISCONNECT_CONFIRMATION`,
  `ARCA_CLASSES`;
- `errors.ts`: `ARCA_ERRORS` y `describeArcaErrorKey`.

### 5.4 Importaciones · acciones (`lib/imports/actions.ts`)

**Subir**

**`createImportBatch(slug, input)`** → `{ batchId, status, createdAt }`

- **Entrada:**
  - `source`: `'arca_recibidos' | 'mp_release' | 'bank_statement'`;
  - datos del archivo: `fileSha256` (hex 64), `fileSize` (1 B – 20 MB), `fileName?` (≤ 200), `detectedFormat?`
    (`^[a-z0-9_:-]{2,80}$`);
  - período: `periodFrom?` y `periodTo?` (`yyyy-MM-dd`);
  - caja: `treasuryAccountId?`, obligatoria para el banco;
  - `meta?`: lista blanca `batchMetaSchema`, sin datos de filas.
- **Archivo repetido:** devuelve `ok: false` con `detail` = `{ key: 'import_file_already', batch_id, date, name, status,
  resumable }`. Con `resumable: true` (lote en `staging`), se sigue en ese lote.

**`addImportItems(slug, { batchId, items: 1..1000 × { rowNo, naturalKey, data, issues? } })`** → `{ inserted, duplicates, skipped, issuesTrimmed, counts }`

- **Validación:** `data` se valida contra el esquema de su origen (`McItem`, `MpItem` o `BankItem`), y la clave
  natural se recalcula en el servidor y tiene que coincidir.
- **Reintento:** es idempotente; reenviar la misma tanda no duplica.
- **Errores:**
  - `import_batch_closed` (también para `arca_emitidos`, hasta WP13);
  - `invalid_payload` con `{ row_no, reason: 'data' | 'key' | 'issues' | 'size', bug }`.

**Revisar**

**`buildImportProposals(slug, { batchId })`** → `BuildProposalsResult = { byStatus, written, unchanged, rulesSkipped, counts }`

- **Errores:** `import_source_unsupported` (Emitidos) y `mp_wallet_missing`.

**`resolveImportNeeds(slug, { batchId, changes: 1..50 })`** → `BuildProposalsResult` (aplica y vuelve a armar). Los cambios
(`ImportChange`):

| `kind` | Campos | Para qué |
|---|---|---|
| `supplier_account` | `partyId`, `accountId` | Cuenta habitual del proveedor |
| `supplier_condition` | `partyId`, `ivaCondition` | Condición frente al IVA |
| `other_taxes_as` | `proposalKey? \| partyId?`, `as: 'perc_iibb' \| 'perc_iva' \| 'internal' \| 'account'`, `accountId?`, `jurisdictionCode?` (901–924), `remember?` | «Otros tributos» de Mis Comprobantes |
| `ignore` / `unignore` | `itemIds` (≤ 1000), `reason?` | «No es nuestro» / deshacer |
| `channel_method` | `channel: 'qr' \| 'point' \| 'link' \| 'transfer_in'`, `salesMethodId \| null` | Medio del cierre de un canal de Mercado Pago (se guarda) |
| `pick_party` | `proposalKey`, `partyId` | A quién le corresponde |
| `pick_treasury` | `proposalKey`, `treasuryAccountId` | La otra cuenta |
| `pick_account` | `proposalKey`, `accountId`, `tax?` | Contrapartida, o la cuenta de un impuesto desconocido |
| `link_credit_note` | `proposalKey`, `documentId \| null` | Factura que corrige la nota de crédito |
| `settles_commissions` | `proposalKey`, `value` | Factura de comisiones de Mercado Pago |
| `accept_warning` | `proposalKey`, `warning` | Aceptar un aviso del motor |
| `confirm` | `proposalKey`, `need: 'foreign_currency' \| 'possible_duplicate' \| 'estimated_deductions'` | «Confirmar» |
| `reset` | `proposalKey` | Borrar las decisiones |
| `reimport` | `proposalKey` | **«Volver a cargar»** una propuesta `voided` (otro intento, con su `client_ref` nuevo) |

**`createImportSuppliers(slug, { batchId, suppliers: 1..200 × { cuit, name, ivaCondition, accountId, paymentTermDays? } })`** → `{ created[], failed[], build }`

- Las fallas son parciales y van en `failed[]` con su texto. Si se creó al menos uno, vuelve a armar el lote.
- **No consulta ARCA** (ver §6.1).

**Confirmar**

**`postImportProposals(slug, { batchId, items: 1..15 × { key, previewHash }, acceptWarnings? })`** → `{ results[], posted, counts, batchStatus }`

- `acceptWarnings` ⊆ `vat_diff`, `voucher_condition`, `voucher_m`, `late_registration`, `treasury_negative`.
- **Resultado por propuesta:** `{ key, outcome, documentId?, message?, hash?, needs? }`, con `outcome` ∈:
  - `posted` y `replayed`: quedó cargada;
  - `already_posted`: ya estaba;
  - `stale`: trae `hash`, la vista previa nueva; se reenvía con ese hash si la persona la acepta;
  - `needs_input`: trae `needs`;
  - `error`;
  - `skipped`: una `voided` viene con `PROPOSAL_VOIDED_TEXT`;
  - `not_found`.

**Lote, reglas y configuración**

**`cancelImportBatch(slug, { batchId, reason? })`** → `null`

- Lo cargado queda: se anula como siempre.

**`saveImportRule(slug, { id?, expectedUpdatedAt?, source, priority?, label, match, action, active? })`** → `SavedImportRule`

- **Patrón inseguro:** devuelve `fieldErrors['match.pattern']` con `SAFE_PATTERN_HELP`.
- **Forma de la regla:** si no sirve para su origen, `fieldErrors['action.kind']`.
- **Editar:** exige `expectedUpdatedAt`.

**`deleteImportRule(slug, { ruleId })`** → `null`

**`saveImportLayout(slug, { signature, mapping, treasuryAccountId? })`** → `{ id, signature }`

- Es el mapeo de columnas de un formato de extracto bancario.

**`saveMercadoPagoImportSettings(slug, { expectedUpdatedAt?, treasuryAccountId?, partyId?, channelMethods?, dayCutoffHour? })`** → `SavedMpSettings`

- `dayCutoffHour` va de 0 a 8.
- No hay token: conectar por API es de WP12.

**`markOnboardingStep(slug, { step, done })`** → `{ step, done }`

- Solo acepta los ítems manuales de «Cómo arrancar»: `treasuries`, `recurring` y `suppliers_message`.
- Cualquier otro devuelve `fieldErrors.step` «Ese paso se marca solo».

### 5.5 Importaciones · lecturas y textos

**`lib/imports/server/queries.ts`** (`server-only`)

| Función | Devuelve |
|---|---|
| `listImportBatches(tenantId, { source?, limit? (1–200, 50), before? })` | `ImportBatchRow[]` (historial; `before` = `createdAt` de la última fila) |
| `getImportBatch(tenantId, batchId)` | `ImportBatchDetail \| null` (con `meta`) |
| `listImportProposals(tenantId, batchId, { statuses?, limit? (≤ 500, 100), offset? })` | `{ rows: ImportProposalRow[], total }` |
| `listImportItems(tenantId, batchId, { statuses?, proposalKey?, limit? (≤ 1000, 100), offset? })` | `{ rows: ImportItemRow[], total }` |
| `getImportReview(tenantId, batchId)` | `ImportReviewSummary \| null` |
| `getImportsOverview(tenantId)` | Las tres tarjetas del hub: `{ arca_recibidos, mp_release, bank_statement }`, cada una `{ lastBatch, pendingBatches, pendingProposals }` |
| `listImportRules(tenantId, source?)` | `ImportRuleRow[]` (con `serverSafe`) |
| `listImportLayouts(tenantId)` | `ImportLayoutRow[]` |
| `getMpImportSettings(tenantId)` | `MpImportSettings`: `{ connection \| null (sin token, solo tokenLast4), effective, wallets, methods, ownAccounts }` |
| `isImportQueryError(e)` | Para distinguir «no existe» de un error de lectura |

- **`ImportBatchRow`:** `{ id, source, origin, fileName, fileSize, detectedFormat, periodFrom, periodTo,
  treasuryAccountId, status, counts, pending, createdByName, createdAt, completedAt, cancelledAt, cancelReason }`.
  - `status` ∈ `staging | review | posting | done | cancelled`.
  - `counts` = `ImportBatchCounts`, 16 conteos que incluyen `voided`.
- **`ImportProposalRow`:** `{ key, form, status, previewHash, summary, needs, warningsAck, documentId, postedAt, error,
  formValues, updatedAt }`.
  - `formValues` sirve para «Ver asiento» y para «Cargarla a mano».
- **`ImportReviewSummary`:**
  - `batch`;
  - totales: `byStatus`, `alreadyLoaded`, `readyCents`, `pendingCents`;
  - para filtrar: `needs` (por tipo) y `warnings` (lo que se acepta con el lote);
  - `months` y `movedToOpenMonth`;
  - `newSuppliers`, con la cuenta sugerida.

**Textos listos en `lib/imports/server/types.ts`** (puro, se puede importar desde el cliente):

- `NEED_TEXT` (21 tipos de `needs`);
- `MANUAL_REASON_TEXT`;
- `SKIP_REASON_TEXT` («Ya cargado» = `already_loaded`, `posted_in_other_batch`, `active_in_other_batch`);
- `NOTE_TEXT`;
- `PROPOSAL_VOIDED_TEXT`;
- `CONFIRMABLE_NEEDS`, `BATCH_ACCEPTABLE_WARNINGS` y los zod de todas las acciones.

### 5.6 «Cómo arrancar» y Resumen

**`getOnboarding(tenantId)`** (`lib/accounting/queries/onboarding.ts`) → `{ data: OnboardingData, state: OnboardingState } | null`

- `null` mientras `acc_report_onboarding` no existe.
- Otros errores tiran `AccQueryError`. `not_set_up` sale si Administración no está configurada.

**`lib/accounting/onboarding.ts`** (puro):

- `ONBOARDING_ITEMS`: 19 ítems en 4 secciones (`day1`, `daily`, `weekly`, `monthly`, con `ONBOARDING_SECTION_LABEL`);
- `ONBOARDING_MANUAL_STEPS`;
- `onboardingState(data, manual?)`: devuelve `items`, `done`, `total`, `next` y `sections`;
- `supplierRequestMessage({ legalName, cuit })`;
- `ONBOARDING_HAVE_AT_HAND`, `PLATFORM_DOES` y `SAS_REQUIRED_FIELDS`.

**`lib/accounting/queries/integrations.ts`:**

- `getIntegrationsStatus(tenantId)` → `IntegrationsStatus`. Mientras las tablas no existen, `available: false`.
- `integrationAttention(status)` o `getIntegrationAttention(tenantId)` → `IntegrationAttentionItem[]`. Es la segunda
  fuente de «Para atender» del Resumen.
  - Tipos: `arca_error`, `arca_cert_expired`, `arca_cert_expiring`, `arca_vouchers`, `mp_reconnect`,
    `import_review`, `mc_prev_month`.
  - Cada uno trae `tone`, `label`, `href` (relativo a `/<bar>/administracion`), `actionLabel`, `count` y `date`.

### 5.7 Del navegador al servidor: el flujo de subida (piezas de la fase 1)

1. **Abrir y reconocer el archivo:** `openTable({ bytes, fileName, inflateRaw })` y `detectSource(...)`. En el
   navegador se descomprime con `DecompressionStream('deflate-raw')`.
2. **Parsear según el origen:**
   - Mis Comprobantes: `parseMisComprobantes`;
   - Mercado Pago: `parseReleaseReport`;
   - banco: `parseBankStatement`, con el mapeo de `listImportLayouts` o «Contanos qué es cada columna» →
     `saveImportLayout`.
3. **Huella del archivo:** `sha256Hex(bytes)`.
4. **Crear el lote:** `createImportBatch`, y después `addImportItems` en tandas (ver §6.1).
5. **Armar las propuestas:** `buildImportProposals`, y la página `importar/[batchId]` lee `getImportReview` y las listas.
6. **Completar lo que falta:** `resolveImportNeeds` / `createImportSuppliers`.
7. **Cargar:** `postImportProposals` en bucle, de a 15.

---

## 6. Lo que necesita la fase 3

### 6.1 Transversal

1. **Aplicar las 13 migraciones** (§2) con el «sí» de Nacho. Hasta entonces, las pantallas tienen que mostrar los
   estados vacíos o «No pudimos cargar esto» de §5.1 sin romperse.
2. **Duración de las funciones (hallazgo del cierre).** Hoy nadie fija `maxDuration` (ni las páginas ni `vercel.json`).
   Las acciones corren en la función de la página que las llama.
   - **«Probar conexión», peor caso con sus topes:**
     - el presupuesto de 45 s solo se mira **antes** de los chequeos 2, 4, 5 y 6;
     - el chequeo 6 (padrón) puede empezar en 44,9 s y hacer dummy (12 s) + login al WSAA del padrón (15 s) +
       `getPersona` (12 s): unos **84 s**;
     - con otra instancia en el lease del padrón se suman hasta 9 s, unos **93 s**;
     - con reintentos por red, más (cada llamada idempotente se reintenta una vez si falla la red).
   - **«Completar con ARCA»:** usa los topes por defecto (25 s): ticket (9 s si está `busy` + 25 s de login) +
     `getPersona` (25 s), unos **59 s**.
   - **Riesgo:** si Vercel corta la función con un login en vuelo que ARCA sí procesó, ese TA se pierde. El WSAA
     contesta «ya posee un TA válido» hasta que venza (hasta 12 h), y ese servicio queda sin andar.
   - **Propuesta, a decidir:**
     - (a) que WP5 convierta el presupuesto en un plazo duro: recortar el timeout de cada llamada a lo que queda y no
       empezar un login con menos de ~20 s;
     - (b) que WP7 y WP8 fijen `export const maxDuration` por encima del peor caso en las páginas que llaman
       `testArcaConnection` (Ajustes › ARCA y la guía) y `lookupCuit` (los cuatro formularios de §3.1 del diseño),
       confirmando el límite del plan de Vercel.
     - Mejor las dos.
   - **Importaciones:** `postImportProposals` (15 cargas) y `buildImportProposals` (lotes grandes) también conviene
     correrlas con un `maxDuration` explícito en `importar/[batchId]`.
3. **Tamaño de las tandas.** `addImportItems` acepta hasta 1000 filas, pero la acción tiene un tope de 4 MB de cuerpo
   (`bodySizeLimit`) y Vercel uno de 4,5 MB. Una fila puede pesar hasta ~8 KB. Por eso conviene mandar tandas de
   **500 filas o 1 MB serializado**, lo que llegue primero, como dice el comentario de WP6. Las tandas por RPC ya
   las corta el servidor (500 filas, 100 propuestas).
4. **No subir `statement_timeout`** (§2.3, punto 5). Las tandas actuales están pensadas para entrar en 8 s.
5. **Permisos.**
   - La contadora ve el estado y el historial, sin botones.
   - `fetchArcaLookupStatus` es de lectura, pero `lookupCuit` exige escritura: mostrar «Completar con ARCA» solo a
     quien puede cargar.
   - `downloadArcaCsr` también exige escritura.
6. **Un solo camino para las marcas de «Cómo arrancar»:** `markOnboardingStep`. `markGuideStep` se usa solo con
   `guide: 'arca'`. Con `'arranque'` también escribe, pero `onboardingState` ignora las marcas de ítems que no se marcan
   a mano, así que no rompe nada: es solo para no tener dos caminos.
7. **Concurrencia y formularios.**
   - Mandar `expectedUpdatedAt` en los formularios que editan (§5.1).
   - `allowedClasses` va en objeto, no en `FormData`.
8. **Rutas nuevas que ya están linkeadas desde el servidor:**

   | Ruta | Paquete | Quién la linkea |
   |---|---|---|
   | `/ajustes?tab=arca` | WP7 | — |
   | `/ajustes/arca` | WP7 | integraciones y «Cómo arrancar» |
   | `/importar` | WP10 | — |
   | `/importar/arca` | WP10 | — |
   | `/importar/mercado-pago` | WP10 | — |
   | `/importar/banco` | WP10 | — |
   | `/importar/<batchId>` | WP10 | `integrationAttention` |
   | `/guias/como-arrancar` | WP11 | — |

   Las pestañas de Ajustes hoy son 8. Con «ARCA» (va después de «Datos de la SAS») son 9: el diseño (§2.2) pide
   verificar que entren a 1280 px con el menú abierto. El menú cambió en `e49a065` (una entrada por sección, con
   pestañas adentro).
9. **Padrón en lote (hallazgo del cierre).** `createImportSuppliers` no consulta ARCA, y `lookupCuit` es de a una CUIT
   con un tope de 30 por minuto.
   - **Qué hay:** `createPadron(...).getPersonaList(ids ≤ 250)` y la caché (`acc_arca_padron_cache_put` acepta 250
     filas), pero ninguna acción los usa.
   - **Qué decidir:** si «Proveedores nuevos (N)» completa con ARCA, hace falta una acción nueva (WP8 o WP10). Si no,
     la pantalla consulta de a una con el tope.
10. **Después de aplicar:** regenerar `types/database.ts` (§2.3). Las pantallas pueden seguir usando los tipos de
    `lib/**`.

### 6.2 Por paquete

**WP7 · Pestaña y guía de ARCA**

1. **Página.** `ajustes/page.tsx` agrega `{ value: 'arca', label: 'ARCA' }` después de `sas`. En el `case 'arca'`:
   1. `requireAccountingAccess(slug, 'read')`;
   2. `settleQuery(getArcaOverview(tenant.id))`.
2. **Estados de la tarjeta** (diseño §2.2), según `connections.produccion`:

   | Estado | Cuándo |
   |---|---|
   | A | `null` o `draft` |
   | B | `key_ready` o `cert_ready`, con `guide.produccion.summary` («4 de 9») |
   | C | `connected`, con `lastTest`, `certificate.renewSoon` y el switch de emisión |
   | D | `error`, con `lastError.step` → `#paso-N` |

3. **Homologación:** va en «Pruebas (homologación)».
4. **Refrescar desde el cliente:** `fetchArcaOverview(slug)`.
5. **Archivos:**
   - el `.csr` se arma con `new Blob([csrPem])` y `fileName`;
   - el certificado se sube con `FileReader.readAsDataURL` y `fileBase64`, de hasta 16 KB (`CERT_FILE_MAX_BYTES`).
6. **Errores a manejar a mano:**
   - `arca_key_replace_requires_confirm`: `AlertDialog` y se reenvía con `mode: 'replace'`;
   - `sas_cuit_missing`: link a `?tab=sas`;
   - `stale`: recargar;
   - `rate_limited`;
   - `secrets_key_missing`: «avisanos».
7. **Confirmaciones:**
   - Desconectar: `AlertDialog` destructivo con el texto `DESCONECTAR`.
   - Prender la emisión: `AlertDialog` no destructivo.
   - Solo en producción.
8. **Duración:** fijar `maxDuration` (§6.1, punto 2).

**WP8 · Completar con ARCA**

- **Mostrar el botón o el link:** `getArcaLookupStatus` (en el servidor) o `fetchArcaLookupStatus` (en el cliente).
  Con `environment: null` va el link «Conectá ARCA para completar esto solo» a `?tab=arca`.
- **Consultar:** `lookupCuit(slug, { cuit, purpose })`.
  - Con `ok: true`: tarjeta «Según ARCA…», con `data.warnings` y [Usar estos datos] sin pisar lo escrito a mano.
  - Con `ok: false`: `message`, y `step` si hay que mandar a la guía.
- **Ficha del proveedor:** «Verificado en ARCA el …» con `getPadronVerification`.
- **Duración:** fijar `maxDuration` en las páginas de los cuatro formularios (§6.1, punto 2).

**WP9 · Emisión**

- **Falta todo el servidor:**
  - `lib/arca/emit.ts`;
  - las 5 acciones de §2.3 del diseño;
  - las RPC `acc_arca_voucher_reserve` / `acc_arca_voucher_update` / `acc_ensure_final_consumer`.
- **Lo que ya está listo:**
  - `openArcaSession({ tenantId, environment, representedCuit, … })`;
  - la sesión expone `.wsfe`, con `dummy`, `ultimoAutorizado`, `caeSolicitar`, `compConsultar`, `ptosVenta`,
    `condicionesIvaReceptor` y `paramList`;
  - `getArcaOverview().attention` ya lista lo que queda en `needs_reconcile` o `authorized`.
- **Sin reintentos ciegos de `FECAESolicitar`:** el cliente ya no lo reintenta.

**WP10 · Pantallas de importación**

- **Hub:** `getImportsOverview` + `listImportBatches`.
- **Configuración de Mercado Pago:** `getMpImportSettings` + `saveMercadoPagoImportSettings`.
- **Banco:**
  - formatos: `listImportLayouts` + `saveImportLayout`;
  - reglas: `listImportRules` / `saveImportRule` / `deleteImportRule`, con `serverSafe` para avisar.
- **Revisión:**
  - `getImportReview` y las listas paginadas;
  - los textos de §5.5;
  - **«Volver a cargar»** = `resolveImportNeeds` con `[{ kind: 'reimport', proposalKey }]`.
- **Cargar:** `postImportProposals` en bucle de ≤ 15.
  - Mostrar el progreso («Cargando 45 de 142…»).
  - Pasar `acceptWarnings` con lo de `getImportReview().warnings` una vez que la persona lo acepta.
  - Ante `stale`, mostrar la vista nueva y reenviar con `hash`.
- **Archivo repetido:** con `detail.resumable`, seguir en ese lote. Si no, link a `importar/<batch_id>`.
- **Contadora:** el hub y el historial se ven en solo lectura, y las rutas de carga muestran `ReadOnlyNotice`.

**WP11 · «Cómo arrancar» y Resumen**

- **La guía:** `getOnboarding` (con `null`, la guía sin marcas), `ONBOARDING_ITEMS` y `onboardingState`.
- **Marcar a mano:** `markOnboardingStep`.
- **«Pedíselo a tus proveedores»:** `supplierRequestMessage`.
- **Resumen:** sumar `getIntegrationAttention(tenantId)` como segunda fuente de «Para atender», sin tocar
  `acc_report_summary`.

**WP12 · Mercado Pago por API (fase 4)**

- El cron usa el cliente de `service_role` **solo** con las 4 `*_service`.
- Nunca contabiliza.
- `acc_mp_store_token` / `acc_mp_get_token` reciben `secretsKey()`.

---

## 7. Pendientes y decisiones abiertas

### 7.1 Para decidir (dueño, contadora o el paquete que corresponda)

1. **El «sí» para aplicar las 13 migraciones** (Nacho, P-O10).
2. **Duración de «Probar conexión» y «Completar con ARCA»** (§6.1, punto 2). Lo decide el cierre, junto con WP5, WP7 y
   WP8, antes del smoke en la preview.
3. **Padrón en lote** para «Proveedores nuevos» (§6.1, punto 9). Lo deciden WP8 y WP10.
4. **Tirar un ticket que ARCA rechaza** (WP5). No hay RPC para descartar un TA guardado.
   - **El problema:** si ARCA rechaza uno vigente (`arca_token_rejected`, Err 600 «token»), la base lo sigue
     devolviendo hasta que está por vencer (hasta 12 h), mientras el texto promete «pedimos uno nuevo».
   - **Propuesta:** una RPC chica `acc_arca_ticket_drop`, o un flag en `acc_arca_ticket_get`.
   - **Dónde:** como la 120110 no está aplicada, todavía se puede cambiar ahí, ensayándola de nuevo y con su md5 nuevo
     en §2. Si no, en una migración 14.
5. **Reinicio del bar** (paquete de la migración 13):
   - rechaza con `reset_arca_vouchers` si hay facturas de producción que llegaron a ARCA (son registros fiscales);
   - borra las conexiones de ARCA, homologación incluida (en el bar demo hay que rehacer los pasos 5 a 9);
   - conserva `acc_guide_progress`.
   Lo confirma el dueño.
6. **Gastos bancarios en el libro IVA Compras** (WP6): hoy no entran. Lo confirma la contadora.

### 7.2 Para confirmar con tráfico o archivos reales

- **Login de homologación:**
  - la forma real de `relations` en el token del WSAA (si no se puede leer, el chequeo 3 lo decide WSFE con 600/601);
  - si `FEParamGetPtosVenta` o `FECompUltimoAutorizado` contestan 602 u 11002 en homologación;
  - los faults reconstruidos de la fase 1.
- **Archivos de Mercado Pago:** los nombres de los impuestos de Córdoba (SIRTAC, SIRCUPA, IIBB) en los reportes. Lo que
  no se reconoce pide la cuenta con `unknown_tax`, así que el valor por defecto es seguro.
- **Formatos reales de la fase 1 (P-O6, P-O8):** NE24 / BNA+, encabezados de Mercado Pago, generación G1 de Mis
  Comprobantes.
- **Base del QR de la factura (P-T11):** `arca.gob.ar` o `afip.gob.ar`.

### 7.3 Límites conocidos (documentados, no bloquean)

**ARCA**

- Si un login al WSAA anda pero se pierde la respuesta, o `ticket_put` falla dos veces, vale «ya posee un TA válido»
  hasta que vence. Los cooldowns de 60, 120 y 600 s protegen a ARCA pero no recuperan el ticket.
- Los topes por minuto (10 pruebas, 30 consultas del padrón) viven en memoria por instancia.

**Importaciones**

- Emitidos (`arca_emitidos`) se rechaza al armar hasta WP13.
- **Filas, propuestas y lote:**
  - Si se deshace «no es nuestro» después de cargar el total diario de Mercado Pago o del banco, esa fila queda sin
    propuesta y hay que cargarla a mano.
  - Una `voided` con filas «no es nuestro» queda `voided`.
  - Un lote con solo `voided` pendientes queda en `review` con 0 pendientes.
- **Carga y re-carga de comprobantes:**
  - Re-cargar una compra **revertida** con el mismo número falla con `duplicate_document`, porque `adoc_purchase_dup_uq`
    cuenta el original; después de **anular** anda.
  - `previous_document_id` recuerda solo el último comprobante reemplazado.
- **Costo y tests:**
  - El primer armado de un lote grande verifica los `client_ref` en `acc_bundles` (~1 s extra con 5000 filas).
  - `tests/rls/acc-imports.test.ts` no cubre todavía anular → volver a cargar → cargar (lo cubren los ensayos en la base
    real).

**Documentación (WP14)**

- `.env.example` y CLAUDE.md §15 tienen que decir que ARCA reusa `META_TOKEN_KEY`, y que la clave tiene que ser **la
  misma** en local, en las previews y en producción.
- El cambio de `.env.example` que hoy está en el árbol (`NEXT_PUBLIC_LANDINGS_HOST`) es de otra tarea.

### 7.4 Cerrado desde la fase 1

| Pendiente de `fase1-estado.md` | Cómo se cerró |
|---|---|
| §6.4.1 `acc_reset_tenant` no conocía las tablas nuevas | Migración 13 |
| §6.4.2 Re-importar después de anular | Migración 13 y WP6: estado `voided`, `attempt + 1` con su `client_ref`, `reimport` |
| §6.4.3 `classifyArcaError` y los errores de PostgREST | WP5: `ArcaStoreError` → `mapAccError` |
| §5.2 Regex de las reglas del bar en el servidor | WP6: subconjunto seguro |
| §6.2 `ticket_put` en snake_case y cooldown solo para lo que vino del WSAA | Verificado en el código y en los tests de `arca-session` |

---

## 8. Archivos del cierre

**En el repo:** ningún cambio. Ningún chequeo dio rojo, así que no hubo nada que arreglar.

**En el scratchpad** (`cierre-f2/`):

- **Logs:** `logs/tsc-1.txt` (incremental), `logs/tsc-2.txt` (completo), `logs/lint-1.txt`, `logs/test-1.txt`,
  `logs/lint-2.txt` y `logs/test-2.txt` (la corrida final).
- **Herramientas:**
  - `tools/sigs.py`: firmas de todas las funciones `public.*` de las migraciones, con overloads y `drop`;
  - `tools/calls.py`: llamadas a RPC en TS contra esas firmas;
  - `tools/selects.py`: columnas de `.from().select()` y filtros contra las tablas;
  - `tools/closure.py`: la de la fase 1, que además marca `next/headers` y `@/lib/supabase/server`.
- **Salidas:** `sigs.json`, `calls.txt`, `selects.txt`, `closure.txt`, `where.txt` (safeupdate) y `md5.txt` (las 13).
- **Este archivo:** `research/fase2-estado.md`.

**Lo que no se hizo:**

- Sin `npm install`.
- Sin comandos de git que cambien estado.
- Sin tocar `.env*` ni migraciones.
- Sin `apply_migration`. A la base real solo fueron consultas de lectura (`pg_proc`, `pg_class`,
  `schema_migrations`, `tenants`).
