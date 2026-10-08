import { ChevronDown, ExternalLink, FlaskConical, LifeBuoy, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { certificateNote } from '@/components/administracion/guias/arca-guide-model'
import { ScreenCertDetalle, ScreenWsass } from '@/components/administracion/guias/arca-mock/screens'
import type { ArcaConnectionView } from '@/lib/arca/views'
import { cn } from '@/lib/utils'
import { ArcaRenewAction } from '../../_components/arca-certificate-actions'

/**
 * El pie de la guía «Conectar ARCA» (diseño §5.1.1): renovar el certificado cada 2 años, la
 * tabla «Si algo sale mal» (lo que se ve en el portal y lo que dice la prueba), los instructivos
 * oficiales de ARCA y, plegada, la nota para quien programa (homologación con WSASS).
 */

const CARD = 'card-hairline overflow-hidden rounded-xl border bg-card'

export function RenewSection({
  slug,
  connection,
  canWrite,
}: {
  slug: string
  connection: ArcaConnectionView | null
  canWrite: boolean
}) {
  const cert = certificateNote(connection?.certificate ?? null)
  const canRenew =
    canWrite &&
    connection !== null &&
    connection.certificate !== null &&
    ['cert_ready', 'connected', 'error'].includes(connection.status)
  return (
    <section
      id="renovar"
      aria-labelledby="renovar-titulo"
      className={cn(CARD, 'scroll-mt-36 lg:scroll-mt-20')}
    >
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
        <RefreshCw className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 id="renovar-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Renovar el certificado (cada 2 años)
          </h2>
          <p className="text-xs text-muted-foreground text-pretty">
            Te avisamos 30 días antes, acá y en el Resumen. Mientras lo renovás, la conexión sigue
            andando.
          </p>
        </div>
      </header>
      <div className="space-y-5 px-5 py-5 text-sm">
        {cert ? (
          <p
            className={cn(
              'font-medium',
              cert.tone === 'warning' && 'text-warning-text',
              cert.tone === 'error' && 'text-destructive',
              cert.tone === 'ok' && 'text-success',
            )}
          >
            {cert.text}
          </p>
        ) : null}
        <ol className="list-decimal space-y-2 pl-5 text-pretty">
          <li>
            Generá el pedido para renovar: es uno nuevo, <b>con el mismo alias</b>.
          </li>
          <li>
            En ARCA: «Administración de Certificados Digitales» → elegí la SAS → «Ver» en tu alias →{' '}
            <b>«Agregar certificado»</b> → subí el pedido nuevo → bajá el .crt.
          </li>
          <li>Subí el certificado nuevo acá. Desde ese momento se usa el nuevo.</li>
        </ol>
        <p className="text-muted-foreground text-pretty">
          Con el mismo alias no hace falta volver a autorizar los servicios (pasos 7 y 8).
        </p>
        <div className="max-w-xl">
          <ScreenCertDetalle
            highlight="agregarCertificado"
            approximate
            caption="El formulario de «Agregar certificado» puede verse distinto: es el mismo que usaste en el paso 6."
          />
        </div>
        {canRenew && connection ? (
          <ArcaRenewAction slug={slug} connection={connection} guideHref="" />
        ) : (
          <p className="rounded-lg border border-dashed border-border/80 bg-background/40 p-3 text-muted-foreground">
            {canWrite
              ? 'Cuando el certificado esté cargado, acá vas a poder renovarlo.'
              : 'Lo renueva un dueño con acceso de carga.'}
          </p>
        )}
      </div>
    </section>
  )
}

type Trouble = {
  readonly see: string
  readonly means: string
  readonly fix: string
  readonly step?: number
}

const PORTAL_TROUBLES: readonly Trouble[] = [
  {
    see: '«Autorizante (Dador)» muestra tu nombre',
    means: 'Elegiste a tu persona y no a la SAS.',
    fix: 'Volvé al Administrador de Relaciones y elegí la SAS.',
    step: 1,
  },
  {
    see: 'No aparece el servicio que habilitaste',
    means: 'Falta cerrar sesión o aceptar el permiso.',
    fix: 'Salí y volvé a entrar. Si sigue, «Aceptación de Designación» → «Aceptar».',
    step: 4,
  },
  {
    see: 'El desplegable «Computador Fiscal» está vacío',
    means: 'El certificado se creó a tu nombre.',
    fix: 'Creá el certificado de nuevo eligiendo la SAS.',
    step: 6,
  },
  {
    see: '«Alias repetido» al agregar el alias',
    means: 'Ese nombre ya existe en ARCA.',
    fix: 'Generá otro pedido con otro alias («Empezar de cero»).',
    step: 5,
  },
  {
    see: 'ARCA no acepta el archivo al agregar el alias',
    means: 'Subiste otro archivo en vez del .csr.',
    fix: 'Subí el .csr que bajaste en el paso 5.',
    step: 6,
  },
  {
    see: 'El local no aparece en «Nuevo domicilio»',
    means: 'No está declarado como local.',
    fix: 'Declaralo en «Locales y establecimientos» del Registro Único Tributario.',
    step: 2,
  },
  {
    see: 'ARCA no te deja entrar a un servicio',
    means: 'Tu clave fiscal es nivel 2.',
    fix: 'Subila a nivel 3 desde la app «ARCA Móvil».',
    step: 0,
  },
]

const TEST_TROUBLES: readonly Trouble[] = [
  {
    see: '«Falta autorizar el certificado»',
    means: 'El certificado no tiene permiso para facturar (o para el padrón).',
    fix: 'Hacé la relación con la SAS elegida y tu alias como Computador Fiscal.',
    step: 7,
  },
  {
    see: '«La SAS no está en el permiso»',
    means: 'Autorizaste el certificado representándote a vos.',
    fix: 'Repetí la relación con la SAS elegida.',
    step: 7,
  },
  {
    see: '«El punto de venta no es de web services»',
    means: 'No es «RECE para aplicativo y web services», o es muy nuevo.',
    fix: 'Revisá el sistema del punto de venta; si lo creaste hoy, probá en unas horas.',
    step: 2,
  },
  {
    see: '«Certificado del ambiente equivocado»',
    means: 'Es un certificado de pruebas usado en producción, o al revés.',
    fix: 'Subí el certificado de producción que bajaste en el paso 6.',
    step: 6,
  },
  {
    see: '«ARCA ya le dio un permiso a este certificado»',
    means: 'Otro sistema usa el mismo certificado, o recién probaste.',
    fix: 'La plataforma necesita su propio alias. Si recién probaste, esperá unos minutos.',
    step: 6,
  },
  {
    see: '«La SAS no está habilitada para facturar»',
    means: 'ARCA ve un problema en la SAS (IVA, actividad, domicilio).',
    fix: 'Revisalo con tu contadora antes de seguir.',
    step: 0,
  },
  {
    see: '«ARCA no responde»',
    means: 'ARCA está caído o lento.',
    fix: 'Probá de nuevo en unos minutos.',
  },
]

function TroubleList({ title, rows }: { title: string; rows: readonly Trouble[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {/* Tabla en la compu; tarjetas en el celular. */}
      <div className="hidden overflow-hidden rounded-lg border border-border/80 md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Lo que ves
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Qué pasó
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Cómo se arregla
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.see} className="align-top">
                <td className="px-3 py-2.5 font-medium text-pretty">{r.see}</td>
                <td className="px-3 py-2.5 text-muted-foreground text-pretty">{r.means}</td>
                <td className="px-3 py-2.5 text-pretty">
                  {r.fix}
                  {r.step !== undefined ? (
                    <a
                      href={`#paso-${r.step}`}
                      className="ml-1 whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Paso {r.step}
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.see} className="rounded-lg border border-border/80 p-3 text-sm">
            <p className="font-medium text-pretty">{r.see}</p>
            <p className="mt-1 text-muted-foreground text-pretty">{r.means}</p>
            <p className="mt-1 text-pretty">
              {r.fix}
              {r.step !== undefined ? (
                <a
                  href={`#paso-${r.step}`}
                  className="ml-1 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
                >
                  Ir al paso {r.step}
                </a>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TroublesSection() {
  return (
    <section aria-labelledby="problemas-titulo" className={CARD}>
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
        <LifeBuoy className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 id="problemas-titulo" className="font-serif text-lg font-semibold tracking-tight">
            Si algo sale mal
          </h2>
          <p className="text-xs text-muted-foreground">
            Lo que puede aparecer en ARCA o en la prueba, qué quiere decir y cómo se arregla.
          </p>
        </div>
      </header>
      <div className="space-y-6 px-5 py-5">
        <TroubleList title="En el portal de ARCA" rows={PORTAL_TROUBLES} />
        <TroubleList title="Al probar la conexión" rows={TEST_TROUBLES} />
      </div>
    </section>
  )
}

const OFFICIAL = [
  {
    href: 'https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf',
    label: 'Cómo obtener el certificado digital de producción',
  },
  {
    href: 'https://www.afip.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf',
    label: 'Cómo asociar el certificado a un web service',
  },
  {
    href: 'https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf',
    label: 'Delegación de web services con el Administrador de Relaciones',
  },
] as const

export function OfficialLinks() {
  return (
    <section aria-labelledby="oficiales-titulo" className="space-y-2 px-1">
      <h2
        id="oficiales-titulo"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Los instructivos oficiales de ARCA
      </h2>
      <ul className="space-y-1 text-sm">
        {OFFICIAL.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline md:min-h-8"
            >
              {link.label} (PDF)
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DeveloperNote({ base }: { base: string }) {
  return (
    <details className="card-hairline group rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <FlaskConical className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Para desarrolladores: pruebas en homologación
          </span>
          <span className="block text-xs text-muted-foreground">
            Lo hace quien programa la plataforma, no los dueños.
          </span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="space-y-4 border-t border-border/60 px-5 py-4 text-sm">
        <p className="text-muted-foreground text-pretty">
          Antes de producción se prueba en homologación (el ARCA de pruebas) con WSASS, el
          autoservicio de certificados de prueba. Esos certificados salen siempre a nombre de una
          persona: se usa la CUIT personal de quien programa, representando a la CUIT de la SAS.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-pretty">
          <li>
            Con tu clave personal (nivel 2 o más): Administrador de Relaciones → «ADHERIR SERVICIO»
            → ARCA › Servicios Interactivos › «WSASS - Autogestión Certificados Homologación». Cerrá
            sesión y volvé a entrar.
          </li>
          <li>
            En Ajustes › ARCA › «Pruebas (homologación)», generá el pedido con tu CUIT personal.
          </li>
          <li>
            En WSASS, «Nuevo Certificado»: el mismo alias y el texto del pedido → «Crear DN y
            obtener certificado».
          </li>
          <li>
            «Crear autorización a servicio» para <b>wsfe</b> y para{' '}
            <b>ws_sr_constancia_inscripcion</b>, con la CUIT de la SAS como «CUIT representado».
          </li>
          <li>
            Subí el certificado en «Pruebas (homologación)», elegí un punto de venta, probá la
            conexión y emití una factura de prueba.
          </li>
        </ol>
        <div className="max-w-xl">
          <ScreenWsass caption="WSASS: «Crear DN y certificado» con el alias y el pedido pegado." />
        </div>
        <Link
          href={`${base}/ajustes?tab=arca#homologacion`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-8"
        >
          Ir a «Pruebas (homologación)»
        </Link>
      </div>
    </details>
  )
}
