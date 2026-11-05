'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'

/**
 * Un interruptor chico que vive en la URL («Solo lo raro», «Saldo inicial»): volver del Mayor con el
 * botón de atrás lo encuentra como estaba. Un checkbox de verdad: se usa con el teclado y lo anuncia
 * un lector de pantalla.
 */
export function UrlToggle({
  param,
  checked,
  disabled = false,
  className,
  children,
}: {
  /** El parámetro de la URL (`raro`): prendido vale `1`. */
  param: string
  checked: boolean
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function change(next: boolean) {
    const search = new URLSearchParams(sp?.toString() ?? '')
    if (next) search.set(param, '1')
    else search.delete(param)
    const query = search.toString()
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    )
  }

  return (
    <label
      aria-busy={pending}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground has-checked:text-foreground md:pointer-fine:min-h-8',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || pending}
        onChange={(event) => change(event.target.checked)}
        className="size-4 accent-primary"
      />
      {children}
    </label>
  )
}
