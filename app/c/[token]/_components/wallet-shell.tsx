import type { WalletData } from '@/lib/wallet/queries'
import { WalletViews } from './wallet-views'

// Wrapper delgado: la wallet es un orquestador de vistas in-place (ver
// wallet-views.tsx). Lo usan la página standalone /c/[token] y el sheet embebido
// de la carta; el `embedded` sólo omite el saludo (el sheet ya lo provee).

export function WalletShell({
  data,
  qrDataUrl,
  embedded = false,
}: {
  data: WalletData
  qrDataUrl: string
  embedded?: boolean
}): React.JSX.Element {
  return <WalletViews data={data} qrDataUrl={qrDataUrl} embedded={embedded} />
}
