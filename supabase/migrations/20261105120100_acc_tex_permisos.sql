-- Tex: permisos justos. Las políticas ya impedían todo esto (ensayado: 0 filas), pero estas tablas heredaron los
-- privilegios por defecto del esquema. Se sacan para que tampoco el permiso lo deje:
--   · anónimos: nada.
--   · una charla no se borra (se llevaría el rastro de lo que se hizo con Tex).
--   · un mensaje no se edita ni se borra: la API de Claude rechaza una historia cambiada.
--   · una acción no se borra.
revoke all on public.acc_tex_threads from anon;
revoke all on public.acc_tex_messages from anon;
revoke all on public.acc_tex_actions from anon;
revoke delete on public.acc_tex_threads from authenticated;
revoke update, delete on public.acc_tex_messages from authenticated;
revoke delete on public.acc_tex_actions from authenticated;
