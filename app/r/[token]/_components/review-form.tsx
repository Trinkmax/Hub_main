'use client'

import { Loader2, MessageSquare, PartyPopper, Star } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { submitReview } from '@/lib/reviews/actions'
import { cn } from '@/lib/utils'

// Island público (sin auth) de /r/[token]. Captura rating 1–5 + comentario y
// llama a submitReview. Si la action devuelve redirectTo (Google Maps) navega
// hacia allá; si no, muestra estado de agradecimiento + puntos ganados.

type Status =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; awardedPoints: number }

const STAR_LABELS: Record<number, string> = {
  1: 'Muy mala',
  2: 'Mala',
  3: 'Regular',
  4: 'Buena',
  5: 'Excelente',
}

export function ReviewForm({ token }: { token: string }): React.JSX.Element {
  const groupId = useId()
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()

  // Estrella resaltada: hover (mouse) tiene prioridad sobre la selección fija.
  const display = hovered || rating

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (rating < 1) return
    setStatus({ kind: 'idle' })
    startTransition(async () => {
      const res = await submitReview({
        token,
        rating,
        comment: comment.trim() ? comment.trim() : null,
      })
      if (res.ok && res.redirectTo) {
        // URL externa de Google Maps → navegación dura.
        window.location.href = res.redirectTo
        return
      }
      if (res.ok) {
        setStatus({ kind: 'done', awardedPoints: res.awardedPoints })
        return
      }
      setStatus({ kind: 'error', message: res.message })
    })
  }

  if (status.kind === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center" aria-live="polite">
        <div className="grid size-16 place-items-center rounded-full bg-[var(--brand-accent,var(--primary))]/12 text-[var(--brand-accent,var(--primary))]">
          <PartyPopper className="size-7" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <p className="font-serif text-2xl font-semibold tracking-tight">
            ¡Gracias por tu opinión!
          </p>
          <p className="text-sm text-muted-foreground text-pretty">
            La tomamos muy en cuenta para seguir mejorando.
          </p>
        </div>
        {status.awardedPoints > 0 ? (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-accent,var(--primary))] px-4 py-1.5 text-sm font-semibold text-[var(--brand-accent-foreground,var(--primary-foreground))] shadow-sm">
            <Star className="size-3.5 fill-current" aria-hidden="true" />
            Ganaste {status.awardedPoints} {status.awardedPoints === 1 ? 'punto' : 'puntos'}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Selector de estrellas con semántica de radio-group, accesible por teclado. */}
      <fieldset className="flex flex-col items-center gap-2.5">
        <legend className="sr-only">Elegí una calificación de 1 a 5 estrellas</legend>
        <div
          role="radiogroup"
          aria-label="Calificación"
          className="flex items-center justify-center gap-1.5 sm:gap-2"
          onMouseLeave={() => setHovered(0)}
        >
          {[1, 2, 3, 4, 5].map((value) => {
            const filled = value <= display
            return (
              <label
                key={value}
                className="cursor-pointer p-1"
                onMouseEnter={() => setHovered(value)}
              >
                <input
                  type="radio"
                  name={groupId}
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  className="sr-only"
                  aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'} — ${STAR_LABELS[value]}`}
                />
                <Star
                  className={cn(
                    'size-10 transition-all duration-150 sm:size-12',
                    'peer-focus-visible:scale-110',
                    filled
                      ? 'fill-[var(--brand-accent,var(--primary))] text-[var(--brand-accent,var(--primary))] drop-shadow-sm'
                      : 'fill-transparent text-muted-foreground/35 hover:text-muted-foreground/60',
                  )}
                  aria-hidden="true"
                />
              </label>
            )
          })}
        </div>
        <p
          className={cn(
            'h-5 text-sm font-medium transition-colors',
            display > 0 ? 'text-foreground' : 'text-transparent select-none',
          )}
          aria-hidden="true"
        >
          {display > 0 ? STAR_LABELS[display] : '·'}
        </p>
      </fieldset>

      {/* El comentario aparece recién cuando hay una calificación elegida. */}
      {rating > 0 ? (
        <div className="grid gap-1.5">
          <Label
            htmlFor="review-comment"
            className="flex items-center gap-1.5 text-muted-foreground"
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            Contanos más (opcional)
          </Label>
          <Textarea
            id="review-comment"
            name="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="¿Qué fue lo que más te gustó? ¿Qué podríamos mejorar?"
            className="resize-none"
          />
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {status.message}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={rating < 1 || pending}
        className="w-full bg-[var(--brand-accent,var(--primary))] text-[var(--brand-accent-foreground,var(--primary-foreground))] hover:bg-[var(--brand-accent,var(--primary))]/90"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Enviando…
          </>
        ) : (
          'Enviar opinión'
        )}
      </Button>
    </form>
  )
}
