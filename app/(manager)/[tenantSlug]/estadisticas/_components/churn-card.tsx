'use client'

import { TrendingDown, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmFormState } from '@/components/ui/confirm-dialog'
import { DataTable, ExportButton } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { formatNumber } from '@/lib/format/number-kind'
import { type AudienceFromListState, createAudienceFromList } from '@/lib/stats/audience-from-list'
import type { ChurnRiskRow } from '@/lib/stats/queries'

const initial: AudienceFromListState = { ok: true, id: '' }

/**
 * Riesgo de churn: la lista y el atajo para convertirla en una audiencia.
 *
 * La confirmación es un `ConfirmDialog` en modo formulario: el nombre viaja en
 * el `FormData` y los ids en un campo oculto, igual que antes, a la misma
 * Server Action. Si falla, el error queda adentro del diálogo (no en un aviso
 * que se va); si sale bien, avisa y abre la audiencia nueva.
 */
export function ChurnCard({
  rows,
  tenantSlug,
  exportHref,
}: {
  rows: ChurnRiskRow[]
  tenantSlug: string
  /** La planilla de la misma lista (`/api/stats/export?type=churn_risk`). */
  exportHref: string
}) {
  const router = useRouter()
  const [name, setName] = useState('Riesgo de churn')
  const ids = rows.map((r) => r.customer_id).join(',')

  async function createAudience(
    _prev: ConfirmFormState,
    formData: FormData,
  ): Promise<ConfirmFormState> {
    const result = await createAudienceFromList(tenantSlug, initial, formData)
    if (!result.ok) return { ok: false, error: result.message }
    toast.success('Audiencia creada.')
    router.push(`/${tenantSlug}/mensajeria/audiencias/${result.id}`)
    return { ok: true }
  }

  return (
    <Section
      title="Riesgo de churn"
      description="Clientes que eran frecuentes y no volvieron en el doble de su frecuencia habitual."
      actions={
        rows.length > 0 ? (
          <>
            <ExportButton href={exportHref} size="sm" />
            <ConfirmDialog
              title="¿Crear una audiencia con esta lista?"
              description={
                <>
                  Va a ser una audiencia fija con los {formatNumber(rows.length)} clientes en riesgo
                  de churn. La vas a poder usar en una difusión.
                </>
              }
              confirmLabel="Crear audiencia"
              pendingLabel="Creando…"
              icon={Users}
              trigger={
                <Button size="sm">
                  <Users aria-hidden />
                  Crear audiencia
                </Button>
              }
              formAction={createAudience}
              hiddenFields={{ customer_ids: ids }}
              confirmDisabled={name.trim() === ''}
            >
              <Field label="Nombre de la audiencia" name="name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                  autoComplete="off"
                />
              </Field>
            </ConfirmDialog>
          </>
        ) : null
      }
    >
      <DataTable
        caption="Clientes en riesgo de churn"
        rows={rows}
        getRowId={(r) => r.customer_id}
        rowHref={(r) => `/${tenantSlug}/clientes/${r.customer_id}`}
        rowLabel={(r) => `${r.first_name} ${r.last_name}`.trim()}
        columns={[
          {
            id: 'cliente',
            header: 'Cliente',
            cell: (r) => `${r.first_name} ${r.last_name}`.trim(),
          },
          {
            id: 'visitas',
            header: 'Visitas',
            numeric: true,
            mobile: 'hidden',
            cell: (r) => formatNumber(r.total_visits),
          },
          {
            id: 'frecuencia',
            header: 'Venía',
            hideBelow: 'lg',
            mobile: 'secondary',
            cell: (r) => (
              <span className="text-muted-foreground">
                cada <span className="type-amount">{formatNumber(r.visit_frequency_days, 1)}</span>{' '}
                días
              </span>
            ),
          },
          {
            id: 'sin-volver',
            header: 'Última visita',
            align: 'end',
            cell: (r) => (
              <span className="type-amount text-warning-text">
                hace {formatNumber(r.days_since_last_visit)}{' '}
                {r.days_since_last_visit === 1 ? 'día' : 'días'}
              </span>
            ),
          },
          // Con su `$`: en el celular la lista pasa a tarjetas y el encabezado no se ve.
          {
            id: 'gasto',
            header: 'Gastó',
            numeric: true,
            cell: (r) => <Amount cents={r.total_spent_cents} decimals={0} />,
          },
        ]}
        empty={
          <EmptyState
            size="sm"
            icon={TrendingDown}
            title="Nadie en riesgo"
            description="Ningún cliente frecuente dejó de venir. Si alguno se demora el doble de lo habitual, va a aparecer acá."
          />
        }
      />
    </Section>
  )
}
