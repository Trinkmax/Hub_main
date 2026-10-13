'use client'

import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { saveParty } from '@/lib/accounting/actions/master'
import { cn } from '@/lib/utils'
import type { SheetParty } from '../_lib/sheet-types'

/**
 * Lo que comparten «Nuevo gasto» y la factura de proveedor para «la
 * clasificación vive en la ficha del proveedor» (12/10/2026): la línea «Va a
 * «…»», el «Usar siempre para …» y guardar esa cuenta en la ficha después de
 * cargar. Cuándo va cada cosa lo decide `accountAsk` (`_lib/supplier-account.ts`).
 */

/** La cuenta sale de la ficha: no se pregunta. [Cambiar] abre el selector solo para esta carga. */
export function SupplierAccountLine({
  accountName,
  onChange,
  className,
}: {
  accountName: string
  onChange: () => void
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground', className)}
    >
      <span className="min-w-0 text-pretty">
        Va a <span className="font-medium text-foreground">«{accountName}»</span>
      </span>
      <button
        type="button"
        onClick={onChange}
        aria-label={`Cambiar la cuenta solo para esta carga (ahora va a ${accountName})`}
        className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
      >
        Cambiar
      </button>
    </div>
  )
}

/** «Usar siempre para Barracuda»: al cargar, la cuenta elegida queda en la ficha del proveedor. */
export function RememberAccountCheckbox({
  id,
  partyName,
  checked,
  onCheckedChange,
}: {
  id: string
  partyName: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground md:min-h-9"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <span className="min-w-0 text-pretty">Usar siempre para {partyName}</span>
    </label>
  )
}

/**
 * Deja la cuenta como habitual del proveedor (su ficha › «Cuenta habitual»),
 * DESPUÉS de que la carga quedó guardada. Es un extra: si falla, lo cargado
 * sigue cargado y se avisa. Nunca tira. Solo manda la cuenta (`saveParty`
 * guarda los campos presentes; `kind` y `name` los pide el esquema).
 */
export async function rememberSupplierAccount(
  tenantSlug: string,
  party: Pick<SheetParty, 'id' | 'kind' | 'name' | 'tradeName' | 'updatedAt'>,
  accountId: string,
): Promise<boolean> {
  const shown = party.tradeName ?? party.name
  const failed = `Quedó cargado, pero no pudimos dejar esa cuenta como habitual de ${shown}. Podés elegirla en su ficha.`
  try {
    const result = await saveParty(tenantSlug, {
      id: party.id,
      expectedUpdatedAt: party.updatedAt,
      kind: party.kind,
      name: party.name,
      defaultAccountId: accountId,
    })
    if (!result.ok) {
      toast.warning(failed)
      return false
    }
    return true
  } catch {
    toast.warning(failed)
    return false
  }
}
