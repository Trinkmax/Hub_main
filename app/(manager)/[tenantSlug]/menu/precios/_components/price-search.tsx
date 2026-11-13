'use client'

import { Search, X } from 'lucide-react'
import { type KeyboardEvent, type RefObject, useEffect } from 'react'
import { Kbd } from '@/components/ui/kbd'

/**
 * El buscador: lo primero y lo más grande de la pantalla. En la compu arranca con el cursor
 * adentro y «/» lo vuelve a enfocar desde cualquier lado; Enter (o flecha abajo) baja al precio
 * del primer resultado, y Esc borra lo escrito.
 */
export function PriceSearch({
  inputRef,
  value,
  onChange,
  onEnter,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  onChange: (next: string) => void
  /** Bajar al primer precio de la lista. */
  onEnter: () => void
}) {
  // Con mouse y teclado, el cursor arranca en el buscador. En el teléfono no: abriría el
  // teclado y taparía media pantalla antes de que la persona vea nada.
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    inputRef.current?.focus({ preventScroll: true })
  }, [inputRef])

  // «/» enfoca el buscador, salvo que ya se esté escribiendo en algún campo.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      ) {
        return
      }
      // Con una hoja o un diálogo abierto, la tecla es de ellos.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputRef])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault()
      onChange('')
      return
    }
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      onEnter()
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-testid="price-search"
        aria-label="Buscar un producto o una categoría"
        // Corto a propósito: en un teléfono de 390 px tiene que entrar entero.
        placeholder="Buscá un producto o categoría"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-12 w-full min-w-0 appearance-none rounded-2xl border border-input bg-card pr-12 pl-12 text-base text-ellipsis shadow-xs outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden transition-[box-shadow,border-color] duration-(--duration-fast) placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none sm:h-14 sm:text-lg"
      />
      {value !== '' ? (
        <button
          type="button"
          data-testid="price-search-clear"
          aria-label="Borrar la búsqueda"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11 pointer-coarse:right-0.5"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : (
        <Kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 pointer-fine:inline-flex"
        >
          /
        </Kbd>
      )}
    </div>
  )
}
