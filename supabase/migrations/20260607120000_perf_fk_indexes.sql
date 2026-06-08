-- Performance: cubrir foreign keys sin índice (advisor: unindexed_foreign_keys, 39 FKs).
-- Sin índice en la columna FK, los JOINs y los DELETE en cascada hacen seq scan.
-- Todos b-tree en la columna FK. Idempotente (if not exists).

create index if not exists idx_audit_log_user_id on public.audit_log (user_id);

create index if not exists idx_broadcast_recipients_customer_id on public.broadcast_recipients (customer_id);
create index if not exists idx_broadcast_recipients_message_id on public.broadcast_recipients (message_id);

create index if not exists idx_broadcasts_audience_id on public.broadcasts (audience_id);
create index if not exists idx_broadcasts_channel_id on public.broadcasts (channel_id);
create index if not exists idx_broadcasts_created_by on public.broadcasts (created_by);
create index if not exists idx_broadcasts_template_id on public.broadcasts (template_id);

create index if not exists idx_commission_ledger_manager_id on public.commission_ledger (manager_id);

create index if not exists idx_customer_capture_submissions_customer_id on public.customer_capture_submissions (customer_id);

create index if not exists idx_customer_punch_cards_reward_redemption_id on public.customer_punch_cards (reward_redemption_id);
create index if not exists idx_customer_punch_cards_tenant_id on public.customer_punch_cards (tenant_id);

create index if not exists idx_event_attendees_checked_in_by on public.event_attendees (checked_in_by);
create index if not exists idx_event_attendees_customer_id on public.event_attendees (customer_id);

create index if not exists idx_events_created_by on public.events (created_by);

create index if not exists idx_flow_executions_customer_id on public.flow_executions (customer_id);

create index if not exists idx_invitations_invited_by on public.invitations (invited_by);

create index if not exists idx_messages_broadcast_id on public.messages (broadcast_id);
create index if not exists idx_messages_flow_execution_id on public.messages (flow_execution_id);

create index if not exists idx_points_transactions_visit_id on public.points_transactions (visit_id);
create index if not exists idx_points_transactions_redemption_id on public.points_transactions (redemption_id);

create index if not exists idx_punch_card_templates_reward_id on public.punch_card_templates (reward_id);

create index if not exists idx_reservation_managers_user_id on public.reservation_managers (user_id);

create index if not exists idx_reward_redemptions_redeemed_by on public.reward_redemptions (redeemed_by);
create index if not exists idx_reward_redemptions_reward_id on public.reward_redemptions (reward_id);

create index if not exists idx_salon_reservations_arrived_by on public.salon_reservations (arrived_by);
create index if not exists idx_salon_reservations_closed_by on public.salon_reservations (closed_by);
create index if not exists idx_salon_reservations_created_by on public.salon_reservations (created_by);
create index if not exists idx_salon_reservations_seated_by on public.salon_reservations (seated_by);

create index if not exists idx_table_session_events_created_by_guest_id on public.table_session_events (created_by_guest_id);
create index if not exists idx_table_session_events_created_by_user_id on public.table_session_events (created_by_user_id);

create index if not exists idx_table_sessions_merged_into on public.table_sessions (merged_into);
create index if not exists idx_table_sessions_opened_by on public.table_sessions (opened_by);

create index if not exists idx_tickets_accepted_by_user_id on public.tickets (accepted_by_user_id);
create index if not exists idx_tickets_created_by_guest_id on public.tickets (created_by_guest_id);
create index if not exists idx_tickets_created_by_user_id on public.tickets (created_by_user_id);

create index if not exists idx_user_active_tenant_tenant_id on public.user_active_tenant (tenant_id);

create index if not exists idx_visit_items_menu_item_id on public.visit_items (menu_item_id);

create index if not exists idx_visits_created_by on public.visits (created_by);

create index if not exists idx_welcome_reward_configs_reward_id on public.welcome_reward_configs (reward_id);
create index if not exists idx_welcome_reward_configs_updated_by on public.welcome_reward_configs (updated_by);
