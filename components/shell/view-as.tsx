'use client'

import { Check, Eye, Loader2 } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { VIEW_AS_CHOICES } from '@/lib/tenant/view-as'
import { setViewAs } from '@/lib/tenant/view-as-actions'
import { cn } from '@/lib/utils'

/**
 * «Ver como» en el shell (lib/tenant/view-as.ts). Los layouts del panel y del salón ponen el
 * estado en este contexto; el menú de usuario y la hoja «Tu cuenta» del salón lo leen. Así las
 * pantallas del punto de venta, que arman su propia barra con la misma hoja, lo traen sin
 * cambios.
 */
export type ViewAsState = {
  slug: string
  /** El rol que se está mirando, o null (es el dueño de siempre). */
  viewAs: TenantRole | null
}

const ViewAsContext = createContext<ViewAsState | null>(null)

/** `value` en null: esta persona no puede usar «Ver como» y no se muestra nada. */
export function ViewAsProvider({
  value,
  children,
}: {
  value: ViewAsState | null
  children: React.ReactNode
}) {
  return <ViewAsContext value={value}>{children}</ViewAsContext>
}

export function useViewAs(): ViewAsState | null {
  return useContext(ViewAsContext)
}

/** Cambia de rol. Si sale bien, la action redirige; si no, avisa. */
export function useSwitchViewAs(slug: string) {
  const [pending, startTransition] = useTransition()
  const switchTo = (role: TenantRole) =>
    startTransition(async () => {
      const result = await setViewAs(slug, role)
      if (result && !result.ok) toast.error(result.error)
    })
  return { pending, switchTo }
}

/**
 * El punto en el avatar mientras se mira otro rol. Chico a propósito: el panel tiene que verse
 * como lo ve esa persona (es para grabar tutoriales), pero vos tenés que poder darte cuenta.
 */
export function ViewAsDot({ className }: { className?: string }) {
  const state = useViewAs()
  if (!state?.viewAs) return null
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background',
          className,
        )}
      />
      <span className="sr-only">Estás viendo el panel como {ROLE_LABELS[state.viewAs]}</span>
    </>
  )
}

/**
 * Los roles en la hoja «Tu cuenta» del salón: botones grandes, uno por rol, para el pulgar.
 * El activo queda marcado (aria-pressed). Cuando termina el cambio (o falla) avisa con
 * `onSettled`, para que la hoja se cierre: si el rol nuevo también vive en el salón, la hoja no
 * se desmonta sola.
 */
export function ViewAsSheetSection({ onSettled }: { onSettled?: () => void }) {
  const state = useViewAs()
  const { pending, switchTo } = useSwitchViewAs(state?.slug ?? '')
  const [target, setTarget] = useState<TenantRole | null>(null)
  const wasPending = useRef(false)

  useEffect(() => {
    if (wasPending.current && !pending) {
      setTarget(null)
      onSettled?.()
    }
    wasPending.current = pending
  }, [pending, onSettled])

  if (!state) return null
  const current: TenantRole = state.viewAs ?? 'owner'

  return (
    <section aria-labelledby="view-as-title" className="px-4 pb-3">
      <h3
        id="view-as-title"
        className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        <Eye className="size-3.5" aria-hidden />
        Ver como
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {VIEW_AS_CHOICES.map(({ role, lands }) => {
          const active = role === current
          const going = pending && target === role
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              aria-busy={going || undefined}
              disabled={pending}
              onClick={() => {
                if (active) return
                setTarget(role)
                switchTo(role)
              }}
              className={cn(
                'flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-[transform,background-color,border-color] active:scale-[0.98] disabled:opacity-60',
                active
                  ? 'border-primary/50 bg-primary/10'
                  : 'border-border/70 bg-card hover:bg-muted/60',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {role === 'owner' ? 'Dueño (vos)' : ROLE_LABELS[role]}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{lands}</span>
              </span>
              {going ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : active ? (
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
