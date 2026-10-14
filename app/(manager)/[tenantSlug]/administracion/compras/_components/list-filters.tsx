'use client'

import { LoaderCircle, Search, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Lo que se borra al cambiar la búsqueda: la página (vuelve a la primera). */
const PAGE_PARAMS = ['pagina', 'despues']

/** Cuánto se espera después de la última tecla para buscar. */
const SEARCH_DELAY_MS = 350

/**
 * El buscador de una lista de Compras: busca MIENTRAS se escribe (reemplaza
 * `?q=` a los 350 ms de la última tecla, y al toque con Enter). Ya no hay
 * botón «Buscar».
 *
 * Es un campo controlado propio: el de antes se volvía a montar con cada
 * búsqueda (`key={q}`) y perdía el foco a mitad de palabra. El valor sigue
 * viviendo en la URL (la lista se comparte y «atrás» funciona); si la URL
 * cambia por otro lado («Sacar los filtros»), el campo la sigue.
 */
export function LiveSearch({
  placeholder,
  label,
  className,
}: {
  placeholder: string
  /** Para lectores: qué se busca («Buscar un proveedor»). Por defecto, el `placeholder`. */
  label?: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const id = useId()
  const urlQuery = searchParams.get('q') ?? ''
  const [value, setValue] = useState(urlQuery)
  const [pending, start] = useTransition()
  /** Lo último que se mandó a la URL: para no buscar dos veces lo mismo. */
  const sent = useRef(urlQuery)

  const apply = (raw: string) => {
    const next = raw.trim()
    if (next === sent.current) return
    sent.current = next
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set('q', next)
    else params.delete('q')
    for (const key of PAGE_PARAMS) params.delete(key)
    const query = params.toString()
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: busca solo cuando cambia lo escrito
  useEffect(() => {
    const timer = window.setTimeout(() => apply(value), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [value])

  // La URL cambió por otro lado (un link, «atrás»): el campo muestra lo que se está viendo.
  // Con una búsqueda en vuelo no se pisa lo que la persona sigue escribiendo.
  useEffect(() => {
    if (pending || urlQuery === sent.current) return
    sent.current = urlQuery
    setValue(urlQuery)
  }, [urlQuery, pending])

  return (
    <div className={cn('relative min-w-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label ?? placeholder}
      </label>
      {pending ? (
        <LoaderCircle
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      ) : (
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <Input
        id={id}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-busy={pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            apply(value)
          }
        }}
        className="h-11 rounded-full pr-11 pl-10 text-base md:h-10 md:pr-10 md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== '' ? (
        <button
          type="button"
          aria-label="Borrar la búsqueda"
          onClick={() => {
            setValue('')
            apply('')
            document.getElementById(id)?.focus()
          }}
          className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:right-1 md:size-9"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  )
}
