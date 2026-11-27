'use client'

import { ArrowRight, Loader2, Scissors } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { type CartaPickerBranch, celebrationSeenKey } from '@/lib/menu/carta-branch'
import { cn } from '@/lib/utils'
import { CartaBrand } from './carta-brand'
import { OpeningRibbon, OpeningStamp, stampText } from './celebration'
import { confettiBurst } from './confetti'

/** Lo que tarda en caer la cinta antes de abrir la carta (el papel sigue cayendo encima de la carta). */
const CUT_MS = 620

/**
 * Lo primero que se ve al escanear el QR de un bar con varias sucursales (docs/features/carta-por-sucursal.md):
 * una tarjeta por sucursal, en su color, y cada una abre su carta. La que se inaugura hoy tiene la cinta: el toque
 * la corta, tira papel picado y entra.
 */
export function BranchPicker({
  tenantName,
  logoUrl,
  branches,
}: {
  tenantName: string
  logoUrl: string | null
  branches: CartaPickerBranch[]
}): React.JSX.Element {
  const router = useRouter()
  const [cutId, setCutId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const open = (branch: CartaPickerBranch) => {
    setOpeningId(branch.id)
    startTransition(() => router.push(branch.href))
  }

  const onOpen = (event: React.MouseEvent<HTMLAnchorElement>, branch: CartaPickerBranch) => {
    // Abrir en otra pestaña (o con el botón del medio) queda en manos del navegador.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return
    event.preventDefault()
    if (openingId || cutId) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (branch.celebration !== 'opening' || calm) {
      open(branch)
      return
    }
    setCutId(branch.id)
    try {
      // Ya festejó al cortar: la carta no vuelve a tirar papel al abrirse.
      sessionStorage.setItem(celebrationSeenKey(branch.slug), '1')
    } catch {
      // Sin almacenamiento (modo privado estricto): a lo sumo, un poco más de papel.
    }
    const bow = event.currentTarget.querySelector('.carta-ribbon-bow')
    const box = (bow ?? event.currentTarget).getBoundingClientRect()
    confettiBurst({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
    window.setTimeout(() => open(branch), CUT_MS)
  }

  return (
    <main className="carta-pick mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),28px)] pt-[max(env(safe-area-inset-top),18px)]">
      <div className="flex justify-center py-3">
        <CartaBrand tenantName={tenantName} logoUrl={logoUrl} className="h-12 max-w-[180px]" />
      </div>

      <div className="carta-pick-in mt-7" style={{ animationDelay: '40ms' }}>
        <h1 className="font-serif text-[2.35rem] font-semibold leading-[1.02] tracking-[-0.03em] text-balance">
          ¿Dónde estás hoy?
        </h1>
        <p className="mt-2.5 text-[15px] leading-snug text-muted-foreground">
          Elegí la sucursal y te mostramos su carta.
        </p>
      </div>

      <ul className="mt-7 flex flex-col gap-3.5">
        {branches.map((branch, index) => {
          const isOpening = branch.celebration === 'opening'
          const isCut = cutId === branch.id
          const isOpeningNow = isCut || (openingId === branch.id && isPending)
          return (
            <li
              key={branch.id}
              className="carta-pick-in"
              style={{ animationDelay: `${120 + index * 80}ms` }}
            >
              <Link
                href={branch.href}
                prefetch
                onClick={(event) => onOpen(event, branch)}
                aria-label={
                  isOpening
                    ? `Cortar la cinta y ver la carta de ${branch.name}`
                    : `Ver la carta de ${branch.name}`
                }
                data-cut={isCut || undefined}
                className={cn(
                  'carta-pick-card group relative isolate flex w-full flex-col justify-end overflow-hidden rounded-[28px] p-6 text-[#fbf7ef] shadow-[0_22px_40px_-24px_rgba(20,28,24,0.75)] outline-none transition-transform duration-200 ease-out focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985]',
                  isOpening ? 'min-h-[244px]' : 'min-h-[150px]',
                )}
                style={{ backgroundColor: branch.color }}
              >
                <span aria-hidden className="carta-pick-light absolute inset-0 -z-10" />

                {isOpening ? (
                  <OpeningRibbon cut={isCut} className="absolute inset-x-0 top-[58px]" />
                ) : branch.celebration === 'new' ? (
                  <span className="absolute left-6 top-6 rounded-full bg-[#f3d98b] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4a2414]">
                    Nuevo
                  </span>
                ) : null}

                {isOpening ? (
                  <OpeningStamp
                    text={stampText('Inauguramos hoy')}
                    className="absolute bottom-5 right-5 size-[92px] text-[#fbf7ef]"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full bg-[#fbf7ef]/15 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                  >
                    <ArrowRight className="size-[18px]" />
                  </span>
                )}

                <span
                  className={cn(
                    'font-serif font-semibold leading-[0.95] tracking-[-0.035em] text-balance',
                    isOpening ? 'max-w-[62%] text-[2.9rem]' : 'max-w-[80%] text-[2.5rem]',
                  )}
                >
                  {branch.name}
                </span>
                <span className="mt-2 flex min-h-5 items-center gap-1.5 text-[14px] leading-snug text-[#fbf7ef]/85">
                  {isOpeningNow ? (
                    <>
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                      Abriendo la carta…
                    </>
                  ) : isOpening ? (
                    <>
                      <Scissors aria-hidden className="size-4" />
                      Tocá para cortar la cinta
                    </>
                  ) : (
                    branch.address
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
