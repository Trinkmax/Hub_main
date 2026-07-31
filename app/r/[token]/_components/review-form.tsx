'use client'

import { Loader2, MessageSquare, Star } from 'lucide-react'
import { useId, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { submitReview } from '@/lib/reviews/actions'
import { cn } from '@/lib/utils'
import { ReviewOutcome } from './review-outcome'

// Island público (sin auth) de /r/[token]. Captura rating 1–5 + comentario y
// llama a submitReview.
//
// ITEM 4 — decisión del dueño: "si pone 5 estrellas se lo redirige a Google
// apenas toca la quinta; si no, va al WhatsApp para que llegue el feedback".
// Por eso 5★ envía sola, sin botón. Lo que NO hacemos es una navegación dura
// automática: la reseña se guarda y mostramos una pantalla puente con un botón
// grande. Ese click es el gesto de usuario que (a) evita que el navegador
// bloquee la apertura de Google y (b) habilita copiar el comentario al
// portapapeles, porque Google no deja pre-cargar el texto por URL.

type Outcome = {
  reviewId: string
  rating: number
  awardedPoints: number
  googleUrl: string | null
  whatsappUrl: string | null
  comment: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; outcome: Outcome }

const STAR_LABELS: Record<number, string> = {
  1: 'Muy mala',
  2: 'Mala',
  3: 'Regular',
  4: 'Buena',
  5: 'Excelente',
}

export function ReviewForm({
  token,
  firstName,
}: {
  token: string
  firstName: string
}): React.JSX.Element {
  const groupId = useId()
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [autoSending, setAutoSending] = useState(false)
  const [pending, startTransition] = useTransition()
  // El auto-envío de 5★ vale para dedo/mouse. Con teclado, las flechas recorren
  // el radiogroup y pasar por la quinta estrella no puede enviar sin querer:
  // ahí dejamos el botón de siempre.
  const pointerRef = useRef(false)

  // Estrella resaltada: hover (mouse) tiene prioridad sobre la selección fija.
  const display = hovered || rating

  function send(value: number, body: string, auto: boolean): void {
    setStatus({ kind: 'idle' })
    setAutoSending(auto)
    startTransition(async () => {
      const res = await submitReview({
        token,
        rating: value,
        comment: body.trim() ? body.trim() : null,
      })
      setAutoSending(false)
      if (!res.ok) {
        setStatus({ kind: 'error', message: res.message })
        return
      }
      setStatus({
        kind: 'done',
        outcome: {
          reviewId: res.reviewId,
          rating: value,
          awardedPoints: res.awardedPoints,
          googleUrl: res.redirectTo,
          whatsappUrl: res.feedbackWhatsappUrl,
          comment: body.trim(),
        },
      })
    })
  }

  function handleSelect(value: number): void {
    setRating(value)
    const byPointer = pointerRef.current
    pointerRef.current = false
    if (value === 5 && byPointer) send(5, comment, true)
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (rating < 1 || pending) return
    send(rating, comment, false)
  }

  if (status.kind === 'done') {
    return (
      <ReviewOutcome
        token={token}
        firstName={firstName}
        reviewId={status.outcome.reviewId}
        rating={status.outcome.rating}
        awardedPoints={status.outcome.awardedPoints}
        googleUrl={status.outcome.googleUrl}
        whatsappUrl={status.outcome.whatsappUrl}
        initialComment={status.outcome.comment}
      />
    )
  }

  if (autoSending) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        aria-live="polite"
        aria-busy="true"
      >
        <h1
          id="review-heading"
          className="font-serif text-2xl font-semibold tracking-tight sm:text-[28px]"
        >
          ¡Cinco estrellas!
        </h1>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <Star
              key={value}
              className="size-7 animate-pulse fill-[var(--brand-accent,var(--primary))] text-[var(--brand-accent,var(--primary))]"
              style={{ animationDelay: `${value * 70}ms` }}
              aria-hidden="true"
            />
          ))}
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Guardando tus 5 estrellas…
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1
          id="review-heading"
          className="text-balance font-serif text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]"
        >
          ¿Cómo estuvo tu experiencia, {firstName}?
        </h1>
        <p className="max-w-[34ch] text-pretty text-sm text-muted-foreground">
          Tu opinión nos ayuda a mejorar. Tocá las estrellas para calificar.
        </p>
      </header>

      {/* Selector de estrellas con semántica de radio-group, accesible por teclado. */}
      <fieldset className="flex flex-col items-center gap-2.5">
        <legend className="sr-only">Elegí una calificación de 1 a 5 estrellas</legend>
        <div
          role="radiogroup"
          aria-label="Calificación"
          className="flex items-center justify-center gap-1.5 sm:gap-2"
          onMouseLeave={() => setHovered(0)}
          // Un pointerdown que no terminó en selección (arrastró el dedo fuera de
          // la estrella) dejaba la marca pegada: si después llegaba a la quinta
          // con las flechas, enviaba sola. El teclado siempre limpia la marca.
          onKeyDown={() => {
            pointerRef.current = false
          }}
        >
          {[1, 2, 3, 4, 5].map((value) => {
            const filled = value <= display
            return (
              <label
                key={value}
                className="cursor-pointer p-1"
                onMouseEnter={() => setHovered(value)}
                onPointerDown={() => {
                  pointerRef.current = true
                }}
              >
                <input
                  type="radio"
                  name={groupId}
                  value={value}
                  checked={rating === value}
                  onChange={() => handleSelect(value)}
                  className="peer sr-only"
                  aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'} — ${STAR_LABELS[value]}`}
                />
                <Star
                  className={cn(
                    'size-10 transition-all duration-150 sm:size-12',
                    'peer-focus-visible:scale-110 peer-focus-visible:drop-shadow-md',
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
            {rating <= 3 ? '¿Qué podríamos haber hecho mejor?' : 'Contanos más (opcional)'}
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
          {status.message} Probá de nuevo tocando el botón.
        </p>
      ) : null}

      <Button
        type="submit"
        size="xl"
        disabled={rating < 1 || pending}
        className="h-12 w-full bg-[var(--brand-accent,var(--primary))] text-[var(--brand-accent-foreground,var(--primary-foreground))] hover:bg-[var(--brand-accent,var(--primary))]/90"
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
