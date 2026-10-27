'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { formatInTimeZone } from 'date-fns-tz'
import {
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  TriangleAlert,
  Unplug,
  Wallet,
} from 'lucide-react'
import { type ComponentProps, type ReactNode, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { connectMercadoPago, disconnectMercadoPago } from '@/lib/ticketing/actions'
import { DEFAULT_TZ } from '@/lib/ticketing/dates'
import { mercadoPagoCredentialsSchema } from '@/lib/ticketing/schemas'
import type { TicketingSettingsView } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { PanelSection } from './panel-section'

/** «Tus integraciones» de Mercado Pago Developers (Argentina). */
const MP_PANEL_URL = 'https://www.mercadopago.com.ar/developers/panel/app'

type CredentialsInput = z.input<typeof mercadoPagoCredentialsSchema>

type Account = Pick<
  TicketingSettingsView,
  'mp_user_id' | 'mp_nickname' | 'mp_live' | 'mp_connected_at'
>

/**
 * La cuenta de Mercado Pago del bar: cada bar cobra en la suya.
 *
 * Sin conectar, la tarjeta explica para qué sirve y lleva de la mano hasta el
 * Access Token (con dibujitos de lo que se ve en Mercado Pago). Conectada,
 * muestra de quién es la cuenta y si cobra de verdad o en modo prueba. El
 * token nunca vuelve al navegador: la acción lo verifica contra Mercado Pago,
 * lo cifra y lo guarda con service_role.
 */
export function MercadoPagoCard({
  tenantSlug,
  account,
  webhookUrl,
}: {
  tenantSlug: string
  account: Account
  /** Dónde avisa Mercado Pago de cada pago (con el bar adentro: `?t=`). */
  webhookUrl: string
}) {
  const connected = Boolean(account.mp_connected_at)

  return (
    <PanelSection
      id="mercado-pago"
      icon={Wallet}
      title={
        <span className="flex flex-wrap items-center gap-2">
          Mercado Pago
          {connected ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-sans text-xs font-medium tracking-normal text-success">
              <Check className="size-3" aria-hidden />
              Conectado
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-sans text-xs font-medium tracking-normal text-muted-foreground">
              Sin conectar
            </span>
          )}
        </span>
      }
      description={
        connected
          ? 'La plata de cada entrada entra directo a esta cuenta.'
          : 'Para cobrar online: cuando alguien paga, la reserva se carga sola en el panel.'
      }
    >
      {connected ? (
        <ConnectedAccount tenantSlug={tenantSlug} account={account} webhookUrl={webhookUrl} />
      ) : (
        <div className="space-y-5">
          <p className="max-w-3xl text-sm text-pretty">
            Conectá la cuenta de Mercado Pago del bar y la gente paga la seña o el total desde la
            página de cada película. Cuando Mercado Pago confirma el pago, la reserva aparece sola
            en Reservas y la plata entra directo a tu cuenta. Se hace una sola vez y lleva unos
            cinco minutos.
          </p>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
            <CredentialsGuide webhookUrl={webhookUrl} />
            <div className="card-hairline rounded-xl border bg-cream-tint p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-4 text-muted-foreground" aria-hidden />
                Pegá tus credenciales
              </h3>
              <CredentialsForm tenantSlug={tenantSlug} submitLabel="Conectar Mercado Pago" />
            </div>
          </div>
        </div>
      )}
    </PanelSection>
  )
}

// ──────────────────────────────────────────────
// Conectada
// ──────────────────────────────────────────────

function ConnectedAccount({
  tenantSlug,
  account,
  webhookUrl,
}: {
  tenantSlug: string
  account: Account
  webhookUrl: string
}) {
  const [changing, setChanging] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [pending, startTransition] = useTransition()
  const live = account.mp_live !== false
  const connectedAt = account.mp_connected_at
    ? formatInTimeZone(new Date(account.mp_connected_at), DEFAULT_TZ, 'dd/MM/yyyy')
    : null
  const name =
    account.mp_nickname ?? (account.mp_user_id ? `Cuenta n.º ${account.mp_user_id}` : 'Tu cuenta')

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectMercadoPago(tenantSlug)
      if (result.ok) {
        setConfirmDisconnect(false)
        toast.success(result.message ?? 'Mercado Pago desconectado.')
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Cuenta
          </dt>
          <dd className="mt-1 truncate font-serif text-xl font-semibold tracking-tight">{name}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Cobra
          </dt>
          <dd className="mt-1.5">
            {live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                Producción: pagos reales
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning-text">
                <TriangleAlert className="size-3" aria-hidden />
                Modo prueba
              </span>
            )}
          </dd>
        </div>
        {connectedAt ? (
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Conectada el
            </dt>
            <dd className="mt-1 text-sm tabular-nums">{connectedAt}</dd>
          </div>
        ) : null}
      </dl>

      {live ? null : (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-text">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Con credenciales de prueba los pagos no son de verdad. Cuando quieras vender, tocá
          «Cambiar credenciales» y pegá las de producción.
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Avisos de pago (webhook)</p>
        <WebhookUrl url={webhookUrl} />
        <p className="text-xs text-muted-foreground text-pretty">
          Cada compra ya le avisa a Mercado Pago a dónde confirmar. Si además la cargás en Mercado
          Pago (Webhooks → Configurar notificaciones → «URL modo producción», evento «Pagos») y
          pegás la clave secreta, verificamos que cada aviso venga de Mercado Pago.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          aria-expanded={changing}
          aria-controls="mp-change-credentials"
          onClick={() => setChanging((value) => !value)}
        >
          <KeyRound className="size-4" aria-hidden />
          Cambiar credenciales
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-muted-foreground hover:text-destructive sm:h-9"
          onClick={() => setConfirmDisconnect(true)}
        >
          <Unplug className="size-4" aria-hidden />
          Desconectar
        </Button>
      </div>

      {changing ? (
        <div
          id="mp-change-credentials"
          className="card-hairline max-w-xl rounded-xl border bg-cream-tint p-4"
        >
          <p className="mb-3 text-xs text-muted-foreground text-pretty">
            Pegá el Access Token nuevo (y la clave secreta, si la tenés). Hasta que las verifiquemos
            con Mercado Pago, sigue funcionando la cuenta de ahora.{' '}
            <a
              href={MP_PANEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Abrir Mercado Pago Developers
            </a>
          </p>
          <CredentialsForm
            tenantSlug={tenantSlug}
            submitLabel="Guardar credenciales"
            onDone={() => setChanging(false)}
            onCancel={() => setChanging(false)}
          />
        </div>
      ) : null}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar Mercado Pago?</AlertDialogTitle>
            <AlertDialogDescription>
              La cartelera sigue visible, pero nadie va a poder pagar online hasta que vuelvas a
              conectar una cuenta. Las compras que ya entraron y sus reservas no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                disconnect()
              }}
            >
              {pending ? 'Desconectando…' : 'Sí, desconectar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function WebhookUrl({ url }: { url: string }) {
  return (
    <div className="flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>
        {url}
      </code>
      <CopyButton
        value={url}
        iconOnly
        variant="ghost"
        label="Copiar la dirección de avisos"
        copiedLabel="¡Copiada!"
      />
    </div>
  )
}

// ──────────────────────────────────────────────
// Cómo conseguir las credenciales
// ──────────────────────────────────────────────

/** Un botón, pestaña o campo tal como se lee en Mercado Pago. */
function Ui({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded border border-border/80 bg-background px-1 py-px text-[0.92em] font-medium text-foreground">
      {children}
    </span>
  )
}

function GuideStep({
  n,
  title,
  children,
  visual,
  last = false,
}: {
  n: number
  title: string
  children: ReactNode
  /** El dibujito de lo que se ve en Mercado Pago (decorativo). */
  visual?: ReactNode
  last?: boolean
}) {
  return (
    <li className={cn('relative flex gap-3', last ? null : 'pb-5')}>
      {/* La línea que une los pasos: el último no la lleva. */}
      {last ? null : (
        <span aria-hidden className="absolute top-9 bottom-0 left-[0.8125rem] w-px bg-border" />
      )}
      <span
        aria-hidden
        className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <h3 className="text-sm font-semibold">
          <span className="sr-only">Paso {n}: </span>
          {title}
        </h3>
        <div className="space-y-2 text-sm text-muted-foreground text-pretty">{children}</div>
        {visual ? <div aria-hidden>{visual}</div> : null}
      </div>
    </li>
  )
}

function CredentialsGuide({ webhookUrl }: { webhookUrl: string }) {
  return (
    <ol aria-label="Cómo conseguir las credenciales de Mercado Pago" className="min-w-0">
      <GuideStep n={1} title="Entrá a Mercado Pago Developers">
        <p>Con la cuenta de Mercado Pago donde querés recibir la plata de las entradas.</p>
        <Button asChild variant="outline" className="h-11 sm:h-9">
          <a href={MP_PANEL_URL} target="_blank" rel="noopener noreferrer">
            Abrir Mercado Pago Developers
            <ArrowUpRight className="size-4" aria-hidden />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </a>
        </Button>
      </GuideStep>

      <GuideStep
        n={2}
        title="Creá una aplicación"
        visual={
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-md border bg-background px-2 py-1">Tus integraciones</span>
            <span>›</span>
            <span className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground">
              Crear aplicación
            </span>
            <span>›</span>
            <span className="rounded-md border bg-background px-2 py-1">Pagos online</span>
            <span>›</span>
            <span className="rounded-md border bg-background px-2 py-1">Checkout Pro</span>
          </div>
        }
      >
        <p>
          En <Ui>Tus integraciones</Ui> tocá <Ui>Crear aplicación</Ui>. Ponele un nombre (por
          ejemplo «Entradas online») y, cuando te pregunte qué vas a integrar, elegí{' '}
          <Ui>Pagos online</Ui> y <Ui>Checkout Pro</Ui>.
        </p>
      </GuideStep>

      <GuideStep
        n={3}
        title="Abrí las credenciales de producción"
        visual={
          <div className="inline-flex items-center gap-1 rounded-full border bg-background p-1 text-[11px]">
            <span className="rounded-full px-2.5 py-1 text-muted-foreground">Prueba</span>
            <span className="rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground">
              Producción
            </span>
          </div>
        }
      >
        <p>
          Entrá a <Ui>Credenciales de producción</Ui> (en algunas cuentas es <Ui>Credenciales</Ui>{' '}
          con el selector en <Ui>Producción</Ui>). Si te pide activarlas, completá el rubro y el
          sitio web del bar —sirve el link de tu cartelera— y aceptá.
        </p>
      </GuideStep>

      <GuideStep
        n={4}
        title="Copiá el Access Token"
        visual={
          <div className="flex max-w-sm items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Access Token
              </div>
              <div className="truncate font-mono text-xs text-foreground">
                APP_USR-7312••••••••••••••••a91c
              </div>
            </div>
            <Copy className="size-4 shrink-0 text-muted-foreground" />
          </div>
        }
      >
        <p>
          Es el que empieza con <code className="font-mono text-foreground">APP_USR-</code>. Fijate
          que esté elegida <Ui>Producción</Ui>: las credenciales de prueba también empiezan con
          APP_USR- y con esas los pagos no son de verdad. Pegalo en el formulario.
        </p>
      </GuideStep>

      <GuideStep n={5} title="Avisos de pago (opcional, recomendado)" last>
        <p>
          En <Ui>Webhooks</Ui> → <Ui>Configurar notificaciones</Ui>, pegá esta dirección en{' '}
          <Ui>URL modo producción</Ui>, marcá el evento <Ui>Pagos</Ui> y tocá <Ui>Guardar</Ui>.
          Después copiá la <Ui>clave secreta</Ui> que aparece y pegala en el formulario: con esa
          clave verificamos que cada aviso de pago venga de Mercado Pago.
        </p>
        <WebhookUrl url={webhookUrl} />
        <div
          aria-hidden
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs text-foreground"
        >
          <span className="flex size-4 items-center justify-center rounded bg-primary text-primary-foreground">
            <Check className="size-3" />
          </span>
          Pagos
        </div>
      </GuideStep>
    </ol>
  )
}

// ──────────────────────────────────────────────
// El formulario
// ──────────────────────────────────────────────

/** Un campo secreto con «Mostrar». Los gestores de contraseñas no lo tienen que guardar. */
function SecretInput({ id, ...props }: ComponentProps<'input'> & { id: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        className="h-11 pr-12 font-mono text-sm md:text-sm"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Ocultar' : 'Mostrar'}
        aria-pressed={visible}
        aria-controls={id}
        className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

function CredentialsForm({
  tenantSlug,
  submitLabel,
  onDone,
  onCancel,
}: {
  tenantSlug: string
  submitLabel: string
  onDone?: () => void
  onCancel?: () => void
}) {
  const form = useForm<CredentialsInput>({
    // raw: zod valida, pero a la acción va lo tipeado (ella vuelve a validar).
    resolver: zodResolver(mercadoPagoCredentialsSchema, undefined, { raw: true }),
    defaultValues: { access_token: '', webhook_secret: '' },
  })
  const { errors } = form.formState
  const [pending, startTransition] = useTransition()

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await connectMercadoPago(tenantSlug, {
        access_token: values.access_token,
        webhook_secret: values.webhook_secret ? values.webhook_secret : null,
      })
      if (result.ok) {
        toast.success(result.message ?? 'Mercado Pago conectado.')
        form.reset({ access_token: '', webhook_secret: '' })
        onDone?.()
        return
      }
      if (result.field === 'access_token' || result.field === 'webhook_secret') {
        form.setError(result.field, { type: 'server', message: result.message })
      }
      toast.error(result.message)
    })
  })

  const tokenError = errors.access_token?.message
  const secretError = errors.webhook_secret?.message

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="mp-access-token">
          Access Token
          <span aria-hidden className="text-destructive">
            *
          </span>
        </Label>
        <SecretInput
          id="mp-access-token"
          placeholder="APP_USR-…"
          aria-required
          aria-invalid={tokenError ? true : undefined}
          aria-describedby="mp-access-token-hint"
          {...form.register('access_token')}
        />
        <p
          id="mp-access-token-hint"
          className={cn('text-xs', tokenError ? 'text-destructive' : 'text-muted-foreground')}
          role={tokenError ? 'alert' : undefined}
        >
          {tokenError ?? 'Lo guardamos cifrado y no se vuelve a mostrar nunca.'}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="mp-webhook-secret">
          Clave secreta de webhooks
          <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <SecretInput
          id="mp-webhook-secret"
          aria-invalid={secretError ? true : undefined}
          aria-describedby="mp-webhook-secret-hint"
          {...form.register('webhook_secret')}
        />
        <p
          id="mp-webhook-secret-hint"
          className={cn('text-xs', secretError ? 'text-destructive' : 'text-muted-foreground')}
          role={secretError ? 'alert' : undefined}
        >
          {secretError ?? 'La del paso 5. Sin clave también funciona.'}
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={onCancel}
            disabled={pending}
          >
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" className="h-11 sm:h-10" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <PlugZap className="size-4" aria-hidden />
          )}
          {pending ? 'Verificando con Mercado Pago…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
