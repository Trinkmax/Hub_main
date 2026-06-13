import Image from 'next/image'
import type { WalletData } from '@/lib/wallet/queries'

// Encabezado de la wallet: logo del bar (si hay) o nombre, + saludo personal.

type Tenant = WalletData['tenant']

export function WalletHeader({
  tenant,
  firstName,
}: {
  tenant: Tenant
  firstName: string
}): React.JSX.Element {
  return (
    <header className="flex flex-col items-center text-center">
      {tenant.logoUrl ? (
        <Image
          src={tenant.logoUrl}
          alt={tenant.name}
          width={96}
          height={96}
          className="h-12 w-auto max-w-[160px] object-contain"
          unoptimized
          priority
        />
      ) : (
        <p className="font-serif text-xl font-semibold tracking-tight">{tenant.name}</p>
      )}

      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Hola, {firstName}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Tu billetera de beneficios</p>
    </header>
  )
}
