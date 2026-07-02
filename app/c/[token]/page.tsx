import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { getAppUrl } from '@/lib/app-url'
import { getWalletByToken } from '@/lib/wallet/queries'
import { WalletShell } from './_components/wallet-shell'

export const metadata = { title: 'Mi wallet' }
export const dynamic = 'force-dynamic'

export default async function CustomerWalletPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const data = await getWalletByToken(token)
  if (!data) notFound()

  const appUrl = await getAppUrl()
  const qrUrl = `${appUrl}/c/${data.customer.qrToken}`
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 360,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })

  return (
    <BrandAccent
      accent={data.tenant.brandAccent}
      className="force-light min-h-[100dvh] bg-background"
    >
      <WalletShell data={data} qrDataUrl={qrDataUrl} />
    </BrandAccent>
  )
}
