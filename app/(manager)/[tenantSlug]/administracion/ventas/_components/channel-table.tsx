import { Term } from '@/components/administracion/kit'
import { PRow, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
import { formatCents } from '@/lib/money'
import type { ChannelSales } from '../_lib/invoiced-view'

/**
 * «Por canal»: lo vendido, lo facturado y lo que quedó sin factura en el salón, el delivery y los
 * eventos, con centavos: es una tabla de la contadora. En el celular se desliza de costado.
 */
export function ChannelTable({
  channels,
  caption,
}: {
  channels: readonly ChannelSales[]
  caption: string
}) {
  const sum = (pick: (channel: ChannelSales) => number) =>
    channels.reduce((total, channel) => total + pick(channel), 0)
  return (
    <PTable minWidth={620} label={caption}>
      <thead>
        <tr>
          <PTh>Canal</PTh>
          <PTh align="right">Vendido</PTh>
          <PTh align="right">Facturado sin IVA</PTh>
          <PTh align="right">
            <Term name="IVA débito fiscal">IVA de lo facturado</Term>
          </PTh>
          <PTh align="right">Sin factura</PTh>
        </tr>
      </thead>
      <tbody>
        {channels.map((c) => (
          <PRow key={c.channel}>
            <PTd className="font-medium">{c.label}</PTd>
            <PTd align="right">{formatCents(c.soldCents)}</PTd>
            <PTd align="right">{formatCents(c.invoicedNetCents)}</PTd>
            <PTd align="right">{formatCents(c.vatCents)}</PTd>
            <PTd align="right">{formatCents(c.uninvoicedCents)}</PTd>
          </PRow>
        ))}
      </tbody>
      <tfoot>
        <PTotalRow>
          <PTd>Total</PTd>
          <PTd align="right">{formatCents(sum((c) => c.soldCents))}</PTd>
          <PTd align="right">{formatCents(sum((c) => c.invoicedNetCents))}</PTd>
          <PTd align="right">{formatCents(sum((c) => c.vatCents))}</PTd>
          <PTd align="right">{formatCents(sum((c) => c.uninvoicedCents))}</PTd>
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}
