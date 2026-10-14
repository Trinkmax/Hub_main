'use client'

import { Plus } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { cn } from '@/lib/utils'
import { admFabFromFrame } from './adm-nav-model'
import { LauncherButton } from './launcher'

/** Desde cuánto scroll el flotante se achica, y hasta dónde hay que volver para que se abra. */
const SHRINK_AFTER_PX = 80
const GROW_BEFORE_PX = 16

/** ¿La página ya bajó? Con dos umbrales, para que no titile justo en el borde. */
function useScrolledDown(): boolean {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setDown((was) => (was ? y > GROW_BEFORE_PX : y > SHRINK_AFTER_PX))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return down
}

/**
 * «＋ Cargar» flotante del celular: abre el lanzador «¿Qué querés cargar?». Abajo a la derecha,
 * por encima del área segura del iPhone; desde `lg` no se ve, porque «Cargar» está en la barra.
 *
 * - Arriba de todo es una píldora con la palabra. Al bajar se achica a un círculo con el «＋»
 *   (ya se sabe qué es) y tapa menos de lo que estás leyendo; al volver arriba se abre de nuevo.
 * - Lleva un aro del color del fondo: lo despega de lo que tenga debajo, sea un botón del mismo
 *   verde o el panel oscuro.
 * - Deja su propio espacio al final de la página, para que lo último se pueda leer sin el botón
 *   encima. Las hojas (z-50, con su fondo) lo tapan mientras están abiertas.
 */
export function LauncherFab() {
  const small = useScrolledDown()
  return (
    <>
      <div aria-hidden="true" className="h-24 lg:hidden" />
      <LauncherButton className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-30 h-14 min-w-14 gap-0 px-0 text-base shadow-lg ring-4 ring-background lg:hidden">
        {/* Chico: 18 + 20 + 18 = 56, un círculo. Grande: el aire de siempre a cada lado. */}
        <span
          aria-hidden="true"
          data-small={small ? '' : undefined}
          className={cn(
            'flex h-14 shrink-0 items-center pr-2 pl-5 data-small:px-[18px]',
            'transition-[padding] duration-200 ease-(--ease-out) motion-reduce:transition-none',
          )}
        >
          <Plus className="size-5" />
        </span>
        {/* La palabra se pliega (0fr) sin salir del botón: sigue siendo su nombre accesible. */}
        <span
          data-small={small ? '' : undefined}
          className={cn(
            'grid grid-cols-[1fr] data-small:grid-cols-[0fr]',
            'transition-[grid-template-columns] duration-200 ease-(--ease-out) motion-reduce:transition-none',
          )}
        >
          <span className="min-w-0 overflow-hidden">
            <span className="block pr-5">Cargar</span>
          </span>
        </span>
      </LauncherButton>
    </>
  )
}

/**
 * El flotante que pone el MARCO de la sección (el layout), para que esté siempre en el mismo
 * lugar en todas las pantallas de primer nivel, sin depender de que cada página se acuerde de
 * ponerlo. La regla vive en `admFabFromFrame`. La contadora no lo ve.
 */
export function AdmFab() {
  const { tenantSlug, readOnly } = useAccounting()
  const pathname = usePathname()
  if (readOnly) return null
  if (!admFabFromFrame(`/${tenantSlug}/administracion`, pathname)) return null
  return <LauncherFab />
}
