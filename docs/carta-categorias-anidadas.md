# Carta — Categorías anidadas

Permite anidar categorías de la carta **sin límite de profundidad**
(categoría → subcategoría → … → ítem), con **mezcla libre** (una categoría puede
tener ítems propios y subcategorías a la vez).

Spec: `docs/superpowers/specs/2026-06-08-carta-categorias-anidadas-design.md`
Plan: `docs/superpowers/plans/2026-06-08-carta-categorias-anidadas.md`

## Modelo de datos

- **Adjacency list**: `menu_categories.parent_id` (self-ref, `on delete cascade`).
  `NULL` = categoría raíz. `position` ordena **entre hermanos** (mismo `parent_id`).
- `menu_items.category_id` es **nullable en la DB** (no en los tipos TS): se usa
  para **archivar** ítems con historial durante el borrado en cascada. El código TS
  nunca lee ítems archivados (todos los lectores filtran `active` y/o `category_id`).
- El árbol se arma **en memoria** desde listas planas (`lib/menu/tree.ts`
  `buildCategoryTree`); solo hay CTE recursivo en la DB para la cascada de borrado
  y el anti-ciclo de "mover".

## RPCs (SECURITY DEFINER, owner-only)

- `reorder_menu_categories(p_parent_id, p_ordered_ids)` — reordena hermanos de un padre (acepta `NULL`=raíz).
- `move_category(p_category_id, p_new_parent_id)` — cambia el padre; rechaza self, descendiente (anti-ciclo) y padre de otro tenant.
- `delete_category_cascade(p_category_id)` — borra el subárbol (ver abajo).
- `get_session_state(...)` — ahora emite `parent_id` por categoría (el cliente arma el árbol).

## Borrado en cascada (seguro)

Al borrar una categoría se borra **todo su subárbol** (subcategorías + ítems), pero
para **no romper el historial de consumo**:

1. Los ítems referenciados en `visit_items`/`ticket_items` se **archivan**
   (`category_id = NULL`, `active = false`) → salen de la carta pero el ledger queda intacto.
2. Los ítems libres se **borran físico** (sus tags caen por cascade).
3. Se borra la categoría raíz → las descendientes caen por `parent_id ON DELETE CASCADE`.

Para el dueño el efecto visible es "se borró todo"; los ítems vendidos quedan archivados.

## Experiencia de usuario

- **Cliente** (`/m/[qrToken]`): navegación **drill-down** con breadcrumb. Una
  categoría es visible si tiene ítems directos o contenido descendiente. La búsqueda
  es global y muestra la **ruta** de cada resultado.
- **Dueño** (`/[slug]/menu`): editor **drill-in** espejo del cliente (un nivel a la
  vez), con breadcrumb, "Agregar ítem"/"Agregar subcategoría", reorder por DnD entre
  hermanos, "Mover a…" (`CategoryTreePicker`, excluye el propio subárbol) y borrado en cascada.
- **Mozo / salón**: la carga rápida NO usa drill-down (sumaría toques); muestra solo
  categorías con ítems directos, etiquetadas con su **ruta** ("Bebidas › Vinos").
- **Puntos**: una regla por categoría alcanza **solo ítems directos** (sin heredar a
  subcategorías) — el motor de puntos no cambió. El selector de reglas ofrece solo
  categorías con ítems y muestra la ruta.

## Deploy (pasos manuales, fuera del desarrollo)

La migración **no se aplicó** durante el desarrollo. Para desplegar:

1. Aplicar `supabase/migrations/20260608120000_carta_nested_categories.sql` a la DB
   (vía Supabase MCP `apply_migration`, o `supabase db push` / branch).
2. Regenerar `types/database.ts` (MCP `generate_typescript_types`, re-anexando el
   bloque de alias). Tras el regen, `category_id` pasa a `string | null`; los lectores
   ya filtran archivados, así que no hay cambios de código necesarios.
3. Correr los tests RLS contra la DB: `npx vitest run tests/rls/menu-nesting.test.ts`
   (se skipean sin Supabase local; corren en el job `rls` de CI).
