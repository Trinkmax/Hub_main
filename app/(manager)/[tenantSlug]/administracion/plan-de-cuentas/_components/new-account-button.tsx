'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChartWorkspace } from './workspace-context'

/** «Nueva cuenta» del encabezado: abre la hoja para elegir dónde va (o una principal). */
export function NewAccountButton() {
  const { readOnly, createAccount } = useChartWorkspace()
  if (readOnly) return null
  return (
    <Button type="button" className="h-11 gap-2 md:h-9" onClick={() => createAccount()}>
      <Plus className="size-4" aria-hidden />
      Nueva cuenta
    </Button>
  )
}
