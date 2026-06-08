# Diseño — Anidamiento ilimitado de categorías en la carta

> Estado: **Aprobado** (diseño) · Fecha: 2026-06-08 · Autor: Agustín + Claude
> Próximo paso: plan de implementación (`writing-plans`).

---

## 1. Contexto y problema

Hoy la carta es **estrictamente de 2 niveles**: `menu_categories` → `menu_items`.
Un dueño (HUB) necesita agrupar categorías: por ejemplo
`Bebidas → Vinos / Gaseosas / … → ítems`. Queremos permitir **anidar
categorías sin límite de profundidad**, manteniendo la experiencia **lo más
simple posible** tanto para el dueño (editor) como para el cliente (carta).

El modelo de 2 niveles está cableado en: el RPC `get_session_state` (carta del
cliente, anónimo), el editor del dueño (`/[slug]/menu`, drag&drop), la carta del
cliente (`/m/[qrToken]`), el menú del mozo (`getStaffMenuForTenant`,
`visitas/nueva/items-step`, `/api/sessions/[id]/menu`) y el motor de puntos
(reglas "por categoría").

## 2. Decisiones tomadas

| # | Decisión | Valor elegido |
|---|----------|---------------|
| 1 | Profundidad | **Ilimitada** (categoría → subcategoría → … → ítem) |
| 2 | Mezcla de contenido | **Libre**: una categoría puede tener ítems propios **y** subcategorías. Ítems directos arriba, subcategorías abajo |
| 3 | Navegación del cliente | **Drill-down con breadcrumb** |
| 4 | Editor del dueño | **Drill-in, espejo del cliente** (un nivel a la vez) |
| 5 | Reglas de puntos por categoría | Alcanzan **solo ítems directos** (sin herencia a subcategorías) |
| 6 | Borrado de categoría con contenido | **Cascada segura** (no rompe el historial de consumo) |

## 3. Approach técnico: adjacency list

Modelo elegido: **adjacency list** — `menu_categories.parent_id` que
auto-referencia a `menu_categories(id)`.

Razón: para una carta de bar (decenas a bajos cientos de nodos) es lo más
simple. El árbol se arma **en memoria** desde la lista plana; los "mover" son un
solo `UPDATE`; y solo usamos CTE recursivo donde de verdad hace falta (cascada de
borrado y chequeo de ciclos). Descartados: *materialized path* / `ltree` y
*closure table* (más rápidos para subárboles enormes pero innecesarios acá y con
escrituras más costosas).

### Hechos del esquema actual verificados (no asumidos)

- FKs que referencian `menu_items.id`: `visit_items.menu_item_id` (RESTRICT),
  `ticket_items.menu_item_id` (RESTRICT), `menu_item_tag_assignments.menu_item_id`
  (CASCADE).
- FKs que referencian `menu_categories.id`: **solo** `menu_items.category_id`
  (RESTRICT). Ninguna tabla de historial referencia categorías directamente.
- `visit_items` **no tiene** `category_id`: la categoría para puntos se deriva por
  JOIN al `menu_items.category_id` **actual** en el momento del cálculo. ⇒ Mover
  un ítem de categoría afecta **solo cálculos futuros**; las visitas pasadas ya
  tienen sus puntos en el ledger inmutable (`points_transactions`).
- Reorder hoy: `reorder_menu_categories(p_tenant_id, p_ordered_ids)` y
  `reorder_menu_items(p_category_id, p_ordered_ids)` (SECURITY DEFINER, owner-only).

## 4. Modelo de datos (migración nueva)

> Una sola migración nueva en `supabase/migrations/`. **No** se editan migraciones
> aplicadas. Incluir GRANTs de los RPCs nuevos. Regenerar `types/database.ts` por
> MCP y re-anexar el bloque de alias.

### 4.1 Cambios de tablas

```sql
-- Anidamiento: parent_id self-ref. NULL = categoría raíz.
alter table public.menu_categories
  add column if not exists parent_id uuid
  references public.menu_categories(id) on delete cascade;

-- category_id pasa a nullable (se usa para "archivar" ítems históricos en la
-- cascada de borrado). FK queda en RESTRICT como backstop.
alter table public.menu_items
  alter column category_id drop not null;

-- Índices: position pasa a ser orden ENTRE HERMANOS (mismo parent_id).
drop index if exists public.menu_categories_tenant_pos_idx;
create index menu_categories_tenant_parent_pos_idx
  on public.menu_categories(tenant_id, parent_id, position);
create index menu_categories_roots_idx
  on public.menu_categories(tenant_id, position) where parent_id is null;
create index menu_categories_parent_idx
  on public.menu_categories(parent_id);
```

Notas:
- `parent_id ON DELETE CASCADE` es lo que permite borrar el subárbol de
  categorías en un solo `DELETE` (sección 8).
- **No** se agrega `unique(tenant_id, parent_id, name)`: hoy los nombres pueden
  repetirse y no queremos romper datos existentes. (Queda como mejora opcional
  futura, con warning suave en UI.)
- `image_url` ya existe en `menu_categories` ⇒ las subcategorías tienen imagen
  gratis.

### 4.2 RPCs

- **`reorder_menu_categories(p_parent_id uuid, p_ordered_ids uuid[])`**.
  Reordena **hermanos** dentro de `p_parent_id` (acepta `NULL` = raíz). Deriva el
  tenant de las propias categorías (necesario para padre `NULL`), valida que todas
  comparten tenant + (`parent_id IS NOT DISTINCT FROM p_parent_id`), exige owner, y
  setea `position = i` por id.
  ⚠️ **Implementación**: la firma actual es `(p_tenant_id uuid, p_ordered_ids uuid[])`.
  Postgres **no permite renombrar parámetros** con `CREATE OR REPLACE` → hay que
  `DROP FUNCTION public.reorder_menu_categories(uuid, uuid[])` y `CREATE` de nuevo,
  **re-otorgando** el `GRANT EXECUTE` (el drop se lo lleva).
- **`move_category(p_category_id uuid, p_new_parent_id uuid)`** (nuevo).
  Valida: misma tenant, `p_new_parent_id <> p_category_id`, y que el destino **no
  sea descendiente** del que se mueve (CTE recursivo anti-ciclo). Setea `parent_id`
  y reubica al final de los hijos del destino (`position = max+1`). Owner-only.
  Audita.
- **`delete_category_cascade(p_category_id uuid)`** (nuevo). Cascada segura
  (sección 8). Owner-only. Devuelve resumen `{deleted_categories int,
  archived_items int, deleted_items int}`.
- **`get_session_state(...)`** (`create or replace`). Agrega `'parent_id',
  mc.parent_id` a cada categoría y **deja de asumir** que todas son raíz: devuelve
  **lista plana** de categorías activas (cada una con sus ítems directos activos);
  el cliente arma el árbol. Filtros actuales (`active = true`) se mantienen; ítems
  con `category_id IS NULL` o `active = false` quedan fuera.

GRANTs:
```sql
grant execute on function public.move_category(uuid, uuid),
  public.delete_category_cascade(uuid) to authenticated;
-- reorder_menu_categories y get_session_state ya tienen GRANT.
```

## 5. Server (`lib/menu`)

- **`schemas.ts`**
  - `createCategorySchema` += `parent_id: z.string().uuid().nullable().optional()`.
  - `moveCategorySchema = z.object({ id: uuid, parent_id: uuid.nullable() })`.
  - `reorderCategoriesSchema` += `parent_id: uuid.nullable()` (junto con `ids`).
  - `updateCategorySchema` queda igual (nombre/active/image; mover es aparte).
- **`actions.ts`**
  - `createCategory(slug, _prev, formData)`: lee `parent_id`; `position = max
    posición entre hermanos (mismo parent_id) + 1`. Audita `menu_category.created`.
  - `moveCategory(slug, { id, parent_id })` (nuevo): llama `move_category` RPC.
    Audita `menu_category.moved`.
  - `deleteCategory(slug, id)`: **ahora llama `delete_category_cascade`** (reemplaza
    el `DELETE` directo). Audita `menu_category.deleted_cascade` con el resumen.
  - `reorderCategories(slug, parentId, ids)`: pasa `p_parent_id`.
  - Mover ítems: se reutiliza `updateMenuItem(category_id)` existente (no hace
    falta acción nueva). `createMenuItem` sin cambios (recibe `category_id` =
    categoría actual del editor).
  - Todas con `requireTenantAccess` + `requireRole(['owner'])` (helper
    `authorizeOwner` existente) y `revalidatePath('/${slug}/menu')`.
- **`queries.ts`**
  - `listMenu` / `listActiveMenu`: agregan `parent_id` al select de categorías.
  - `MenuCategory` type += `parent_id: string | null`.
  - Helper `buildCategoryTree(categories, items)` (puede vivir en `lib/menu/tree.ts`):
    arma `{ ...category, children: TreeNode[], items: MenuItem[] }` desde las listas
    planas. Usado por editor, carta y picker. Pura, testeable.

## 6. Editor del dueño (drill-in)

Ruta: `app/(manager)/[tenantSlug]/menu/`.

- **`menu-board.tsx`** se reescribe como **navegador drill-in**:
  - Mantiene `currentCategoryId` (`null` = raíz). **Breadcrumb** arriba (raíz ›
    Bebidas › Vinos) clickeable para subir.
  - Botones **"Agregar ítem"** y **"Agregar subcategoría"** en el nivel actual.
  - Lista de **ítems directos** del nivel (grid con DnD reorder → `reorderItems`).
  - Lista de **subcategorías** (DnD reorder → `reorderCategories(parentId=current)`).
    Cada fila: `›` para entrar + menú `⋯` (Renombrar / **Mover a…** / Pausar /
    Borrar).
  - Trabaja sobre el árbol en memoria construido con `buildCategoryTree`.
- **`CategoryTreePicker`** (nuevo, reutilizable): muestra el árbol con rutas
  ("Bebidas › Vinos") para elegir destino. Usado por: mover categoría, mover ítem
  (`item-edit-dialog`), y picker de reglas de puntos. Excluye el subárbol propio al
  mover (no permitir destino descendiente).
- **`new-category-form.tsx`**: hidden input `parent_id` = categoría actual.
- **`category-edit-dialog.tsx`**: agrega acción "Mover a…" (abre `CategoryTreePicker`).
- **`item-edit-dialog.tsx`**: el selector plano de categoría pasa a
  `CategoryTreePicker` con ruta. Guardar = `updateMenuItem(category_id)`.
- **Búsqueda** (`menu-search` + board): global, aplana todos los niveles, muestra
  el **breadcrumb** de cada resultado; desactiva DnD mientras hay búsqueda (como hoy).
- `loading.tsx`: skeleton acorde al nuevo layout.

## 7. Carta del cliente y demás consumidores

### 7.1 Cliente — `app/m/[qrToken]`
- **`menu-hub.tsx`**: arma árbol desde categorías planas (ahora con `parent_id`);
  **drill-down con breadcrumb**. En un nivel muestra ítems directos arriba y
  subcategorías (cards) abajo. **Visibilidad**: una categoría aparece si tiene
  ítems directos **o** contenido descendiente (alguna hoja con ítems). Carrusel de
  destacados y búsqueda siguen aplanando **todos** los ítems; la búsqueda muestra
  la ruta de cada resultado.
- **`category-card.tsx`**: se reusa para subcategorías (conteo de ítems/subcats).
- **`item-row.tsx`**: sin cambios.
- **`lib/m-session/actions.ts`**: tipo `menu[]` += `parent_id`.
- **`lib/m-session/menu-search.ts`**: aplana todas las categorías + adjunta ruta.

### 7.2 Mozo / salón
- **`lib/sessions-waiter/staff-menu-queries.ts`**: incluye `parent_id`; devuelve
  categorías planas + ítems; el cliente arma el árbol.
- **`visitas/nueva/items-step.tsx`** y **`/api/sessions/[id]/menu`**: adoptan
  **drill-down** para consistencia (reusan navegación/árbol). *Mínimo viable* si se
  quiere acotar el alcance: aplanar categorías-hoja con etiqueta de ruta + apoyarse
  en búsqueda (los mozos suelen buscar). Decisión: drill-down.

### 7.3 Puntos
- **`puntos/_components/rules-list.tsx`** y el editor de reglas: usan
  `CategoryTreePicker` con **ruta completa** para elegir/mostrar la categoría.
- **Motor de puntos (`lib/points/engine.ts`) y `calculate_visit_points`: SIN
  CAMBIOS** — el match sigue siendo directo (`item.category_id === rule.category_id`),
  coherente con la decisión #5.

### 7.4 Sin cambios
- **Cocina / KDS** (`kds-screen.tsx`): muestra solo nombres de ítems.
- **Tickets / waiter ticket-card**: no usan categoría.
- **`mv_customer_stats`**: sigue agregando por `category_id` (categoría directa).

## 8. Borrado en cascada (seguro)

RPC `delete_category_cascade(p_category_id)`, **owner-only**, transaccional:

1. Resolver tenant desde la categoría; exigir rol `owner`.
2. CTE recursivo → **todos** los ids de categorías del subárbol (raíz + descendientes).
3. Ítems del subárbol (`category_id IN subárbol`):
   - **No referenciados** en `visit_items` ni `ticket_items` → `DELETE` físico
     (las asignaciones de tags caen por `ON DELETE CASCADE`).
   - **Referenciados en historial** → **archivar**: `UPDATE set category_id = NULL,
     active = false`. Salen de la carta y del editor, y dejan de bloquear la FK
     RESTRICT.
4. `DELETE` de la categoría raíz del subárbol → las descendientes caen por
   `parent_id ON DELETE CASCADE` (ya sin ítems que las bloqueen).
5. Retornar `{deleted_categories, archived_items, deleted_items}`.

**Invariante de seguridad bendecido por el usuario**: los ítems que ya aparecen en
visitas/tickets **no se borran físicamente** — quedan **archivados** (ocultos, sin
categoría) para no corromper el ledger. Para el dueño el efecto visible es "se borró
todo".

UI: `AlertDialog` que describe qué se borra y, si hay ítems en historial, aclara que
"esos ítems quedan archivados para no romper el historial de consumo".

## 9. Manejo de errores y bordes
- **Anti-ciclo**: `move_category` rechaza mover a sí mismo o a un descendiente
  (errcode `P0001`, mensaje accionable en la acción).
- **Reorder cross-parent**: el RPC solo actualiza ids cuyo `parent_id` coincide con
  `p_parent_id` y mismo tenant (no mezcla niveles).
- **Ítems con `category_id NULL`**: nunca se muestran (carta filtra `active`; editor
  agrupa por categoría). Las queries de menú filtran/excluyen explícitamente.
- **Reglas de puntos sobre categoría borrada**: dejan de matchear (ningún ítem tiene
  ese `category_id`); no crashea. Opcional: warning en `rules-list` si la categoría
  ya no existe.
- Validación zod en cada borde; sin tragar errores; logs sin PII.

## 10. Testing
- **Unit (Vitest)**:
  - `buildCategoryTree`: arma jerarquía correcta desde listas planas; ítems directos
    + hijos; raíces (`parent_id null`).
  - Anti-ciclo de `move_category` (lógica equivalente en TS si se valida en server, o
    cubrir vía RLS): rechaza self y descendiente.
  - Scoping de reorder por padre.
  - `createCategorySchema` con `parent_id` (incluye `null`/ausente).
  - Búsqueda con ruta (`menu-search`).
- **RLS (integración, `tests/rls`)**:
  - Aislamiento entre tenants en categorías anidadas (no ver/mover las de otro tenant
    aunque se pase un `parent_id` ajeno).
  - `delete_category_cascade`: preserva ítems históricos (archivados, detach+hide),
    borra los libres, borra el subárbol de categorías; **owner-only** (cashier/waiter
    fallan).
  - `move_category`: owner-only; anti-ciclo a nivel DB.
- **Smoke manual documentado en el PR**:
  1. Crear `Bebidas`, entrar, crear subcategoría `Vinos`, crear ítem `Malbec` dentro.
  2. Agregar ítem directo `Agua` en `Bebidas` (mezcla libre).
  3. Mover `Vinos` a otra categoría (verificar anti-ciclo: intentar moverla dentro de
     sí misma → rechazo).
  4. Carta del cliente (`/m/[qrToken]`): drill-down Bebidas → Vinos → Malbec;
     breadcrumb; búsqueda muestra ruta.
  5. Regla de puntos sobre `Vinos`; cerrar visita con `Malbec`; verificar puntos
     (solo ítems directos de `Vinos`).
  6. Borrar `Bebidas` en cascada: ítem usado en visita queda archivado, el resto se
     borra; carta no lo muestra; visita pasada intacta.

## 11. Fuera de alcance (YAGNI)
- Unicidad de nombres entre hermanos.
- Herencia de reglas de puntos a descendientes (decisión #5: no).
- Drag cross-nivel para mover (se usa "Mover a…"; el drag solo reordena hermanos).
- Reagrupar/colapsar en KDS por categoría.
- Límite de profundidad / límite de hijos (ilimitado por decisión #1).

## 12. Definition of Done (de CLAUDE.md §11)
UI accesible/mobile; migración aplicada local; RLS testeada; `types/database.ts`
regenerado (+ alias re-anexado); zod en cada borde; unit tests verdes; smoke manual
en PR; sin errores TS/lint; README de feature; PR con descripción; conventional commit.

## 13. Superficies afectadas (resumen)
| Capa | Archivo | Cambio |
|------|---------|--------|
| DB | migración nueva | `parent_id`, `category_id` nullable, índices, RPCs, `get_session_state` |
| DB | `types/database.ts` | regenerar + alias |
| Server | `lib/menu/schemas.ts` | `parent_id`, `moveCategorySchema`, reorder+parent |
| Server | `lib/menu/actions.ts` | create+parent, `moveCategory`, delete→cascade, reorder+parent |
| Server | `lib/menu/queries.ts` (+ `tree.ts`) | `parent_id`, `buildCategoryTree` |
| Manager UI | `menu-board.tsx` | reescritura drill-in + breadcrumb |
| Manager UI | `CategoryTreePicker` (nuevo) | picker de árbol con ruta |
| Manager UI | `new-category-form`, `category-edit-dialog`, `item-edit-dialog`, `category-row`, `menu-search`, `loading` | contexto de padre / mover / ruta |
| Cliente | `menu-hub.tsx`, `category-card.tsx` | árbol + drill-down |
| Cliente | `lib/m-session/{actions,menu-search}.ts` | `parent_id` + ruta |
| Mozo | `staff-menu-queries.ts`, `visitas/nueva/items-step.tsx`, `/api/sessions/[id]/menu` | drill-down |
| Puntos | `rules-list.tsx` + editor de reglas | picker con ruta (motor SIN cambios) |
| Tests | `tests/lib/*`, `tests/rls/*` | unit + RLS de anidamiento y cascada |
