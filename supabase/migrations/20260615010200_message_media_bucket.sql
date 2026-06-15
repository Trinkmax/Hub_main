-- ============================================================
-- Inbox — bucket privado para media de mensajes (WhatsApp inbound/outbound)
-- ============================================================
-- Bucket privado. La subida la hace el job worker con service_role (bypassa RLS).
-- La lectura se hace con signed URLs generadas server-side, así que no se
-- necesita policy de SELECT para authenticated. Path: <tenant_id>/<message_id>.<ext>
-- ============================================================

insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', false)
on conflict (id) do nothing;
