# Carta — Anidamiento ilimitado de categorías · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anidar categorías de la carta sin límite de profundidad (categoría → subcategoría → … → ítem), con mezcla libre de ítems+subcategorías, navegación drill-down en cliente y editor drill-in en el panel, manteniendo la experiencia simple.

**Architecture:** Adjacency list — `menu_categories.parent_id` self-ref (`NULL` = raíz). El árbol se arma en memoria desde listas planas; CTE recursivo solo en cascada de borrado y anti-ciclo de "mover". `category_id` de `menu_items` pasa a nullable para archivar ítems históricos en la cascada sin romper el ledger.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (Postgres 15, RLS, RPC SECURITY DEFINER), TypeScript estricto, zod, dnd-kit, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-carta-categorias-anidadas-design.md`

**Branch:** `feat/carta-categorias-anidadas` (ya creada).

**Convenciones del repo a respetar:**
- Husky pre-commit corre `typecheck && lint && test:ci`. No usar `--no-verify`.
- Migraciones: una sola nueva, nunca editar aplicadas. GRANTs explícitos.
- Types: regenerar con MCP Supabase `generate_typescript_types` (db:types necesita Docker) y **re-anexar** el bloque de alias del final de `types/database.ts` (líneas ~4281-4311) que el generador borra.
- Aplicar migración a prod vía MCP `apply_migration` (proyecto `ogplsevtrclzxvyejlns`).

---

## Fase 1 — Modelo de datos y RPCs

### Task 1: Migración de schema + RPCs

**Files:**
- Create: `supabase/migrations/20260608120000_carta_nested_categories.sql`

- [ ] **Step 1: Crear el archivo de migración con DDL + RPCs**

Crear `supabase/migrations/20260608120000_carta_nested_categories.sql` con TODO este contenido. (El bloque 6, `get_session_state`, se construye en el Step 2 a partir del actual — dejá un marcador por ahora.)

```sql
-- ============================================================
-- Migración: Carta — anidamiento ilimitado de categorías
-- ============================================================
-- adjacency list (parent_id self-ref). NULL = categoría raíz.
-- category_id de menu_items pasa a nullable: se usa para "archivar"
-- ítems con historial durante la cascada de borrado, sin romper el ledger.

-- 1. Columnas + índices ---------------------------------------
alter table public.menu_categories
  add column if not exists parent_id uuid
  references public.menu_categories(id) on delete cascade;

alter table public.menu_items
  alter column category_id drop not null;

drop index if exists public.menu_categories_tenant_pos_idx;
create index if not exists menu_categories_tenant_parent_pos_idx
  on public.menu_categories(tenant_id, parent_id, position);
create index if not exists menu_categories_roots_idx
  on public.menu_categories(tenant_id, position) where parent_id is null;
create index if not exists menu_categories_parent_idx
  on public.menu_categories(parent_id);

-- 2. reorder_menu_categories: reordena HERMANOS dentro de un padre.
--    Drop + create: cambia el nombre del parámetro (p_tenant_id → p_parent_id),
--    y CREATE OR REPLACE no permite renombrar parámetros en Postgres.
drop function if exists public.reorder_menu_categories(uuid, uuid[]);
create function public.reorder_menu_categories(
  p_parent_id uuid, p_ordered_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  i int;
begin
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;
  -- Tenant derivado de las categorías (necesario porque p_parent_id puede ser NULL = raíz).
  select tenant_id into v_tenant
    from public.menu_categories where id = p_ordered_ids[1];
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update public.menu_categories
      set position = i
      where id = p_ordered_ids[i]
        and tenant_id = v_tenant
        and parent_id is not distinct from p_parent_id;
  end loop;
end; $$;

-- 3. move_category: cambia parent_id con chequeo anti-ciclo.
create or replace function public.move_category(
  p_category_id uuid, p_new_parent_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  v_parent_tenant uuid;
  v_max_pos int;
begin
  select tenant_id into v_tenant from public.menu_categories where id = p_category_id;
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_new_parent_id is not null then
    if p_new_parent_id = p_category_id then
      raise exception 'cycle' using errcode = 'P0001';
    end if;
    select tenant_id into v_parent_tenant from public.menu_categories where id = p_new_parent_id;
    if v_parent_tenant is null or v_parent_tenant <> v_tenant then
      raise exception 'invalid_parent' using errcode = 'P0001';
    end if;
    -- Anti-ciclo: el nuevo padre NO puede ser descendiente de la categoría movida.
    if exists (
      with recursive descendants as (
        select id from public.menu_categories where parent_id = p_category_id
        union all
        select c.id from public.menu_categories c
          join descendants d on c.parent_id = d.id
      )
      select 1 from descendants where id = p_new_parent_id
    ) then
      raise exception 'cycle' using errcode = 'P0001';
    end if;
  end if;
  select coalesce(max(position), 0) into v_max_pos
    from public.menu_categories
    where tenant_id = v_tenant and parent_id is not distinct from p_new_parent_id;
  update public.menu_categories
    set parent_id = p_new_parent_id, position = v_max_pos + 1
    where id = p_category_id and tenant_id = v_tenant;
end; $$;

-- 4. delete_category_cascade: borra el subárbol; archiva ítems con historial.
create or replace function public.delete_category_cascade(
  p_category_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  v_subtree uuid[];
  v_deleted_items int := 0;
  v_archived_items int := 0;
  v_deleted_categories int := 0;
begin
  select tenant_id into v_tenant from public.menu_categories where id = p_category_id;
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  with recursive subtree as (
    select id from public.menu_categories where id = p_category_id
    union all
    select c.id from public.menu_categories c join subtree s on c.parent_id = s.id
  )
  select array_agg(id) into v_subtree from subtree;

  -- Ítems referenciados en historial → archivar (no se pueden borrar físico).
  with refd as (
    select mi.id
    from public.menu_items mi
    where mi.category_id = any(v_subtree)
      and (
        exists (select 1 from public.visit_items vi where vi.menu_item_id = mi.id)
        or exists (select 1 from public.ticket_items ti where ti.menu_item_id = mi.id)
      )
  ), upd as (
    update public.menu_items mi
      set category_id = null, active = false
      from refd
      where mi.id = refd.id
      returning mi.id
  )
  select count(*) into v_archived_items from upd;

  -- Ítems libres → borrar físico (asignaciones de tags caen por on delete cascade).
  with del as (
    delete from public.menu_items mi
      where mi.category_id = any(v_subtree)
      returning mi.id
  )
  select count(*) into v_deleted_items from del;

  -- Borrar la raíz → descendientes caen por parent_id on delete cascade.
  delete from public.menu_categories where id = p_category_id and tenant_id = v_tenant;
  v_deleted_categories := coalesce(array_length(v_subtree, 1), 0);

  return jsonb_build_object(
    'deleted_categories', v_deleted_categories,
    'archived_items', v_archived_items,
    'deleted_items', v_deleted_items
  );
end; $$;

-- 5. GRANTs ---------------------------------------------------
grant execute on function public.reorder_menu_categories(uuid, uuid[]),
  public.move_category(uuid, uuid),
  public.delete_category_cascade(uuid) to authenticated;

-- 6. get_session_state: ver Step 2 (se reemplaza la función completa
--    agregando 'parent_id' a cada categoría).
```

- [ ] **Step 2: Agregar `parent_id` a `get_session_state`**

Copiar **íntegra** la función `get_session_state` desde `supabase/migrations/20260527130200_get_session_state_merged.sql` (líneas 16-215) al final de la migración nueva como bloque 6, con **una sola** modificación: dentro del `jsonb_build_object` de la categoría (actualmente líneas 111-114 de ese archivo), agregar `'parent_id', mc.parent_id,` justo después de `'position', mc.position,`. Resultado del fragmento:

```sql
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'parent_id', mc.parent_id,
      'items', coalesce(jsonb_agg(jsonb_build_object(
```

Todo lo demás de la función queda idéntico (sigue devolviendo categorías planas, cada una con sus ítems directos; el cliente arma el árbol).

- [ ] **Step 3: Aplicar la migración**

Aplicar a la base remota vía MCP Supabase `apply_migration` (proyecto `ogplsevtrclzxvyejlns`), `name: "carta_nested_categories"`, `query` = contenido completo del archivo. Para entorno local con Docker: `npm run db:reset`.

Verificar con MCP `execute_sql`:
```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'menu_categories' and column_name = 'parent_id';
-- Esperado: parent_id | YES
select column_name, is_nullable from information_schema.columns
where table_name = 'menu_items' and column_name = 'category_id';
-- Esperado: category_id | YES
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608120000_carta_nested_categories.sql
git commit -m "feat(carta): migración anidamiento de categorías (parent_id, RPCs cascada/move/reorder)"
```

---

### Task 2: Regenerar tipos

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Regenerar con MCP**

Llamar MCP Supabase `generate_typescript_types` y sobrescribir `types/database.ts` con el resultado.

- [ ] **Step 2: Re-anexar el bloque de alias**

El generador borra el bloque de alias del final. Re-anexarlo (está en git: `git show HEAD~1:types/database.ts | tail -40` o el commit previo). Es el bloque que empieza con `// Enum aliases (mantienen compatibilidad...` y exporta `BroadcastStatus`, …, `FloorElementKind`, `FloorElementShape`.

- [ ] **Step 3: Verificar los tipos nuevos**

Confirmar en `types/database.ts`:
- `menu_categories.Row` incluye `parent_id: string | null`.
- `menu_items.Row` tiene `category_id: string | null` (ahora nullable).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (puede fallar en `lib/menu/queries.ts` por `category_id` nullable; si falla ahí, se resuelve en Task 4 — anotar y seguir).

- [ ] **Step 5: Commit**

```bash
git add types/database.ts
git commit -m "chore(types): regenerar database.ts con parent_id y category_id nullable"
```

---

## Fase 2 — Capa server (tree, schemas, queries, actions)

### Task 3: Helper de árbol `lib/menu/tree.ts` (TDD)

**Files:**
- Create: `lib/menu/tree.ts`
- Test: `tests/lib/menu-tree.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/lib/menu-tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildCategoryTree,
  categoryPath,
  categoryPathLabel,
  flattenForPicker,
} from '@/lib/menu/tree'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'

function cat(id: string, parent_id: string | null, position: number, name = id): MenuCategory {
  return { id, name, position, active: true, image_url: null, parent_id }
}
function item(id: string, category_id: string, position: number): MenuItem {
  return {
    id,
    category_id,
    name: id,
    description: null,
    price_cents: 100,
    points_override: null,
    position,
    active: true,
    image_url: null,
    featured: false,
    tags: [],
  }
}

describe('buildCategoryTree', () => {
  it('anida por parent_id y adjunta ítems directos, ordenado por position', () => {
    const cats = [
      cat('vinos', 'bebidas', 1),
      cat('bebidas', null, 2),
      cat('comidas', null, 1),
    ]
    const items = [item('malbec', 'vinos', 1), item('agua', 'bebidas', 1)]
    const tree = buildCategoryTree(cats, items)

    expect(tree.map((n) => n.id)).toEqual(['comidas', 'bebidas']) // raíces por position
    const bebidas = tree.find((n) => n.id === 'bebidas')!
    expect(bebidas.items.map((i) => i.id)).toEqual(['agua'])
    expect(bebidas.children.map((c) => c.id)).toEqual(['vinos'])
    expect(bebidas.children[0]!.items.map((i) => i.id)).toEqual(['malbec'])
  })

  it('ignora ítems con category_id nulo o sin categoría existente', () => {
    const cats = [cat('a', null, 1)]
    const items = [item('x', 'a', 1), { ...item('y', 'a', 2), category_id: null as unknown as string }]
    const tree = buildCategoryTree(cats, items)
    expect(tree[0]!.items.map((i) => i.id)).toEqual(['x'])
  })
})

describe('categoryPath / categoryPathLabel', () => {
  it('devuelve ancestros desde la raíz hasta la categoría', () => {
    const cats = [cat('vinos', 'bebidas', 1, 'Vinos'), cat('bebidas', null, 1, 'Bebidas')]
    expect(categoryPath(cats, 'vinos').map((c) => c.id)).toEqual(['bebidas', 'vinos'])
    expect(categoryPathLabel(cats, 'vinos')).toBe('Bebidas › Vinos')
  })
})

describe('flattenForPicker', () => {
  it('aplana con depth y excluye un subárbol (para mover sin ciclo)', () => {
    const cats = [
      cat('bebidas', null, 1, 'Bebidas'),
      cat('vinos', 'bebidas', 1, 'Vinos'),
      cat('comidas', null, 2, 'Comidas'),
    ]
    const all = flattenForPicker(cats)
    expect(all.map((c) => `${c.depth}:${c.id}`)).toEqual(['0:bebidas', '1:vinos', '0:comidas'])

    const exclBebidas = flattenForPicker(cats, 'bebidas')
    expect(exclBebidas.map((c) => c.id)).toEqual(['comidas']) // sin bebidas ni su subárbol
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run tests/lib/menu-tree.test.ts`
Expected: FAIL — `Cannot find module '@/lib/menu/tree'`.

- [ ] **Step 3: Implementar `lib/menu/tree.ts`**

```ts
import type { MenuCategory, MenuItem } from './queries'

export type MenuTreeNode = MenuCategory & {
  children: MenuTreeNode[]
  items: MenuItem[]
}

/** Arma el bosque de categorías desde listas planas. Ítems van bajo su categoría
 *  directa (category_id). Hijos e ítems quedan ordenados por position. */
export function buildCategoryTree(
  categories: MenuCategory[],
  items: MenuItem[],
): MenuTreeNode[] {
  const byId = new Map<string, MenuTreeNode>()
  for (const c of categories) byId.set(c.id, { ...c, children: [], items: [] })

  for (const it of items) {
    if (!it.category_id) continue
    byId.get(it.category_id)?.items.push(it)
  }

  const roots: MenuTreeNode[] = []
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const sortRec = (nodes: MenuTreeNode[]) => {
    nodes.sort(byPos)
    for (const n of nodes) {
      n.items.sort(byPos)
      sortRec(n.children)
    }
  }
  sortRec(roots)
  return roots
}

/** Ancestros desde la raíz hasta la categoría (incluida). */
export function categoryPath(categories: MenuCategory[], id: string): MenuCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const out: MenuCategory[] = []
  let cur = byId.get(id)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return out
}

/** "Bebidas › Vinos". */
export function categoryPathLabel(categories: MenuCategory[], id: string): string {
  return categoryPath(categories, id)
    .map((c) => c.name)
    .join(' › ')
}

export type PickerEntry = { id: string; name: string; depth: number; path: string }

/** Lista plana en orden de árbol con depth y path; opcionalmente excluye un
 *  subárbol entero (la categoría `excludeSubtreeOf` y todos sus descendientes),
 *  para pickers de "mover" que no deben permitir ciclos. */
export function flattenForPicker(
  categories: MenuCategory[],
  excludeSubtreeOf?: string,
): PickerEntry[] {
  const tree = buildCategoryTree(categories, [])
  const out: PickerEntry[] = []
  const walk = (nodes: MenuTreeNode[], depth: number, ancestors: string[]) => {
    for (const n of nodes) {
      if (n.id === excludeSubtreeOf) continue
      const path = [...ancestors, n.name].join(' › ')
      out.push({ id: n.id, name: n.name, depth, path })
      walk(n.children, depth + 1, [...ancestors, n.name])
    }
  }
  walk(tree, 0, [])
  return out
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run tests/lib/menu-tree.test.ts`
Expected: PASS (todos los casos).

- [ ] **Step 5: Commit**

```bash
git add lib/menu/tree.ts tests/lib/menu-tree.test.ts
git commit -m "feat(menu): helper de árbol de categorías (build/path/picker) + tests"
```

---

### Task 4: Tipos y schemas server

**Files:**
- Modify: `lib/menu/queries.ts` (tipo `MenuCategory`, selects, filtro archivados)
- Modify: `lib/menu/schemas.ts`
- Test: `tests/lib/menu-category-schema.test.ts` (extender)

- [ ] **Step 1: Test de schema con `parent_id` (falla)**

Agregar a `tests/lib/menu-category-schema.test.ts`:

```ts
import { createCategorySchema, moveCategorySchema } from '@/lib/menu/schemas'

describe('createCategorySchema con parent_id', () => {
  it('acepta sin parent_id (=> null/undefined permitido)', () => {
    const r = createCategorySchema.safeParse({ name: 'Bebidas' })
    expect(r.success).toBe(true)
  })
  it('acepta un parent_id uuid', () => {
    const r = createCategorySchema.safeParse({
      name: 'Vinos',
      parent_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.parent_id).toBe('11111111-1111-1111-1111-111111111111')
  })
  it('rechaza parent_id no-uuid', () => {
    const r = createCategorySchema.safeParse({ name: 'Vinos', parent_id: 'x' })
    expect(r.success).toBe(false)
  })
})

describe('moveCategorySchema', () => {
  it('acepta parent_id null (mover a raíz)', () => {
    const r = moveCategorySchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      parent_id: null,
    })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `npx vitest run tests/lib/menu-category-schema.test.ts`
Expected: FAIL — `moveCategorySchema` no existe / `parent_id` no parseado.

- [ ] **Step 3: Editar `lib/menu/schemas.ts`**

Agregar el normalizador de `parent_id` y los schemas. Reemplazar `createCategorySchema` y agregar `moveCategorySchema` + `reorderCategoriesSchema`:

```ts
// parent_id: uuid o null/'' (raíz). '' y undefined → null.
const parentId = z
  .union([z.string().uuid(), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(60, 'Máximo 60'),
  image_url: categoryImageUrl.optional().default(null),
  parent_id: parentId,
})

export const moveCategorySchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
})

export const reorderCategoriesSchema = z.object({
  parent_id: z.string().uuid().nullable(),
  ids: z.array(z.string().uuid()).min(1),
})
```

(Dejar `reorderSchema` existente para `reorderItems`; no se toca.)

- [ ] **Step 4: Editar `lib/menu/queries.ts`**

a) Agregar `parent_id` al tipo `MenuCategory`:

```ts
export type MenuCategory = {
  id: string
  name: string
  position: number
  active: boolean
  image_url: string | null
  parent_id: string | null
}
```

b) En `listMenu`: agregar `parent_id` al select de categorías y **excluir ítems archivados** (`category_id` nulo). Cambiar el primer y segundo query del `Promise.all`:

```ts
      supabase
        .from('menu_categories')
        .select('id, name, position, active, image_url, parent_id')
        .eq('tenant_id', opts.tenantId)
        .order('position', { ascending: true }),
      supabase
        .from('menu_items')
        .select(MENU_ITEM_COLUMNS)
        .eq('tenant_id', opts.tenantId)
        .not('category_id', 'is', null)
        .order('position', { ascending: true }),
```

c) En `listActiveMenu`: agregar `parent_id` al select de categorías:

```ts
    supabase
      .from('menu_categories')
      .select('id, name, position, active, parent_id')
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .order('position', { ascending: true }),
```

(En `listActiveMenu` los ítems ya se filtran por `active = true`, lo que excluye archivados.)

- [ ] **Step 5: Correr tests + typecheck**

Run: `npx vitest run tests/lib/menu-category-schema.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/menu/schemas.ts lib/menu/queries.ts tests/lib/menu-category-schema.test.ts
git commit -m "feat(menu): parent_id en tipos/queries/schemas + moveCategory/reorder schemas"
```

---

### Task 5: Server actions (create+parent, move, delete cascada, reorder+parent)

**Files:**
- Modify: `lib/menu/actions.ts`

- [ ] **Step 1: `createCategory` — leer y usar `parent_id`**

En `createCategory` (líneas 77-100), cambiar el `safeParse` para incluir `parent_id` y calcular la posición **entre hermanos**:

```ts
  const parsed = createCategorySchema.safeParse({
    name: formData.get('name'),
    image_url: formData.get('image_url'),
    parent_id: formData.get('parent_id'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Si viene parent_id, validar que la categoría padre es del tenant.
  if (parsed.data.parent_id) {
    const { data: parent } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('id', parsed.data.parent_id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (!parent) return { ok: false, message: 'Categoría padre inválida.' }
  }

  // Posición = max entre hermanos (mismo parent_id) + 1.
  const siblingQuery = supabase
    .from('menu_categories')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
  const { data: maxPos } = await (parsed.data.parent_id
    ? siblingQuery.eq('parent_id', parsed.data.parent_id)
    : siblingQuery.is('parent_id', null)
  ).maybeSingle()
```

Y en el `.insert(...)` agregar `parent_id: parsed.data.parent_id`:

```ts
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      image_url: parsed.data.image_url,
      parent_id: parsed.data.parent_id,
      position: (maxPos?.position ?? 0) + 1,
    })
```

- [ ] **Step 2: Reemplazar `deleteCategory` por la cascada**

Reemplazar el cuerpo de `deleteCategory` (líneas 145-170) por:

```ts
export async function deleteCategory(slug: string, id: string): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('delete_category_cascade', {
    p_category_id: idParsed.data,
  })
  if (error) {
    console.error('[menu.deleteCategory] cascade', error.message)
    return { ok: false, message: 'No pudimos borrar la categoría.' }
  }

  const summary = (data ?? {}) as {
    deleted_categories?: number
    archived_items?: number
    deleted_items?: number
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'menu_category.deleted_cascade',
    entity: 'menu_category',
    entityId: idParsed.data,
    payload: summary,
  })

  revalidatePath(`/${slug}/menu`)
  const archived = summary.archived_items ?? 0
  return {
    ok: true,
    message:
      archived > 0
        ? `Categoría eliminada. ${archived} ítem${archived === 1 ? '' : 's'} con historial quedaron archivados.`
        : 'Categoría eliminada.',
  }
}
```

- [ ] **Step 3: Agregar `moveCategory`**

Agregar después de `updateCategory` (importar `moveCategorySchema` arriba):

```ts
export async function moveCategory(
  slug: string,
  payload: { id: string; parent_id: string | null },
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = moveCategorySchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('move_category', {
    p_category_id: parsed.data.id,
    p_new_parent_id: parsed.data.parent_id,
  })
  if (error) {
    if (error.message.includes('cycle')) {
      return { ok: false, message: 'No podés mover una categoría dentro de sí misma.' }
    }
    if (error.message.includes('invalid_parent')) {
      return { ok: false, message: 'Categoría destino inválida.' }
    }
    return { ok: false, message: 'No pudimos mover la categoría.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'menu_category.moved',
    entity: 'menu_category',
    entityId: parsed.data.id,
    payload: { parent_id: parsed.data.parent_id },
  })

  revalidatePath(`/${slug}/menu`)
  return { ok: true, message: 'Categoría movida.' }
}
```

- [ ] **Step 4: `reorderCategories` con `parent_id`**

Reemplazar `reorderCategories` (líneas 358-374). Importar `reorderCategoriesSchema` (y quitar `reorderSchema` del import si ya no se usa en otro lado — `reorderItems` usa `reorderItemsSchema`, así que `reorderSchema` puede quedar; verificá imports):

```ts
export async function reorderCategories(
  slug: string,
  parentId: string | null,
  ids: string[],
): Promise<MenuActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reorderCategoriesSchema.safeParse({ parent_id: parentId, ids })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('reorder_menu_categories', {
    p_parent_id: parsed.data.parent_id,
    p_ordered_ids: parsed.data.ids,
  })
  if (error) return { ok: false, message: 'No pudimos reordenar.' }

  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}
```

Actualizar el bloque de imports de schemas al inicio del archivo para incluir `moveCategorySchema` y `reorderCategoriesSchema`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (el caller de `reorderCategories` en `menu-board.tsx` quedará roto hasta Task 7; si typecheck falla solo ahí, anotar y seguir — se arregla en Fase 3).

- [ ] **Step 6: Commit**

```bash
git add lib/menu/actions.ts
git commit -m "feat(menu): actions create+parent, moveCategory, deleteCategory cascada, reorder por padre"
```

---

## Fase 3 — Editor del dueño (drill-in)

### Task 6: `CategoryTreePicker` (nuevo)

**Files:**
- Create: `app/(manager)/[tenantSlug]/menu/_components/category-tree-picker.tsx`

- [ ] **Step 1: Implementar el componente**

Picker de categoría destino (para "mover categoría", "mover ítem"). Usa `flattenForPicker`. Permite elegir "Raíz (sin categoría padre)" cuando `allowRoot`.

```tsx
'use client'

import { Check } from 'lucide-react'
import type { MenuCategory } from '@/lib/menu/queries'
import { flattenForPicker } from '@/lib/menu/tree'
import { cn } from '@/lib/utils'

export function CategoryTreePicker({
  categories,
  value,
  onChange,
  excludeSubtreeOf,
  allowRoot = false,
  rootLabel = 'Raíz (sin categoría padre)',
}: {
  categories: MenuCategory[]
  value: string | null
  onChange: (id: string | null) => void
  /** Excluye esta categoría y su subárbol (para mover sin ciclos). */
  excludeSubtreeOf?: string
  allowRoot?: boolean
  rootLabel?: string
}) {
  const entries = flattenForPicker(categories, excludeSubtreeOf)

  return (
    <ul className="card-hairline max-h-64 overflow-y-auto rounded-lg border bg-card p-1.5">
      {allowRoot ? (
        <li>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
              value === null ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/40',
            )}
          >
            <span className="flex-1 truncate font-medium">{rootLabel}</span>
            {value === null ? <Check className="size-4 text-primary" aria-hidden /> : null}
          </button>
        </li>
      ) : null}
      {entries.map((e) => {
        const checked = value === e.id
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onChange(e.id)}
              aria-pressed={checked}
              style={{ paddingLeft: `${0.625 + e.depth * 1}rem` }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md py-2 pr-2.5 text-left text-sm transition-colors',
                checked ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/40',
              )}
            >
              <span className="flex-1 truncate">{e.name}</span>
              {checked ? <Check className="size-4 text-primary" aria-hidden /> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add app/\(manager\)/\[tenantSlug\]/menu/_components/category-tree-picker.tsx
git commit -m "feat(menu): CategoryTreePicker reutilizable (árbol indentado con ruta)"
```

---

### Task 7: Reescribir `MenuBoard` a navegador drill-in

**Files:**
- Modify: `app/(manager)/[tenantSlug]/menu/_components/menu-board.tsx` (reescritura)
- Modify: `app/(manager)/[tenantSlug]/menu/_components/new-category-form.tsx` (prop `parentId`)
- Modify: `app/(manager)/[tenantSlug]/menu/page.tsx` (pasar props; quitar el `NewCategoryForm` del header si querés, o dejarlo creando raíz)

> **Diseño del componente:** `MenuBoard` mantiene `currentId: string | null` (null = raíz). Construye el árbol con `buildCategoryTree(categories, items)`. Renderiza: breadcrumb (raíz › … › actual), botones "Agregar ítem" (si `currentId !== null`) y "Agregar subcategoría", la grilla de ítems directos del nivel (reusa `CategoryRow`), y la lista de subcategorías (DnD con `reorderCategories(slug, currentId, ids)`), cada una con `›` (entrar, set `currentId`) y menú `⋯` (Renombrar / Mover a… / Pausar / Eliminar). La búsqueda sigue siendo global y plana (igual que hoy) y muestra la ruta de cada categoría resultado.

- [ ] **Step 1: `new-category-form.tsx` — aceptar `parentId`**

Agregar prop `parentId: string | null` y un hidden input. Cambiar la firma y el form:

```tsx
export function NewCategoryForm({
  tenantId,
  tenantSlug,
  parentId = null,
}: {
  tenantId: string
  tenantSlug: string
  parentId?: string | null
}) {
  // ...resto igual...
  return (
    <form ref={formRef} action={formAction} className="grid gap-3">
      <input type="hidden" name="image_url" value={imageUrl ?? ''} />
      <input type="hidden" name="parent_id" value={parentId ?? ''} />
      {/* ...resto igual... */}
```

- [ ] **Step 2: Reescribir `menu-board.tsx`**

Reemplazar el archivo completo por la versión drill-in. Reutiliza `CategoryRow` (ítems del nivel), `CategoryEditDialog`, `CategoryTreePicker`, `NewCategoryForm`, `NewItemForm`.

```tsx
'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronRight,
  FolderTree,
  GripVertical,
  Home,
  MoreHorizontal,
  Move,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import {
  deleteCategory,
  moveCategory,
  reorderCategories,
  updateCategory,
} from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { buildCategoryTree, categoryPath, type MenuTreeNode } from '@/lib/menu/tree'
import { CategoryEditDialog } from './category-edit-dialog'
import { CategoryRow } from './category-row'
import { CategoryTreePicker } from './category-tree-picker'
import { MenuSearch } from './menu-search'
import { NewCategoryForm } from './new-category-form'

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function MenuBoard({
  tenantSlug,
  tenantId,
  categories,
  items,
  tags,
}: {
  tenantSlug: string
  tenantId: string
  categories: MenuCategory[]
  items: MenuItem[]
  tags: ItemTagRow[]
}) {
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Árbol completo en memoria. Se rearma si cambian categories/items (router.refresh).
  const tree = useMemo(() => buildCategoryTree(categories, items), [categories, items])
  const nodeById = useMemo(() => {
    const m = new Map<string, MenuTreeNode>()
    const walk = (ns: MenuTreeNode[]) => {
      for (const n of ns) {
        m.set(n.id, n)
        walk(n.children)
      }
    }
    walk(tree)
    return m
  }, [tree])

  const current = currentId ? (nodeById.get(currentId) ?? null) : null
  const levelNodes = current ? current.children : tree
  const levelItems = current ? current.items : []
  const breadcrumb = current ? categoryPath(categories, current.id) : []

  // Búsqueda global y plana: lista de categorías que matchean por nombre, con ruta.
  const searchHits = useMemo(() => {
    const q = search.trim()
    if (q.length === 0) return []
    const needle = norm(q)
    return categories
      .filter((c) => norm(c.name).includes(needle))
      .map((c) => ({ cat: c, path: categoryPath(categories, c.id) }))
  }, [categories, search])

  if (search.trim().length > 0) {
    return (
      <div className="space-y-5">
        <div className="sm:max-w-md">
          <MenuSearch value={search} onChange={setSearch} />
        </div>
        {searchHits.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Sin resultados"
            description={`No encontramos categorías con "${search}".`}
          />
        ) : (
          <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {searchHits.map(({ cat, path }) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setCurrentId(cat.id)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-secondary/40"
                >
                  <FolderTree className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm">
                    {path.map((c) => c.name).join(' › ')}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 sm:max-w-md">
          <MenuSearch value={search} onChange={setSearch} />
        </div>
      </div>

      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Ruta de categorías">
        <button
          type="button"
          onClick={() => setCurrentId(null)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        >
          <Home className="size-3.5" aria-hidden />
          Carta
        </button>
        {breadcrumb.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            <button
              type="button"
              onClick={() => setCurrentId(c.id)}
              className="rounded-md px-1.5 py-1 font-medium hover:bg-secondary/50"
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Acciones del nivel */}
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="size-3.5" /> Agregar ítem
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(560px,calc(100vw-2rem))] p-3"
              sideOffset={6}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Nuevo ítem en {current.name}
              </p>
              <ItemAdder tenantSlug={tenantSlug} tenantId={tenantId} categoryId={current.id} />
            </PopoverContent>
          </Popover>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" /> Agregar {current ? 'subcategoría' : 'categoría'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3" sideOffset={6}>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Nueva {current ? 'subcategoría' : 'categoría'}
            </p>
            <NewCategoryForm
              tenantId={tenantId}
              tenantSlug={tenantSlug}
              parentId={current?.id ?? null}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Ítems directos del nivel actual */}
      {current ? (
        <div className="card-hairline rounded-xl border border-border/70 bg-card p-4 sm:p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Ítems de {current.name}
          </p>
          <CategoryRow
            category={current}
            items={levelItems}
            tenantSlug={tenantSlug}
            tenantId={tenantId}
            allCategories={categories}
            allTags={tags}
            hideAddButton
          />
        </div>
      ) : null}

      {/* Subcategorías del nivel actual */}
      <SubcategoryList
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        parentId={current?.id ?? null}
        nodes={levelNodes}
        allCategories={categories}
        onEnter={setCurrentId}
      />

      {levelNodes.length === 0 && (!current || current.items.length === 0) ? (
        <EmptyState
          icon={FolderTree}
          title={current ? 'Categoría vacía' : 'Empezá creando una categoría'}
          description={
            current
              ? 'Agregá ítems o subcategorías con los botones de arriba.'
              : 'Las categorías agrupan tu carta. Podés anidar subcategorías dentro.'
          }
        />
      ) : null}
    </div>
  )
}

// Form de alta de ítem que refresca al crear (router.refresh vía window event no;
// usamos el patrón existente: NewItemForm resetea; pero necesitamos recargar el
// árbol. Reusamos router.refresh.)
function ItemAdder({
  tenantSlug,
  tenantId,
  categoryId,
}: {
  tenantSlug: string
  tenantId: string
  categoryId: string
}) {
  // NewItemForm ya hace toast + reset. Para reflejar el ítem nuevo en el árbol,
  // refrescamos la ruta. Importamos useRouter localmente.
  const { useRouter } = require('next/navigation') as typeof import('next/navigation')
  const router = useRouter()
  const { NewItemForm } = require('./new-item-form') as typeof import('./new-item-form')
  return (
    <NewItemForm
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      categoryId={categoryId}
      onCreated={() => router.refresh()}
    />
  )
}

function SubcategoryList({
  tenantSlug,
  tenantId,
  parentId,
  nodes,
  allCategories,
  onEnter,
}: {
  tenantSlug: string
  tenantId: string
  parentId: string | null
  nodes: MenuTreeNode[]
  allCategories: MenuCategory[]
  onEnter: (id: string) => void
}) {
  const [order, setOrder] = useState(nodes)
  const [, startTransition] = useTransition()

  // Re-sincronizar si cambian los nodos (navegación de nivel o refresh).
  // Comparamos por ids para no romper el orden optimista.
  const idsKey = nodes.map((n) => n.id).join(',')
  const orderIdsKey = order.map((n) => n.id).join(',')
  if (idsKey !== orderIdsKey) {
    setOrder(nodes)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex((c) => c.id === active.id)
    const newIndex = order.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const prev = order
    const next = arrayMove(order, oldIndex, newIndex)
    setOrder(next)
    startTransition(async () => {
      const r = await reorderCategories(
        tenantSlug,
        parentId,
        next.map((c) => c.id),
      )
      if (!r.ok) {
        toast.error(r.message)
        setOrder(prev)
      }
    })
  }

  if (order.length === 0) return null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Subcategorías
          </p>
          {order.map((node) => (
            <SubcategoryRow
              key={node.id}
              node={node}
              tenantSlug={tenantSlug}
              tenantId={tenantId}
              allCategories={allCategories}
              onEnter={onEnter}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SubcategoryRow({
  node,
  tenantSlug,
  tenantId,
  allCategories,
  onEnter,
}: {
  node: MenuTreeNode
  tenantSlug: string
  tenantId: string
  allCategories: MenuCategory[]
  onEnter: (id: string) => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: node.id,
  })
  const [editing, setEditing] = useState(false)
  const [toDelete, setToDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(node.parent_id)
  const [, startTransition] = useTransition()

  const directItems = node.items.length
  const subcats = node.children.length

  const onToggle = () => {
    startTransition(async () => {
      const r = await updateCategory(tenantSlug, {
        id: node.id,
        name: node.name,
        active: !node.active,
        image_url: node.image_url,
      })
      if (r.ok) toast.success(node.active ? 'Categoría pausada.' : 'Categoría activada.')
      else toast.error(r.message)
    })
  }

  const onDelete = () => {
    setToDelete(false)
    startTransition(async () => {
      const r = await deleteCategory(tenantSlug, node.id)
      if (r.ok) toast.success(r.message ?? 'Categoría eliminada.')
      else toast.error(r.message)
    })
  }

  const onConfirmMove = () => {
    setMoving(false)
    startTransition(async () => {
      const r = await moveCategory(tenantSlug, { id: node.id, parent_id: moveTarget })
      if (r.ok) toast.success('Categoría movida.')
      else toast.error(r.message)
    })
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card-hairline flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5"
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Mover ${node.name}`}
        className="cursor-grab rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onEnter(node.id)}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <FolderTree className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-serif text-base font-semibold tracking-tight">{node.name}</span>
        {!node.active ? (
          <Badge variant="muted" className="text-[10px]">
            Pausada
          </Badge>
        ) : null}
        <span className="text-xs tabular-nums text-muted-foreground">
          {subcats > 0 ? `${subcats} subcat · ` : ''}
          {directItems} ítem{directItems === 1 ? '' : 's'}
        </span>
      </button>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-foreground"
            aria-label={`Acciones de ${node.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Renombrar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <Move className="size-3.5" /> Mover a…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggle}>
            {node.active ? (
              <>
                <Pause className="size-3.5" /> Pausar
              </>
            ) : (
              <>
                <Play className="size-3.5" /> Activar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(true)}>
            <Trash2 className="size-3.5" /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <CategoryEditDialog
          category={node}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {/* Mover a… */}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover "{node.name}"</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Elegí la categoría que la va a contener.</p>
          <CategoryTreePicker
            categories={allCategories}
            value={moveTarget}
            onChange={setMoveTarget}
            excludeSubtreeOf={node.id}
            allowRoot
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancelar
            </Button>
            <Button onClick={onConfirmMove}>Mover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar en cascada */}
      <AlertDialog open={toDelete} onOpenChange={setToDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{node.name}" y todo su contenido?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran sus subcategorías e ítems. Los ítems que aparezcan en visitas o pedidos
              pasados quedan archivados (ocultos) para no romper el historial. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

> Nota: `require(...)` dentro de `ItemAdder` evita reordenar imports; si Biome se queja de `require`, mové `useRouter` y `NewItemForm` a imports normales arriba y borrá `ItemAdder` usándolos directo. (Preferido: imports normales — ver Step 4.)

- [ ] **Step 3: `CategoryRow` — soportar `hideAddButton`**

En `category-row.tsx`, agregar prop opcional `hideAddButton?: boolean` a `CategoryRow` y envolver el `<Popover>` de "Agregar ítem" (líneas 185-207) en `{!hideAddButton ? (...) : null}`. El `MenuBoard` ya ofrece su propio "Agregar ítem", así que en drill-in pasamos `hideAddButton`.

```tsx
export function CategoryRow({
  category,
  items: initialItems,
  tenantSlug,
  tenantId,
  allCategories,
  allTags,
  hideAddButton = false,
}: {
  category: MenuCategory
  items: MenuItem[]
  tenantSlug: string
  tenantId: string
  allCategories: MenuCategory[]
  allTags: ItemTagRow[]
  hideAddButton?: boolean
}) {
```

Y el bloque del Popover de agregar ítem:

```tsx
        {hideAddButton ? null : (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            {/* ...contenido existente del Popover... */}
          </Popover>
        )}
```

- [ ] **Step 4: Mover `useRouter`/`NewItemForm` a imports y borrar `ItemAdder`**

En `menu-board.tsx`, reemplazar el helper `ItemAdder` por imports normales: agregar `import { useRouter } from 'next/navigation'` y `import { NewItemForm } from './new-item-form'` arriba, llamar `const router = useRouter()` dentro de `MenuBoard`, y en el Popover de "Agregar ítem" usar directamente:

```tsx
              <NewItemForm
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                categoryId={current.id}
                onCreated={() => router.refresh()}
              />
```

- [ ] **Step 5: `page.tsx` — el `NewCategoryForm` del header crea raíz**

En `page.tsx`, los `NewCategoryForm` del header y del empty-state crean categorías raíz: pasar `parentId={null}` (o dejar el default). No requiere otro cambio porque `MenuBoard` ya recibe `categories` e `items` planos. Verificar que sigue compilando.

- [ ] **Step 6: Lint + typecheck**

Run: `npm run lint`
Expected: PASS (sin `require`; resolver cualquier warning nuevo introducido).
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/(manager)/[tenantSlug]/menu/"
git commit -m "feat(menu): editor drill-in con breadcrumb, subcategorías DnD, mover y borrado en cascada"
```

---

### Task 8: `item-edit-dialog` — selector de categoría con árbol/ruta

**Files:**
- Modify: `app/(manager)/[tenantSlug]/menu/_components/item-edit-dialog.tsx`

- [ ] **Step 1: Reemplazar el `<Select>` de categoría por `CategoryTreePicker`**

En la tab "Avanzado" (líneas 406-425), reemplazar el bloque del `<Select>` de categoría por el picker de árbol (muestra ruta e indenta):

```tsx
            <TabsContent value="advanced" className="m-0 grid gap-5 outline-none">
              <div className="grid gap-1.5">
                <Label>Categoría</Label>
                <CategoryTreePicker
                  categories={categories}
                  value={categoryId}
                  onChange={(id) => id && setCategoryId(id)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Mové el ítem a otra categoría sin perder sus datos.
                </p>
              </div>
```

Agregar el import: `import { CategoryTreePicker } from './category-tree-picker'`. Quitar los imports de `Select*` si ya no se usan en el archivo (verificar). `categoryId` sigue siendo `string` (un ítem siempre tiene categoría); el `onChange` ignora `null`.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(manager)/[tenantSlug]/menu/_components/item-edit-dialog.tsx"
git commit -m "feat(menu): mover ítem usando árbol de categorías con ruta"
```

---

## Fase 4 — Carta del cliente (drill-down)

### Task 9: Tipo `menu` + búsqueda con ruta

**Files:**
- Modify: `lib/m-session/actions.ts` (tipo `ActiveSessionStateData.menu`)
- Modify: `lib/m-session/menu-search.ts`
- Test: `tests/lib/menu-search.test.ts` (extender)

- [ ] **Step 1: Agregar `parent_id` al tipo `menu`**

En `lib/m-session/actions.ts`, dentro de `ActiveSessionStateData`, agregar `parent_id` al objeto de categoría (después de `position`):

```ts
  menu: Array<{
    id: string
    name: string
    position: number
    parent_id: string | null
    image_url: string | null
    items: Array<{
```

- [ ] **Step 2: Test de búsqueda con ruta (falla)**

En `tests/lib/menu-search.test.ts`, agregar un caso que verifique que la búsqueda recorre categorías anidadas (los ítems de subcategorías también aparecen):

```ts
it('encuentra ítems en subcategorías (estructura anidada)', () => {
  const categories = [
    {
      id: 'bebidas',
      name: 'Bebidas',
      position: 1,
      parent_id: null,
      image_url: null,
      items: [],
    },
    {
      id: 'vinos',
      name: 'Vinos',
      position: 1,
      parent_id: 'bebidas',
      image_url: null,
      items: [
        {
          id: 'malbec',
          name: 'Malbec',
          description: null,
          price_cents: 4500,
          image_url: null,
          position: 1,
          featured: false,
          points_override: null,
          tags: [],
        },
      ],
    },
  ] as unknown as Parameters<typeof searchMenuItems>[0]
  const r = searchMenuItems(categories, 'malbec')
  expect(r.map((i) => i.id)).toEqual(['malbec'])
})
```

(`searchMenuItems` ya recorre `categories[].items[]`; como `get_session_state` devuelve todas las categorías —incluidas subcategorías— con sus ítems directos, la búsqueda plana ya funciona sin recursión. El test lo blinda.)

- [ ] **Step 3: Correr (debe pasar — confirma que no se rompió)**

Run: `npx vitest run tests/lib/menu-search.test.ts`
Expected: PASS. Si falla, ajustar `searchMenuItems` para que itere todas las categorías (ya lo hace).

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add lib/m-session/actions.ts lib/m-session/menu-search.ts tests/lib/menu-search.test.ts
git commit -m "feat(carta): parent_id en el tipo de menú del cliente + test búsqueda anidada"
```

---

### Task 10: `MenuHub` drill-down con breadcrumb

**Files:**
- Modify: `app/m/[qrToken]/_components/menu-hub.tsx`
- Modify: `app/m/[qrToken]/_components/category-card.tsx` (conteo incluye subcategorías)

> **Diseño:** `MenuHub` arma un bosque por `parent_id` (las categorías ya traen sus ítems directos). Mantiene `currentId`. En cada nivel muestra ítems directos arriba y subcategorías (cards) abajo. Una categoría es visible si tiene ítems directos **o** contenido descendiente. Breadcrumb para subir. Búsqueda y carrusel de destacados quedan globales (aplanan todas las categorías), igual que hoy.

- [ ] **Step 1: Reescribir `menu-hub.tsx`**

```tsx
'use client'

import { ChevronRight, Home, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { searchMenuItems } from '@/lib/m-session/menu-search'
import { CategoryCard } from './category-card'
import { ItemDetailSheet } from './item-detail-sheet'
import { ItemRow } from './item-row'
import type { CartItem } from './mesa-screen'
import { RecommendedCarousel } from './recommended-carousel'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]
type Node = Category & { children: Node[] }

// Arma el bosque por parent_id. Cada categoría conserva sus ítems directos.
function buildForest(categories: Category[]): {
  roots: Node[]
  byId: Map<string, Node>
} {
  const byId = new Map<string, Node>()
  for (const c of categories) byId.set(c.id, { ...c, children: [] })
  const roots: Node[] = []
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children.push(n)
    else roots.push(n)
  }
  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const sortRec = (ns: Node[]) => {
    ns.sort(byPos)
    for (const n of ns) sortRec(n.children)
  }
  sortRec(roots)
  return { roots, byId }
}

// ¿La categoría tiene contenido (ítems directos o algún descendiente con ítems)?
function hasContent(node: Node): boolean {
  if (node.items.length > 0) return true
  return node.children.some(hasContent)
}

export function MenuHub({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<Item | null>(null)

  const { roots, byId } = useMemo(() => buildForest(categories), [categories])
  const featured = useMemo(
    () => categories.flatMap((c) => c.items.filter((i) => i.featured)).slice(0, 6),
    [categories],
  )
  const searchResults = useMemo(() => searchMenuItems(categories, query), [categories, query])
  const searching = query.trim().length > 0

  const current = currentId ? (byId.get(currentId) ?? null) : null
  const levelNodes = (current ? current.children : roots).filter(hasContent)
  const levelItems = current ? current.items : []

  // Breadcrumb (ancestros).
  const breadcrumb = useMemo(() => {
    const out: Node[] = []
    let cur = current
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      out.unshift(cur)
      cur = cur.parent_id ? (byId.get(cur.parent_id) ?? null) : null
    }
    return out
  }, [current, byId])

  return (
    <div className="space-y-5">
      {!current && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en toda la carta…"
            className="h-11 rounded-xl pl-9 text-sm"
            aria-label="Buscar en la carta"
          />
        </div>
      )}

      {!current && searching ? (
        searchResults.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
            <p className="text-sm font-medium">Sin resultados</p>
            <p className="mt-1 text-xs text-muted-foreground">Probá con otra búsqueda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {searchResults.map((it) => (
              <ItemRow key={it.id} item={it} onOpen={setOpening} />
            ))}
          </div>
        )
      ) : current ? (
        <section aria-labelledby="cat-detail-title" className="space-y-4">
          {/* Breadcrumb */}
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Ruta">
            <button
              type="button"
              onClick={() => setCurrentId(null)}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2.5 py-1 text-muted-foreground shadow-sm"
            >
              <Home className="size-3.5" aria-hidden /> Carta
            </button>
            {breadcrumb.map((c, idx) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
                {idx === breadcrumb.length - 1 ? (
                  <span className="px-1.5 py-1 font-serif text-base font-semibold">{c.name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentId(c.id)}
                    className="rounded-md px-1.5 py-1 font-medium"
                  >
                    {c.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {/* Ítems directos */}
          {levelItems.length > 0 ? (
            <div className="space-y-2">
              {levelItems.map((it) => (
                <ItemRow key={it.id} item={it} onOpen={setOpening} />
              ))}
            </div>
          ) : null}

          {/* Subcategorías */}
          {levelNodes.length > 0 ? (
            <div className="space-y-3">
              {levelItems.length > 0 ? (
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Más opciones
                </p>
              ) : null}
              {levelNodes.map((node) => (
                <CategoryCard
                  key={node.id}
                  category={node}
                  subcatCount={node.children.filter(hasContent).length}
                  onSelect={setCurrentId}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <RecommendedCarousel items={featured} onOpen={setOpening} />
          {levelNodes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
              <p className="text-sm font-medium">La carta está vacía</p>
              <p className="mt-1 text-xs text-muted-foreground">Pedile al mozo que te ayude.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {levelNodes.map((node) => (
                <CategoryCard
                  key={node.id}
                  category={node}
                  subcatCount={node.children.filter(hasContent).length}
                  onSelect={setCurrentId}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!current && searching && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="mx-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <X className="size-3.5" aria-hidden /> Limpiar búsqueda
        </button>
      )}

      <ItemDetailSheet item={opening} onClose={() => setOpening(null)} onAdd={onAdd} />
    </div>
  )
}
```

- [ ] **Step 2: `category-card.tsx` — conteo con subcategorías**

Agregar prop opcional `subcatCount?: number` y ajustar el label para reflejar subcategorías:

```tsx
export function CategoryCard({
  category,
  subcatCount = 0,
  onSelect,
}: {
  category: Category
  subcatCount?: number
  onSelect: (id: string) => void
}) {
  const count = category.items.length
  const parts: string[] = []
  if (subcatCount > 0) parts.push(`${subcatCount} ${subcatCount === 1 ? 'sección' : 'secciones'}`)
  if (count > 0) parts.push(`${count} ${count === 1 ? 'opción' : 'opciones'}`)
  const countLabel = parts.join(' · ') || 'Ver'
  // ...resto igual...
```

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/m/[qrToken]/_components/menu-hub.tsx" "app/m/[qrToken]/_components/category-card.tsx"
git commit -m "feat(carta): navegación drill-down con breadcrump y subcategorías en la vista del cliente"
```

---

## Fase 5 — Mozo / salón y puntos

### Task 11: Menú del staff con ruta (no rompe con anidación)

**Files:**
- Modify: `lib/sessions-waiter/staff-menu-queries.ts`
- Modify: `app/(manager)/[tenantSlug]/visitas/nueva/_components/items-step.tsx`

> **Decisión pragmática (refina el spec §7.2):** para las superficies de carga rápida del staff NO usamos drill-down (sumaría toques en el flujo de pedido). En su lugar: mostramos **solo categorías con ítems directos**, etiquetadas con su **ruta completa** ("Bebidas › Vinos"). Es no-breaking (cada ítem sigue bajo su categoría directa) y mantiene la velocidad de carga. Las categorías-contenedor sin ítems propios simplemente no generan tab/sección vacía.

- [ ] **Step 1: `staff-menu-queries.ts` — incluir `parent_id` y ruta**

Agregar `parent_id` al select y a `StaffMenuCategory`, y exponer un `path` calculado. Cambiar el tipo y el armado:

```ts
export type StaffMenuCategory = {
  id: string
  name: string
  position: number
  parent_id: string | null
  /** Ruta completa "Bebidas › Vinos" para etiquetar la categoría. */
  path: string
  items: StaffMenuItem[]
}
```

En `getStaffMenuForTenant`, cambiar el select de categorías a `'id, name, position, parent_id'`, y al final calcular `path` con un mapa de nombres por id (no hace falta filtrar activos para el path; usamos las mismas filas):

```ts
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const parentById = new Map(categories.map((c) => [c.id, c.parent_id as string | null]))
  const pathOf = (id: string): string => {
    const parts: string[] = []
    let cur: string | null = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      parts.unshift(nameById.get(cur) ?? '')
      cur = parentById.get(cur) ?? null
    }
    return parts.filter(Boolean).join(' › ')
  }

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    parent_id: c.parent_id as string | null,
    path: pathOf(c.id),
    items: itemsByCategory.get(c.id) ?? [],
  }))
```

(El select trae `active = true`; una subcategoría activa cuyo padre está pausado igual aparece — aceptable: si el dueño pausó el padre, los ítems de la subcat ya no están en la carta del cliente vía `get_session_state` que filtra por `mc.active`, pero el staff puede seguir cargándolos. Si se quiere paridad estricta, es mejora futura — anotar en BACKLOG.md.)

- [ ] **Step 2: `items-step.tsx` — tabs/sección solo con ítems, etiqueta = ruta**

Leer el archivo y ajustar: filtrar a `categories.filter((c) => c.items.length > 0)` para las tabs/secciones, y usar `c.path` como etiqueta del tab/encabezado en lugar de `c.name`. (El resto de la lógica de selección de ítems queda igual: `items.filter((i) => i.category_id === c.id)` ya no hace falta si `StaffMenuCategory.items` viene agrupado; usar `c.items`.)

Si `items-step` consume `getStaffMenuForTenant` (categorías ya agrupadas), reemplazar el filtrado por categoría por el uso directo de `c.items`, y el label del `TabsTrigger`/encabezado por `{c.path}`.

- [ ] **Step 3: Verificar el route handler del staff menu**

`app/api/sessions/[sessionId]/menu/route.ts` devuelve `getStaffMenuForTenant(...)`. Como solo cambió el shape (campos agregados), no requiere cambios de lógica. Verificar que compila y que los consumers del JSON toleran los campos nuevos.

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sessions-waiter/staff-menu-queries.ts "app/(manager)/[tenantSlug]/visitas/nueva/_components/items-step.tsx"
git commit -m "feat(salon): menú del staff con ruta de categoría y solo categorías con ítems"
```

---

### Task 12: Reglas de puntos — mostrar ruta de la categoría

**Files:**
- Modify: `app/(manager)/[tenantSlug]/puntos/_components/rules-list.tsx`
- (Si existe un editor de reglas con selector de categoría, modificarlo para usar `CategoryTreePicker` — ver Step 2.)

> **Motor de puntos: SIN cambios.** El match sigue por `category_id` directo (decisión #5). Solo cambia la **presentación** (mostrar ruta) para desambiguar categorías homónimas en distintas ramas.

- [ ] **Step 1: `rules-list.tsx` — describir con ruta**

`menu.categories` ahora trae `parent_id`. Reemplazar el `describe` de reglas por categoría para mostrar la ruta usando `categoryPathLabel`. Agregar import `import { categoryPathLabel } from '@/lib/menu/tree'` y cambiar:

```tsx
    if (typeof cfg.category_id === 'string') {
      const label = categoryPathLabel(menu.categories, cfg.category_id)
      return `Cat "${label || '???'}" → ${cfg.points as number} pts c/u`
    }
```

- [ ] **Step 2: Editor de reglas (si aplica)**

Localizar el componente que crea reglas por categoría (buscar usos de `category_id` en `app/(manager)/[tenantSlug]/puntos/_components/`). Si tiene un `<Select>` plano de categorías, reemplazarlo por `CategoryTreePicker` (sin `allowRoot`, value = `string | null`) para que el dueño elija exactamente la categoría (con ruta). Si no existe tal editor en esa carpeta, anotar en el PR que el alta de reglas por categoría se hace en otro lugar y aplicar el mismo cambio allí.

Run para localizar:
```bash
grep -rn "category_id" "app/(manager)/[tenantSlug]/puntos/"
```

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/puntos/"
git commit -m "feat(puntos): mostrar ruta completa de categoría en reglas (motor sin cambios)"
```

---

## Fase 6 — Tests RLS, verificación y cierre

### Task 13: Tests RLS de anidamiento y cascada

**Files:**
- Create: `tests/rls/menu-nesting.test.ts`

> Estos tests corren contra Supabase local (job `rls` de CI). Patrón: ver `tests/rls/loyalty.test.ts` para helpers (`createTenant`, `createUserClient`, `service`). Reproducir el setup de tenant + owner + cashier.

- [ ] **Step 1: Escribir el test RLS**

Crear `tests/rls/menu-nesting.test.ts` siguiendo el patrón de `tests/rls/loyalty.test.ts`. Cubrir:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// importar los mismos helpers que usa tests/rls/loyalty.test.ts
// (createTenant, createUserClient, service, uniqueSlug)

describe('RLS — anidamiento de categorías', () => {
  // beforeAll: crear tenantA con owner y cashier; crear categoría raíz "Bebidas"
  // y subcategoría "Vinos" (parent_id = bebidas) vía service; crear ítem "Malbec"
  // en Vinos; crear tenantB con owner.

  it('move_category: owner mueve subcategoría a raíz', async () => {
    // ownerA.client.rpc('move_category', { p_category_id: vinosId, p_new_parent_id: null })
    // → sin error; verificar parent_id = null
  })

  it('move_category: rechaza ciclo (mover Bebidas dentro de Vinos)', async () => {
    // ownerA.client.rpc('move_category', { p_category_id: bebidasId, p_new_parent_id: vinosId })
    // → error (cycle)
  })

  it('move_category: cashier no puede mover (owner-only)', async () => {
    // cashierA.client.rpc('move_category', ...) → error forbidden
  })

  it('move_category: no permite padre de otro tenant', async () => {
    // ownerA mueve vinos a una categoría de tenantB → error invalid_parent
  })

  it('delete_category_cascade: archiva ítem con historial y borra el resto', async () => {
    // crear visita con visit_items que referencie Malbec (vía service / RPC close_table)
    // ownerA.client.rpc('delete_category_cascade', { p_category_id: bebidasId })
    // → resumen.archived_items >= 1; Malbec sigue existiendo con category_id null y active false;
    //   las categorías del subárbol ya no existen; el visit_item sigue intacto.
  })

  it('delete_category_cascade: cashier no puede (owner-only)', async () => {
    // cashierA.client.rpc('delete_category_cascade', ...) → error forbidden
  })

  it('aislamiento: ownerB no ve categorías de tenantA', async () => {
    // ownerB.client.from('menu_categories').select().eq('id', bebidasId) → vacío
  })
})
```

Completar el setup concreto copiando el estilo de `loyalty.test.ts` (mismas importaciones y helpers reales del repo). Para crear el `visit_items` que referencia el ítem, usar el RPC `close_table` (firma `close_table(p_customer_id, p_items, p_notes)`) o insertar `visits` + `visit_items` vía `service`.

- [ ] **Step 2: Correr los tests RLS localmente**

Run: `npx supabase start` (si no está corriendo) y luego:
```bash
npx vitest run tests/rls/menu-nesting.test.ts
```
Expected: PASS (todos los casos). Si falla por setup, ajustar el seed siguiendo `loyalty.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/rls/menu-nesting.test.ts
git commit -m "test(rls): anidamiento de categorías — move/cascade/aislamiento owner-only"
```

---

### Task 14: Verificación final (DoD) + smoke manual

**Files:**
- Modify: `BACKLOG.md` (si quedaron mejoras anotadas)
- Create/Modify: README de la feature (sección en `docs/` o el README del módulo de menú)

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: PASS (los 18 warnings preexistentes de Biome siguen siendo warnings; no agregar nuevos).

- [ ] **Step 2: Smoke manual documentado (anotar resultados en el PR)**

1. `/[slug]/menu`: crear `Bebidas` (raíz). Entrar. Crear subcategoría `Vinos`. Dentro de `Vinos`, crear ítem `Malbec`.
2. Volver a `Bebidas`. Crear ítem directo `Agua` (mezcla libre: ítem + subcategoría conviven).
3. Reordenar subcategorías con drag dentro de un nivel; verificar que persiste.
4. "Mover a…": mover `Vinos` a la raíz y de vuelta a `Bebidas`. Intentar mover `Bebidas` dentro de `Vinos` → debe rechazar (ciclo).
5. Carta cliente (`/m/[qrToken]`): drill-down Carta → Bebidas (ve `Agua` + sección `Vinos`) → Vinos → `Malbec`. Breadcrumb sube. Buscar "malbec" lo encuentra.
6. Puntos: crear regla por categoría `Vinos`; ver que se muestra como "Bebidas › Vinos". Cerrar visita con `Malbec`; verificar puntos (solo ítems directos de `Vinos`).
7. Borrar `Bebidas` en cascada: confirmar; `Malbec` (si está en visita) queda archivado, `Agua` se borra; carta del cliente ya no muestra `Bebidas`; la visita pasada queda intacta.

- [ ] **Step 3: Actualizar tipos de prod + README**

Confirmar que `types/database.ts` quedó regenerado (Task 2). Escribir/actualizar el README de la feature (resumen de modelo y comportamiento del borrado en cascada). Anotar en `BACKLOG.md` las mejoras diferidas (paridad de pausado padre→hijo en staff; unicidad de nombres entre hermanos).

- [ ] **Step 4: Commit + push + PR**

```bash
git add -A
git commit -m "docs(carta): README de anidamiento + backlog de mejoras diferidas"
git push -u origin feat/carta-categorias-anidadas
```
Abrir PR con descripción completa (qué, decisiones, smoke manual con resultados, screenshots) y conventional commit title.

---

## Self-review del plan (cobertura del spec)

| Sección del spec | Task(s) |
|---|---|
| A. DB (parent_id, category_id nullable, índices) | Task 1 |
| A. RPC reorder/move/cascade/get_session_state | Task 1 |
| A. Tipos regenerados + alias | Task 2 |
| B. schemas (parent_id, move, reorder) | Task 4 |
| B. actions (create+parent, move, delete cascada, reorder) | Task 5 |
| B. queries (parent_id) + tree helper | Task 3, Task 4 |
| C. Editor drill-in + breadcrumb + subcats DnD | Task 7 |
| C. CategoryTreePicker | Task 6 |
| C. new-category-form parent, category-edit mover, item-edit ruta | Task 7, Task 8 |
| D. Cliente drill-down + category-card | Task 10 |
| D. m-session tipo + búsqueda con ruta | Task 9 |
| 7.2 Mozo/salón | Task 11 |
| 7.3 Puntos (picker con ruta, motor sin cambios) | Task 12 |
| E. Borrado en cascada seguro | Task 1 (RPC), Task 5 (action), Task 7 (UI) |
| F. Tests unit | Task 3, Task 4, Task 9 |
| F. Tests RLS | Task 13 |
| F. Smoke manual | Task 14 |

**Notas de consistencia de tipos:** `MenuCategory` gana `parent_id: string | null` (Task 4) — usado por `buildCategoryTree`/`categoryPath`/`flattenForPicker` (Task 3), `CategoryTreePicker` (Task 6), `MenuBoard` (Task 7), `rules-list` (Task 12). `reorderCategories(slug, parentId, ids)` (Task 5) ⇄ caller en `MenuBoard` (Task 7). `delete_category_cascade` retorna `{deleted_categories, archived_items, deleted_items}` (Task 1) ⇄ leído en `deleteCategory` (Task 5).

**Desviación del spec marcada:** Task 11 implementa el staff con "categorías-hoja etiquetadas por ruta" en lugar de drill-down (más simple y no-breaking para carga rápida). Confirmar con el usuario si prefiere drill-down estricto.
