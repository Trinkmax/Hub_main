'use client'

import Link, { type LinkProps } from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { useCallback } from 'react'

type ViewTransitionLinkProps = LinkProps &
  Omit<ComponentProps<'a'>, keyof LinkProps> & {
    children: ReactNode
    transitionName?: string
  }

/**
 * Wrapper de `next/link` que dispara View Transitions API en navegación cliente.
 * Fallback automático: si `document.startViewTransition` no existe, usa router push normal.
 */
export function ViewTransitionLink({
  href,
  onClick,
  children,
  transitionName,
  style,
  ...props
}: ViewTransitionLinkProps) {
  const router = useRouter()

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (event.button !== 0) return

      const supports =
        typeof document !== 'undefined' &&
        'startViewTransition' in document &&
        typeof (document as Document & { startViewTransition?: unknown }).startViewTransition ===
          'function'

      if (!supports) return

      event.preventDefault()
      ;(
        document as Document & {
          startViewTransition: (cb: () => void | Promise<void>) => unknown
        }
      ).startViewTransition(() => {
        router.push(href.toString())
      })
    },
    [onClick, href, router],
  )

  const composedStyle = transitionName
    ? { ...style, viewTransitionName: transitionName }
    : style

  return (
    <Link href={href} onClick={handleClick} style={composedStyle} {...props}>
      {children}
    </Link>
  )
}
