import { readFileSync } from 'node:fs'

/**
 * Respuestas de ARCA para los tests de WP2 (SOAP, WSAA, WSFE y padrón). Ningún test
 * usa la red: leen estos archivos.
 *
 * De dónde sale cada uno:
 * - **Capturas reales** (08/10/2026, `scripts/arca/smoke.mts --save`): los `*-dummy-*`.
 *   No traen datos de nadie.
 * - **Reconstruidas de respuestas reales** de la investigación (`arca-tecnico.md` §2.4,
 *   §4.2 y §5.2): los faults del WSAA `cms.cert.untrusted` y `cms.bad.base64`, el
 *   `Err 600` de WSFE, el Fault «Token malformado» del padrón, el `soap:Client` por
 *   SOAPAction equivocado y el 602 de `FEParamGetPtosVenta` («Sin Resultados»).
 * - **Armadas con la forma de los manuales** (WSAA cap. 6.2, WSFEv1 v4.7 y su WSDL,
 *   constancia v4.1) y datos sintéticos: el resto.
 *
 * Todas las CUIT son sintéticas, con dígito verificador válido: la SAS 30-71234567-1,
 * la persona de WSASS 20-12345678-6, una monotributista 27-12345678-0, una
 * asociación exenta 30-71111111-1, una persona sin datos 20-11111111-2 y una CUIT que
 * «no existe» 20-33333333-4. La 33-69345023-9 es la de ARCA (sale en sus manuales).
 *
 * Son archivos fijos (se armaron una vez con un script descartable): si hace falta
 * otro caso, se escribe a mano con la misma forma y datos sintéticos. Nunca se
 * commitean respuestas reales con CUIT o nombres de terceros.
 */

export const ARCA_XML = {
  wsaaLoginEscaped: 'wsaa-login-escaped.xml',
  wsaaLoginCdata: 'wsaa-login-cdata.xml',
  /** El token (base64 del XML SSO) que traen los dos de arriba. */
  wsaaToken: 'wsaa-token.txt',
  wsaaFaultCertUntrusted: 'wsaa-fault-cms-cert-untrusted.xml',
  wsaaFaultBadBase64: 'wsaa-fault-cms-bad-base64.xml',
  wsaaFaultAlreadyAuthenticated: 'wsaa-fault-already-authenticated.xml',
  wsaaFaultNotAuthorized: 'wsaa-fault-not-authorized.xml',
  wsfeDummyProduccion: 'wsfe-dummy-produccion.xml',
  wsfeDummyHomologacion: 'wsfe-dummy-homologacion.xml',
  wsfeUltimoOk: 'wsfe-ultimo-ok.xml',
  wsfeUltimoErr600: 'wsfe-ultimo-err600.xml',
  wsfeUltimoErr11002: 'wsfe-ultimo-err11002.xml',
  wsfeCaeAprobado: 'wsfe-cae-aprobado.xml',
  wsfeCaeAprobadoObs: 'wsfe-cae-aprobado-obs.xml',
  wsfeCaeRechazado10016: 'wsfe-cae-rechazado-10016.xml',
  wsfeCaeRechazado10000: 'wsfe-cae-rechazado-10000.xml',
  wsfeCaeErr600Relaciones: 'wsfe-cae-err600-relaciones.xml',
  wsfeCompConsultarOk: 'wsfe-compconsultar-ok.xml',
  wsfeCompConsultar602: 'wsfe-compconsultar-602.xml',
  wsfePtosVenta: 'wsfe-ptosventa.xml',
  wsfePtosVenta602: 'wsfe-ptosventa-602.xml',
  wsfeCondicionIvaReceptor: 'wsfe-condicion-iva-receptor.xml',
  wsfeTiposIva: 'wsfe-tipos-iva.xml',
  wsfeFaultSoapAction: 'wsfe-fault-soapaction.xml',
  padronDummyProduccion: 'padron-dummy-produccion.xml',
  padronPersonaRi: 'padron-persona-ri.xml',
  padronPersonaMonotributo: 'padron-persona-monotributo.xml',
  padronPersonaExento: 'padron-persona-exento.xml',
  padronPersonaSinDatos: 'padron-persona-sin-datos.xml',
  padronPersonaNoExiste: 'padron-persona-no-existe.xml',
  padronPersonaLista: 'padron-persona-lista.xml',
  padronFaultToken: 'padron-fault-token.xml',
  htmlMantenimiento: 'xhtml-mantenimiento.xml',
} as const

export type ArcaXmlFixture = (typeof ARCA_XML)[keyof typeof ARCA_XML]

/** El texto (UTF-8) de un fixture. */
export function arcaXml(name: ArcaXmlFixture): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
}

/** CUIT sintéticas de los fixtures. */
export const XML_CUITS = {
  sas: '30712345671',
  persona: '20123456786',
  monotributista: '27123456780',
  exento: '30711111111',
  sinDatos: '20111111112',
  noExiste: '20333333334',
  arca: '33693450239',
} as const

/** Lo que dicen los tickets de `wsaa-login-*.xml`. */
export const XML_TICKET = {
  generationTime: '2026-10-08T11:50:00.467Z',
  expirationTime: '2026-10-08T23:50:00.467Z',
  destination: 'SERIALNUMBER=CUIT 20123456786, CN=plataformatest',
  source: 'CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239',
  uniqueId: '2483958221',
} as const
