'use client'

import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { setActiveBranch } from '@/lib/pos/actions'
import './branch-chooser.css'

type Choice = { id: string; name: string; color: string; address: string | null }

/**
 * «¿Dónde trabajás hoy?» Aparece una sola vez por dispositivo, cuando el bar tiene más de una sucursal y
 * este dispositivo todavía no eligió. Después no pregunta más: la tele y la caja son de una sucursal, y
 * quien trabaja en las dos la cambia desde la barra de arriba.
 */
export function BranchChooser({
  slug,
  branches,
  fill = 'tabbar',
}: {
  slug: string
  branches: ReadonlyArray<Choice>
  /** `screen` cuando la pantalla no lleva nada alrededor (la tele); `tabbar` deja lugar a las pestañas. */
  fill?: 'tabbar' | 'screen'
}) {
  const router = useRouter()
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const choose = (id: string) => {
    if (pending) return
    setPicked(id)
    setError(null)
    startTransition(async () => {
      const result = await setActiveBranch(slug, id)
      if (!result.ok) {
        setPicked(null)
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="pos-where" data-fill={fill}>
      <div className="pos-where-inner">
        <h1>¿Dónde trabajás hoy?</h1>
        <ul className="pos-where-list">
          {branches.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                className="pos-where-btn"
                style={{ ['--branch' as string]: branch.color }}
                disabled={pending}
                onClick={() => choose(branch.id)}
              >
                <span>
                  <span className="pos-where-name">{branch.name}</span>
                  {branch.address ? <span className="pos-where-addr">{branch.address}</span> : null}
                </span>
                <span className="pos-where-go" aria-hidden>
                  {pending && picked === branch.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ArrowRight />
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="pos-where-error" role="alert">
            {error} Probá de nuevo.
          </p>
        ) : null}
        <p className="pos-where-note">
          {fill === 'screen'
            ? 'Esta pantalla se queda con la sucursal que elijas. Para cambiarla después, elegí la otra desde el mapa del salón.'
            : 'Este dispositivo se acuerda de lo que elijas. Para pasar a la otra sucursal, tocá su nombre arriba a la izquierda.'}
        </p>
      </div>
    </div>
  )
}
