import 'server-only'

/** Tex aparece solo si está la clave de la API de Claude: sin ella no se dibuja nada. */
export function texEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
