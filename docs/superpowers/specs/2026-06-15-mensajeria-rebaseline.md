# Spec (re-baseline) — Mensajería: cerrar los gaps de comunicación con el cliente

> Fecha: 2026-06-15 · Base: `origin/main @ 52abcfb` (coincide con prod) · Worktree: `worktree-messaging`
> Re-baseline del diseño original [`2026-06-13-mensajeria-hub-design.md`]. La base anterior estaba 1 día desactualizada; `main` ya shippeó parte de lo planeado, así que este doc recorta el alcance a lo que **realmente falta** y lo re-funda sobre el código actual.

---

## 1. Por qué este re-baseline

El plan original (Fase 0/1) se escribió sobre un `origin/main` stale. El `main` real ya integró (commit `f2e94c5` "marketing+ops" y otros): crons activos (Vercel), opt-in en el envío, hub de Marketing + IA de nav, builder de audiencias con pickers + CRM, sistema de **reviews**, y el retiro de `events`/`event_attendees` → `scheduled_events`/`salon_reservations`. **No reconstruir nada de eso.** Como la base ahora coincide con prod, regenerar tipos por MCP ya no diverge.

## 2. Alcance (cerrado con el usuario, 2026-06-15)

Objetivo rector: **todo lo que implique comunicación con el cliente debe quedar cubierto.** Seis frentes:

1. **Difusiones a clientes** — pulir el envío masivo.
2. **Inbox general** — el inbox tipo WhatsApp-Web completo.
3. **Sincronizar + gestionar templates** — sync existente + crear/editar/enviar-a-aprobación en Meta.
4. **Centralización global de contacto** — contactar al cliente por WhatsApp desde cualquier sector del sistema.
5. **Workflows (completo)** — editor visual de nodos + arreglar lo que no dispara.
6. **Etiquetas (sin IA)** — etiquetas de conversación manuales.

### Decisiones
- **Workflows** → **editor visual nuevo** (`@xyflow/react`) + completar triggers muertos (`after_visit`, `tag_added`) + validación + preview.
- **Instagram** → **solo WhatsApp por ahora** (el inbox muestra IG si llega, pero no invertimos en sus gaps).
- **Soporte incluido** → **mensajes rápidos** (canned replies con `/`), **gestión de plantillas** (crear/editar/submit a Meta), **refresh automático de token WA**.
- **Etiquetas** → manuales, **sin auto-etiquetado por IA**.
- **IA de navegación** → **mantener la IA actual de `main`** (hub de Marketing en *Crecimiento* + "Mensajería"=inbox en *Hoy*). No rehacer la nav; slotear features en las rutas existentes.

### Out of scope
Alertas/Casos sobre reseñas; auto-etiquetado por IA; paridad completa de Instagram (vinculación IGSID→cliente, media IG); multi-número por tenant.

## 3. Estado actual relevante (de la auditoría 2026-06-15)

- **Crons**: wired en `vercel.json` (Vercel Cron, `*/5`). `process-broadcasts`+`process-jobs` corren. (No pg_cron.)
- **Opt-in**: enforced por-recipient en `handleSendBroadcastMessage` (skip+`failed:opt_out`). (La audiencia NO se pre-filtra → opted-out igual se enumeran en `recipients`/`total`.)
- **Inbox**: two-pane (manager `/bandeja` + salon `/salon/bandeja`), realtime en el thread abierto, ventana 24h, composer con templates. Falta: mark-read, realtime de lista, tags, mensajes rápidos, media, paginación.
- **Difusiones**: wizard crear+programar + detalle read-only. Falta: variable_mapping (hardcodea `first_name`, sin columna DB), preview, test-send, tracking entrega/lectura/respuesta (sin columnas, webhook no propaga), cancelar-en-vuelo + UI de cancelar/reenviar/enviar-ahora, throttle tier-aware, stats sin race, segmento inline.
- **Templates**: `lib/meta/templates.ts` sólo sincroniza+muestra. Falta crear/editar/submit.
- **Contacto**: no existe `wa.me` ni botón "Contactar" en ningún lado; `ensureConversationId` está duplicado y privado en `engine.ts` + `flows/runtime.ts` (requiere `customerId` non-null); no hay job `send_message`.
- **Workflows**: builder lineal (dnd), runtime con 4 step types, 3 triggers que disparan; `after_visit` y `tag_added` definidos pero **nunca disparan**. Sin editor visual.
- **Token WA**: `token_expires_at` se guarda pero nunca se lee; sin refresh.

## 4. Arquitectura / convenciones

- Mismas reglas de CLAUDE.md (multi-tenant, RLS+GRANTs, zod en bordes, Server Actions, sin `any`).
- **Migraciones** → MCP `apply_migration` a prod (`ogplsevtrclzxvyejlns`); luego MCP `generate_typescript_types` + re-anexar el bloque de **alias de enums** que el generador borra (cola de `types/database.ts`). La base coincide con prod, así que el regen no introduce schema ajeno.
- **Crons** → agregar nuevas rutas a `vercel.json` (el proyecto está en Vercel Pro; ya hay 9 crons sub-diarios). No pg_cron.
- **Tests** → unit en `tests/lib/*` (node env); RLS/integración en `tests/rls/*` (auto-skip sin `SUPABASE_*`, corren en CI — Docker no disponible local).
- **Contacto reusable** → extraer `findOrCreateConversation(channelId, externalUserId, customerId|null)` compartido (de-duplicar de engine/flows, permitir `customerId` null) + acción `contactCustomer` + componente `<ContactCustomerSheet>` + fallback `wa.me`.

## 5. Fases (orden de ejecución)

Cada fase: produce software testeable y mergeable; sus migraciones se aplican a prod antes del código que depende de ellas; se ejecuta subagent-driven con review por tarea.

### Fase 1 — Difusiones + Templates (prioridad)
- DB: `broadcasts.variable_mapping jsonb`; `broadcast_recipients.{delivered_at,read_at,replied_at}`; enum `broadcast_status += 'partial'`.
- Engine: aplicar `variable_mapping` (reemplazar hardcode), pre-filtrar opt-in en materialize (además del skip), throttle por tasa, stats exactas (contar de `broadcast_recipients`), finalizar `partial`.
- Propagación: RPC + webhook → setear delivered/read en `broadcast_recipients`; detectar `replied` en inbound.
- Acciones+UI: variable-mapping inputs + preview renderizado + test-send; enviar-ahora/cancelar/reenviar-fallidos (wire + UI); stats en vivo (realtime) en el detalle.
- Templates: gestión (crear/editar/submit a Meta) en `configuracion/templates` + `lib/meta/templates.ts` (create/delete vía Graph), reusando los componentes para el variable-mapping del wizard.

### Fase 2 — Inbox general
- DB: `conversation_tags` + `conversation_tag_assignments`; `quick_messages`; `conversations` += `last_inbound_at`, `last_read_at`, `last_message_preview`, `last_message_direction`.
- Inbox: `markConversationRead` (resetea unread) + `markRead` a Meta (read receipt); realtime en la **lista**; tags (tag bar + chips + filtro); mensajes rápidos (CRUD + `/` en composer); descarga+render de **media** inbound (Storage); paginación (lista + thread).

### Fase 3 — Centralización global de contacto
- `findOrCreateConversation` compartido (nullable customer) + job kind `send_message` + acción `contactCustomer` (resuelve canal WA, normaliza tel, ventana 24h: texto/template, opt-in para marketing).
- `<ContactCustomerSheet>` (in-app) + fallback `wa.me`. Embeds en reservas, clientes (tab "Comunicaciones" real), y donde haya teléfono.

### Fase 4 — Workflows (editor visual + arreglos)
- DB: `flow_nodes` + `flow_edges`; `flow_executions.current_node_id`; migración de los flows lineales existentes a grafo.
- Editor `@xyflow/react` (canvas, paleta, validación: 1 trigger, sin huérfanos). Runtime que camina el grafo (condition = 2 handles). Cablear `after_visit` (trigger en insert de visita) y `tag_added` (ya hay trigger DB en `customer_tag_assignments`) → enqueue `start_flow`. Preview de variables.

### Fase 5 — Refresh de token WA (chico)
- Cron `refresh-meta-tokens` (en `vercel.json`) que renueva tokens próximos a expirar (WA long-lived/system-user; IG `ig_refresh_token`) + aviso "token por expirar" en `canales`.

## 6. Definition of Done (por fase, CLAUDE.md §11)
UI accesible/mobile · migraciones aplicadas (MCP) + tipos regenerados · RLS + GRANTs + tests RLS · zod en bordes · unit tests verdes · smoke manual documentado · typecheck + lint sin errores nuevos · Conventional Commits.
