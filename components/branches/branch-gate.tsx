'use client'

import { LoaderCircle, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type CSSProperties, useCallback, useEffect, useState, useTransition } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { setBranchScope } from '@/lib/branches/actions'
import { type BranchPulses, pulseLine } from '@/lib/branches/pulse-line'
import { type BranchRef, branchShortLabel } from '@/lib/branches/types'
import { cn } from '@/lib/utils'
import { BranchAwning } from './awning'
import { Storefront } from './storefront'
import './branches.css'

/**
 * «¿A dónde entrás hoy?»: la primera pantalla de un equipo que todavía no eligió sucursal, cuando la persona tiene
 * más de una. Es la cuadra: una vidriera por sucursal con la persiana a media altura y cómo viene el día. Al elegir,
 * la persiana sube entera y entrás. Los dueños pueden entrar a «Todas juntas». Este equipo se acuerda; después se
 * cambia desde la píldora de arriba (o con ⌥S).
 *
 * Se dibuja en lugar del panel (no es otra dirección): al elegir se vuelve a pedir la misma pantalla y un link
 * directo llega a donde iba.
 */

const SHUTTER_MS = 520

export function BranchGate({
  slug,
  tenantName,
  branches,
  canAll,
  pulses,
  email,
  signOut,
  surface = 'view',
}: {
  slug: string
  tenantName: string
  branches: ReadonlyArray<BranchRef>
  canAll: boolean
  pulses: BranchPulses | null
  email: string
  signOut: () => Promise<void>
  /**
   * `view` (el panel): «¿A dónde entrás hoy?», con «Todas juntas» si corresponde. `device` (el salón): «¿Dónde
   * trabajás hoy?», siempre una: el mapa, la caja y la tele son de un lugar.
   */
  surface?: 'view' | 'device'
}) {
  const router = useRouter()
  const [chosen, setChosen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const choose = useCallback(
    (choice: string) => {
      if (pending || chosen) return
      setChosen(choice)
      setError(null)
      startTransition(async () => {
        const [result] = await Promise.all([
          setBranchScope(slug, choice, surface),
          new Promise((resolve) => setTimeout(resolve, SHUTTER_MS)),
        ])
        if (!result.ok) {
          setChosen(null)
          setError(result.message)
          return
        }
        router.refresh()
      })
    },
    [chosen, pending, router, slug],
  )

  // 1, 2… elige una sucursal; 0, todas juntas.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return
      if (event.key === '0' && canAll && surface === 'view') {
        event.preventDefault()
        choose('all')
        return
      }
      const index = Number(event.key) - 1
      const branch = Number.isInteger(index) ? branches[index] : undefined
      if (branch) {
        event.preventDefault()
        choose(branch.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [branches, canAll, choose])

  return (
    <main className="branch-gate bg-app-gradient">
      <div className="w-full max-w-[34rem] sm:max-w-3xl">
        <header className="mb-7 text-center sm:mb-9">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {tenantName}
          </p>
          <h1 className="font-display text-[2rem] leading-[1.05] font-semibold text-balance sm:text-[2.6rem]">
            {surface === 'device' ? '¿Dónde trabajás hoy?' : '¿A dónde entrás hoy?'}
          </h1>
          <p className="mx-auto mt-3 max-w-[26rem] text-sm text-balance text-muted-foreground">
            {surface === 'device'
              ? 'Elegí la sucursal. Este equipo se acuerda: el mapa, la caja y la cocina van a ser de ahí.'
              : 'Elegí la sucursal. Este equipo se acuerda y la cambiás cuando quieras desde arriba.'}
          </p>
        </header>

        <ul
          className="branch-gate-street"
          style={{ '--gate-columns': Math.min(branches.length, 3) } as CSSProperties}
        >
          {branches.map((branch, index) => {
            const isChosen = chosen === branch.id
            const meta = pulseLine(pulses?.[branch.id])
            return (
              <li key={branch.id}>
                <button
                  type="button"
                  className="branch-gate-door w-full"
                  data-chosen={isChosen ? '' : undefined}
                  disabled={pending && !isChosen}
                  onClick={() => choose(branch.id)}
                  style={{ '--option-color': branch.color } as CSSProperties}
                >
                  <Storefront
                    label={branchShortLabel(branch)}
                    color={branch.color}
                    open={isChosen ? 1 : 0.42}
                    principal={branch.isDefault}
                  />
                  <span className="flex min-w-0 flex-1 flex-col items-center gap-1 max-sm:items-start">
                    <span className="branch-gate-door-name">{branch.name}</span>
                    {branch.address ? (
                      <span className="text-[13px] text-muted-foreground">{branch.address}</span>
                    ) : null}
                    {meta ? (
                      <span className="text-[13px] font-medium text-foreground/80">{meta}</span>
                    ) : null}
                  </span>
                  <span className="max-sm:hidden" aria-hidden>
                    {isChosen && pending ? (
                      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Kbd>{index + 1}</Kbd>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {canAll && surface === 'view' ? (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={() => choose('all')}
              disabled={pending && chosen !== 'all'}
              className={cn(
                'inline-flex h-11 items-center gap-2.5 rounded-full border border-border bg-card/80 px-5 text-sm font-medium shadow-xs transition-colors',
                'hover:bg-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              )}
            >
              <BranchAwning
                colors={branches.map((branch) => branch.color)}
                className="h-3.5 w-[1.35rem]"
              />
              Ver todas juntas
              {chosen === 'all' && pending ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <Kbd className="max-sm:hidden">0</Kbd>
              )}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-center text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Entrás como {email}</span>
          <span aria-hidden>·</span>
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded underline-offset-2 hover:text-foreground hover:underline"
            >
              <LogOut className="size-3" aria-hidden />
              Salir
            </button>
          </form>
        </footer>
      </div>
    </main>
  )
}
