import { Clock, Landmark, Monitor } from 'lucide-react'
import Link from 'next/link'
// `Fragment` con `key` en las listas de «Chequeá que…»: un arreglo de elementos sin clave que
// viaja del servidor al cliente deja el aviso de React en la consola.
import { Fragment, type ReactNode } from 'react'
import {
  doneNote,
  guideStatusText,
  nextGuideStep,
  sasLabel,
  stepAnchor,
} from '@/components/administracion/guias/arca-guide-model'
import {
  ScreenArbolServicios,
  ScreenAutoridad,
  ScreenCertAgregar,
  ScreenCertDetalle,
  ScreenCertLista,
  ScreenComputadorFiscal,
  ScreenFacturaA,
  ScreenLogin,
  ScreenMenuRelaciones,
  ScreenNuevaRelacion,
  ScreenPortalHome,
  ScreenPortalSearch,
  ScreenPvAlta,
  ScreenPvListado,
  ScreenPvMenu,
  ScreenRepresentantePersona,
} from '@/components/administracion/guias/arca-mock/screens'
import {
  GuideBlock,
  GuideChecklist,
  GuideChip,
  GuideStep,
  GuideTroubles,
} from '@/components/administracion/guias/guide-step'
import { HowToMisComprobantes } from '@/components/administracion/guias/how-to'
import { StepScreens } from '@/components/administracion/guias/step-screens'
import { Button } from '@/components/ui/button'
import { type ArcaGuideStepId, guideStep } from '@/lib/arca/guide'
import type { ArcaConnectionView, ArcaGuideStepView } from '@/lib/arca/views'
import { formatCuit } from '@/lib/fiscal'
import { ArcaCertUpload, ArcaCsrAction } from '../../_components/arca-certificate-actions'
import {
  ArcaClassesSelect,
  ArcaMarkStepButton,
  ArcaPointOfSaleForm,
  type SalesPointBrief,
} from '../../_components/arca-step-actions'
import { ArcaTestAction } from '../../_components/arca-test-action'
import { Callout } from '../../_components/form-bits'

/**
 * Los 11 pasos de «Conectar ARCA» (diseño §5.1.3), con su contenido: para qué, las pantallas de
 * ARCA (maquetas con «Tocá acá»), lo que hay que tocar, la acción de la plataforma cuando el paso
 * trae algo (punto de venta, Factura A, pedido, certificado, prueba), lo que hay que chequear y
 * qué hacer si algo sale mal. Textos de `arca-pasos.md`; los datos del bar salen de la conexión
 * y de Datos de la SAS. Server component: lo interactivo son islas de cliente.
 */

export type GuideStepsData = {
  readonly slug: string
  readonly base: string
  readonly canWrite: boolean
  readonly states: Readonly<Record<ArcaGuideStepId, ArcaGuideStepView>>
  readonly connection: ArcaConnectionView | null
  readonly sasName: string | null
  readonly sasCuit: string | null
  readonly suggestedAlias: string
  readonly salesPoints: readonly SalesPointBrief[]
}

const ADMIN_WHO = 'quien maneja la clave fiscal de la SAS (el administrador de relaciones)'

/** Las etiquetas del encabezado de un paso. */
function chipsFor(id: ArcaGuideStepId): ReactNode {
  const step = guideStep(id)
  const platform = step.where === 'La plataforma'
  return (
    <>
      <GuideChip icon={platform ? <Monitor aria-hidden /> : <Landmark aria-hidden />}>
        {platform ? 'En la plataforma' : 'En ARCA'}
      </GuideChip>
      <GuideChip icon={<Clock aria-hidden />}>≈ {step.minutes} min</GuideChip>
      {step.optional ? <GuideChip>Opcional</GuideChip> : null}
    </>
  )
}

/** Quién lo hace y dónde (la primera línea del cuerpo). */
function WhoWhere({ id }: { id: ArcaGuideStepId }) {
  const step = guideStep(id)
  const platform = step.where === 'La plataforma'
  return (
    <p className="text-xs text-muted-foreground text-pretty">
      <span className="font-medium text-foreground">Lo hace:</span>{' '}
      {step.who.startsWith('Quien maneja')
        ? ADMIN_WHO
        : step.who.charAt(0).toLowerCase() + step.who.slice(1)}
      {platform ? null : (
        <>
          {' · '}
          <span className="font-medium text-foreground">Dónde:</span> {step.where}
        </>
      )}
    </p>
  )
}

/**
 * El aviso de «Revisar» o «No anduvo» de un paso. Si lo que falta es la CUIT de la SAS, trae el
 * botón para cargarla (la contadora no lo ve: no puede cambiarla).
 */
function problemFor(state: ArcaGuideStepView, data: GuideStepsData): ReactNode {
  if (!state.problem || (state.status !== 'check' && state.status !== 'failed')) return null
  const action =
    state.problem.key === 'sas_cuit_missing' && data.canWrite ? (
      <Button asChild variant="outline" className="h-11 md:h-9">
        <Link href={`${data.base}/ajustes?tab=sas`}>Ir a Datos de la SAS</Link>
      </Button>
    ) : null
  return (
    <Callout
      tone={state.status === 'failed' ? 'error' : 'warning'}
      title={state.problem.title}
      action={action}
    >
      {state.problem.body}
    </Callout>
  )
}

const MARK_LABELS: Partial<Record<ArcaGuideStepId, string>> = {
  s0_prereq: 'Ya revisé todo',
  s1_elegir_sas: 'Ya lo hice',
  s4_certificados: 'Ya me aparece el servicio',
  s7_wsfe: 'Ya lo hice',
  s8_padron: 'Ya lo hice',
  s10_mis_comprobantes: 'Ya lo hice',
}

function Step({
  id,
  data,
  children,
}: {
  id: ArcaGuideStepId
  data: GuideStepsData
  children: ReactNode
}) {
  const step = guideStep(id)
  const state = data.states[id]
  const next = nextGuideStep(id)
  // Con la CUIT de la SAS sin cargar, «Ya lo arreglé» no arregla nada (el paso queda listo solo
  // cuando se carga la CUIT): el aviso de arriba ya trae «Ir a Datos de la SAS».
  const markLabel = state.reason === 'sas_cuit_missing' ? undefined : MARK_LABELS[id]
  // Un paso hecho dice «Hecho el 08/10 por Ana» (o «Hecho: lo vimos solo») en lugar del estado:
  // juntos se leía «Hecho · Hecho el 08/10 por Ana».
  const done = doneNote(state)
  return (
    <GuideStep
      id={id}
      anchor={stepAnchor(step.n)}
      n={step.n}
      title={step.title}
      status={state.status}
      statusText={done ?? guideStatusText(state.status, step.optional)}
      chips={chipsFor(id)}
      problem={problemFor(state, data)}
      footerHow={step.howVerified}
      footerAction={
        data.canWrite && markLabel ? (
          <ArcaMarkStepButton
            slug={data.slug}
            step={id}
            status={state.status}
            source={state.source}
            label={markLabel}
          />
        ) : null
      }
      next={
        next
          ? { id: next.id, anchor: stepAnchor(next.n), label: `Siguiente: paso ${next.n}` }
          : null
      }
    >
      <WhoWhere id={id} />
      {children}
    </GuideStep>
  )
}

/** Una CUIT con guiones que no se corta en dos renglones (en el celular se partía en el guion). */
function Cuit({ value }: { value: string }) {
  return <span className="whitespace-nowrap tabular-nums">{formatCuit(value)}</span>
}

/** Lo que ve la contadora en lugar de una acción de la plataforma. */
function ReadOnlyAction({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border/80 bg-background/40 p-3 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

// ─── Servicios del árbol de ARCA (P-07) ──────────────────────────────────────

const SVC_CERTIFICADOS = {
  name: 'Administración de Certificados Digitales',
  description: 'Administre aquí sus Certificados Digitales para webservices',
}
const SVC_FACTURACION = { name: 'Facturación Electrónica', description: 'Factura electrónica' }
const SVC_MTXCA = {
  name: 'Factura Electrónica con Detalle - MTXCA',
  description: 'Factura Electrónica con Detalle - MTXCA',
}
const SVC_PADRON = {
  name: 'Consulta de constancia de inscripción',
  description: 'Servicio de Consulta de la Constancia de Inscripción de Padrón',
}
const SVC_MIS_COMPROBANTES = {
  name: 'Mis Comprobantes',
  description: 'Consulta de Comprobantes Electrónicos Emitidos y Recibidos',
}

// ─── Pasos ───────────────────────────────────────────────────────────────────

function Step0({ data }: { data: GuideStepsData }) {
  const others = data.salesPoints.filter((p) => p.label !== 'Plataforma (ARCA)')
  return (
    <Step id="s0_prereq" data={data}>
      <GuideBlock label="Para qué">
        <p>
          Antes de tocar nada, revisá que la SAS esté en regla para facturar. Si algo de esto falta,
          ARCA no deja emitir facturas y conviene arreglarlo primero con tu contadora.
        </p>
      </GuideBlock>
      <GuideBlock label="Qué revisás">
        <ol className="space-y-3">
          <li>
            <b>Tu clave fiscal es nivel 3.</b> Se sube desde la app «ARCA Móvil», escaneando el DNI
            y la cara. Por homebanking solo llega a nivel 2, que no alcanza.
          </li>
          <li>
            <b>La CUIT de la SAS está cargada.</b>{' '}
            {data.sasCuit ? (
              <span className="text-success">
                Sí: <Cuit value={data.sasCuit} /> (la tomamos de Datos de la SAS).
              </span>
            ) : (
              <>
                Todavía no:{' '}
                <Link
                  href={`${data.base}/ajustes?tab=sas`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  cargala en Datos de la SAS
                </Link>
                .
              </>
            )}
          </li>
          <li>
            <b>La SAS es «Responsable inscripto» y tiene una actividad.</b> En la portada de
            arca.gob.ar está el botón «Constancia de CUIT»: poné la CUIT de la SAS y fijate que diga
            Responsable inscripto en IVA (la condición de quien cobra y descuenta IVA) y que tenga
            al menos una actividad.
          </li>
          <li>
            <b>El Domicilio Fiscal Electrónico está activo.</b> Es la casilla oficial de avisos de
            ARCA. Sin eso, ARCA no deja facturar.
          </li>
          <li>
            <b>Anotá los puntos de venta que ya usás.</b> Son el número antes del guion en cualquier
            factura del sistema de caja que usás hoy (en{' '}
            <span className="whitespace-nowrap tabular-nums">0003-00001234</span>, el punto de venta
            es el 3).{' '}
            {others.length > 0 ? (
              <span>
                En Ajustes › Puntos de venta tenés:{' '}
                {others.map((p, i) => (
                  <span key={p.number}>
                    {i > 0 ? ', ' : ''}
                    <b className="tabular-nums">{String(p.number).padStart(4, '0')}</b> ({p.label})
                  </span>
                ))}
                .
              </span>
            ) : null}
          </li>
        </ol>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Revisá el Domicilio Fiscal Electrónico',
            mock: (
              <ScreenPortalHome
                highlight="domicilio"
                caption="En el portal, el ícono «Domicilio Fiscal Electrónico». Entrá y fijate que esté activo."
              />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                Entrá a ARCA con tu CUIT y tu clave y abrí «Domicilio Fiscal Electrónico» para ver
                que esté activo.
              </>
            ),
            screen: 0,
          },
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'No sé si soy el administrador de relaciones de la SAS',
            fix: 'Entrá con tu CUIT a «Administrador de relaciones»: si en el desplegable aparece la SAS, sos vos. Si no aparece, lo es otra persona (suele ser quien figuró cuando se sacó la CUIT de la SAS): esta guía la tiene que hacer ella.',
          },
          {
            problem: 'La CUIT de la SAS no figura activa o no es Responsable inscripto',
            fix: 'Hablalo con tu contadora antes de seguir: ARCA no deja facturar hasta que se regularice.',
          },
        ]}
      />
    </Step>
  )
}

function Step1({ data }: { data: GuideStepsData }) {
  const sas = sasLabel(data.sasName)
  return (
    <Step id="s1_elegir_sas" data={data}>
      <GuideBlock label="Para qué">
        <p>
          La SAS no tiene clave fiscal propia: entrás con la tuya y elegís actuar en nombre de la
          SAS. Así, todo lo que hagas después queda a nombre de la SAS y no al tuyo.
        </p>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Entrá con tu CUIT',
            mock: (
              <ScreenLogin caption="«Ingresar con Clave Fiscal»: tu CUIT personal, sin guiones." />
            ),
          },
          {
            title: 'Abrí el Administrador de relaciones',
            mock: (
              <ScreenPortalHome caption="En el portal, el ícono «Administrador de relaciones»." />
            ),
          },
          {
            title: 'Elegí la SAS',
            mock: (
              <ScreenAutoridad caption="En «Autoridad de Aplicación», el desplegable con las personas que representás." />
            ),
          },
          {
            title: 'Fijate quién aparece arriba',
            mock: (
              <ScreenMenuRelaciones
                highlight="acting"
                caption={`Arriba tiene que decir «Actuando en representación de ${sas}».`}
              />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                Entrá a <b>arca.gob.ar</b>, tocá «Iniciar sesión» y poné <b>tu CUIT personal</b> sin
                guiones. Tocá «Siguiente», escribí tu clave y tocá «INGRESAR».
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                Tocá <b>«Administrador de relaciones»</b> (si no lo ves, escribilo en el buscador
                «¿Qué necesitás?»).
              </>
            ),
            screen: 1,
          },
          {
            content: (
              <>
                En el desplegable de «Autoridad de Aplicación» elegí <b>{sas}</b>, no tu nombre.
              </>
            ),
            screen: 2,
          },
          {
            content: (
              <>
                Mirá la cabecera: tiene que decir <b>«Actuando en representación de {sas}»</b>.
              </>
            ),
            screen: 3,
          },
        ]}
      />
      <GuideChecklist
        items={[
          <Fragment key="acting">
            Arriba dice «Actuando en representación de {sas}
            {data.sasCuit ? (
              <>
                {' '}
                [<Cuit value={data.sasCuit} />]
              </>
            ) : null}
            ».
          </Fragment>,
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'Arriba dice mi nombre y no el de la SAS',
            fix: 'Volvé al Administrador de relaciones y, en el desplegable, elegí la SAS.',
          },
          {
            problem: 'La SAS no aparece en el desplegable',
            fix: 'Tu usuario no administra la SAS. Pedile a quien la administra que haga esta guía o que te dé el permiso.',
          },
          {
            problem: '¿Entro con la CUIT de la SAS?',
            fix: 'No: la SAS no tiene clave. Siempre entrás con tu CUIT y tu clave, y elegís la SAS adentro.',
          },
        ]}
      />
    </Step>
  )
}

function Step2({ data }: { data: GuideStepsData }) {
  return (
    <Step id="s2_punto_venta" data={data}>
      <GuideBlock label="Para qué">
        <p>
          El punto de venta es el número que va adelante en cada factura (en{' '}
          <span className="whitespace-nowrap tabular-nums">0005-00000001</span>, el 5). La
          plataforma necesita uno propio, de tipo «RECE para aplicativo y web services» (el que deja
          facturar por internet, sin entrar al portal), para no chocar con la numeración del sistema
          de caja que usás hoy.
        </p>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Buscá el servicio',
            mock: (
              <ScreenPortalSearch
                query="puntos de venta"
                title="Administración de puntos de venta y domicilios"
                description="Administración de Puntos de Venta y Domicilios"
              />
            ),
          },
          {
            title: 'Elegí la SAS y «A/B/M de Puntos de Venta»',
            mock: (
              <ScreenPvMenu caption="Esta pantalla puede cambiar: buscá la SAS y la opción «A/B/M de Puntos de Venta»." />
            ),
          },
          {
            title: 'Anotá los que hay y tocá «Agregar»',
            mock: (
              <ScreenPvListado caption="El listado con los puntos de venta que ya existen. El botón para agregar puede estar en otro lugar." />
            ),
          },
          {
            title: 'Completá el alta',
            mock: (
              <ScreenPvAlta caption="El número es un ejemplo: ARCA te propone el siguiente libre." />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                En el buscador del portal escribí <b>puntos de venta</b> y tocá «Administración de
                puntos de venta y domicilios».
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                Elegí <b>la SAS</b> y entrá a <b>«A/B/M de Puntos de Venta»</b>. Si sale un aviso,
                cerralo.
              </>
            ),
            screen: 1,
          },
          {
            content: (
              <>
                Anotá los números que ya están (son los de tu sistema de caja o de otros sistemas) y
                tocá <b>«Agregar»</b>.
              </>
            ),
            screen: 2,
          },
          {
            content: (
              <>
                Completá: <b>Número</b> (dejá el que te propone o poné uno libre fácil de
                reconocer), <b>Nombre Fantasía</b> («Plataforma»: solo lo ve ARCA),{' '}
                <b>Sistema: «RECE para aplicativo y web services»</b> y <b>Nuevo domicilio</b>: el
                local. Tocá «Aceptar» y confirmá con «Sí».
              </>
            ),
            screen: 3,
          },
        ]}
      />
      <GuideBlock label="Qué te traés">
        <p>
          {data.canWrite
            ? 'El número del punto de venta que creaste. Guardalo acá:'
            : 'El número del punto de venta que se creó para la plataforma.'}
        </p>
        {data.canWrite ? (
          <ArcaPointOfSaleForm
            slug={data.slug}
            environment="produccion"
            connection={data.connection}
            existing={data.salesPoints}
            guideHref=""
          />
        ) : (
          <ReadOnlyAction>
            {data.connection?.pointOfSale
              ? `Punto de venta guardado: ${String(data.connection.pointOfSale).padStart(4, '0')}.`
              : 'Todavía no se guardó el punto de venta.'}
          </ReadOnlyAction>
        )}
      </GuideBlock>
      <GuideChecklist
        items={[
          <Fragment key="sistema">
            El sistema dice <b>«RECE para aplicativo y web services»</b>.
          </Fragment>,
          <Fragment key="nuevo">Es un número nuevo, que no usa ningún otro sistema.</Fragment>,
          <Fragment key="guardado">Guardaste el número acá arriba.</Fragment>,
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'El local no aparece en «Nuevo domicilio»',
            fix: 'Hay que declararlo como «Locales y establecimientos» en Sistema Registral › Registro Único Tributario › Domicilios (los nombres de los botones pueden cambiar). Si no te sale, hacelo con tu contadora.',
          },
          {
            problem: 'Me equivoqué de sistema',
            fix: 'Un punto de venta no cambia de sistema: creá otro. Ojo: uno dado de baja ya no se puede volver a usar.',
          },
          {
            problem: 'Lo creé hoy y la prueba dice que no está habilitado',
            fix: 'ARCA puede tardar unas horas en verlo desde la plataforma. Probá la conexión más tarde.',
          },
          {
            problem: '¿Lo puedo usar enseguida?',
            fix: 'ARCA pide informar el punto de venta unos días antes de empezar a facturar con él (3 días hábiles). Si vas a facturar pronto, consultalo con tu contadora.',
          },
        ]}
      />
    </Step>
  )
}

function Step3({ data }: { data: GuideStepsData }) {
  return (
    <Step id="s3_factura_a" data={data}>
      <GuideBlock label="Para qué">
        <p>
          A los consumidores finales se les hace <b>Factura B</b>, que no necesita este paso. La{' '}
          <b>Factura A</b> es para empresas y responsables inscriptos (un evento corporativo, por
          ejemplo) y ARCA la habilita aparte. Si no le vas a facturar a empresas, salteá este paso.
        </p>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Habilitación de Comprobantes',
            mock: (
              <ScreenFacturaA caption="Esta pantalla puede verse distinta: buscá «Habilitación de Comprobantes»." />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                En el buscador del portal escribí <b>Regímenes de Facturación</b> y entrá a
                «Regímenes de Facturación y Registración (REAR/RECE/RFI)», eligiendo la SAS.
              </>
            ),
          },
          {
            content: (
              <>
                Entrá a <b>«Habilitación de Comprobantes»</b> y presentá el <b>F. 856</b> (el
                formulario de las sociedades).
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                ARCA mira la solvencia: que al menos un tercio de los socios tenga bienes
                declarados, o que la SAS tenga inmuebles o autos. Los socios que la acreditan entran
                con su clave a «Solvencia como Componente de Empresa» y aceptan.
              </>
            ),
          },
          {
            content: (
              <>
                Si la solvencia no alcanza, al presentarlo elegí{' '}
                <b>«A con Pago en CBU informada»</b>: después no se puede cambiar.
              </>
            ),
          },
        ]}
      />
      <GuideBlock label="Qué te traés">
        <p>
          Qué Factura A te autorizó ARCA: la común, la que dice «Operación sujeta a retención» (al
          cliente le retienen IVA y Ganancias: a las empresas no les gusta) o la de «Pago en CBU
          informada».
        </p>
        <ArcaClassesSelect
          slug={data.slug}
          environment="produccion"
          connection={data.connection}
          readOnly={!data.canWrite}
        />
      </GuideBlock>
      <GuideTroubles
        items={[
          {
            problem: 'ARCA suspendió la solicitud',
            fix: 'Tenés 15 días para presentar la documentación por «Presentaciones Digitales». Hacelo con tu contadora.',
          },
          {
            problem: 'No sé si lo necesito',
            fix: 'Si solo le vendés a consumidores finales, no. Lo podés hacer más adelante y volver a este paso.',
          },
        ]}
      />
    </Step>
  )
}

function Step4({ data }: { data: GuideStepsData }) {
  return (
    <Step id="s4_certificados" data={data}>
      <GuideBlock label="Para qué">
        <p>
          Habilita a tu usuario a crear certificados en nombre de la SAS. El certificado es la
          credencial con la que la plataforma le va a hablar a ARCA.
        </p>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Nueva Relación',
            mock: (
              <ScreenMenuRelaciones caption="En el Administrador de Relaciones, con la SAS elegida." />
            ),
          },
          {
            title: 'Buscá el servicio',
            mock: <ScreenNuevaRelacion highlight="buscarServicio" />,
          },
          {
            title: 'Administración de Certificados Digitales',
            mock: (
              <ScreenArbolServicios
                folder="Servicios Interactivos"
                service={SVC_CERTIFICADOS}
                before={[
                  {
                    name: 'Actualización Autoridades Societarias',
                    description: 'Actualización Autoridades Societarias',
                  },
                ]}
                after={[
                  {
                    name: 'Administración de Flota de Vehículos de Alquiler',
                    description: 'Administración de la flota de vehículos de alquiler',
                  },
                ]}
                caption="ARCA › Servicios Interactivos › Administración de Certificados Digitales."
              />
            ),
          },
          {
            title: 'Buscá el representante',
            mock: (
              <ScreenNuevaRelacion
                highlight="buscarRepresentante"
                service="Administración de Certificados Digitales"
                representative={null}
              />
            ),
          },
          {
            title: 'Poné tu CUIT',
            mock: <ScreenRepresentantePersona service="Administración de Certificados Digitales" />,
          },
          {
            title: 'Confirmá',
            mock: (
              <ScreenNuevaRelacion
                highlight="confirmar"
                service="Administración de Certificados Digitales"
                representative={<b>TU NOMBRE [Clave Fiscal Nivel 3]</b>}
              />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                Con la SAS elegida (paso 1), tocá <b>«Nueva Relación»</b>.
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                En la fila «Servicio», tocá <b>«BUSCAR»</b>.
              </>
            ),
            screen: 1,
          },
          {
            content: (
              <>
                Tocá <b>ARCA</b>, después <b>«Servicios Interactivos»</b> y elegí{' '}
                <b>«Administración de Certificados Digitales»</b>.
              </>
            ),
            screen: 2,
          },
          {
            content: (
              <>
                En la fila «Representante», tocá <b>«BUSCAR»</b>.
              </>
            ),
            screen: 3,
          },
          {
            content: (
              <>
                Poné <b>tu CUIT</b>, tocá «BUSCAR» (aparece tu nombre) y «CONFIRMAR». Dejá sin
                tildar «El usuario es Externo».
              </>
            ),
            screen: 4,
          },
          {
            content: (
              <>
                Revisá y tocá <b>«CONFIRMAR»</b>. Sale el formulario F. 3283/E: es el comprobante
                del permiso, guardalo como PDF si querés.
              </>
            ),
            screen: 5,
          },
          {
            content: (
              <>
                <b>Cerrá sesión y volvé a entrar</b>: recién ahí aparece el servicio nuevo.
              </>
            ),
          },
        ]}
      />
      <GuideChecklist
        items={[
          <Fragment key="dador">«Autorizante (Dador)» dice la SAS, no tu nombre.</Fragment>,
          <Fragment key="servicio">
            Después de volver a entrar, en el buscador aparece «Administración de Certificados
            Digitales».
          </Fragment>,
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'No me aparece el servicio',
            fix: 'Cerrá sesión y volvé a entrar. Si sigue sin aparecer, entrá a «Aceptación de Designación» y tocá «Aceptar».',
          },
          {
            problem: '«Autorizante (Dador)» dice mi nombre',
            fix: 'Volvé al paso 1 y elegí la SAS en el desplegable antes de tocar «Nueva Relación».',
          },
        ]}
      />
    </Step>
  )
}

function Step5({ data }: { data: GuideStepsData }) {
  return (
    <Step id="s5_pedido" data={data}>
      <GuideBlock label="Para qué">
        <p>
          La plataforma arma un <b>pedido de certificado</b> (un archivo .csr). Vos lo subís a ARCA
          en el paso 6 y ARCA te devuelve el certificado. La clave secreta que acompaña al pedido
          queda guardada en la plataforma, cifrada, y nunca sale de acá.
        </p>
      </GuideBlock>
      <GuideBlock label="Qué tocás">
        <p>
          Revisá el <b>alias</b> (el nombre que va a tener el certificado en ARCA: solo letras y
          números) y tocá «Generar el pedido y bajarlo». El archivo queda en Descargas.
        </p>
      </GuideBlock>
      <GuideBlock label="Qué te traés">
        {data.canWrite ? (
          <ArcaCsrAction
            slug={data.slug}
            environment="produccion"
            connection={data.connection}
            suggestedAlias={data.suggestedAlias}
            guideHref=""
          />
        ) : (
          <ReadOnlyAction>
            {data.connection?.hasCsr
              ? `El pedido ya está generado (alias ${data.connection.alias}).`
              : 'Todavía no se generó el pedido.'}
          </ReadOnlyAction>
        )}
      </GuideBlock>
      <GuideChecklist
        items={[
          <Fragment key="csr">
            Se bajó el archivo que termina en <b>.csr</b> (está en Descargas).
          </Fragment>,
          <Fragment key="alias">Copiaste o anotaste el alias: lo vas a escribir en ARCA.</Fragment>,
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'Perdí el archivo',
            fix: 'Tocá «Descargar de nuevo»: es el mismo pedido, sirve igual.',
          },
          {
            problem: 'Quiero empezar de cero (o ARCA dice que el alias está repetido)',
            fix: '«Empezar de cero» genera otro pedido, y ahí podés cambiar el alias. El pedido anterior deja de servir: si ya subiste un certificado, vas a tener que repetir el paso 6.',
          },
          {
            problem: 'No se descarga',
            fix: 'Probá desde la compu: algunos celulares no guardan archivos .csr.',
          },
        ]}
      />
    </Step>
  )
}

function Step6({ data }: { data: GuideStepsData }) {
  const sas = sasLabel(data.sasName)
  return (
    <Step id="s6_certificado" data={data}>
      <GuideBlock label="Para qué">
        <p>
          Con el pedido del paso 5, ARCA crea el certificado de la plataforma. Después lo bajás (es
          un archivo .crt) y lo subís acá.
        </p>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Buscá el servicio',
            mock: (
              <ScreenPortalSearch
                query="certificados"
                title={SVC_CERTIFICADOS.name}
                description={SVC_CERTIFICADOS.description}
              />
            ),
          },
          {
            title: 'Elegí la SAS',
            mock: (
              <ScreenAutoridad
                title="Administración de Certificados Digitales"
                approximate
                caption="Si representás a más de una persona, ARCA te pregunta en nombre de quién."
              />
            ),
          },
          {
            title: '«Agregar alias»',
            mock: <ScreenCertLista caption="La lista «Certificados» (vacía la primera vez)." />,
          },
          {
            title: 'CUIT, alias y el .csr',
            mock: (
              <ScreenCertAgregar caption="Arriba, la CUIT de la SAS. Después el alias, el archivo .csr y «Agregar alias»." />
            ),
          },
          {
            title: 'Tocá «Ver»',
            mock: <ScreenCertLista withAlias caption="Vuelve la lista, con tu alias." />,
          },
          {
            title: 'Bajá el certificado',
            mock: (
              <ScreenCertDetalle caption="El detalle: el DN con la CUIT de la SAS, el estado VALIDO y el ícono «Descargar»." />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                En el buscador escribí <b>certificados</b> y tocá «Administración de Certificados
                Digitales». Si no aparece, revisá el paso 4.
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                Si te pregunta en nombre de quién, elegí <b>{sas}</b>.
              </>
            ),
            screen: 1,
          },
          {
            content: (
              <>
                Tocá <b>«Agregar alias»</b>.
              </>
            ),
            screen: 2,
          },
          {
            content: (
              <>
                Fijate que la <b>CUIT sea la de la SAS</b>. En «Alias» escribí el alias del paso 5,
                en «Examinar…» elegí el archivo <b>.csr</b> y tocá <b>«Agregar alias»</b>.
              </>
            ),
            screen: 3,
          },
          {
            content: (
              <>
                Al lado de tu alias, tocá <b>«Ver»</b>.
              </>
            ),
            screen: 4,
          },
          {
            content: (
              <>
                Tocá el ícono de <b>«Descargar»</b>: se baja el certificado (.crt). Subilo acá
                abajo.
              </>
            ),
            screen: 5,
          },
        ]}
      />
      <GuideBlock label="Qué te traés">
        {data.connection?.certificate && !data.connection.certificate.expired ? (
          <p className="text-sm text-success">
            Ya subiste el certificado. Si bajaste otro, podés subirlo de nuevo.
          </p>
        ) : null}
        {data.canWrite ? (
          <ArcaCertUpload
            slug={data.slug}
            environment="produccion"
            connection={data.connection}
            guideHref=""
          />
        ) : (
          <ReadOnlyAction>
            {data.connection?.certificate
              ? 'El certificado ya está cargado.'
              : 'Todavía no se subió el certificado.'}
          </ReadOnlyAction>
        )}
      </GuideBlock>
      <GuideChecklist
        items={[
          <Fragment key="cuit">
            La CUIT de la pantalla de ARCA es la de la SAS
            {data.sasCuit ? (
              <>
                {' '}
                (<Cuit value={data.sasCuit} />)
              </>
            ) : null}
            , no la tuya.
          </Fragment>,
          <Fragment key="valido">
            El estado del certificado dice <b>VALIDO</b>.
          </Fragment>,
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'La CUIT que aparece es la mía',
            fix: 'Volvé y elegí la SAS cuando te pregunta en nombre de quién. Si no te pregunta, falta el paso 4 hecho para la SAS.',
          },
          {
            problem: 'ARCA dice «alias repetido»',
            fix: 'Ese nombre ya existe. En el paso 5 tocá «Empezar de cero» y elegí otro alias.',
          },
          {
            problem: 'ARCA no acepta el archivo',
            fix: 'Tiene que ser el .csr del paso 5 (no el .crt ni otro archivo).',
          },
          {
            problem: 'La plataforma dice que el certificado es de otro pedido',
            fix: 'Subiste un certificado hecho con otro .csr. Volvé a ARCA y creá el certificado con el .csr de este paso.',
          },
        ]}
      />
    </Step>
  )
}

function AuthorizeStep({
  data,
  id,
  service,
  wrong,
  before,
  purpose,
}: {
  data: GuideStepsData
  id: 's7_wsfe' | 's8_padron'
  service: { name: string; description: string }
  wrong?: { name: string; description: string }
  before?: { name: string; description: string }
  purpose: ReactNode
}) {
  const sas = sasLabel(data.sasName)
  const alias = data.connection?.hasCsr ? data.connection.alias : data.suggestedAlias
  return (
    <Step id={id} data={data}>
      <GuideBlock label="Para qué">{purpose}</GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Nueva Relación',
            mock: (
              <ScreenMenuRelaciones caption="En el Administrador de Relaciones, con la SAS elegida." />
            ),
          },
          {
            title: 'Buscá el servicio',
            mock: <ScreenNuevaRelacion highlight="buscarServicio" />,
          },
          {
            title: service.name,
            mock: (
              <ScreenArbolServicios
                folder="WebServices"
                service={service}
                wrong={wrong}
                before={before ? [before] : []}
                caption={`ARCA › WebServices › ${service.name}.`}
              />
            ),
          },
          {
            title: 'Buscá el representante',
            mock: (
              <ScreenNuevaRelacion
                highlight="buscarRepresentante"
                service={service.name}
                representative={null}
              />
            ),
          },
          {
            title: 'Elegí tu alias',
            mock: (
              <ScreenComputadorFiscal
                service={service.name}
                caption="En «Computador Fiscal» aparece el alias de tu certificado."
              />
            ),
          },
          {
            title: 'Confirmá',
            mock: (
              <ScreenNuevaRelacion
                highlight="confirmar"
                service={service.name}
                representative={
                  <span>
                    Computador Fiscal identificado como <b>{alias}</b> relacionado con la persona{' '}
                    <b>{data.sasCuit ?? 'CUIT DE LA SAS'}</b>
                  </span>
                }
              />
            ),
          },
        ]}
        instructions={[
          {
            content: (
              <>
                En el Administrador de Relaciones, con <b>{sas}</b> elegida, tocá{' '}
                <b>«Nueva Relación»</b>.
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                En la fila «Servicio», tocá <b>«BUSCAR»</b>.
              </>
            ),
            screen: 1,
          },
          {
            content: (
              <>
                Tocá <b>ARCA</b>, después la carpeta <b>«WebServices»</b> y elegí{' '}
                <b>«{service.name}»</b>.
                {wrong ? <> Ojo: no elijas «{wrong.name}», que está justo arriba.</> : null}
              </>
            ),
            screen: 2,
          },
          {
            content: (
              <>
                En la fila «Representante», tocá <b>«BUSCAR»</b>.
              </>
            ),
            screen: 3,
          },
          {
            content: (
              <>
                En «Computador Fiscal» elegí <b>{alias}</b> (tu certificado) y tocá «CONFIRMAR».
              </>
            ),
            screen: 4,
          },
          {
            content: (
              <>
                Revisá y tocá <b>«CONFIRMAR»</b>. Sale la constancia F. 3283/E.
              </>
            ),
            screen: 5,
          },
        ]}
      />
      <GuideChecklist
        items={[
          <Fragment key="acting">Arriba dice «Actuando en representación de {sas}».</Fragment>,
          <Fragment key="servicio">
            El servicio es «{service.name}»
            {wrong ? <> (no «{wrong.name}» ni «Comprobantes en línea»)</> : null}.
          </Fragment>,
          <Fragment key="computador">
            El Computador Fiscal es <b>{alias}</b>.
          </Fragment>,
        ]}
      />
      <GuideTroubles
        items={[
          {
            problem: 'El desplegable «Computador Fiscal» está vacío',
            fix: 'El certificado quedó a tu nombre y no al de la SAS. Repetí el paso 6 eligiendo la SAS.',
          },
          {
            problem: 'La prueba dice «La SAS no está en el permiso»',
            fix: 'Hiciste la relación representándote a vos. Repetí este paso con la SAS elegida (paso 1).',
          },
          {
            problem: 'No encuentro el servicio en WebServices',
            fix: 'Están en orden alfabético. Buscalo con el nombre exacto; los de «Servicios Interactivos» son otra carpeta.',
          },
        ]}
      />
    </Step>
  )
}

function Step9({ data }: { data: GuideStepsData }) {
  return (
    <Step id="s9_probar" data={data}>
      <GuideBlock label="Para qué">
        <p>
          La plataforma hace 7 chequeos con ARCA: que responda, que el certificado esté autorizado,
          que la SAS esté en el permiso, el punto de venta, la numeración, el padrón y el
          vencimiento del certificado. Si algo falla, te dice qué es y a qué paso volver.
        </p>
      </GuideBlock>
      <GuideBlock label="Qué tocás">
        {data.canWrite ? (
          <ArcaTestAction
            slug={data.slug}
            environment="produccion"
            connection={data.connection}
            guideHref=""
            showNextSteps
          />
        ) : (
          <ReadOnlyAction>
            {data.connection?.lastTestAt
              ? 'La última prueba se ve en Ajustes › ARCA.'
              : 'Todavía no se probó la conexión.'}
          </ReadOnlyAction>
        )}
      </GuideBlock>
      <GuideChecklist
        items={[
          <Fragment key="todos">
            Todos los chequeos tienen ✓. Los avisos en amarillo no frenan, pero conviene leerlos.
          </Fragment>,
        ]}
      />
    </Step>
  )
}

function Step10({ data }: { data: GuideStepsData }) {
  return (
    <Step id="s10_mis_comprobantes" data={data}>
      <GuideBlock label="Para qué">
        <p>
          Para bajar una vez por mes las facturas que te hicieron tus proveedores y cargarlas de una
          sola vez en Administración, en vez de una por una.
        </p>
      </GuideBlock>
      <StepScreens
        screens={[
          {
            title: 'Nueva Relación',
            mock: (
              <ScreenMenuRelaciones caption="En el Administrador de Relaciones, con la SAS elegida." />
            ),
          },
          {
            title: 'Mis Comprobantes',
            mock: (
              <ScreenArbolServicios
                folder="Servicios Interactivos"
                service={SVC_MIS_COMPROBANTES}
                approximate
                caption="Puede estar en otro lugar del árbol: buscá «Mis Comprobantes»."
              />
            ),
          },
          {
            title: 'Quién lo va a bajar',
            mock: <ScreenRepresentantePersona service="Mis Comprobantes" />,
          },
        ]}
        instructions={[
          {
            content: (
              <>
                Con la SAS elegida, tocá <b>«Nueva Relación»</b> y en «Servicio», «BUSCAR».
              </>
            ),
            screen: 0,
          },
          {
            content: (
              <>
                Elegí <b>ARCA › «Servicios Interactivos» › «Mis Comprobantes»</b>.
              </>
            ),
            screen: 1,
          },
          {
            content: (
              <>
                En «Representante» poné la CUIT de quien lo va a bajar (la tuya o la de tu
                contadora), «BUSCAR» y «CONFIRMAR». Después, cerrá sesión y volvé a entrar.
              </>
            ),
            screen: 2,
          },
        ]}
      />
      <GuideBlock label="Qué te traés">
        <p>
          Nada para cargar acá. Cuando lo tengas,{' '}
          <Link
            href={`${data.base}/importar/arca`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            importá las compras de ARCA
          </Link>
          .
        </p>
        <HowToMisComprobantes />
      </GuideBlock>
      <GuideTroubles
        items={[
          {
            problem: 'No me aparece «Mis Comprobantes»',
            fix: 'Cerrá sesión y volvé a entrar. Si sigue sin aparecer, entrá a «Aceptación de Designación» y tocá «Aceptar».',
          },
        ]}
      />
    </Step>
  )
}

/** Los 11 pasos, en orden. */
export function GuideSteps({ data }: { data: GuideStepsData }) {
  return (
    <>
      <Step0 data={data} />
      <Step1 data={data} />
      <Step2 data={data} />
      <Step3 data={data} />
      <Step4 data={data} />
      <Step5 data={data} />
      <Step6 data={data} />
      <AuthorizeStep
        data={data}
        id="s7_wsfe"
        service={SVC_FACTURACION}
        wrong={SVC_MTXCA}
        purpose={
          <p>
            Autoriza al certificado (ARCA lo llama «Computador Fiscal») a facturar en nombre de la
            SAS por web services: es el permiso para pedir el CAE de cada factura.
          </p>
        }
      />
      <AuthorizeStep
        data={data}
        id="s8_padron"
        service={SVC_PADRON}
        before={{ name: 'Consulta AdminRel', description: 'Consulta AdminRel' }}
        purpose={
          <p>
            Permite completar proveedores y clientes con solo poner la CUIT: la plataforma consulta
            en ARCA los datos públicos de cada CUIT (nombre, condición frente al IVA y domicilio).
            Es el mismo certificado: no hace falta otro.
          </p>
        }
      />
      <Step9 data={data} />
      <Step10 data={data} />
    </>
  )
}
