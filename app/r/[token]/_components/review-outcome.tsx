'use client'

import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  PartyPopper,
  Star,
} from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { attachReviewComment } from '@/lib/reviews/actions'

// Pantalla posterior al envío de la reseña. Tres salidas posibles:
//   1. Puente a Google (5★ con enlace de Maps cargado) — un botón, un gesto.
//      Google NO permite pre-cargar el texto de la reseña por URL, así que le
//      copiamos el comentario al portapapeles y se lo decimos.
//   2. WhatsApp de feedback (puntajes bajos, si el dueño cargó el número).
//   3. Sólo agradecimiento.
// En las tres, el cliente termina con una salida al club: antes era un dead-end.

export type ReviewOutcomeProps = {
  token: string
  firstName: string
  reviewId: string
  rating: number
  awardedPoints: number
  googleUrl: string | null
  whatsappUrl: string | null
  initialComment: string
}

export function ReviewOutcome({
  token,
  firstName,
  reviewId,
  rating,
  awardedPoints,
  googleUrl,
  whatsappUrl,
  initialComment,
}: ReviewOutcomeProps): React.JSX.Element {
  const [comment, setComment] = useState(initialComment)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const isBridge = Boolean(googleUrl)
  const alreadyCommented = initialComment.trim().length > 0
  const trimmed = comment.trim()

  // Las 5★ se envían solas al tocar la quinta estrella, así que quien no había
  // escrito nada se quedaba sin poder hacerlo: acá le damos la segunda chance.
  // En el brazo de WhatsApp no la ofrecemos — ahí la salida es la conversación,
  // y dos cajas de texto compitiendo es una de más.
  const offerComment = !alreadyCommented && !whatsappUrl

  function persistComment(): void {
    if (!trimmed || trimmed === initialComment.trim()) return
    setSaveError(null)
    startTransition(async () => {
      const res = await attachReviewComment({ token, reviewId, comment: trimmed })
      if (res.ok) setSaved(true)
      else setSaveError(res.message)
    })
  }

  // Todo esto corre DENTRO del click del ancla: el portapapeles necesita gesto
  // del usuario y la navegación es nativa (nunca la bloquea el navegador).
  function handlePublishClick(): void {
    if (!trimmed) return
    navigator.clipboard
      ?.writeText(trimmed)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
    persistComment()
  }

  return (
    <div className="mt-5 flex flex-col items-center gap-5 text-center" aria-live="polite">
      <div className="grid size-16 place-items-center rounded-full bg-[var(--brand-accent,var(--primary))]/12 text-[var(--brand-accent,var(--primary))]">
        <PartyPopper className="size-7" aria-hidden="true" />
      </div>

      <div className="space-y-1.5">
        <h1
          id="review-heading"
          className="font-serif text-2xl font-semibold tracking-tight sm:text-[28px]"
        >
          ¡Gracias, {firstName}!
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {isBridge
            ? 'Nos hiciste el día. ¿Nos das una mano y lo contás en Google? Tarda 10 segundos.'
            : rating <= 3
              ? 'Ya guardamos tu opinión y la vamos a leer. Queremos que la próxima sea mejor.'
              : 'Ya guardamos tu opinión. La tomamos muy en cuenta para seguir mejorando.'}
        </p>
      </div>

      {awardedPoints > 0 ? (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-accent,var(--primary))] px-4 py-1.5 text-sm font-semibold text-[var(--brand-accent-foreground,var(--primary-foreground))] shadow-sm">
          <Star className="size-3.5 fill-current" aria-hidden="true" />
          Ganaste {awardedPoints} {awardedPoints === 1 ? 'punto' : 'puntos'}
        </div>
      ) : null}

      {isBridge && googleUrl ? (
        <div className="w-full space-y-3">
          {alreadyCommented ? (
            <div className="rounded-xl border border-dashed bg-(--cream-tint) p-3 text-left">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {copied ? (
                  <Check className="size-3.5 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
                {copied ? '¡Copiado! Pegalo en Google' : 'Copiamos tu comentario: pegalo en Google'}
              </p>
              <p className="mt-1.5 text-sm text-foreground text-pretty">“{trimmed}”</p>
            </div>
          ) : (
            <div className="grid gap-1.5 text-left">
              <Label htmlFor="bridge-comment" className="text-muted-foreground">
                ¿Querés dejar unas palabras? (opcional)
              </Label>
              <Textarea
                id="bridge-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Lo que más te gustó de tu visita…"
                className="resize-none"
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground text-pretty">
                {copied ? (
                  <>
                    <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                    Lo copiamos al portapapeles: pegalo en Google.
                  </>
                ) : (
                  'Google no deja dejarlo escrito de antemano, así que te lo copiamos al portapapeles para que lo pegues allá.'
                )}
              </p>
            </div>
          )}

          <Button
            asChild
            size="xl"
            className="h-12 w-full bg-[var(--brand-accent,var(--primary))] text-[var(--brand-accent-foreground,var(--primary-foreground))] hover:bg-[var(--brand-accent,var(--primary))]/90"
          >
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handlePublishClick}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Publicar en Google
            </a>
          </Button>
        </div>
      ) : null}

      {!isBridge && whatsappUrl ? (
        <div className="w-full space-y-2">
          <Button asChild size="xl" variant="outline" className="h-12 w-full">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden="true" />
              Mandanos el detalle por WhatsApp
            </a>
          </Button>
          <p className="text-xs text-muted-foreground text-pretty">
            Se abre WhatsApp con el mensaje ya escrito. Lo lee el dueño, no un bot.
          </p>
        </div>
      ) : null}

      {!isBridge && offerComment ? (
        <div className="grid w-full gap-1.5 text-left">
          {saved ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-foreground">
              <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
              Listo, sumamos tu comentario. ¡Gracias!
            </p>
          ) : (
            <>
              <Label htmlFor="outcome-comment" className="text-muted-foreground">
                ¿Querés contarnos algo más? (opcional)
              </Label>
              <Textarea
                id="outcome-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Lo que más te gustó de tu visita…"
                className="resize-none"
              />
              {saveError ? (
                <p role="alert" className="text-xs text-destructive">
                  {saveError} Probá de nuevo.
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                disabled={!trimmed || pending}
                onClick={persistComment}
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Guardando…
                  </>
                ) : (
                  'Enviar comentario'
                )}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {/* Salida del dead-end: la reseña sale de la billetera, así que volvemos a ella. */}
      <Link
        href={`/c/${token}`}
        className="card-hairline group flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors hover:border-(--brand-accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-accent) focus-visible:ring-offset-2"
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-accent,var(--primary))]/12 text-[var(--brand-accent,var(--primary))]">
          <Star className="size-5 fill-current" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">
            {awardedPoints > 0 ? 'Mirá tus puntos en el club' : 'Entrá al club de beneficios'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            Tus puntos, tu nivel y los beneficios que ya tenés disponibles.
          </p>
        </div>
        <ChevronRight
          className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </div>
  )
}
