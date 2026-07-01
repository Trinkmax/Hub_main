# Spec — Rediseño de Mensajería · Fase 0: IA y navegación

> Fecha: 2026-07-01 · Estado: **Diseño aprobado (esqueleto)**, pendiente de plan de implementación.
> Base: **`origin/main`** (prod, `hubbar.vercel.app`, commit `afae5d8`). **NO** sobre `feat/mensajeria` (snapshot 114 commits atrás, sólo docs).
> Rama de trabajo: **`feat/mensajeria-rediseno`**.
> Parte de un rediseño mayor de la superficie de Mensajería. **Este documento cubre sólo la capa transversal de IA/navegación + taxonomía.** Cada pantalla (Inbox, Difusiones, Flows, Audiencias, Config) tendrá su propio spec de rediseño después.

---

## 1. Contexto y problema

La mensajería se consolidó (2026-06-15) como un **grupo del sidebar apuntando a las rutas viejas**, no como una sección real. El resultado es incoherente. Problemas concretos (verificados en el código de prod):

1. **Tres taxonomías para una sola sección.** El sidebar dice **"Mensajería"**, pero las páginas se autotitulan `eyebrow="Marketing"` (difusiones, flows, audiencias — 10 páginas: `difusiones/{page,nueva/page,[id]/page}`, `flows/{page,nuevo/page,[id]/page}`, `audiencias/{page,nueva/page,[id]/page}`) y la bandeja dice `eyebrow="Hoy"`. Además sigue vivo un **hub muerto `/marketing`** (`app/(manager)/[tenantSlug]/marketing/page.tsx`, `title="Marketing"`).
2. **El sidebar expulsa a Configuración.** En `components/shell/nav-config.ts` el grupo "Mensajería" tiene como hijos "Mensajes rápidos" → `/configuracion/mensajes-rapidos` y "Canales y plantillas" → `/configuracion/canales`. Clickearlos te lleva al shell de Ajustes, con **otro menú lateral** (`settings-nav.tsx`). Salto de contexto.
3. **Duplicación.** Esos mismos ítems **también** están en el grupo "Mensajería" del `settings-nav.tsx`. Dos entradas, dos shells, para lo mismo.
4. **Miscategorización.** "Tags de carta" está en el grupo "Mensajería" de Ajustes, pero su código es el **gestor de tags del MENÚ** (`lib/item-tags`, `listMenuItemsWithTags`) — no tiene nada que ver con conversaciones. Y las **etiquetas de conversación** (tabla `conversation_tags`, ya usadas inline en el inbox) **no tienen página de gestión** (crear/renombrar/color).

**Objetivo:** que Mensajería se sienta como **un producto coherente** — un solo nombre, una sola navegación, y su configuración adentro de la sección.

---

## 2. Decisión

**Opción elegida: B — Sección con sub-nav lateral** (mismo patrón que Configuración).

Alternativas consideradas:
- **A — Hub con tabs internos:** más consolidado, pero los tabs aprietan en mobile y es el refactor más grande.
- **C — Arreglo en el lugar:** liviano, pero la sección sigue sintiéndose como páginas sueltas.

**Por qué B:** coherente y escalable; reusa un patrón ya existente y probado (`settings-nav`); mantiene rutas deep-linkables; y le da un hogar limpio a la config de mensajería sin sacar al usuario de la sección.

---

## 3. Arquitectura de la sección

### 3.1 Shell
- Nuevo route group `app/(manager)/[tenantSlug]/mensajeria/` con `layout.tsx` que renderiza **sub-nav lateral + contenido**.
- **Sidebar:** un solo ítem **"Mensajería"** (grupo *Hoy*), **sin children**, `href → /{slug}/mensajeria` (default: Inbox). Se quitan los 6 children actuales de `nav-config.ts`.
- **Sub-nav:** client component al estilo `settings-nav.tsx`, con active-state por longest-prefix (`pathname === href || startsWith(href + '/')`).
- **Inbox a lo ancho:** en `/mensajeria/inbox` el layout **colapsa el sub-nav a un riel de íconos** (o lo oculta con un toggle) para dar ancho a la lista + thread. Las demás sub-rutas muestran el sub-nav completo. El comportamiento exacto se afina en el spec del Inbox; **default: maximizar ancho** del Inbox.

### 3.2 Sub-nav — estructura y roles

```
MENSAJERÍA
  Inbox                     roles: todos (owner, cashier)   [default de la sección]

  CAMPAÑAS                  (rótulo de grupo — provisional)
  Difusiones                roles: owner
  Flows                     roles: owner
  Audiencias                roles: owner

  CONFIGURACIÓN             (rótulo de grupo)
  Canales                   roles: owner
  Plantillas                roles: owner
  Mensajes rápidos          roles: owner, cashier
  Etiquetas                 roles: owner, cashier
```

- El filtrado por rol reusa la lógica existente (`itemVisible`/roles). El **cajero** ve `Inbox` + `Mensajes rápidos`; el **dueño** ve todo.
- Íconos: reusar los keys de `nav-icons.ts` ya asignados (Inbox, Megaphone, Workflow, UsersRound, Settings2, MessageSquareText) + uno para Etiquetas (`Tag`/`Tags`).
- **Rótulos de grupo provisionales** ("Campañas"/"Configuración"): a confirmar en review. "Flows" no es estrictamente una campaña.

### 3.3 Rutas y redirects

Las rutas se mueven bajo `/mensajeria/*`; **las viejas redirigen (308 permanente)** para no romper links, bookmarks ni el historial del navegador.

| Ruta vieja | Ruta nueva |
|---|---|
| `/bandeja` (+ subrutas) | `/mensajeria/inbox` |
| `/difusiones` (+ `/nueva`, `/[id]`) | `/mensajeria/difusiones/…` |
| `/flows` (+ `/nuevo`, `/[id]`) | `/mensajeria/flows/…` |
| `/audiencias` (+ `/nueva`, `/[id]`) | `/mensajeria/audiencias/…` |
| `/configuracion/canales` | `/mensajeria/canales` |
| `/configuracion/templates` | `/mensajeria/plantillas` |
| `/configuracion/mensajes-rapidos` | `/mensajeria/mensajes-rapidos` |
| *(nueva)* | `/mensajeria/etiquetas` |
| `/configuracion/tags` (item-tags) | `/menu/tags` *(fuera de mensajería — es del catálogo)* |
| `/marketing` | *(retirada; redirect → `/mensajeria`)* |

- **Mecánica:** mover las **carpetas enteras** de `app/(manager)/[tenantSlug]/{bandeja,difusiones,flows,audiencias}` a `mensajeria/{inbox,difusiones,flows,audiencias}` (arrastra `loading.tsx`, `_components/`, etc.). Las páginas de config (`canales`, `templates`, `mensajes-rapidos`) se mueven de `configuracion/` a `mensajeria/`.
- **Redirects:** declarar en `next.config` (`redirects()`), permanentes. Preferir redirect a nivel config sobre `proxy.ts` para no cargar el matcher de auth.
- **Item-tags:** la página `configuracion/tags` se **reubica en Menú** (`/menu/tags` o sub-vista de `/menu`), conservando su lógica (`lib/item-tags`).

### 3.4 Etiquetas de conversación (hogar nuevo)
- Nueva página `/mensajeria/etiquetas`: **CRUD de `conversation_tags`** (crear / renombrar / color / borrar). El backend ya existe (tabla `conversation_tags` + `setConversationTags` diff-based); falta la gestión.
- **Color:** restringir a una **paleta curada** (no `<input type=color>` de hex crudo). La auditoría marcó que el hex libre, usado como texto + fondo tint ~15%, se saltea la gobernanza de contraste de los tokens OKLCH. Ofrecer ~8–12 colores del sistema.

---

## 4. Limpieza / taxonomía (parte de esta fase)
- **Eyebrow único "Mensajería"** en las 10 páginas (`PageHeader eyebrow`). Retirar `"Marketing"` y el `"Hoy"` de la bandeja. (Opcional: eyebrow contextual `"Mensajería · Difusiones"` en detalles.)
- **Retirar el hub muerto `/marketing`** (page + cualquier link entrante).
- **Mover "Tags de carta" a Menú** (ver §3.3).
- **Quitar el grupo "Mensajería" del `settings-nav.tsx`** de Configuración (queda Equipo + Apariencia + lo demás de ajustes).
- **Actualizar** `command-palette/command-config.ts` (⌘K: inbox/difusiones/audiencias/flows/new-broadcast/new-flow → rutas nuevas), `nav-config.ts`, `nav-icons.ts` (si falta un ícono), y **links internos** (buscar usos de `/bandeja`, `/difusiones`, `/flows`, `/audiencias`, `/configuracion/{canales,templates,mensajes-rapidos}` — p. ej. el `ContactButton` que hoy apunta a `/bandeja`).

---

## 5. Touch-points (archivos)
- `components/shell/nav-config.ts` — colapsar el grupo Mensajería a un solo ítem.
- `components/shell/nav-icons.ts` — asegurar ícono de Etiquetas.
- `app/(manager)/[tenantSlug]/configuracion/_components/settings-nav.tsx` — quitar grupo Mensajería.
- `components/command-palette/command-config.ts` — repuntar comandos + keyword `mensajeria`.
- Mover carpetas: `bandeja→mensajeria/inbox`, `difusiones→mensajeria/difusiones`, `flows→mensajeria/flows`, `audiencias→mensajeria/audiencias`; `configuracion/{canales,templates,mensajes-rapidos}→mensajeria/{canales,plantillas,mensajes-rapidos}`; `configuracion/tags→menu/tags`.
- Nuevo `app/(manager)/[tenantSlug]/mensajeria/layout.tsx` + sub-nav + `mensajeria/page.tsx` (redirect a inbox).
- Nuevo `app/(manager)/[tenantSlug]/mensajeria/etiquetas/` (CRUD conversation_tags) + `lib/conversation-tags/*` (extender con create/rename/delete si no existen).
- `next.config.*` — redirects 308.
- Eyebrows en las 10 páginas.
- Borrar `app/(manager)/[tenantSlug]/marketing/`.
- (Limpieza oportunista, opcional) borrar el inbox huérfano del salón `app/(salon)/[tenantSlug]/salon/bandeja/*` (spec original ya lo pedía; hoy sigue).

---

## 6. Fuera de alcance (este spec)
- **Rediseño visual/estados de cada pantalla** (Inbox, Difusiones, Flows, Audiencias, Config) → un spec por pantalla.
- **Los fixes operativos/seguridad críticos** de la auditoría (opt-in en flows, inyección SQL en audiencias, envíos duplicados, métricas congeladas, conversación partida por `wa_id`, `is_blocked`, etc.) → track aparte, no se tocan acá.
- **Instagram** (sigue sólo modelado).

---

## 7. Validación (smoke manual, CLAUDE.md §10/§11)
1. El sidebar muestra **un solo "Mensajería"**; clickearlo abre el Inbox dentro de la sección.
2. El sub-nav navega entre Inbox / Difusiones / Flows / Audiencias / Canales / Plantillas / Mensajes rápidos / Etiquetas **sin salir de la sección** (mismo shell).
3. Las rutas viejas **redirigen**: probar `/bandeja`, `/difusiones/nueva`, `/configuracion/canales`, `/marketing`.
4. **Roles:** con un usuario `cashier`, el sub-nav muestra **sólo** Inbox + Mensajes rápidos.
5. **⌘K** lleva a las rutas nuevas.
6. **"Tags de carta"** aparece en **Menú**, no en Mensajería; su CRUD sigue funcionando.
7. `/mensajeria/etiquetas` crea/edita una etiqueta de conversación y se ve en el inbox.
8. Inbox: al abrirlo, gana ancho (sub-nav colapsado a riel).

---

## 8. Riesgos y mitigaciones
- **Ruta olvidada = link muerto.** Muchos redirects + links internos. → Grep exhaustivo de las rutas viejas antes de mergear + redirects declarados para todas.
- **Mover páginas rompe imports/loading.** → Mover **carpetas enteras**, no archivos sueltos; correr typecheck.
- **Sub-nav + inbox two-pane en pantallas chicas.** → Colapso del riel en `/mensajeria/inbox` (default: maximizar); afinar en el spec del Inbox.
- **`conversation_tags` sin gestión previa.** → La página nueva es greenfield; validar RLS/roles de las nuevas server actions de CRUD.

---

## 9. Roadmap del rediseño (contexto, no scope de este spec)
- **Fase 0 (este spec):** IA + shell + taxonomía.
- Luego, un spec por pantalla, en orden sugerido: **Inbox → Difusiones (+ Audiencias) → Flows → Config**. Cada uno con su brainstorm → spec → plan.
- En paralelo (track separado, prioridad del negocio): los **críticos operativos/seguridad** de la auditoría.
