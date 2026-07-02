import Image from 'next/image'
import type { WalletData } from '@/lib/wallet/queries'
import { WalletCarousel } from './wallet-carousel'

// "Nuestros Aliados": marcas amigas del bar con beneficios para socios. Los
// acuerdos todavía no están cerrados (partners.active = false) → se muestran como
// "Próximamente"; cuando se activan, muestran su descuento.

type Partner = WalletData['partners'][number]

function PartnerCard({ partner }: { partner: Partner }) {
  const initial = partner.name.trim()[0]?.toUpperCase() ?? '·'
  const live = partner.active && Boolean(partner.discountLabel)
  return (
    <article className="flex w-32 shrink-0 snap-start flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card p-3 text-center shadow-sm">
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-(--cream-tint) font-display text-lg font-semibold text-foreground">
        {partner.logoUrl ? (
          <Image
            src={partner.logoUrl}
            alt=""
            width={48}
            height={48}
            className="size-full object-cover"
            unoptimized
          />
        ) : (
          initial
        )}
      </span>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-foreground">
          {partner.name}
        </p>
        {partner.category ? (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
            {partner.category}
          </p>
        ) : null}
      </div>
      {live ? (
        <span className="rounded-full bg-(--brand-accent)/12 px-2 py-0.5 text-[10px] font-semibold text-(--brand-accent)">
          {partner.discountLabel}
        </span>
      ) : (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Próximamente
        </span>
      )}
    </article>
  )
}

export function WalletPartners({ partners }: { partners: Partner[] }): React.JSX.Element | null {
  if (partners.length === 0) return null
  return (
    <section aria-labelledby="aliados-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="aliados-heading" className="font-display text-lg font-semibold tracking-tight">
          Nuestros Aliados
        </h2>
        <p className="text-xs text-muted-foreground">
          Descuentos exclusivos en marcas amigas para los socios de HUB.
        </p>
      </div>
      <WalletCarousel>
        {partners.map((partner) => (
          <PartnerCard key={partner.id} partner={partner} />
        ))}
      </WalletCarousel>
    </section>
  )
}
