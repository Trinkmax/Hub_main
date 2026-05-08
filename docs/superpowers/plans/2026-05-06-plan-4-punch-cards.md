# Plan 4 — Punch cards

**Goal:** Sistema de tarjetas perforadas paralelo a points_balance. "5 cafés = 1 café gratis".

**Implementación**: 4 migrations, lib + UI owner para tags y templates, extensión de mark_session_paid, get_loyalty_state RPC y mejora del ClosingScreen del comensal con progreso visible.

## Files

- `supabase/migrations/20260506130000_plan4_item_tags.sql` — item_tags + menu_item_tag_assignments + RLS.
- `supabase/migrations/20260506130100_plan4_punch_cards.sql` — punch_card_templates + customer_punch_cards + RLS.
- `supabase/migrations/20260506130200_plan4_punch_cards_in_mark_paid.sql` — extiende mark_session_paid con `_advance_punch_cards_for_visit`.
- `supabase/migrations/20260506130300_plan4_get_loyalty_state.sql` — RPC pública anon.
- `lib/item-tags/{schemas,queries,actions}.ts`
- `lib/punch-cards/{schemas,queries,actions}.ts`
- `lib/m-session/actions.ts` — sumamos `getLoyaltyState`.
- `app/(dashboard)/[tenantSlug]/configuracion/tags/page.tsx + tags-manager`
- `app/(dashboard)/[tenantSlug]/configuracion/punch-cards/page.tsx + punch-cards-manager`
- `app/m/[qrToken]/_components/closing-screen.tsx` — extendida con loyalty state.

## Smoke (cuando Docker esté disponible)

1. `npm run db:reset && npm run db:types`.
2. Owner crea reward "Café gratis" en /puntos.
3. Owner crea categoría "Café" + ítem "Capuchino" en /menu.
4. Owner crea tag "#cafe" en /configuracion/tags y lo asigna al Capuchino.
5. Owner crea punch card "5 cafés = 1 café gratis":
   - trigger=tag, ref=#cafe, threshold=5, reward=Café gratis.
6. Comensal escanea, se registra, pide 3 capuchinos (asignados a sí mismo). Mozo acepta + cocina + entrega.
7. Mozo cobra. En el ClosingScreen el comensal ve "5 cafés = 1 gratis · 3/5".
8. Repetir hasta llegar a 5: la card se marca completed y se genera reward_redemption pending.
9. Verificar:
   ```bash
   psql "$DB_URL" -c "select customer_id, current_stamps, threshold_snapshot, completed_at from public.customer_punch_cards;"
   psql "$DB_URL" -c "select customer_id, status from public.reward_redemptions where status='pending' order by created_at desc limit 1;"
   ```

## Casos cubiertos

- Trigger por item / categoría / tag.
- Auto-creación de card al primer matching consumption.
- Cap: current_stamps no excede threshold_snapshot.
- Idempotencia heredada de mark_session_paid (re-cobrar no duplica stamps).
- Multiple cards activas por customer (uno por template).

## Lo que NO está

- Edit form de punch_card_template (sólo create + delete).
- Expiración automática (Plan 5: cron).
- Visualización de cards completadas/expiradas en historial.
