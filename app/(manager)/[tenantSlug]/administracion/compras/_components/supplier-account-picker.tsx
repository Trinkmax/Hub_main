'use client'

import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveParty } from '@/lib/accounting/actions/master'
import type { PartyKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { nextUnclassified, type SupplierAccountOption } from '../_lib/suppliers'

/** Lo que hace falta de cada proveedor de la lista para guardarle la cuenta. */
export type SupplierAccountRow = {
  partyId: string
  /** Razón social: `saveParty` la pide en cada edición. */
  name: string
  /** Como se lo nombra en la lista. */
  displayName: string
  kind: PartyKind
  /** Para la concurrencia optimista de `saveParty`. */
  updatedAt: string
  accountId: string | null
}

type PickerContextValue = { pick: (partyId: string) => void }

const PickerContext = createContext<PickerContextValue | null>(null)

/** Abre «¿En qué se le compra a …?» para un proveedor de la lista. `null` fuera de la lista. */
export function useSupplierAccountPicker(): PickerContextValue | null {
  return useContext(PickerContext)
}

type Draft = {
  open: boolean
  partyId: string | null
  value: string | null
  error: string | null
}

const CLOSED: Draft = { open: false, partyId: null, value: null, error: null }

/**
 * «Elegir cuenta» desde la lista de proveedores (pedido de los socios,
 * 12/10/2026): la cuenta habitual de la ficha, sin entrar a la ficha. Un solo
 * diálogo para toda la lista (no un selector por fila): cada fila solo tiene
 * su botón. «Guardar y seguir» pasa al próximo sin clasificar, para recorrer
 * de corrido una lista recién cargada.
 */
export function SupplierAccountProvider({
  tenantSlug,
  accounts,
  rows,
  children,
}: {
  tenantSlug: string
  /** Las cuentas que ofrece la ficha del proveedor (`supplierAccountOptions`). */
  accounts: readonly SupplierAccountOption[]
  /** Los proveedores que se ven, en el orden de la lista. */
  rows: readonly SupplierAccountRow[]
  children: ReactNode
}) {
  const router = useRouter()
  const uid = useId()
  const fieldId = `${uid}-cuenta`
  const [draft, setDraft] = useState<Draft>(CLOSED)
  const [pending, start] = useTransition()

  const pick = useCallback(
    (partyId: string) => {
      const target = rows.find((r) => r.partyId === partyId)
      if (!target) return
      setDraft({ open: true, partyId, value: target.accountId, error: null })
    },
    [rows],
  )
  const context = useMemo(() => ({ pick }), [pick])

  const row = draft.partyId ? (rows.find((r) => r.partyId === draft.partyId) ?? null) : null
  const next = row ? nextUnclassified(rows, row.partyId) : null
  // «Guardar y seguir» solo cuando se está clasificando: a uno que ya tenía cuenta se le cambia y listo.
  const offerNext = row !== null && row.accountId === null && next !== null
  const chosen = draft.value ? (accounts.find((a) => a.id === draft.value) ?? null) : null
  const unchanged = row !== null && draft.value === row.accountId

  // Al pasar al siguiente, el foco vuelve al selector: se tipea la cuenta sin tocar el mouse.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al cambiar de proveedor
  useEffect(() => {
    if (draft.open && draft.partyId) document.getElementById(fieldId)?.focus()
  }, [draft.partyId])

  const save = (andNext: boolean) => {
    if (!row || pending || unchanged) return
    const value = draft.value
    const following = andNext ? next : null
    start(async () => {
      try {
        const result = await saveParty(tenantSlug, {
          id: row.partyId,
          expectedUpdatedAt: row.updatedAt,
          kind: row.kind,
          name: row.name,
          defaultAccountId: value,
        })
        if (!result.ok) {
          const stale = result.code === 'stale'
          setDraft((d) => ({
            ...d,
            error: stale
              ? 'Alguien cambió a este proveedor recién. Probá de nuevo.'
              : (result.fieldErrors?.defaultAccountId ?? result.message),
          }))
          if (stale) router.refresh()
          return
        }
        toast.success(
          chosen
            ? `Listo: las compras a ${row.displayName} van a «${chosen.name}».`
            : `${row.displayName} quedó sin clasificar.`,
        )
        router.refresh()
        setDraft((d) =>
          following
            ? { open: true, partyId: following.partyId, value: null, error: null }
            : { ...d, open: false, error: null },
        )
      } catch {
        setDraft((d) => ({ ...d, error: ACC_UNREACHABLE.offline }))
      }
    })
  }

  return (
    <PickerContext.Provider value={context}>
      {children}
      <Dialog
        open={draft.open && row !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDraft((d) => ({ ...d, open: false }))
        }}
      >
        <DialogContent className="sm:max-w-md">
          {row ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-pretty leading-snug">
                  ¿En qué se le compra a {row.displayName}?
                </DialogTitle>
                <DialogDescription id={`${fieldId}-hint`}>
                  La cuenta donde van sus compras. Queda en su ficha y se propone sola en cada
                  carga.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor={fieldId}>Cuenta</Label>
                <AccountCombobox
                  id={fieldId}
                  value={draft.value}
                  onValueChange={(value) => setDraft((d) => ({ ...d, value, error: null }))}
                  accounts={accounts}
                  placeholder="Elegí una cuenta"
                  disabled={pending}
                  invalid={Boolean(draft.error)}
                  aria-describedby={
                    draft.error ? `${fieldId}-hint ${fieldId}-error` : `${fieldId}-hint`
                  }
                />
                {draft.value && row.accountId ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="inline-flex min-h-11 items-center justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:min-h-0"
                    onClick={() => setDraft((d) => ({ ...d, value: null, error: null }))}
                  >
                    Quitar la cuenta
                  </button>
                ) : null}
                {draft.error ? (
                  <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
                    {draft.error}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 md:h-9"
                  disabled={pending}
                  onClick={() => setDraft((d) => ({ ...d, open: false }))}
                >
                  Cancelar
                </Button>
                {offerNext ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 md:h-9"
                    disabled={pending || unchanged}
                    onClick={() => save(true)}
                  >
                    Guardar y seguir
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="h-11 min-w-[110px] md:h-9"
                  disabled={pending || unchanged}
                  onClick={() => save(false)}
                >
                  {pending ? 'Guardando…' : 'Guardar'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PickerContext.Provider>
  )
}

/**
 * El botón de una fila: «Elegir cuenta» (o «Cambiar»). No dibuja nada fuera de
 * la lista ni para quien no puede escribir (la lista no monta el provider).
 */
export function SupplierAccountButton({
  partyId,
  supplierName,
  hasAccount,
  className,
}: {
  partyId: string
  supplierName: string
  hasAccount: boolean
  className?: string
}) {
  const picker = useSupplierAccountPicker()
  if (!picker) return null
  return (
    <button
      type="button"
      onClick={() => picker.pick(partyId)}
      aria-label={
        hasAccount ? `Cambiar la cuenta de ${supplierName}` : `Elegir la cuenta de ${supplierName}`
      }
      className={cn(
        'inline-flex min-h-11 items-center rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0',
        className,
      )}
    >
      {hasAccount ? 'Cambiar' : 'Elegir cuenta'}
    </button>
  )
}
