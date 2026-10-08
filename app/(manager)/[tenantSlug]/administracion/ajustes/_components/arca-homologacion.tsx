import { ChevronDown, FlaskConical } from 'lucide-react'
import { ArcaTestVoucherButton } from '@/components/administracion/arca/test-voucher-button'
import {
  homologacionStepAnchor,
  suggestArcaAlias,
} from '@/components/administracion/guias/arca-guide-model'
import { Badge } from '@/components/ui/badge'
import type { ArcaConnectionView } from '@/lib/arca/views'
import { formatCuit, padPv } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { ArcaCertUpload, ArcaCsrAction } from './arca-certificate-actions'
import { ArcaDisconnectButton } from './arca-connection-controls'
import { HashDetails } from './arca-shared'
import { ArcaPointOfSaleForm } from './arca-step-actions'
import { ArcaTestAction } from './arca-test-action'

/**
 * Un renglón numerado de las pruebas. Tiene `id` (`#homologacion-paso-N`): ahí lleva «Cómo se
 * arregla» cuando la prueba de homologación falla.
 */
function TestStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li
      id={homologacionStepAnchor(n)}
      className="grid scroll-mt-20 gap-3 sm:grid-cols-[2rem_minmax(0,1fr)]"
    >
      <span
        aria-hidden="true"
        className="hidden size-7 items-center justify-center rounded-full border border-border bg-secondary/40 text-xs font-semibold tabular-nums text-muted-foreground sm:flex"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-3">
        <h4 className="text-sm font-semibold">
          <span className="sm:hidden">{n}. </span>
          {title}
        </h4>
        {children}
      </div>
    </li>
  )
}

/**
 * «Pruebas (homologación) · para desarrolladores» (diseño §2.2 y §3.2.8): el mismo camino de
 * producción en el ARCA de pruebas, con el certificado de WSASS a nombre de quien programa.
 * Cuando queda conectado, «Emitir una factura de prueba» (contrato C3), que nunca toca los
 * libros. Plegado: los dueños no tienen que hacer nada acá. Se abre solo con `#homologacion`.
 */
export function ArcaHomologacion({
  slug,
  connection,
  canWrite,
}: {
  slug: string
  connection: ArcaConnectionView | null
  canWrite: boolean
}) {
  const guideHref = `/${slug}/administracion/ajustes/arca`
  const active = connection && connection.status !== 'disconnected' ? connection : null
  const hasKey = Boolean(active?.hasCsr || active?.certificate)
  const statusBadge = (className: string) => (
    <Badge
      variant="outline"
      className={cn(
        active?.status === 'connected'
          ? 'border-success/30 bg-success/10 text-success'
          : active?.status === 'error'
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'text-muted-foreground',
        className,
      )}
    >
      {active ? active.statusLabel : 'Sin empezar'}
    </Badge>
  )

  return (
    <HashDetails
      id="homologacion"
      className="card-hairline group scroll-mt-20 rounded-xl border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary">
          <FlaskConical className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Pruebas (homologación) · para desarrolladores
          </span>
          <span className="block text-xs text-muted-foreground text-pretty">
            Para quien programa la plataforma. Los dueños no tienen que hacer nada acá.
          </span>
          {/* En el celular el estado va abajo del texto: al costado lo dejaba en un hilo. */}
          {statusBadge('mt-1.5 sm:hidden')}
        </span>
        {statusBadge('hidden shrink-0 sm:inline-flex')}
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="space-y-6 border-t border-border/60 px-5 py-5 text-sm">
        <p className="text-muted-foreground text-pretty">
          Homologación es el ARCA de pruebas: lo que se emite ahí no vale. Sirve para probar la
          conexión y las facturas antes de producción, con un certificado de WSASS (el autoservicio
          de certificados de prueba de ARCA) a nombre de quien programa.
        </p>

        {active ? (
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="grid content-start gap-0.5">
              <dt className="text-xs text-muted-foreground">Certificado a nombre de</dt>
              <dd className="tabular-nums">
                {active.certCuit ? formatCuit(active.certCuit) : '—'}
              </dd>
            </div>
            <div className="grid content-start gap-0.5">
              <dt className="text-xs text-muted-foreground">Representa a la SAS</dt>
              <dd className="tabular-nums">
                {active.representedCuit ? formatCuit(active.representedCuit) : '—'}
              </dd>
            </div>
            <div className="grid content-start gap-0.5">
              <dt className="text-xs text-muted-foreground">Punto de venta</dt>
              <dd className="tabular-nums">
                {active.pointOfSale ? padPv(active.pointOfSale, 4) : 'Sin cargar'}
              </dd>
            </div>
          </dl>
        ) : null}

        {canWrite ? (
          <ol className="space-y-8">
            <TestStep n={1} title="El pedido del certificado">
              <p className="text-muted-foreground text-pretty">
                Generá el pedido con tu CUIT personal. En WSASS, en «Nuevo Certificado», usá el
                mismo alias y pegá el texto del pedido («Ver el texto del pedido» → «Copiar»).
              </p>
              <ArcaCsrAction
                slug={slug}
                environment="homologacion"
                connection={active}
                suggestedAlias={suggestArcaAlias(slug, 'homologacion')}
                guideHref={guideHref}
                showPem
              />
            </TestStep>
            <TestStep n={2} title="El certificado de WSASS">
              <p className="text-muted-foreground text-pretty">
                En WSASS, «Crear autorización a servicio» para <b>wsfe</b> y para{' '}
                <b>ws_sr_constancia_inscripcion</b>, con la CUIT de la SAS como representada. El
                certificado que te muestra WSASS guardalo como .crt o pegalo acá.
              </p>
              <ArcaCertUpload
                slug={slug}
                environment="homologacion"
                connection={active}
                allowPaste
                guideHref={guideHref}
                title="Subí el certificado de WSASS (.crt)"
              />
            </TestStep>
            <TestStep n={3} title="El punto de venta de pruebas">
              <ArcaPointOfSaleForm
                slug={slug}
                environment="homologacion"
                connection={active}
                guideHref={guideHref}
              />
            </TestStep>
            <TestStep n={4} title="Probar la conexión de pruebas">
              <ArcaTestAction
                slug={slug}
                environment="homologacion"
                connection={active}
                guideHref={guideHref}
              />
            </TestStep>
            <TestStep n={5} title="Una factura de prueba">
              <p className="text-muted-foreground text-pretty">
                Pide el CAE de una factura en el ARCA de pruebas. No se carga en los libros.
                {active?.status === 'connected'
                  ? ''
                  : ' Se habilita cuando la prueba de conexión da todo bien.'}
              </p>
              <ArcaTestVoucherButton slug={slug} disabled={active?.status !== 'connected'} />
            </TestStep>
          </ol>
        ) : (
          <p className="text-muted-foreground">
            {active
              ? `Estado: ${active.statusLabel.toLowerCase()}.`
              : 'Todavía no se configuraron las pruebas.'}
          </p>
        )}

        {canWrite && hasKey ? (
          // En el celular, a todo el ancho (como en la tarjeta de producción).
          <div className="border-t border-border/60 pt-4 sm:flex sm:justify-end">
            <ArcaDisconnectButton
              slug={slug}
              environment="homologacion"
              className="w-full sm:w-auto"
            />
          </div>
        ) : null}
      </div>
    </HashDetails>
  )
}
