import 'server-only'

type TenantAccent = {
  accent?: string
  accentForeground?: string
}

/**
 * Inyecta CSS vars `--tenant-accent` / `--tenant-accent-foreground` para el tenant
 * actual. Por ahora, leer desde una columna `tenants.theme` jsonb (futuro). HUB usa
 * el primary del sistema, así que no necesita override.
 *
 * Server Component: el `<style>` se serializa con el HTML del layout y aplica antes
 * de hidratación. No leak entre tenants porque el alcance es el `<html>` del request.
 */
export function TenantAccentStyle({ accent }: { accent?: TenantAccent | null }) {
  if (!accent || (!accent.accent && !accent.accentForeground)) return null

  const decls: string[] = []
  if (accent.accent) {
    decls.push(`--tenant-accent: ${accent.accent};`)
  }
  if (accent.accentForeground) {
    decls.push(`--tenant-accent-foreground: ${accent.accentForeground};`)
  }

  const css = `:root { ${decls.join(' ')} }`

  // biome-ignore lint/security/noDangerouslySetInnerHtml: CSS scoped por request, accent ya validado en server
  return <style dangerouslySetInnerHTML={{ __html: css }} />
}
