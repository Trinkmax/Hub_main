import 'server-only'

import type { ArcaEnvironment } from './endpoints'
import { type ArcaRpc, ArcaStoreError, asRec, callArcaRpc, textOf } from './store'

/**
 * Secretos de ARCA (diseño §2.5, D4).
 *
 * - **La clave del servidor** (`secretsKey`): la única lectura de la variable de
 *   entorno con la que la base cifra y descifra la clave privada y el ticket del
 *   WSAA (`pgp_sym_encrypt` adentro de las RPC `SECURITY DEFINER`). Hoy es
 *   `META_TOKEN_KEY`, la misma de los tokens de Meta. Viaja como argumento de la
 *   RPC desde el servidor y nunca se guarda ni llega al navegador. Tiene que ser
 *   **la misma** en local, en las previews y en producción (todas usan la misma
 *   base): con otra, la base contesta `secret_unreadable`.
 * - **Las credenciales** (`loadCredentials`): la clave privada descifrada y el
 *   certificado, solo para firmar el pedido de ticket al WSAA. La clave privada
 *   queda como propiedad NO enumerable: si alguien loguea el objeto por error
 *   (`console.log`, `JSON.stringify`), no aparece.
 *
 * Solo servidor. Nunca loguear la clave, el PEM ni lo que devuelven estas funciones.
 */

/** La variable de entorno de la clave (D4: una sola, compartida con Meta). */
export const SECRETS_KEY_ENV = 'META_TOKEN_KEY'

/** Mínimo que acepta la base (`private.acc_secret_key_check`). */
export const SECRETS_KEY_MIN_LENGTH = 16

/** Falta la clave del servidor o es demasiado corta: es configuración, no algo de la persona. */
export class ArcaSecretsKeyError extends Error {
  constructor() {
    // Sin el valor: solo dice qué variable falta.
    super(`ARCA: falta ${SECRETS_KEY_ENV} o tiene menos de ${SECRETS_KEY_MIN_LENGTH} caracteres`)
    this.name = 'ArcaSecretsKeyError'
  }
}

export function isArcaSecretsKeyError(e: unknown): e is ArcaSecretsKeyError {
  return (
    e instanceof ArcaSecretsKeyError || (e instanceof Error && e.name === 'ArcaSecretsKeyError')
  )
}

/**
 * La clave con la que la base cifra los secretos de ARCA. Tira
 * `ArcaSecretsKeyError` si falta o si no llega al mínimo (una variable vacía o mal
 * cargada no tiene que cifrar nada).
 */
export function secretsKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env[SECRETS_KEY_ENV]
  if (typeof value !== 'string' || value.length < SECRETS_KEY_MIN_LENGTH) {
    throw new ArcaSecretsKeyError()
  }
  return value
}

/** Lo que hace falta para pedir un ticket al WSAA. */
export type ArcaCredentials = {
  /** PEM del certificado (público). */
  readonly certificatePem: string
  /** PKCS#8 PEM. **Secreto**: propiedad no enumerable; nunca se loguea ni se devuelve. */
  readonly privateKeyPem: string
  readonly alias: string | null
  readonly representedCuit: string | null
  readonly status: string | null
}

/**
 * `acc_arca_get_credentials`: la clave privada descifrada y el certificado. La base
 * exige escritor, la clave del servidor y una conexión con certificado
 * (`cert_ready`, `connected` o `error`); si no, `ArcaStoreError` con
 * `arca_not_ready`, `arca_key_missing` o `secret_unreadable`.
 */
export async function loadCredentials(
  rpc: ArcaRpc,
  tenantId: string,
  environment: ArcaEnvironment,
  secretKey: string,
): Promise<ArcaCredentials> {
  const op = 'acc_arca_get_credentials'
  const data = asRec(
    await callArcaRpc(rpc, op, {
      p_tenant_id: tenantId,
      p_environment: environment,
      p_secret_key: secretKey,
    }),
  )
  const privateKeyPem = textOf(data?.private_key_pem)
  const certificatePem = textOf(data?.certificate_pem)
  if (!privateKeyPem?.includes('-----BEGIN ')) {
    throw new ArcaStoreError(op, null, 'arca_key_missing')
  }
  if (!certificatePem?.includes('-----BEGIN CERTIFICATE-----')) {
    throw new ArcaStoreError(op, null, 'arca_not_ready')
  }
  const connection = asRec(data?.connection)
  const credentials = {
    certificatePem,
    alias: textOf(connection?.alias),
    representedCuit: textOf(connection?.represented_cuit),
    status: textOf(connection?.status),
  }
  Object.defineProperty(credentials, 'privateKeyPem', {
    value: privateKeyPem,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return credentials as ArcaCredentials
}
