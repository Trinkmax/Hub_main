/**
 * Direcciones de los web services de ARCA, por ambiente (diseño §2.4.1;
 * `arca-tecnico.md` §1).
 *
 * - Se usan los hosts `*.afip.gov.ar`. Las variantes `*.arca.gob.ar` que nombran
 *   algunos manuales nuevos están incompletas: unas no resuelven y otras tienen un
 *   certificado TLS que no coincide (verificado el 08/10/2026).
 * - Homologación (pruebas) y producción no se mezclan: un certificado de un
 *   ambiente usado en el otro da `cms.cert.untrusted` (D2).
 * - El transporte solo acepta URLs de esta lista de dominios (`isArcaUrl`): es la
 *   misma regla que tendría el relay de §2.9.
 *
 * Puro: sirve en el navegador y en el servidor.
 */

export const ARCA_ENVIRONMENTS = ['produccion', 'homologacion'] as const
export type ArcaEnvironment = (typeof ARCA_ENVIRONMENTS)[number]

export function isArcaEnvironment(value: unknown): value is ArcaEnvironment {
  return value === 'produccion' || value === 'homologacion'
}

export type ArcaEndpoints = {
  /** WSAA, `LoginCms` (el ticket de acceso). */
  readonly wsaa: string
  /** WSFEv1 (factura electrónica). */
  readonly wsfe: string
  /** Constancia de inscripción (`ws_sr_constancia_inscripcion`, ex A5). */
  readonly padronA5: string
  /** Padrón A13 (identidad y domicilios, sin impuestos): respaldo, hoy sin uso. */
  readonly padronA13: string
}

export const ARCA_ENDPOINTS: Readonly<Record<ArcaEnvironment, ArcaEndpoints>> = {
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    padronA5: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    padronA13: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13',
  },
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    padronA5: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    padronA13: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13',
  },
}

/** Los servicios (WSN) que pide la plataforma en el TRA del WSAA. */
export const ARCA_SERVICE = {
  wsfe: 'wsfe',
  padron: 'ws_sr_constancia_inscripcion',
} as const

/** Un servicio de negocio de ARCA (lo que va en `<service>` del TRA). */
export type ArcaWsn = (typeof ARCA_SERVICE)[keyof typeof ARCA_SERVICE]

export const ARCA_WSNS: readonly ArcaWsn[] = [ARCA_SERVICE.wsfe, ARCA_SERVICE.padron]

export function isArcaWsn(value: unknown): value is ArcaWsn {
  return value === ARCA_SERVICE.wsfe || value === ARCA_SERVICE.padron
}

/** Espacios de nombres de cada servicio (los cuerpos SOAP los declaran con un prefijo). */
export const ARCA_NAMESPACES = {
  wsaa: 'http://wsaa.view.sua.dvadac.desein.afip.gov',
  wsfe: 'http://ar.gov.afip.dif.FEV1/',
  padronA5: 'http://a5.soap.ws.server.puc.sr/',
} as const

/** El único dominio al que el transporte le habla. */
export const ARCA_HOST_SUFFIX = '.afip.gov.ar'

/**
 * ¿Es una URL de ARCA que el transporte puede usar? `https`, puerto por defecto,
 * sin usuario ni contraseña y un host que termina en `.afip.gov.ar`.
 */
export function isArcaUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.hostname.endsWith(ARCA_HOST_SUFFIX) &&
    parsed.hostname.length > ARCA_HOST_SUFFIX.length
  )
}
