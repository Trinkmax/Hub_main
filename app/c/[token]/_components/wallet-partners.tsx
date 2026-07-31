import { Lock } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { WalletCarousel } from './wallet-carousel'

// "Nuestros Aliados": marcas amigas del bar con beneficios para socios.
//
// Cada socio ve, para cada marca, SÓLO el beneficio de SU nivel (decisión del
// dueño: no se acumulan los de abajo). Las marcas que en su nivel no le dan nada
// NO se esconden: se muestran bloqueadas con el nivel que necesita — es el
// motivo más concreto que tiene para querer subir. Los acuerdos que todavía no
// están cerrados (`active = false`) siguen apareciendo como "Próximamente".

type Partner = WalletData['partners'][number]

function PartnerCard({ partner }: { partner: Partner }) {
  const initial = partner.name.trim()[0]?.toUpperCase() ?? '·'
  const mine = partner.active ? partner.myBenefit : null
  const locked = partner.active && !mine && partner.unlockTierName !== null
  // Sin beneficios por nivel cargados, el descuento suelto de la marca sigue
  // siendo la mejor información que tenemos.
  const legacyLabel = partner.active && !mine && !locked ? partner.discountLabel : null
  const dimmed = !partner.active || locked

  return (
    <article className="flex w-32 shrink-0 snap-start flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card p-3 text-center shadow-sm">
      <span
        className={cn(
          'relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-(--cream-tint) font-display text-lg font-semibold text-foreground',
          dimmed && 'opacity-55 saturate-[0.5]',
        )}
      >
        {partner.logoUrl ? (
          <Image
            src={partner.logoUrl}
            alt=""
            width={48}
            height={48}
            // Contain + aire: los logos de marca suelen ser wordmarks anchos y
            // object-cover los recortaba dentro del círculo.
            className="size-full object-contain p-1"
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

      {mine ? (
        <span className="line-clamp-2 rounded-full bg-(--brand-accent)/12 px-2 py-0.5 text-[10px] font-semibold text-(--brand-accent)">
          {mine.discountPct !== null ? `${Math.round(mine.discountPct)}% · ` : ''}
          {mine.label}
        </span>
      ) : locked ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <Lock className="size-2.5" aria-hidden="true" />
          Desde {partner.unlockTierName}
        </span>
      ) : legacyLabel ? (
        <span className="rounded-full bg-(--brand-accent)/12 px-2 py-0.5 text-[10px] font-semibold text-(--brand-accent)">
          {legacyLabel}
        </span>
      ) : (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Próximamente
        </span>
      )}
    </article>
  )
}

export function WalletPartners({
  partners,
  tierName,
}: {
  partners: Partner[]
  /** Nivel actual del socio, para decir en voz alta qué está viendo. */
  tierName?: string | null
}): React.JSX.Element | null {
  if (partners.length === 0) return null
  return (
    <section aria-labelledby="aliados-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="aliados-heading" className="font-display text-lg font-semibold tracking-tight">
          Nuestros Aliados
        </h2>
        <p className="text-xs text-muted-foreground text-balance">
          {tierName
            ? `Lo que te dan hoy en cada marca por ser ${tierName}. Las bloqueadas se abren al subir de nivel.`
            : 'Descuentos exclusivos en marcas amigas para los socios del club.'}
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
