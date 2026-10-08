import { ArrowRight, BookOpen, ChevronDown, FileDown, FileUp, Monitor } from 'lucide-react'
import Link from 'next/link'
import { MiniActing, MiniSistema } from '@/components/administracion/guias/arca-mock/screens'
import { formatCuit } from '@/lib/fiscal'
import { Callout } from '../../_components/form-bits'

/**
 * Lo de arriba de la guía «Conectar ARCA» (diseño §5.1.1): «Antes de arrancar», «Las 3 reglas de
 * oro» (con una mini maqueta cada una) y las palabras de ARCA explicadas en criollo.
 */

export function GuideBefore({ base, sasCuit }: { base: string; sasCuit: string | null }) {
  return (
    <Callout tone="info" title="Antes de arrancar">
      <ul className="mt-1 list-disc space-y-1 pl-4">
        <li>
          Tu CUIT y tu <b>clave fiscal nivel 3</b> (la clave de ARCA). El nivel 3 se saca desde la
          app «ARCA Móvil», escaneando tu DNI y tu cara; por homebanking solo llega a nivel 2 y no
          alcanza.
        </li>
        <li>
          La CUIT de la SAS:{' '}
          {sasCuit ? (
            <b className="tabular-nums text-foreground">{formatCuit(sasCuit)}</b>
          ) : (
            <Link
              href={`${base}/ajustes?tab=sas`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              cargala en Datos de la SAS
            </Link>
          )}
          .
        </li>
        <li>
          Esta página abierta al lado de ARCA, en otra pestaña o ventana. Desde la compu es más
          cómodo.
        </li>
      </ul>
    </Callout>
  )
}

function Rule({
  n,
  title,
  children,
  visual,
}: {
  n: number
  title: React.ReactNode
  children: React.ReactNode
  visual: React.ReactNode
}) {
  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {n}
        </span>
        <div className="min-w-0 space-y-1 text-sm text-pretty">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{children}</p>
        </div>
      </div>
      <div className="min-w-0 pl-10 lg:pl-0">{visual}</div>
    </li>
  )
}

/** Los dos archivos: el .csr va a ARCA, el .crt vuelve a la plataforma. */
function FilesDiagram() {
  return (
    <div
      role="img"
      aria-label="El pedido .csr va de la plataforma a ARCA; el certificado .crt vuelve de ARCA a la plataforma."
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-border bg-background/60 p-3 text-xs"
    >
      <span className="flex flex-col items-center gap-1 text-center">
        <Monitor className="size-5 text-primary" aria-hidden />
        <span className="font-medium">La plataforma</span>
      </span>
      <span className="flex flex-col gap-2" aria-hidden="true">
        <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono font-medium text-primary">
          <FileUp className="size-3.5" />
          .csr
          <ArrowRight className="size-3.5" />
        </span>
        <span className="flex flex-row-reverse items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-mono font-medium text-success">
          <FileDown className="size-3.5" />
          .crt
          <ArrowRight className="size-3.5 rotate-180" />
        </span>
      </span>
      <span className="flex flex-col items-center gap-1 text-center">
        <span className="rounded bg-[#232a4e] px-1.5 py-0.5 text-[11px] font-black tracking-wide text-white">
          ARCA
        </span>
        <span className="font-medium">El portal</span>
      </span>
    </div>
  )
}

export function GoldenRules({ sasName }: { sasName: string }) {
  return (
    <section
      aria-labelledby="reglas-titulo"
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <header className="border-b border-border/60 px-5 py-4">
        <h2 id="reglas-titulo" className="font-serif text-lg font-semibold tracking-tight">
          Las 3 reglas de oro
        </h2>
        <p className="text-xs text-muted-foreground">
          Son los tres errores más comunes. Si seguís estas, no falla.
        </p>
      </header>
      <ol className="divide-y divide-border/60">
        <Rule
          n={1}
          title={
            <>
              Siempre elegí <b>la SAS</b>
            </>
          }
          visual={<MiniActing />}
        >
          Entrás con tu clave, pero todo se hace en nombre de la SAS. Arriba de cada pantalla tiene
          que decir «Actuando en representación de {sasName}».
        </Rule>
        <Rule
          n={2}
          title={
            <>
              El punto de venta es <b>«RECE para aplicativo y web services»</b>
            </>
          }
          visual={<MiniSistema />}
        >
          Uno nuevo, solo para la plataforma: distinto del que usa el sistema de caja que tenés hoy,
          así no se pisan los números de las facturas.
        </Rule>
        <Rule
          n={3}
          title={
            <>
              A ARCA le subís el <b>.csr</b>; de ARCA te traés el <b>.crt</b>
            </>
          }
          visual={<FilesDiagram />}
        >
          El .csr es el pedido que arma la plataforma. El .crt es el certificado que te da ARCA a
          cambio. Nunca al revés.
        </Rule>
      </ol>
    </section>
  )
}

const GLOSSARY: ReadonlyArray<{ term: string; meaning: string }> = [
  { term: 'ARCA', meaning: 'La agencia de impuestos: la ex AFIP.' },
  {
    term: 'Clave fiscal',
    meaning:
      'El usuario y la contraseña de ARCA de una persona. La SAS no tiene clave propia: se entra con la de quien la administra.',
  },
  {
    term: 'Administrador de relaciones',
    meaning:
      'La persona que maneja la clave fiscal en nombre de la SAS y reparte permisos. Suele ser quien figuró cuando se sacó la CUIT de la SAS.',
  },
  {
    term: 'Servicio',
    meaning: 'Cada «aplicación» de ARCA. Antes de usarlo, hay que habilitarlo para la SAS.',
  },
  {
    term: 'Relación',
    meaning:
      'El permiso que dice «tal persona o tal certificado puede usar tal servicio en nombre de la SAS». Se arma con «Nueva Relación».',
  },
  {
    term: 'Punto de venta',
    meaning:
      'El número que va adelante en cada factura: en 0005-00000123, el punto de venta es el 5. Cada sistema que factura usa el suyo.',
  },
  {
    term: 'Web service',
    meaning: 'La puerta por la que la plataforma le habla a ARCA sin que nadie entre al portal.',
  },
  {
    term: 'Pedido de certificado (.csr)',
    meaning: 'El archivo que arma la plataforma para pedirle el certificado a ARCA. No es secreto.',
  },
  {
    term: 'Certificado (.crt)',
    meaning:
      'La credencial que ARCA le da a la plataforma para hablar en nombre de la SAS. Dura 2 años.',
  },
  {
    term: 'Alias o «Computador Fiscal»',
    meaning:
      'El nombre del certificado en ARCA. Cuando lo autorizás a un servicio, ARCA lo llama «Computador Fiscal».',
  },
  {
    term: 'CAE',
    meaning: 'El código que ARCA le pone a cada factura electrónica para decir que es válida.',
  },
  {
    term: 'Homologación',
    meaning: 'El ARCA de pruebas: lo que se emite ahí no vale. Lo usa quien programa.',
  },
  {
    term: 'Domicilio Fiscal Electrónico',
    meaning: 'La casilla oficial de avisos de ARCA. Tiene que estar activa para facturar.',
  },
]

export function Glossary() {
  return (
    <details className="card-hairline group rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <BookOpen className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-medium">
          Palabras que vas a ver en ARCA, en criollo
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <dl className="grid gap-x-6 gap-y-3 border-t border-border/60 px-5 py-4 text-sm sm:grid-cols-2">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="space-y-0.5">
            <dt className="font-medium">{g.term}</dt>
            <dd className="text-muted-foreground text-pretty">{g.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
