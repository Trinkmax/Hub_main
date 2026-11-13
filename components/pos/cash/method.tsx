import {
  ArrowLeftRight,
  Banknote,
  CircleEllipsis,
  CreditCard,
  type LucideIcon,
  QrCode,
  WalletCards,
} from 'lucide-react'
import { METHOD_LABEL, type PayMethod } from '@/lib/pos/cash/types'

/** Cada medio de pago con su dibujo: siempre va con la palabra al lado, nunca solo. */
export const METHOD_ICON: Readonly<Record<PayMethod, LucideIcon>> = {
  cash: Banknote,
  transfer: ArrowLeftRight,
  qr: QrCode,
  debit: WalletCards,
  credit: CreditCard,
  other: CircleEllipsis,
}

export function MethodMark({ method }: { method: PayMethod }) {
  const Icon = METHOD_ICON[method]
  return (
    <span className="caja-method">
      <Icon aria-hidden strokeWidth={2.3} />
      {METHOD_LABEL[method]}
    </span>
  )
}
