import { ChevronRight, FlaskConical } from 'lucide-react'
import { ArcaTestVoucherButton } from '@/components/administracion/arca/test-voucher-button'
import {
  homologacionStepAnchor,
  suggestArcaAlias,
} from '@/components/administracion/guias/arca-guide-model'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import type { ArcaConnectionView } from '@/lib/arca/views'
import { formatCuit, padPv } from '@/lib/fiscal'
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
 * «Pruebas (homologación) · para quien programa» (diseño §2.2 y §3.2.8): el mismo camino de
 * producción en el ARCA de pruebas, con el certificado de WSASS a nombre de quien programa.
 * Cuando queda conectado, «Emitir una factura de prueba» (contrato C3), que nunca toca los
 * libros. Va último, plegado y sin tarjeta —una línea gris—: los dueños no tienen que hacer nada
 * acá. Se abre solo con `#homologacion` (el link del cajón de la contadora y el de la guía).
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
  const statusTone =
    active?.status === 'connected' ? 'ok' : active?.status === 'error' ? 'late' : 'muted'

  return (
    <HashDetails id="homologacion" className="group scroll-mt-28">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg py-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 basis-40 text-pretty sm:flex-none sm:basis-auto">
          Pruebas (homologación) · para quien programa
        </span>
        {/* Plegado va en gris y dice de qué habla («Pruebas: …»): es el ambiente de pruebas, que
            el dueño no usa. El rojo es de la conexión de verdad; acá aparece recién al abrir. */}
        <StatusPill tone="muted">
          Pruebas: {active ? active.statusLabel.toLowerCase() : 'sin empezar'}
        </StatusPill>
      </summary>
      <div className="mt-3 space-y-6 rounded-2xl bg-secondary/50 p-4 text-sm sm:p-5">
        {active && statusTone !== 'muted' ? (
          <p>
            <StatusPill tone={statusTone}>{active.statusLabel}</StatusPill>
          </p>
        ) : null}
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
