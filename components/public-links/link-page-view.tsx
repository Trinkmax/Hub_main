import { ArrowUpRight } from 'lucide-react'
import Image from 'next/image'
import { CURATED_ICONS } from '@/components/icons/curated-lucide'
import { BrandWordmark } from '@/components/shell/brand-mark'
import { cn } from '@/lib/utils'

export type LinkPageLink = {
  id: string
  label: string
  description: string | null
  url: string
  icon: string | null
  highlight: boolean
}

/**
 * La página pública de links, como la ve quien llega desde Instagram.
 *
 * Vive en /components (no en la ruta) porque la renderizan DOS lados: la página
 * real `/l/[slug]` y la vista previa del editor. Compartir el componente es lo
 * que garantiza que la previa no mienta.
 *
 * Identidad HUB: papel crema (`--background` del tema claro) con tinta forest.
 * Va siempre envuelta en `.force-light` — la página es la vitrina del bar y no
 * tiene por qué cambiar de color según el modo oscuro del celular de quien mira.
 */
export function LinkPageView({
  tenantName,
  headline,
  bio,
  logoUrl,
  links,
  /** false = vista previa: los botones se ven pero no navegan. */
  interactive = true,
  className,
}: {
  tenantName: string
  headline: string | null
  bio: string | null
  logoUrl: string | null
  links: LinkPageLink[]
  interactive?: boolean
  className?: string
}) {
  const title = headline?.trim() || tenantName

  return (
    <div className={cn('relative isolate overflow-hidden bg-background', className)}>
      {/* Halo suave arriba: le da profundidad al crema sin romper el plano. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklch,var(--brand-accent)_16%,transparent),transparent)]"
      />

      <div className="relative mx-auto flex w-full max-w-[26rem] flex-col items-center px-5 py-12 sm:py-14">
        {/* El logo va solo, grande y sin marco: ya dice el nombre del bar, así
            que repetirlo abajo en serif era decir dos veces lo mismo. El título
            sigue existiendo para lectores de pantalla y para el SEO, pero no se
            dibuja. Sin logo cargado sí se muestra, porque es lo único que
            identifica al bar. */}
        {logoUrl ? (
          <>
            <Image
              src={logoUrl}
              alt={title}
              width={640}
              height={272}
              // El optimizer de Vercel está apagado en este proyecto (loader
              // custom): el logo va tal cual, y es lo primero que se ve.
              unoptimized
              priority
              className="h-auto w-60 max-w-full object-contain sm:w-72"
            />
            <h1 className="sr-only">{title}</h1>
          </>
        ) : (
          <>
            <BrandWordmark className="text-3xl" />
            <h1 className="mt-6 text-balance text-center font-serif text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">
              {title}
            </h1>
          </>
        )}

        {bio ? (
          <p className="mt-5 max-w-[22rem] text-pretty text-center text-sm leading-relaxed text-muted-foreground">
            {bio}
          </p>
        ) : null}

        {links.length > 0 ? (
          <nav className="mt-8 flex w-full flex-col gap-3" aria-label={`Links de ${tenantName}`}>
            {links.map((link) => (
              <LinkButton key={link.id} link={link} interactive={interactive} />
            ))}
          </nav>
        ) : (
          <p className="mt-10 rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            Todavía no hay links cargados.
          </p>
        )}

        <p className="mt-10 text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground/70">
          {tenantName}
        </p>
      </div>
    </div>
  )
}

function LinkButton({ link, interactive }: { link: LinkPageLink; interactive: boolean }) {
  // `Object.hasOwn` y no un índice suelto: `CURATED_ICONS` es un objeto literal
  // y `CURATED_ICONS['constructor']` devolvería `Object`, que React intentaría
  // renderizar como componente y tiraría abajo la página pública Y su previa.
  // El schema ya valida el nombre; esto es la segunda cerradura, porque acá
  // llega cualquier fila que haya en la DB.
  const Icon =
    link.icon && Object.hasOwn(CURATED_ICONS, link.icon) ? CURATED_ICONS[link.icon] : undefined

  const className = cn(
    'group relative flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left',
    'transition-[transform,background-color,box-shadow,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    interactive && 'active:scale-[0.99]',
    link.highlight
      ? 'border-transparent bg-(--brand-accent) text-(--brand-accent-foreground) shadow-sm hover:opacity-92'
      : 'border-(--brand-accent)/20 bg-card text-foreground shadow-2xs hover:border-(--brand-accent)/35 hover:bg-cream-tint',
  )

  const content = (
    <>
      {Icon ? (
        <Icon
          className={cn(
            'size-5 shrink-0',
            link.highlight ? 'opacity-90' : 'text-(--brand-accent) opacity-80',
          )}
          aria-hidden
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug">{link.label}</span>
        {link.description ? (
          <span
            className={cn(
              'mt-0.5 block text-xs leading-snug',
              link.highlight ? 'opacity-85' : 'text-muted-foreground',
            )}
          >
            {link.description}
          </span>
        ) : null}
      </span>
      <ArrowUpRight
        className={cn(
          'size-4 shrink-0 transition-transform duration-[var(--duration-fast)]',
          'group-hover:-translate-y-0.5 group-hover:translate-x-0.5',
          link.highlight ? 'opacity-80' : 'text-muted-foreground',
        )}
        aria-hidden
      />
    </>
  )

  if (!interactive) {
    return (
      <span className={className} aria-disabled>
        {content}
      </span>
    )
  }

  return (
    <a
      href={link.url}
      target="_blank"
      // noopener/noreferrer obligatorio: son links de terceros cargados por el bar.
      rel="noopener noreferrer"
      className={className}
    >
      {content}
    </a>
  )
}
