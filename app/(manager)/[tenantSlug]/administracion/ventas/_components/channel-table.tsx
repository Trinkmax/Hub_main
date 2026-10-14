import { Amount } from '@/components/administracion/amount'
import { Term } from '@/components/administracion/kit'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
} from '@/components/ui/data-table'
import type { ChannelSales } from '../_lib/invoiced-view'

/**
 * «Por canal»: lo vendido, lo facturado y lo que quedó sin factura en el
 * salón, el delivery y los eventos. Es la vista «Ver como tabla» de «Lo que se
 * facturó» (la que abre por defecto quien solo mira), sin encabezado ni
 * tarjeta propios. En el celular se desliza de costado: es una tabla de la
 * contadora, no una lista del dueño.
 */
export function ChannelTable({
  channels,
  caption,
}: {
  channels: readonly ChannelSales[]
  caption: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <DataTableScroll>
        <DataTableRoot>
          <caption className="sr-only">{caption}</caption>
          <DataTableHead>
            <tr>
              <DataTableHeader>Canal</DataTableHeader>
              <DataTableHeader className="text-right">Vendido</DataTableHeader>
              <DataTableHeader className="text-right">Facturado sin IVA</DataTableHeader>
              <DataTableHeader className="text-right">
                <Term name="IVA débito fiscal">IVA de lo facturado</Term>
              </DataTableHeader>
              <DataTableHeader className="text-right">Sin factura</DataTableHeader>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {channels.map((c) => (
              <tr key={c.channel}>
                <DataTableCell className="font-medium">{c.label}</DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={c.soldCents} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={c.invoicedNetCents} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={c.vatCents} />
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Amount cents={c.uninvoicedCents} />
                </DataTableCell>
              </tr>
            ))}
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
    </div>
  )
}
