import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import type { CustomerListRow } from '@/lib/customers/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import { TagPill } from './tag-pill'

export function CustomersTable({
  rows,
  tenantSlug,
}: {
  rows: CustomerListRow[]
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
              return (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition-colors hover:bg-secondary/40"
                >
                  <DataTableCell>
                    <Link
                      href={`/${tenantSlug}/clientes/${c.id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-secondary text-[11px] font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium group-hover:text-primary">
                        {c.first_name} {c.last_name}
                      </span>
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="font-mono text-xs text-muted-foreground">
                    {formatPhoneForDisplay(c.phone)}
                  </DataTableCell>
                  <DataTableCell>
                    {c.tags.length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <TagPill key={t.id} tag={t} />
                        ))}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {c.last_visit_at
                      ? format(new Date(c.last_visit_at), "d 'de' MMM yyyy", { locale: es })
                      : 'Nunca'}
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {c.points_balance.toLocaleString('es-AR')}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="w-8 text-muted-foreground/40 group-hover:text-muted-foreground">
                    <ChevronRight className="size-4" />
                  </DataTableCell>
                </tr>
              )
            })}
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
    </DataTableShell>
  )
}
