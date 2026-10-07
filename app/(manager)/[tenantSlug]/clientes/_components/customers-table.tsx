import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import type { CustomerListRow } from '@/lib/customers/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { TagPill } from './tag-pill'

export function CustomersTable({
  rows,
  total,
  tenantSlug,
}: {
  rows: CustomerListRow[]
  total: number
  tenantSlug: string
}) {
  return (
    <DataTableShell>
      <DataTableScroll>
        <DataTableRoot>
          <DataTableHead>
            <tr>
              <DataTableHeader>Cliente</DataTableHeader>
              <DataTableHeader>Teléfono</DataTableHeader>
              <DataTableHeader>Etiquetas</DataTableHeader>
              <DataTableHeader>Última visita</DataTableHeader>
              <DataTableHeader className="text-right">Puntos</DataTableHeader>
              <DataTableHeader className="w-8" />
            </tr>
          </DataTableHead>
          <DataTableBody>
            {rows.map((c) => {
              const initials =
                `${c.first_name?.[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase() || '?'
              const hasPoints = c.points_balance > 0
              return (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[--cream-tint]"
                >
                  <DataTableCell>
                    <Link
                      href={`/${tenantSlug}/clientes/${c.id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <span className="block truncate font-medium group-hover:text-primary">
                          {c.first_name} {c.last_name}
                        </span>
                        {c.total_visits > 0 ? (
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {c.total_visits} {c.total_visits === 1 ? 'visita' : 'visitas'}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="font-mono text-xs text-muted-foreground">
                    {formatPhoneForDisplay(c.phone)}
                  </DataTableCell>
                  <DataTableCell>
                    {c.tags.length === 0 ? (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <TagPill key={t.id} tag={t} />
                        ))}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    {c.last_visit_at ? (
                      <span
                        className="text-xs text-muted-foreground"
                        title={format(new Date(c.last_visit_at), "d 'de' MMM yyyy", { locale: es })}
                      >
                        {formatDistanceToNow(new Date(c.last_visit_at), {
                          locale: es,
                          addSuffix: true,
                        })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-muted-foreground/40"
                        />
                        Sin visitas aún
                      </span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                        hasPoints ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50',
                      )}
                    >
                      {c.points_balance.toLocaleString('es-AR')}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="w-8 text-muted-foreground/30 transition-opacity group-hover:text-muted-foreground">
                    <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </DataTableCell>
                </tr>
              )
            })}
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
      <DataTableFooter>
        <span>
          Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
          <strong className="tabular-nums text-foreground">{total.toLocaleString('es-AR')}</strong>
        </span>
      </DataTableFooter>
    </DataTableShell>
  )
}
