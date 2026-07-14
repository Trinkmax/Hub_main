import { notFound } from 'next/navigation'
import { CartaBrand } from '@/app/carta/[tenantSlug]/_components/carta-brand'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { getReviewContextByToken } from '@/lib/reviews/queries'
import { ReviewForm } from './_components/review-form'

export const metadata = { title: 'Tu opinión' }
export const dynamic = 'force-dynamic'

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await getReviewContextByToken(token)
  if (!ctx) notFound()

  return (
    <BrandAccent accent={ctx.brandAccent} className="min-h-[100dvh] bg-background">
      <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
        <section
          aria-labelledby="review-heading"
          className="card-hairline w-full max-w-md rounded-3xl border bg-card p-7 shadow-lg sm:p-9"
        >
          <header className="flex flex-col items-center gap-4 text-center">
            {/* El logo es un wordmark ancho: iba dentro de un marco cuadrado con
                object-cover y quedaba RECORTADO ("HUB!" → "UB"). Va sin marco y
                contenido, igual que en la carta. */}
            <CartaBrand
              tenantName={ctx.tenantName}
              logoUrl={ctx.logoUrl}
              className="h-12 max-w-[200px]"
            />

            <h1
              id="review-heading"
              className="text-balance font-serif text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]"
            >
              ¿Cómo estuvo tu experiencia, {ctx.firstName}?
            </h1>
            <p className="max-w-[34ch] text-pretty text-sm text-muted-foreground">
              Tu opinión nos ayuda a mejorar. Tocá las estrellas para calificar.
            </p>
          </header>

          <div className="mt-7">
            <ReviewForm token={token} />
          </div>
        </section>
      </main>
    </BrandAccent>
  )
}
