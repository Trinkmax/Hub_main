'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'

/** Lo que se borra al cambiar un filtro: la página (vuelve a la primera). */
const PAGE_PARAMS = ['pagina', 'despues']

/**
 * Un filtro en un desplegable nativo, para cuando no entra como segmento: el valor vive en la URL
 * (`param`), la lista se comparte y «atrás» funciona. La opción de valor vacío saca el parámetro.
 */
export function UrlSelect({
  param,
  value,
  options,
  label,
  className,
}: {
  param: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  /** Nombre accesible. */
  label: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, start] = useTransition()

  return (
    <select
      aria-label={label}
      aria-busy={pending}
      value={value}
      onChange={(event) => {
        const next = new URLSearchParams(searchParams.toString())
        if (event.target.value) next.set(param, event.target.value)
        else next.delete(param)
        for (const key of PAGE_PARAMS) next.delete(key)
        const query = next.toString()
        start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
      }}
      className={cn(
        'adm-select h-10 max-w-full rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:h-8',
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
