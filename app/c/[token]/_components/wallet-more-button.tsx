'use client'

import { ChevronRight } from 'lucide-react'

// CTA "ver más" full-width que cambia de vista dentro de la wallet (no navega ni
// scrollea): main → niveles / canjeables. Client (onClick).

export function WalletMoreButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-lift group flex w-full items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card px-4 py-3.5 text-left text-sm font-semibold text-foreground shadow-sm outline-none transition-colors hover:border-(--brand-accent)/40 focus-visible:ring-2 focus-visible:ring-foreground"
    >
      <span>{children}</span>
      <ChevronRight
        className="size-4 shrink-0 text-(--brand-accent) transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  )
}
