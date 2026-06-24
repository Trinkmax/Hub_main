# Mensajería — Dispatcher de trabajo de fondo

> Activa el envío real de mensajería (difusiones + flows). Antes de esto, la DB y
> el backend ya estaban en producción, pero **nada corría el trabajo de fondo**:
> una difusión programada quedaba en `scheduled` para siempre.

## Qué hace

Un único endpoint **`/api/cron/dispatch`** (Next.js, `runtime = 'nodejs'`) corre todo
el trabajo de fondo de mensajería vencido. Lo agenda **pg_cron** (cada minuto) vía
**pg_net**, leyendo URL y secreto de **Supabase Vault**. Es plan-agnostic (no depende
del límite de crons de Vercel Hobby) e idempotente (cada sub-tarea filtra por `due <= now`,
así que tolera ticks perdidos).

### En cada tick (alta frecuencia)
- `processScheduledBroadcasts()` — promueve difusiones `scheduled → sending`, materializa
  audiencia con **enforce de opt-in**, crea `broadcast_recipients` y encola los envíos.
- `runWorker({ handler: messagingJobHandler })` — drena `job_queue`:
  `send_broadcast_message`, `start_flow`, `download_media`. (También reencola jobs colgados.)
- tick de `flow_executions` vencidas (`tickFlowExecution`) con backoff recuperable (+30s)
  y `markFailed` para errores no-recuperables.

### Gated por cadencia (`lib/cron/schedule.ts`)
- `evaluate_time_triggers` — cada 15 min (enrola flows por inactividad/cumple/evento).
- `sync_templates` — cada 30 min (refresca templates aprobados de cada canal WA conectado).
- `refresh_meta_tokens` — diario 04:20 UTC (refresca tokens de Meta por expirar).

### Lo que NO toca (ya estaba agendado)
- pg_cron `refresh-mv-stats` (cada 10 min) — stats.
- `vercel.json`: `auto-abandon-stale` (05:00) y `expire-punch-cards` (04:00) — diarios.
- ⚠️ `grant-tier-benefits` **no está agendado por nadie** (orphan). Fuera del scope de
  mensajería; anotado para decidir aparte (ver BACKLOG).

## Arquitectura

```
pg_cron (cada minuto)
  └─ net.http_post(  Vault: app_url + '/api/cron/dispatch',  Bearer Vault: cron_secret )
       └─ app/api/cron/dispatch/route.ts   (valida Bearer CRON_SECRET)
            └─ lib/cron/dispatch.ts → runDispatch()
                 ├─ processScheduledBroadcasts()      (lib/broadcasts/engine)
                 ├─ runWorker(messagingJobHandler)    (lib/jobs/runner + lib/jobs/handlers)
                 ├─ tickDueFlows()                    (lib/flows/runtime)
                 └─ gatedTasksDue(now) → evaluate_time_triggers / sync_templates / refresh_meta_tokens
```

`lib/jobs/handlers.ts` (`messagingJobHandler`) es compartido por el dispatcher y por la
ruta legacy `/api/cron/process-jobs` (que queda para invocación manual).

## Variables de entorno

| Var | Dónde | Para qué |
|-----|-------|----------|
| `CRON_SECRET` | Vercel env | Bearer que valida `/api/cron/dispatch`. Debe coincidir con el secreto `cron_secret` de Vault. |
| `JOB_QUEUE_LIMIT` | opcional (default 100) | jobs por tick. |
| `FLOW_TICK_LIMIT` | opcional (default 100) | ejecuciones de flow por tick. |
| Vault `app_url` | Supabase Vault | base URL de producción (ej. `https://hub.vercel.app`). |
| Vault `cron_secret` | Supabase Vault | igual a `CRON_SECRET` de Vercel. |

## Cómo ponerlo en marcha (orden importa)

1. **Deploy**: mergear esta rama a `main` → Vercel auto-deploya → `/api/cron/dispatch` existe.
   Confirmar que `CRON_SECRET` está seteado en el env de producción de Vercel.
2. **Vault** (MCP `execute_sql`, valores reales, una vez):
   ```sql
   select vault.create_secret('https://<app-prod>', 'app_url');
   select vault.create_secret('<CRON_SECRET de Vercel>', 'cron_secret');
   ```
3. **Agendar** (MCP `apply_migration` con `supabase/migrations/20260624000000_cron_dispatch_schedule.sql`):
   habilita `pg_net` y crea el job `hub-dispatch`.
4. **Verificar**:
   ```sql
   select jobname, schedule, active from cron.job where jobname = 'hub-dispatch';
   select status_code, created from net._http_response order by created desc limit 5; -- esperar 200
   ```
5. **Conectar WhatsApp** (manual, sólo lo puede hacer el dueño): Configuración → Canales →
   WhatsApp (Embedded Signup) → estado "Conectado".

## Smoke del happy path (difusión real)

1. Configuración → Plantillas: sincronizar → al menos 1 template `approved` con 1+ variable.
2. Difusiones → Nueva: elegir canal → template → mapear variables → preview → "Enviar prueba a mí".
3. Audiencia: filtro `opt_in_marketing is_true` (sólo opted-in reciben).
4. Programar / enviar ahora.
5. En ≤ 1 min (tick del dispatcher) los recipients pasan `pending → sent → delivered → read`.
   Los opted-out **no** reciben. Responder desde el destino marca el recipient como "Respondió".

## Notas

- El tick es 1/min; el throttle de difusiones (`BROADCAST_RATE_PER_SEC`, default 10/s) espacia
  los `run_at` para no pegarle al rate-limit del WABA.
- Si un tick tarda más que `timeout_milliseconds` (30s), pg_net registra timeout pero el trabajo
  se completa igual del lado del server (la próxima corrida retoma lo pendiente).
- Riesgo conocido: ticks solapados podrían doble-tickear un flow si una corrida supera 60s; aceptable
  para el volumen del MVP (los jobs usan claim atómico; las difusiones promueven con guard de estado).
