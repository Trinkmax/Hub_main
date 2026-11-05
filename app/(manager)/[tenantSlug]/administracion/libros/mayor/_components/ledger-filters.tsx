'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { Button } from '@/components/ui/button'

const STEP = 'size-11 shrink-0 md:pointer-fine:size-8'
const FIELD = 'h-11 md:h-11 md:pointer-fine:h-8'

/** Una flecha: un link a la cuenta de al lado o, en la punta, un botón apagado. */
function AccountStep({
  href,
  label,
  direction,
}: {
  href: string | null
  /** «Cuenta anterior: 4.2.01.03.004 Energía eléctrica». */
  label: string
  direction: 'prev' | 'next'
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  if (!href) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled
        className={STEP}
        aria-label={label}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    )
  }
  return (
    <Button asChild variant="outline" size="icon" className={STEP}>
      <Link href={href} scroll={false} aria-label={label}>
        <Icon className="size-4" aria-hidden />
      </Link>
    </Button>
  )
}

/**
 * Qué mayor se ve: la cuenta (también un grupo, que suma sus cuentas) con las flechas para pasar a la
 * anterior y a la siguiente con movimiento, como quien da vuelta las hojas del libro. En las cuentas
 * de proveedores o clientes, además, uno solo. Cambiar algo vuelve a la primera página y conserva el
 * período.
 */
export function LedgerFilters({
  accounts,
  parties,
  accountId,
  partyId,
  showParty,
  prev,
  next,
}: {
  accounts: readonly AccountOption[]
  parties: readonly PartyOption[]
  accountId: string | null
  partyId: string | null
  /** La cuenta elegida lleva proveedor o cliente. */
  showParty: boolean
  prev: { href: string; label: string } | null
  next: { href: string; label: string } | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function go(updates: Record<string, string | null>) {
    const search = new URLSearchParams(sp?.toString() ?? '')
    search.delete('despues')
    for (const [key, value] of Object.entries(updates)) {
      if (value) search.set(key, value)
      else search.delete(key)
    }
    const qs = search.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  return (
    <div aria-busy={pending} className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <AccountStep
          direction="prev"
          href={prev?.href ?? null}
          label={prev?.label ?? 'No hay una cuenta anterior con movimiento'}
        />
        <AccountCombobox
          aria-label="Cuenta"
          accounts={accounts}
          value={accountId}
          placeholder="Elegí una cuenta"
          searchPlaceholder="Código o nombre (por ejemplo, 1.1.01.01)"
          disabled={pending}
          className={`${FIELD} flex-1 sm:w-80 sm:flex-none`}
          onValueChange={(id) => go({ cuenta: id, participe: null })}
        />
        <AccountStep
          direction="next"
          href={next?.href ?? null}
          label={next?.label ?? 'No hay una cuenta siguiente con movimiento'}
        />
      </div>
      {showParty ? (
        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <PartyCombobox
            aria-label="Proveedor o cliente"
            className={`${FIELD} flex-1 sm:w-56 sm:flex-none`}
            parties={parties}
            value={partyId}
            placeholder="Todos los proveedores y clientes"
            includeInactive
            disabled={pending}
            onValueChange={(id) => go({ participe: id })}
          />
          {partyId ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={STEP}
              aria-label="Ver todos los proveedores y clientes"
              disabled={pending}
              onClick={() => go({ participe: null })}
            >
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
