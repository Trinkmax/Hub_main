'use client'

import type { ComponentProps } from 'react'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import type { OnboardingSheet } from '@/lib/accounting/onboarding'

/**
 * Abre una hoja de acción rápida («Nuevo gasto», «Ajustar saldo»…) sobre la
 * misma guía, como `ActionButton`. No se muestra en modo lectura ni fuera de
 * Administración (sin el provider no hay hojas).
 */
export function SheetButton({
  sheet,
  children,
  ...button
}: { sheet: OnboardingSheet } & Omit<
  ComponentProps<typeof Button>,
  'onClick' | 'asChild' | 'type'
>) {
  const ctx = useAccountingOptional()
  if (!ctx || ctx.readOnly) return null
  return (
    <Button type="button" {...button} onClick={() => ctx.openAction(sheet)}>
      {children}
    </Button>
  )
}
