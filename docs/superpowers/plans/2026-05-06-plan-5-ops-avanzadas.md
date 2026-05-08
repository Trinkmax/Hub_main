# Plan 5 — Operaciones avanzadas + auto-aceptación + cron

**Goal:** Cerrar el spec con: marcar abandoned manual y automático, mergear sesiones, mover y splitear, y configuración de auto-aceptación de comandas por tenant.

## Files

### Migrations
- `20260506140000_plan5_tenant_config.sql` — columnas de config en `tenants`.
- `20260506140100_plan5_submit_ticket_auto_accept.sql` — submit_ticket honra auto-aceptación.
- `20260506140200_plan5_session_ops.sql` — RPCs `mark_session_abandoned`, `merge_sessions`, `move_session`, `split_session`.
- `20260506140300_plan5_cron_jobs.sql` — `auto_abandon_stale_sessions`, `expire_punch_cards` (service_role only).

### Lib
- `lib/sessions-waiter/actions.ts` — extiende con `markSessionAbandoned`, `mergeSessionsAction`, `moveSessionAction`, `splitSessionAction`.
- `lib/admin/tenant-config.ts` — `getTenantConfig` + `updateTenantConfig`.

### UI
- `/configuracion/auto-aceptacion` — owner toggle de auto-aceptación + caps + timeouts de guest/sesión.
- `session-detail.tsx` — botón "Marcar abandoned" en menú dropdown.

### API routes (cron)
- `/api/cron/auto-abandon-stale` — corre cada hora.
- `/api/cron/expire-punch-cards` — corre 04:00 daily.

### Vercel cron
Actualizado en `vercel.json` con las dos entradas.

## Smoke (cuando Docker esté disponible)

### Auto-aceptación

1. Owner va a `/<slug>/configuracion/auto-aceptacion`.
2. Activa "Habilitar auto-aceptación", deja caps vacíos.
3. Comensal pide → ticket entra directo en `accepted` (no en pending). Mozo NO necesita confirmar.
4. Owner pone cap de monto = 200000 (= $2000). Comensal pide algo más caro → entra como pending. Pide algo barato → directo accepted.

### mark_session_abandoned

1. Mozo abre detalle de sesión open.
2. Click en menú (3 puntos) → "Marcar abandoned".
3. Confirmar.
4. Verificá: sesión status='abandoned', no se generaron points_transactions.

### merge_sessions (vía SQL — sin UI todavía)

```bash
psql "$DB_URL" -c "select * from public.merge_sessions('<survivor>', array['<absorbed>']::uuid[]);"
```

### move_session / split_session

Solo accesibles por SQL hasta que se construya la UI.

### Cron auto-abandon

```bash
# Forzar el cron (con CRON_SECRET en .env.local)
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/auto-abandon-stale
```

### Cron expire-punch-cards

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-punch-cards
```

## Lo que NO entra (queda como mejora futura)

- UI de merge sessions (dialog "elegir otra sesión open para mergear").
- UI de move session (dialog "elegir mesa destino").
- UI de split session (selector de guests + mesa destino).
- `last_activity_at` heartbeat client-side (el comensal pinguea cada N min).
- Indicador "guest inactivo > 30 min" en panel del mozo (tiene los datos en `session_guests.last_activity_at`).
- Tests RLS dedicados de Plan 5.
