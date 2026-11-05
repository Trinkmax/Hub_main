'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChartWorkspace } from './workspace-context'

/** «Nueva cuenta» del encabezado: abre la hoja para elegir dónde va (o una principal). */
export function NewAccountButton() {
  const { readOnly, createAccount } = useChartWorkspace()
  if (readOnly) return null
  return (
    <Button
      type="button"
      size="sm"
      className="h-11 gap-1.5 md:pointer-fine:h-8"
      onClick={() => createAccount()}
    >
      <Plus className="size-3.5" aria-hidden />
      Nueva cuenta
    </Button>
  )
}
