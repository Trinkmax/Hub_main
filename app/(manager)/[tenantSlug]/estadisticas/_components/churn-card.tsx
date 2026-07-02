'use client'

import { TrendingDown, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { type AudienceFromListState, createAudienceFromList } from '@/lib/stats/audience-from-list'
import type { ChurnRiskRow } from '@/lib/stats/queries'

const initial: AudienceFromListState = { ok: true, id: '' }

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function ChurnCard({ rows, tenantSlug }: { rows: ChurnRiskRow[]; tenantSlug: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    createAudienceFromList.bind(null, tenantSlug),
    initial,
  )
  const [name, setName] = useState('Riesgo de churn')

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success('Audiencia creada.')
      router.push(`/${tenantSlug}/mensajeria/audiencias/${state.id}`)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, router, tenantSlug])

  const ids = rows.map((r) => r.customer_id).join(',')

  return (
    <DataTableShell>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <TrendingDown className="size-4" />
          </div>
          <div>
            <h2 className="font-serif text-lg font-semibold tracking-tight">Riesgo de churn</h2>
            <p className="text-xs text-muted-foreground">
              Clientes que eran frecuentes y no volvieron en 2× su frecuencia habitual.
            </p>
          </div>
        </div>
        {rows.length > 0 ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Users className="size-3.5" />
                Crear audiencia
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Crear audiencia desde lista</AlertDialogTitle>
                <AlertDialogDescription>
                  Vamos a crear una audiencia estática con los <strong>{rows.length}</strong>{' '}
                  clientes identificados como riesgo de churn.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <form action={action} className="space-y-3">
                <Input
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                />
                <input type="hidden" name="customer_ids" value={ids} />
                <AlertDialogFooter>
                  <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
                  <AlertDialogAction type="submit" disabled={pending}>
                    {pending ? 'Creando…' : 'Crear audiencia'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </header>
      {rows.length === 0 ? (
        <EmptyState
          icon={TrendingDown}
          title="Nadie en riesgo"
          description="No hay clientes en riesgo de churn según la lógica actual. Buen trabajo."
          className="m-3 border-0 bg-transparent"
        />
      ) : (
        <DataTableScroll>
          <DataTableRoot>
            <DataTableHead>
              <tr>
                <DataTableHeader>Cliente</DataTableHeader>
                <DataTableHeader>Visitas</DataTableHeader>
                <DataTableHeader>Frecuencia</DataTableHeader>
                <DataTableHeader>Sin volver</DataTableHeader>
                <DataTableHeader>Spent</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((r) => (
                <tr key={r.customer_id} className="transition-colors hover:bg-secondary/40">
                  <DataTableCell className="font-medium">
                    {r.first_name} {r.last_name}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">{r.total_visits}</DataTableCell>
                  <DataTableCell className="tabular-nums text-muted-foreground">
                    cada {r.visit_frequency_days?.toFixed?.(1) ?? r.visit_frequency_days}d
                  </DataTableCell>
                  <DataTableCell className="tabular-nums text-warning">
                    {r.days_since_last_visit}d
                  </DataTableCell>
                  <DataTableCell className="font-display font-semibold tabular-nums">
                    {fmtCents(r.total_spent_cents)}
                  </DataTableCell>
                </tr>
              ))}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
      )}
    </DataTableShell>
  )
}
