-- Fix crítico (auditoría mensajería): trigger de tags duplicado.
--
-- El trigger legacy `trg_tags_start_flows` (definido en phase6_marketing,
-- 2026-05-04) nunca se dropeó cuando `flow_graph_and_triggers` (2026-06-15)
-- introdujo el canónico `trg_tag_assign_start_flows` → `fn_start_tag_added_flows`.
-- Ambos corrían AFTER INSERT en customer_tag_assignments y encolaban un job
-- `start_flow` por cada flow con trigger_type='tag_added' → cada flow disparaba
-- DOS veces al etiquetar un cliente.
--
-- Se elimina el legacy (trigger + función). El canónico queda como único.
-- Idempotente.

drop trigger if exists trg_tags_start_flows on public.customer_tag_assignments;
drop function if exists public.trg_tags_start_flows();
