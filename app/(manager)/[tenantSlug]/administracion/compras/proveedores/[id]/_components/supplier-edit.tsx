'use client'

import { Pencil } from 'lucide-react'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SupplierDataForm } from './supplier-data-form'

type EditContextValue = { open: () => void }

const EditContext = createContext<EditContextValue | null>(null)

/** Abre «Editar datos» del proveedor de la página. `null` fuera del provider. */
export function useSupplierEdit(): EditContextValue | null {
  return useContext(EditContext)
}

/**
 * «Editar datos» montado UNA vez en la hoja del proveedor y abierto desde donde
 * haga falta: los chips de la tapa («＋ Cómo te factura», «＋ A cuántos días le
 * pagás») y el botón de «Sus datos». El mismo patrón de `SupplierAccountProvider`
 * + `SupplierAccountButton`: un diálogo, muchos botones.
 *
 * Solo lo monta la página para quien puede escribir: sin provider, los botones
 * no se dibujan (la contadora no ve ninguno).
 */
export function SupplierEditProvider({
  children,
  ...form
}: { children: ReactNode } & Omit<
  ComponentProps<typeof SupplierDataForm>,
  'open' | 'onOpenChange'
>) {
  const [open, setOpen] = useState(false)
  const context = useMemo(() => ({ open: () => setOpen(true) }), [])
  return (
    <EditContext.Provider value={context}>
      {children}
      <SupplierDataForm {...form} open={open} onOpenChange={setOpen} />
    </EditContext.Provider>
  )
}

/**
 * Un botón que abre «Editar datos». Con `chip`, tiene el aspecto de un dato que
 * falta en la tapa (contorno punteado: es «falta», no «elegido»).
 */
export function SupplierEditButton({
  children,
  chip = false,
  className,
  'aria-label': ariaLabel,
}: {
  children?: ReactNode
  chip?: boolean
  className?: string
  'aria-label'?: string
}) {
  const edit = useSupplierEdit()
  if (!edit) return null
  if (chip) {
    return (
      <button type="button" onClick={edit.open} aria-label={ariaLabel} className={className}>
        {children}
      </button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      className={cn('h-11 gap-2 rounded-full px-5 md:h-9', className)}
      aria-label={ariaLabel}
      onClick={edit.open}
    >
      <Pencil className="size-3.5" aria-hidden />
      {children ?? 'Editar datos'}
    </Button>
  )
}
