'use client'

import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ChoiceCard, EmptyTeach, Panel, Pill } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { saveMercadoPagoImportSettings } from '@/lib/imports/actions'
import type { MpCobroChannel } from '@/lib/imports/server/types'
import { MP_SETTINGS_CHANNELS, mpSettingsInput } from '@/lib/imports/ui/payloads'
import { ANSWER_BUTTON, QuestionAnswers, QuestionCard } from './review/question-card'
import { MpChannelMap } from './upload/mp-channel-map'

/** Lo que la página trae de `getMpImportSettings` (sin token). */
export type MpSettingsView = {
  connection: {
    treasuryAccountId: string
    channelMethods: Partial<Record<MpCobroChannel, string>>
    dayCutoffHour: number
    updatedAt: string | null
  } | null
  effective: {
    treasuryId: string
    partyId: string
    channelMethods: Partial<Record<MpCobroChannel, string>>
    inferred: MpCobroChannel[]
  } | null
  wallets: Array<{ id: string; name: string; hasCvu: boolean }>
  methods: Array<{ id: string; name: string; kind: string; partyId: string | null }>
  ownAccounts: number
}

const CHANNEL_SHORT: Readonly<Record<MpCobroChannel, string>> = {
  qr: 'QR',
  point: 'Point',
  transfer_in: 'Transferencias',
  link: 'Link de pago',
}

/** El corte del día, en palabras, para el resumen plegado. */
function cutoffWords(hour: number): string {
  if (hour === 0) return 'día del calendario'
  if (hour === 5) return 'noche anterior (hasta las 5 a. m.)'
  return `corte a las ${hour} a. m.`
}

/**
 * «Antes de empezar, una sola vez» de Mercado Pago: cuál es la cuenta, cómo se
 * llama cada cobro en el cierre del día (el dibujo de las flechas) y de qué día
 * es lo que se cobra después de medianoche. Tres preguntas, sin un desplegable
 * a la vista. Guardado, queda en una línea con «Cambiar».
 *
 * La acción y lo que manda son los de siempre (`saveMercadoPagoImportSettings`
 * con `mpSettingsInput`). Ojo: el reporte se lee con lo GUARDADO; con cambios
 * sin guardar, la pantalla lo avisa.
 */
export function MpSettingsCard({
  slug,
  settings,
  ajustesHref,
}: {
  slug: string
  settings: MpSettingsView
  /** Ajustes › Cajas y cuentas (para agregar la billetera o los CBU). */
  ajustesHref: string
}) {
  const router = useRouter()
  const walletLabel = useId()
  const mapLabel = useId()
  const cutoffLabel = useId()
  const cutoffName = useId()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ tone: 'error' | 'stale'; text: string } | null>(null)
  const conn = settings.connection
  const configured = conn !== null
  const [open, setOpen] = useState(!configured)
  const [dirty, setDirty] = useState(false)

  const [wallet, setWallet] = useState<string>(
    conn?.treasuryAccountId ??
      settings.effective?.treasuryId ??
      (settings.wallets.length === 1 ? (settings.wallets[0]?.id ?? '') : ''),
  )
  const [methods, setMethods] = useState<Partial<Record<MpCobroChannel, string | null>>>(() => {
    const out: Partial<Record<MpCobroChannel, string | null>> = {}
    for (const c of MP_SETTINGS_CHANNELS) {
      out[c] = conn?.channelMethods[c] ?? settings.effective?.channelMethods[c] ?? null
    }
    return out
  })
  const [cutoff, setCutoff] = useState<number>(conn?.dayCutoffHour ?? 0)

  const mpParty = settings.effective?.partyId ?? null
  const sortedMethods = [...settings.methods].sort(
    (a, b) =>
      Number(b.partyId === mpParty) - Number(a.partyId === mpParty) ||
      a.name.localeCompare(b.name, 'es'),
  )
  // Lo deducido por el nombre que todavía no se guardó.
  const inferred = new Set(
    (settings.effective?.inferred ?? []).filter((c) => !conn?.channelMethods[c]),
  )
  const methodName = (id: string | null | undefined) =>
    settings.methods.find((m) => m.id === id)?.name ?? null
  const walletName = settings.wallets.find((w) => w.id === wallet)?.name ?? null

  const save = () => {
    setMessage(null)
    if (!wallet) {
      setMessage({ tone: 'error', text: 'Elegí cuál es tu cuenta de Mercado Pago.' })
      return
    }
    start(async () => {
      try {
        const result = await saveMercadoPagoImportSettings(
          slug,
          mpSettingsInput({ updatedAt: conn?.updatedAt ?? null, wallet, methods, cutoff }),
        )
        if (!result.ok) {
          const stale = result.code === 'stale'
          setMessage({
            tone: stale ? 'stale' : 'error',
            text: stale
              ? 'Alguien cambió esto recién. Recargá para ver lo último.'
              : result.message,
          })
          return
        }
        toast.success(result.message)
        setDirty(false)
        setOpen(false)
        router.refresh()
      } catch {
        setMessage({ tone: 'error', text: 'Sin conexión: no se guardó. Probá de nuevo.' })
      }
    })
  }

  if (!open) {
    const used = MP_SETTINGS_CHANNELS.filter((c) => methodName(conn?.channelMethods[c]))
    const unused = MP_SETTINGS_CHANNELS.filter((c) => !used.includes(c)).map(
      (c) => CHANNEL_SHORT[c],
    )
    const summary = [
      walletName ? `entra a ${walletName}` : null,
      ...used.map((c) => `${CHANNEL_SHORT[c]} → ${methodName(conn?.channelMethods[c])}`),
      unused.length === 1
        ? `${unused[0]} → no lo uso`
        : unused.length > 1
          ? `${unused.slice(0, -1).join(', ')} y ${unused[unused.length - 1]} → no los uso`
          : null,
      cutoffWords(conn?.dayCutoffHour ?? 0),
    ].filter(Boolean)
    return (
      <section
        id="antes"
        aria-label="Cómo leo tu Mercado Pago"
        className="card-hairline flex scroll-mt-28 flex-col gap-2 rounded-2xl border bg-card/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <p className="min-w-0 text-sm text-pretty">
          <span className="font-medium">Cómo leo tu Mercado Pago:</span>{' '}
          <span className="text-muted-foreground">{summary.join(' · ')}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 self-start sm:self-auto md:pointer-fine:h-9"
          onClick={() => setOpen(true)}
        >
          Cambiar
        </Button>
      </section>
    )
  }

  const cutoffChoices: Array<{ value: number; title: string; consequence: string }> = [
    {
      value: 0,
      title: 'Del día que dice el calendario',
      consequence: 'Lo de la 1 de la mañana del sábado cuenta para el sábado.',
    },
    {
      value: 5,
      title: 'De la noche anterior (hasta las 5 a. m.)',
      consequence: 'Lo de la 1 de la mañana del sábado cuenta para el viernes, como tu cierre.',
    },
    ...(cutoff !== 0 && cutoff !== 5
      ? [
          {
            value: cutoff,
            title: `Corte a las ${cutoff} a. m.`,
            consequence: 'Lo que se cobra antes de esa hora cuenta para la noche anterior.',
          },
        ]
      : []),
  ]

  return (
    <Panel
      id="antes"
      title="Antes de empezar, una sola vez"
      description="Tres cosas para leer bien tu reporte. Después queda guardado."
    >
      <div className="grid gap-6">
        {settings.wallets.length === 0 ? (
          <EmptyTeach
            plain
            icon={Wallet}
            title="Falta tu cuenta de Mercado Pago"
            action={
              <Button asChild className="h-11">
                <Link href={ajustesHref}>Agregar la cuenta</Link>
              </Button>
            }
          >
            La agregás una vez en Cajas, como «billetera virtual», y volvés.
          </EmptyTeach>
        ) : (
          <div className="grid gap-2">
            <p id={walletLabel} className="font-medium">
              1. ¿Cuál es tu cuenta de Mercado Pago?
            </p>
            <fieldset
              aria-labelledby={walletLabel}
              className="m-0 min-w-0 border-0 p-0 flex flex-wrap gap-1.5"
            >
              {settings.wallets.map((w) => (
                <Pill
                  key={w.id}
                  size="touch"
                  activeTone="brand"
                  active={wallet === w.id}
                  onClick={() => {
                    setWallet(w.id)
                    setDirty(true)
                  }}
                >
                  {w.name}
                </Pill>
              ))}
            </fieldset>
            <p className="text-sm text-muted-foreground">
              Es la caja de Mercado Pago de Cajas: ahí entra lo que cobrás.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <p id={mapLabel} className="font-medium">
            2. ¿Cómo llamás a cada cobro en tu cierre del día?
          </p>
          <p className="text-sm text-muted-foreground text-pretty">
            Así junto lo que te depositó Mercado Pago con lo que anotaste en el cierre.
          </p>
          <fieldset aria-labelledby={mapLabel} className="m-0 mt-1 min-w-0 border-0 p-0">
            <MpChannelMap
              channels={MP_SETTINGS_CHANNELS}
              methods={sortedMethods}
              value={methods}
              inferred={inferred}
              onChange={(channel, id) => {
                setMethods((prev) => ({ ...prev, [channel]: id }))
                setDirty(true)
              }}
            />
          </fieldset>
        </div>

        <div className="grid gap-2">
          <p id={cutoffLabel} className="font-medium">
            3. Lo que cobrás después de medianoche, ¿de qué día es?
          </p>
          <div
            role="radiogroup"
            aria-labelledby={cutoffLabel}
            className="grid gap-2 sm:grid-cols-2"
          >
            {cutoffChoices.map((choice) => (
              <ChoiceCard
                key={choice.value}
                name={cutoffName}
                value={String(choice.value)}
                checked={cutoff === choice.value}
                onChange={() => {
                  setCutoff(choice.value)
                  setDirty(true)
                }}
                title={choice.title}
                consequence={choice.consequence}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Si cerrás la caja de madrugada, casi seguro es la segunda.
          </p>
        </div>

        {settings.ownAccounts === 0 ? (
          <p className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm text-pretty">
            Cargá el CBU o CVU de tus cuentas en{' '}
            <Link
              href={ajustesHref}
              className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cajas
            </Link>
            : así distingo un retiro a tu banco de un pago a otra persona.
          </p>
        ) : null}

        {message ? (
          <QuestionCard role="alert" tone="info" inset question={message.text}>
            {message.tone === 'stale' ? (
              <QuestionAnswers>
                <Button
                  type="button"
                  variant="outline"
                  className={ANSWER_BUTTON}
                  onClick={() => router.refresh()}
                >
                  Recargar
                </Button>
              </QuestionAnswers>
            ) : null}
          </QuestionCard>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <Button
            type="button"
            className="h-11 w-full px-6 sm:w-auto"
            disabled={pending || settings.wallets.length === 0}
            onClick={save}
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
          {dirty ? (
            <p className="text-sm text-warning-text">
              Sin guardar: todavía leo tu reporte con lo anterior.
            </p>
          ) : null}
          {configured && !dirty ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(false)}
            >
              Dejarlo como está
            </button>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}
