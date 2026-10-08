'use client'

import { CheckCircle2, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { saveMercadoPagoImportSettings } from '@/lib/imports/actions'
import type { MpCobroChannel } from '@/lib/imports/server/types'
import { MP_CHANNEL_TEXT } from '@/lib/imports/ui/labels'
import { cn } from '@/lib/utils'

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

const CHANNELS: readonly MpCobroChannel[] = ['qr', 'point', 'transfer_in', 'link']
const NONE = 'none'
const SELECT_CLASS = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'

/**
 * «Antes de la primera importación» (diseño §4.2.1): la billetera de Mercado
 * Pago, a qué medio del cierre del día va cada canal de cobro y qué día cuenta
 * para el cobro. Se hace una vez; después queda plegada con su resumen.
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
  const titleId = useId()
  const walletId = useId()
  const cutoffId = useId()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ tone: 'error' | 'stale'; text: string } | null>(null)
  const conn = settings.connection
  const configured = conn !== null

  const [wallet, setWallet] = useState<string>(
    conn?.treasuryAccountId ??
      settings.effective?.treasuryId ??
      (settings.wallets.length === 1 ? (settings.wallets[0]?.id ?? '') : ''),
  )
  const [methods, setMethods] = useState<Partial<Record<MpCobroChannel, string | null>>>(() => {
    const out: Partial<Record<MpCobroChannel, string | null>> = {}
    for (const c of CHANNELS) {
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

  const save = () => {
    setMessage(null)
    if (!wallet) {
      setMessage({ tone: 'error', text: 'Elegí cuál es tu cuenta de Mercado Pago.' })
      return
    }
    start(async () => {
      try {
        const result = await saveMercadoPagoImportSettings(slug, {
          expectedUpdatedAt: conn?.updatedAt ?? null,
          treasuryAccountId: wallet,
          channelMethods: Object.fromEntries(CHANNELS.map((c) => [c, methods[c] ?? null])),
          dayCutoffHour: cutoff,
        })
        if (!result.ok) {
          const stale = result.code === 'stale'
          setMessage({
            tone: stale ? 'stale' : 'error',
            text: stale
              ? 'Alguien cambió esta configuración recién. Recargá para ver lo último.'
              : result.message,
          })
          return
        }
        toast.success(result.message)
        router.refresh()
      } catch {
        setMessage({ tone: 'error', text: 'Sin conexión: no se guardó. Probá de nuevo.' })
      }
    })
  }

  const cutoffOptions = [
    { value: '0', label: 'El día del calendario' },
    { value: '5', label: 'El día de servicio (hasta las 5 a. m.)' },
    ...(cutoff !== 0 && cutoff !== 5
      ? [{ value: String(cutoff), label: `Corte a las ${cutoff} a. m.` }]
      : []),
  ]

  return (
    <details
      open={!configured}
      className="card-hairline group rounded-xl border bg-card [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex items-center gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg border shadow-2xs',
              configured
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-primary/20 bg-cream-tint text-primary',
            )}
          >
            {configured ? (
              <CheckCircle2 className="size-5" aria-hidden />
            ) : (
              <Settings2 className="size-5" aria-hidden />
            )}
          </span>
          <span>
            <span id={titleId} className="block font-serif text-lg font-semibold tracking-tight">
              {configured ? 'Configuración de Mercado Pago' : 'Antes de la primera importación'}
            </span>
            <span className="block text-sm text-muted-foreground">
              {configured
                ? 'Lista. Tocá para ver o cambiar a qué medio va cada canal.'
                : 'Una sola vez: decinos cuál es tu cuenta y cómo se llama cada cobro en tu cierre del día.'}
            </span>
          </span>
        </span>
        <span className="text-xs font-medium text-muted-foreground group-open:hidden">Ver</span>
        <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
          Ocultar
        </span>
      </summary>

      <div className="grid gap-5 border-t border-border/60 px-5 py-5">
        {settings.wallets.length === 0 ? (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text">
            Todavía no cargaste tu cuenta de Mercado Pago.{' '}
            <Link href={ajustesHref} className="font-medium underline underline-offset-2">
              Agregala en Ajustes › Cajas y cuentas
            </Link>{' '}
            (como «billetera virtual») y volvé.
          </p>
        ) : (
          <div className="grid gap-1.5 sm:max-w-md">
            <Label htmlFor={walletId}>
              ¿Cuál es tu cuenta de Mercado Pago?
              <span aria-hidden className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Select value={wallet || undefined} onValueChange={setWallet}>
              <SelectTrigger id={walletId} className={SELECT_CLASS}>
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent>
                {settings.wallets.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Es la caja «Mercado Pago» de Cajas y cuentas: ahí entra lo que cobrás.
            </p>
          </div>
        )}

        <fieldset className="grid gap-3">
          {/* El `legend` no es parte de la grilla: el aire hasta la ayuda va en su margen. */}
          <legend className="mb-1.5 text-sm font-medium">
            ¿Cómo se llama cada cobro en tu cierre del día?
          </legend>
          <p className="text-xs text-muted-foreground text-pretty">
            Así juntamos lo que te depositó Mercado Pago con lo que anotaste en el cierre. Si un
            canal no lo usás, dejalo en «No lo uso».
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {CHANNELS.map((channel) => {
              const id = `${titleId}-${channel}`
              const inferred = settings.effective?.inferred.includes(channel) ?? false
              return (
                // `content-start`: la celda vecina con «Lo dedujimos…» es más alta y, estirada,
                // esta repartía el sobrante entre sus filas y bajaba el campo 10 px.
                <div key={channel} className="grid content-start gap-1.5">
                  <Label htmlFor={id}>{MP_CHANNEL_TEXT[channel]}</Label>
                  <Select
                    value={methods[channel] ?? NONE}
                    onValueChange={(value) =>
                      setMethods((prev) => ({ ...prev, [channel]: value === NONE ? null : value }))
                    }
                  >
                    <SelectTrigger id={id} className={SELECT_CLASS}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No lo uso</SelectItem>
                      {sortedMethods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {inferred && !conn?.channelMethods[channel] ? (
                    <p className="text-xs text-muted-foreground">
                      Lo dedujimos por el nombre: revisalo.
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </fieldset>

        <div className="grid gap-1.5">
          <p id={cutoffId} className="text-sm font-medium">
            ¿Qué día cuenta para cada cobro?
          </p>
          <ChoiceChips
            labelledBy={cutoffId}
            value={String(cutoff)}
            onChange={(v) => setCutoff(Number(v))}
            options={cutoffOptions}
          />
          <p className="text-xs text-muted-foreground text-pretty">
            Con «día de servicio», lo que cobrás a la 1 de la mañana del sábado cuenta para el
            viernes (como el cierre de la noche). Si no sabés, preguntale a quien lleva tus cuentas.
          </p>
        </div>

        {settings.ownAccounts === 0 ? (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text text-pretty">
            Cargá el CBU o CVU de tus cuentas en{' '}
            <Link href={ajustesHref} className="font-medium underline underline-offset-2">
              Ajustes › Cajas y cuentas
            </Link>
            : así distinguimos un retiro a tu propio banco de un pago a otra persona.
          </p>
        ) : null}

        {message ? (
          <div
            role="alert"
            className={cn(
              'flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center',
              message.tone === 'stale'
                ? 'border-warning/40 bg-warning/10 text-warning-text'
                : 'border-destructive/30 bg-destructive/10 text-destructive',
            )}
          >
            <p className="flex-1">{message.text}</p>
            {message.tone === 'stale' ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => router.refresh()}
              >
                Recargar
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            className="h-11 w-full sm:w-auto md:h-9"
            disabled={pending || settings.wallets.length === 0}
            onClick={save}
          >
            {pending ? 'Guardando…' : 'Guardar la configuración'}
          </Button>
        </div>
      </div>
    </details>
  )
}
