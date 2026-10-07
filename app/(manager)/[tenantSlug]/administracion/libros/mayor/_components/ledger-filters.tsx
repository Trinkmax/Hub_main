'use client'

import { X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useTransition } from 'react'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { PartyCombobox, type PartyOption } from '@/components/administracion/party-combobox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

/**
 * Qué mayor se ve (H.12): la cuenta (también un grupo, que suma sus cuentas)
 * y, en las cuentas de proveedores o clientes, uno solo. Cambiar algo vuelve a
 * la primera página y conserva el período.
 */
export function LedgerFilters({
  accounts,
  parties,
  accountId,
  partyId,
  showParty,
}: {
  accounts: readonly AccountOption[]
  parties: readonly PartyOption[]
  accountId: string | null
  partyId: string | null
  /** La cuenta elegida lleva proveedor o cliente. */
  showParty: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const accountLabelId = useId()
  const partyLabelId = useId()

  function go(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    next.delete('despues')
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const qs = next.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  return (
    <div
      aria-busy={pending}
      className="grid gap-3 rounded-xl border border-border/60 bg-card/40 p-3 sm:grid-cols-2"
    >
      <div className="grid content-start gap-1.5">
        <Label id={accountLabelId}>Cuenta</Label>
        <AccountCombobox
          aria-labelledby={accountLabelId}
          accounts={accounts}
          value={accountId}
          placeholder="Elegí una cuenta"
          searchPlaceholder="Código o nombre (por ejemplo, 1.1.01.01)"
          disabled={pending}
          onValueChange={(id) => go({ cuenta: id, participe: null })}
        />
      </div>
      {showParty ? (
        <div className="grid content-start gap-1.5">
          <Label id={partyLabelId}>
            Proveedor o cliente{' '}
            <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <div className="flex items-center gap-2">
            <PartyCombobox
              aria-labelledby={partyLabelId}
              className="flex-1"
              parties={parties}
              value={partyId}
              placeholder="Todos"
              includeInactive
              disabled={pending}
              onValueChange={(id) => go({ participe: id })}
            />
            {partyId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 md:size-10"
                aria-label="Ver todos los proveedores y clientes"
                disabled={pending}
                onClick={() => go({ participe: null })}
              >
                <X className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
