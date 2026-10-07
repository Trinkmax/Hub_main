'use client'

import { ArrowUpRight, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { type ComponentProps, useEffect, useId, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { computeActiveHrefs } from './nav-active'
import type { ResolvedNavGroup, ResolvedNavItem } from './nav-config'
import { NAV_ICONS } from './nav-icons'

/**
 * Preferencia de grupos expandidos/colapsados. El grupo con la ruta activa se
 * abre siempre (la preferencia no puede "esconder" dónde estás parado).
 */
const STORAGE_KEY = 'hub:nav:groups'

function readGroupPrefs(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // storage bloqueado o JSON corrupto → arrancamos de cero
  }
  return {}
}

/** La clave es el id estable del grupo; hasta oct 2026 era la etiqueta (se sigue leyendo). */
function readGroupPref(group: ResolvedNavGroup): boolean | undefined {
  const prefs = readGroupPrefs()
  const byId = group.id ? prefs[group.id] : undefined
  if (typeof byId === 'boolean') return byId
  const byLabel = prefs[group.label]
  return typeof byLabel === 'boolean' ? byLabel : undefined
}

function writeGroupPref(group: ResolvedNavGroup, open: boolean): void {
  try {
    const prefs = readGroupPrefs()
    if (group.id) delete prefs[group.label]
    prefs[group.id ?? group.label] = open
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // sin storage no persistimos, el toggle igual funciona en memoria
  }
}

/**
 * Foco «adentro» (§3.0): las filas van pegadas entre sí y un contorno de
 * afuera se cortaría contra la vecina (y contra el `overflow-hidden` del
 * acordeón). Antes los botones de grupo y de despliegue no tenían anillo.
 */
const FOCUS_INSIDE = 'outline-(--ring) -outline-offset-2 focus-visible:outline-2'

/** Lo que cambia de color al pasar el mouse: 150 ms y solo colores (§2.10). */
const COLOR_TRANSITION = 'transition-colors duration-(--duration-quick)'

const ROW_IDLE = 'text-muted-foreground hover:bg-hover hover:text-foreground'
const ROW_ACTIVE = 'bg-selected text-foreground'

/**
 * Una fila del menú: 32 px (28 los hijos) con mouse y 44 con el dedo; en el
 * cajón del celular, 44 siempre. `min-h` y no `h`: con el espaciado de texto
 * del usuario (WCAG 1.4.12) el texto puede crecer.
 */
function rowClass({ touch, child }: { touch: boolean; child: boolean }) {
  return cn(
    'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 text-left font-medium',
    child ? 'min-h-7 type-small' : 'min-h-8 type-body',
    touch ? 'min-h-11' : 'pointer-coarse:min-h-11',
    COLOR_TRANSITION,
    FOCUS_INSIDE,
  )
}

/** Chevron de 14 px que gira 90° en 150 ms (instantáneo con «reducir movimiento»). */
function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      className={cn(
        'size-3.5 shrink-0 transition-transform duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
        open && 'rotate-90',
        className,
      )}
      aria-hidden="true"
    />
  )
}

export function SidebarNav({
  groups,
  onNavigate,
  touch = false,
  className,
}: {
  groups: ResolvedNavGroup[]
  onNavigate?: () => void
  /** El cajón del celular: todas las filas a 44 px. */
  touch?: boolean
  className?: string
}) {
  const pathname = usePathname()
  // `useSearchParams` para que los hijos por `?segment=` desempaten bien y no
  // queden dos seleccionados a la vez. El subtree se monta en rutas dynamic.
  const search = useSearchParams().toString()
  const activeHrefs = useMemo(
    () => computeActiveHrefs(pathname, search, groups),
    [pathname, search, groups],
  )

  return (
    <div className={cn('flex flex-col gap-4 px-3 py-4', className)}>
      {groups.map((group) =>
        group.collapsible ? (
          <CollapsibleGroup
            key={group.id ?? group.label}
            group={group}
            activeHrefs={activeHrefs}
            onNavigate={onNavigate}
            touch={touch}
          />
        ) : (
          <StaticGroup
            key={group.id ?? group.label}
            group={group}
            activeHrefs={activeHrefs}
            onNavigate={onNavigate}
            touch={touch}
          />
        ),
      )}
    </div>
  )
}

function groupContainsActive(group: ResolvedNavGroup, activeHrefs: Set<string>): boolean {
  return group.items.some(
    (item) =>
      (!item.newTab && activeHrefs.has(item.href)) ||
      (item.children?.some((c) => !c.newTab && activeHrefs.has(c.href)) ?? false),
  )
}

type GroupProps = {
  group: ResolvedNavGroup
  activeHrefs: Set<string>
  onNavigate?: () => void
  touch: boolean
}

/**
 * Título de grupo: la única mayúscula espaciada del panel (`type-group`, 12 px,
 * 0.08em), en texto de apoyo. El grupo anclado («Sistema») va sin título.
 */
function StaticGroup({ group, activeHrefs, onNavigate, touch }: GroupProps) {
  const headingId = useId()
  if (group.pinned) {
    return (
      <GroupItems
        group={group}
        activeHrefs={activeHrefs}
        onNavigate={onNavigate}
        touch={touch}
        aria-label={group.label}
      />
    )
  }
  return (
    <div>
      <div
        id={headingId}
        className="flex min-h-7 items-center px-2.5 type-group text-subtle-foreground"
      >
        {group.label}
      </div>
      <GroupItems
        group={group}
        activeHrefs={activeHrefs}
        onNavigate={onNavigate}
        touch={touch}
        aria-labelledby={headingId}
      />
    </div>
  )
}

function CollapsibleGroup({ group, activeHrefs, onNavigate, touch }: GroupProps) {
  const containsActive = groupContainsActive(group, activeHrefs)
  // SSR y primer render cliente coinciden (sólo dependen de la ruta activa);
  // la preferencia guardada se aplica recién después del mount.
  const [open, setOpen] = useState(containsActive)
  const headingId = useId()
  const contentId = useId()

  // biome-ignore lint/correctness/useExhaustiveDependencies: sólo al montar — aplica la preferencia guardada una vez
  useEffect(() => {
    const pref = readGroupPref(group)
    if (typeof pref === 'boolean') setOpen(pref || containsActive)
  }, [])

  // Navegar hacia adentro de un grupo colapsado lo abre (nunca escondemos la
  // ubicación actual). No pisa la preferencia guardada: es apertura contextual.
  useEffect(() => {
    if (containsActive) setOpen(true)
  }, [containsActive])

  const toggle = () => {
    setOpen((v) => {
      writeGroupPref(group, !v)
      return !v
    })
  }

  return (
    <div>
      <button
        type="button"
        id={headingId}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn(
          'flex min-h-7 w-full items-center justify-between gap-2 rounded-md px-2.5 type-group text-subtle-foreground hover:bg-hover hover:text-foreground',
          touch ? 'min-h-11' : 'pointer-coarse:min-h-11',
          COLOR_TRANSITION,
          FOCUS_INSIDE,
        )}
      >
        <span className="flex items-center gap-2">
          {group.label}
          {!open && containsActive ? (
            <>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              <span className="sr-only">, acá está la página abierta</span>
            </>
          ) : null}
        </span>
        <Chevron open={open} />
      </button>
      {/* Plegado: `inert` lo saca del orden de Tab y del árbol accesible (antes
          los links seguían enfocables, recortados). Se anima la altura con
          grid-template-rows 0fr → 1fr en 150 ms. */}
      <div
        id={contentId}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows] duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <GroupItems
            group={group}
            activeHrefs={activeHrefs}
            onNavigate={onNavigate}
            touch={touch}
            aria-labelledby={headingId}
            className="pt-0.5"
          />
        </div>
      </div>
    </div>
  )
}

function GroupItems({
  group,
  activeHrefs,
  onNavigate,
  touch,
  className,
  ...props
}: GroupProps & Pick<ComponentProps<'ul'>, 'aria-label' | 'aria-labelledby' | 'className'>) {
  return (
    <ul className={cn('flex flex-col gap-0.5', className)} {...props}>
      {group.items.map((item) =>
        item.children?.length ? (
          <SidebarParent
            key={item.label}
            item={item}
            activeHrefs={activeHrefs}
            onNavigate={onNavigate}
            touch={touch}
          />
        ) : (
          <li key={item.label}>
            <SidebarLink
              item={item}
              active={!item.newTab && activeHrefs.has(item.href)}
              onNavigate={onNavigate}
              touch={touch}
            />
          </li>
        ),
      )}
    </ul>
  )
}

function SidebarParent({
  item,
  activeHrefs,
  onNavigate,
  touch,
}: {
  item: ResolvedNavItem
  activeHrefs: Set<string>
  onNavigate?: () => void
  touch: boolean
}) {
  const children = item.children ?? []
  const childActive = children.some((c) => !c.newTab && activeHrefs.has(c.href))
  const selfActive = !item.newTab && activeHrefs.has(item.href)
  const [open, setOpen] = useState(selfActive || childActive)
  const childrenId = useId()
  const Icon = NAV_ICONS[item.iconKey]

  // El shell persiste entre navegaciones: si un hijo pasa a activo después de
  // montar (desde ⌘K o un link de la página), el padre se abre. Antes quedaba
  // cerrado y sin ningún indicador (el padre apaga su resaltado cuando hay un
  // hijo activo).
  useEffect(() => {
    if (childActive) setOpen(true)
  }, [childActive])

  return (
    <li>
      {item.expanderOnly ? (
        // Padre puro-agrupador: clickearlo SÓLO expande (no navega).
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={childrenId}
          className={cn(
            rowClass({ touch, child: false }),
            childActive && !open ? 'text-foreground hover:bg-hover' : ROW_IDLE,
          )}
        >
          <Icon
            className={cn('size-4 shrink-0', childActive && 'text-primary')}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {childActive && !open ? (
            <span className="sr-only">, acá está la página abierta</span>
          ) : null}
          <Chevron open={open} className="text-subtle-foreground" />
        </button>
      ) : (
        <div className="flex items-center gap-0.5">
          <SidebarLink
            item={{ ...item, children: undefined }}
            active={selfActive && !childActive}
            onNavigate={onNavigate}
            touch={touch}
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={`Subpáginas de ${item.label}`}
            aria-expanded={open}
            aria-controls={childrenId}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-hover hover:text-foreground',
              touch ? 'size-11' : 'size-7 pointer-coarse:size-11',
              COLOR_TRANSITION,
              FOCUS_INSIDE,
            )}
          >
            <Chevron open={open} />
          </button>
        </div>
      )}
      {/* Sangría de 28 px con una guía de un pelo alineada al centro del ícono
          del padre (px-2.5 + 8 px). Cerrado: `hidden` (fuera de Tab y del
          árbol accesible), sin animación. */}
      <ul
        id={childrenId}
        hidden={!open}
        className="mt-0.5 ml-[17px] flex flex-col gap-0.5 border-l border-border pl-2.5"
      >
        {children.map((child) => (
          <li key={child.label}>
            <SidebarLink
              item={child}
              active={!child.newTab && activeHrefs.has(child.href)}
              onNavigate={onNavigate}
              touch={touch}
              child
            />
          </li>
        ))}
      </ul>
    </li>
  )
}

function SidebarLink({
  item,
  active,
  onNavigate,
  touch,
  child = false,
  className,
}: {
  item: ResolvedNavItem
  active: boolean
  onNavigate?: () => void
  touch: boolean
  /** Fila de hijo: 28 px, `type-small`, la barra de activo cae sobre la guía. */
  child?: boolean
  className?: string
}) {
  const Icon = NAV_ICONS[item.iconKey]

  if (item.newTab) {
    // A otra pestaña siempre con `<a>`: lo público y el salón tienen su propio
    // `<html>` (tema y avisos), así que nunca se llega con una navegación
    // blanda, y tampoco hace falta prefetch.
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={cn(rowClass({ touch, child }), ROW_IDLE, className)}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ArrowUpRight
          className="size-3.5 shrink-0 text-subtle-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="sr-only">, abre en otra pestaña</span>
      </a>
    )
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(rowClass({ touch, child }), active ? ROW_ACTIVE : ROW_IDLE, className)}
    >
      {active ? (
        // La barra de 2 px de «estás acá». En alto contraste los fondos se
        // borran: la barra toma el color de selección del sistema.
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-1.5 w-0.5 rounded-full bg-primary forced-colors:bg-[Highlight]',
            child ? '-left-[11px]' : 'left-0',
          )}
        />
      ) : null}
      <Icon
        className={cn('size-4 shrink-0', active && 'text-primary')}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  )
}
