-- ─────────────────────────────────────────────────────────────
-- message_templates.variable_hints — qué significa cada {{n}}
--
-- Meta solo entiende variables posicionales (`{{1}}`, `{{2}}`…), así que el
-- editor de plantillas ofrece botones con nombre ("Nombre", "Cumpleaños") y
-- guarda acá la traducción: `{"1": "first_name", "2": "birthdate"}`.
--
-- Con eso la difusión llega con el paso "Hacelo personal" ya resuelto, en vez
-- de pedirle al dueño que se acuerde de qué puso en cada hueco cuando escribió
-- la plantilla. Es metadata NUESTRA: Meta no la conoce y el sync no la pisa
-- (el upsert de `syncTemplates` no incluye esta columna).
-- ─────────────────────────────────────────────────────────────

alter table public.message_templates
  add column if not exists variable_hints jsonb not null default '{}'::jsonb;

comment on column public.message_templates.variable_hints is
  'Mapa posición → fuente de dato ({"1":"first_name"}). Precarga el paso de personalización de la difusión. Ver lib/broadcasts/variables.ts.';
