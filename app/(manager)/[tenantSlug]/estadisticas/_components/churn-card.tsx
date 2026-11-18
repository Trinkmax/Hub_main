'use client'

import { ArrowDownToLine, TrendingDown, Users } from 'lucide-react'
import Link from 'next/link'
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

export function ChurnCard({
  rows,
  tenantSlug,
  exportHref,
}: {
  rows: ChurnRiskRow[]
  tenantSlug: string
  /** De dónde se baja la lista en una planilla. */
  exportHref?: string
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    createAudienceFromList.bind(null, tenantSlug),
    initial,
  )
  const [name, setName] = useState('Dejaron de venir')

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
            <h2 className="font-serif text-lg font-semibold tracking-tight">Dejaron de venir</h2>
            <p className="text-xs text-muted-foreground">
              Venían seguido y ya pasó más del doble de lo que tardaban en volver. Armá una
              audiencia para escribirles.
            </p>
          </div>
        </div>
        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {exportHref ? (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={exportHref} download>
                  <ArrowDownToLine className="size-3.5" aria-hidden />
                  Bajar la lista
                </a>
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Users className="size-3.5" />
                  Crear audiencia
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Crear una audiencia con esta lista</AlertDialogTitle>
                  <AlertDialogDescription>
                    Queda una audiencia fija con{' '}
                    {rows.length === 1 ? (
                      <>
                        <strong>1</strong> cliente
                      </>
                    ) : (
                      <>
                        los <strong>{rows.length}</strong> clientes
                      </>
                    )}{' '}
                    de esta lista, para mandarles una difusión desde Mensajería.
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
          </div>
        ) : null}
      </header>
      {rows.length === 0 ? (
        <EmptyState
          icon={TrendingDown}
          title="Nadie dejó de venir"
          description="Los que venían seguido siguen viniendo."
          className="m-3 border-0 bg-transparent"
        />
      ) : (
        <DataTableScroll>
          <DataTableRoot>
            <DataTableHead>
              <tr>
                <DataTableHeader>Cliente</DataTableHeader>
                <DataTableHeader>Consumos</DataTableHeader>
                <DataTableHeader>Venía</DataTableHeader>
                <DataTableHeader>Sin venir</DataTableHeader>
                <DataTableHeader>Consumo total</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((r) => (
                <tr key={r.customer_id} className="transition-colors hover:bg-secondary/40">
                  <DataTableCell>
                    <Link
                      href={`/${tenantSlug}/clientes/${r.customer_id}`}
                      className="font-medium hover:text-primary"
                    >
                      {r.first_name} {r.last_name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">{r.total_visits}</DataTableCell>
                  <DataTableCell className="tabular-nums text-muted-foreground">
                    cada {Math.max(1, Math.round(Number(r.visit_frequency_days ?? 0)))} días
                  </DataTableCell>
                  <DataTableCell className="tabular-nums text-(--warning-text)">
                    {r.days_since_last_visit} días
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
