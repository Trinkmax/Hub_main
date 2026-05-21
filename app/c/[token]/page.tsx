import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { getAppUrl } from '@/lib/app-url'
import { getCustomerPanelByToken } from '@/lib/c-panel/queries'
import { CustomerPanelLayout } from './_components/customer-panel-layout'

export const metadata = { title: 'Mi cuenta' }
export const dynamic = 'force-dynamic'

export default async function CustomerPanelPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const data = await getCustomerPanelByToken(token)
  if (!data) notFound()

  const appUrl = await getAppUrl()
  const qrUrl = `${appUrl}/c/${data.customer.qr_token}`
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 360,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })

  return (
    <CustomerPanelLayout
      tenantName={data.tenant.name}
      firstName={data.customer.first_name}
      lastName={data.customer.last_name}
      pointsBalance={data.customer.points_balance}
      lunchCard={data.active_lunch_card}
      upcomingEvents={data.upcoming_events}
      qrDataUrl={qrDataUrl}
      qrToken={data.customer.qr_token}
    />
  )
}
