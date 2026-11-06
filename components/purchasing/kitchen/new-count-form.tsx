'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addDays } from '@/lib/dates'
import { startCount } from '@/lib/purchasing/kitchen-actions'
import { COUNT_KIND_LABELS, type CountKind } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'

const NAME_KEY = 'hub_pur_name'

export function rememberedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name)
  } catch {
    // Sin almacenamiento (modo privado): se vuelve a escribir la próxima vez.
  }
}

const KIND_HINT: Record<CountKind, string> = {
  order: 'El conteo de siempre: se recorren todas las zonas.',
  top_up: 'Un conteo extra entre medio: contá solo lo que haga falta.',
}

/** «Nuevo conteo»: quién cuenta y hasta qué día tienen que alcanzar los eventos. */
export function NewCountForm({
  slug,
  today,
  defaultUntil,
  defaultName,
}: {
  slug: string
  today: string
  defaultUntil: string
  defaultName: string | null
}) {
  const router = useRouter()
  const [kind, setKind] = useState<CountKind>('order')
  const [name, setName] = useState(defaultName ?? '')
  const [date, setDate] = useState(today)
  const [until, setUntil] = useState(defaultUntil)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    // El celular de la cocina lo usa más de una persona: gana el último nombre escrito en este equipo.
    const saved = rememberedName()
    if (saved) setName(saved)
  }, [])

  const submit = () => {
    const who = name.trim()
    if (!who) {
      setError('Escribí quién cuenta.')
      return
    }
    if (!date || !until || until < date) {
      setError('«Contar para los eventos hasta» no puede ser antes de la fecha.')
      return
    }
    setError(null)
    rememberName(who)
    start(async () => {
      const res = await startCount({
        slug,
        kind,
        countDate: date,
        eventsUntil: until,
        countedByName: who,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      router.push(`/${slug}/salon/stock/conteo/${res.countId}`)
    })
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-8">
      <Link
        href={`/${slug}/salon/stock`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Inicio
      </Link>
      <h1 className="mt-2 font-serif text-[2rem] font-semibold leading-tight tracking-[-0.015em] text-primary">
        Nuevo conteo
      </h1>

      <form
        className="mt-5 space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <fieldset className="space-y-2">
          <legend className="sr-only">Tipo de conteo</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['order', 'top_up'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'h-14 rounded-2xl border text-base font-semibold transition-colors',
                  kind === k
                    ? 'border-primary bg-accent text-primary'
                    : 'border-border bg-card text-foreground active:bg-muted',
                )}
              >
                {COUNT_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{KIND_HINT[kind]}</p>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="pur-who">Quién cuenta</Label>
          <Input
            id="pur-who"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            placeholder="Tu nombre"
            maxLength={60}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pur-date">Fecha</Label>
          <Input
            id="pur-date"
            type="date"
            value={date}
            min={addDays(today, -7)}
            max={addDays(today, 7)}
            onChange={(e) => setDate(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pur-until">Contar para los eventos hasta</Label>
          <Input
            id="pur-until"
            type="date"
            value={until}
            min={date}
            onChange={(e) => setUntil(e.target.value)}
            className="h-12 text-base"
          />
          <p className="text-sm text-muted-foreground">
            Lo que piden los eventos hasta ese día se suma al pedido y se cuenta exacto.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-warning/15 px-3 py-2 text-sm text-warning-text">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="h-14 w-full rounded-2xl text-base"
        >
          {pending ? 'Preparando…' : 'Empezar'}
        </Button>
      </form>
    </div>
  )
}
