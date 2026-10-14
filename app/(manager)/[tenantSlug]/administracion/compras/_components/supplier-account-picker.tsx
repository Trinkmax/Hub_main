'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { CategoryPicker } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveParty } from '@/lib/accounting/actions/master'
import type { PartyKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import type { SupplierAccountOption, SupplierCategoryChoices } from '../_lib/suppliers'

/** Lo que hace falta de cada proveedor para guardarle la categoría. */
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

/** Abre «¿En qué le comprás a …?» para un proveedor. `null` fuera del provider. */
export function useSupplierAccountPicker(): PickerContextValue | null {
  return useContext(PickerContext)
}

type Draft = {
  open: boolean
  partyId: string | null
  value: string | null
  error: string | null
  /** «Ver el plan completo»: el combo con todas las cuentas que acepta el motor. */
  fullPlan: boolean
}

const CLOSED: Draft = { open: false, partyId: null, value: null, error: null, fullPlan: false }

/**
 * Elegir o cambiar la categoría de UN proveedor desde su renglón o su hoja: la
 * «cuenta habitual» de su ficha, sin códigos ni plan de cuentas a la vista. Un
 * solo diálogo para toda la lista (cada renglón solo tiene su botón).
 *
 * Adentro va `CategoryPicker` (las categorías como botones, «Mercadería»
 * arriba) y, detrás de «Ver el plan completo», el combo de siempre para la
 * cuenta rara. Guarda lo mismo que guardaba: `saveParty` con `defaultAccountId`
 * (y `id`, `expectedUpdatedAt`, `kind`, `name`, que pide el esquema).
 *
 * Para clasificar muchos de corrido está el clasificador (`SupplierSorter`).
 */
export function SupplierAccountProvider({
  tenantSlug,
  accounts,
  categories,
  rows,
  children,
}: {
  tenantSlug: string
  /** Las cuentas del plan completo (`supplierAccountOptions`). */
  accounts: readonly SupplierAccountOption[]
  categories: SupplierCategoryChoices
  /** Los proveedores a los que se les puede elegir, en el orden de la lista. */
  rows: readonly SupplierAccountRow[]
  children: ReactNode
}) {
  const router = useRouter()
  const uid = useId()
  const fieldId = `${uid}-categoria`
  const [draft, setDraft] = useState<Draft>(CLOSED)
  const [pending, start] = useTransition()

  const pick = useCallback(
    (partyId: string) => {
      const target = rows.find((r) => r.partyId === partyId)
      if (!target) return
      setDraft({ open: true, partyId, value: target.accountId, error: null, fullPlan: false })
    },
    [rows],
  )
  const context = useMemo(() => ({ pick }), [pick])

  const row = draft.partyId ? (rows.find((r) => r.partyId === draft.partyId) ?? null) : null
  const chosen = draft.value ? (accounts.find((a) => a.id === draft.value) ?? null) : null
  const unchanged = row !== null && draft.value === row.accountId
  // La elegida que no es un botón (del plan completo, o una cuenta que ya no se ofrece).
  const outside =
    draft.value && !categories.options.some((o) => o.id === draft.value)
      ? { id: draft.value, name: chosen?.name ?? 'Otra cuenta' }
      : null

  const save = () => {
    if (!row || pending || unchanged) return
    const value = draft.value
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
            : `${row.displayName} quedó sin categoría.`,
        )
        router.refresh()
        setDraft((d) => ({ ...d, open: false, error: null }))
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
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          {row ? (
            <>
              <DialogHeader>
                {/* El `id` va en un span: si se pisa el del título, el diálogo se queda sin nombre. */}
                <DialogTitle className="text-pretty leading-snug">
                  <span id={`${fieldId}-label`}>¿En qué le comprás a {row.displayName}?</span>
                </DialogTitle>
                <DialogDescription>
                  Queda en su ficha y se propone sola cada vez que le cargás algo.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <CategoryPicker
                  id={fieldId}
                  aria-labelledby={`${fieldId}-label`}
                  options={categories.options}
                  featured={categories.featured}
                  pinned={categories.pinned}
                  value={draft.value}
                  outside={outside}
                  invalid={Boolean(draft.error)}
                  onChange={(value) => setDraft((d) => ({ ...d, value, error: null }))}
                  onOpenFullPlan={() => setDraft((d) => ({ ...d, fullPlan: true }))}
                />
                {draft.fullPlan ? (
                  <div className="grid gap-1.5 rounded-xl bg-secondary/50 p-3">
                    <p className="text-xs text-muted-foreground">
                      El plan completo, para una cuenta que no está entre los botones.
                    </p>
                    <AccountCombobox
                      id={`${fieldId}-plan`}
                      aria-label="Buscar en el plan completo"
                      value={draft.value}
                      onValueChange={(value) => setDraft((d) => ({ ...d, value, error: null }))}
                      accounts={accounts}
                      placeholder="Buscar una cuenta"
                      disabled={pending}
                    />
                  </div>
                ) : null}
                {draft.value && row.accountId ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="inline-flex min-h-11 items-center justify-self-start rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                    onClick={() => setDraft((d) => ({ ...d, value: null, error: null }))}
                  >
                    Quitar la categoría
                  </button>
                ) : null}
                {draft.error ? (
                  <p role="alert" className="text-sm text-destructive">
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
                <Button
                  type="button"
                  className="h-11 min-w-[110px] md:h-9"
                  disabled={pending || unchanged}
                  onClick={save}
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
 * El botón de un renglón o de una tapa: «＋ Elegir categoría» (falta: contorno
 * punteado) o el texto que le pasen para cambiarla. No dibuja nada fuera del
 * provider ni para quien no puede escribir (la pantalla no monta el provider).
 */
export function SupplierAccountButton({
  partyId,
  supplierName,
  hasAccount,
  className,
  children,
}: {
  partyId: string
  supplierName: string
  hasAccount: boolean
  className?: string
  /** Lo que se lee en el botón (por defecto «Elegir categoría» o «Cambiar»). */
  children?: ReactNode
}) {
  const picker = useSupplierAccountPicker()
  if (!picker) return null
  return (
    <button
      type="button"
      onClick={() => picker.pick(partyId)}
      aria-label={
        hasAccount
          ? `Cambiar la categoría de ${supplierName}`
          : `Elegir la categoría de ${supplierName}`
      }
      className={cn(
        'inline-flex min-h-11 items-center gap-1 rounded-full text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-7',
        hasAccount
          ? 'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
          : 'border border-dashed border-primary/40 px-2.5 text-primary hover:bg-accent',
        className,
      )}
    >
      {children ?? (
        <>
          {hasAccount ? null : <Plus aria-hidden className="size-3" />}
          {hasAccount ? 'Cambiar' : 'Elegir categoría'}
        </>
      )}
    </button>
  )
}
