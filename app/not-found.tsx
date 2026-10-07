import { Button } from '@/components/ui-legacy/button'

/**
 * El 404 raíz. Sale adentro del `<html>` del workspace que pidió la URL: bajo
 * lo público (`/carta`, `/c`, `/m`…) lleva `legacy-theme` y bajo el salón
 * `force-light`, los scopes que congelan los tokens de antes. Por eso usa el
 * botón de la copia congelada y no el del kit: el 404 raíz bajo una URL
 * pública se tiene que ver como siempre (kit, riesgo 1). El panel tiene su
 * propio 404 adentro del shell; este queda para lo que no es del panel y para
 * un bar que no existe.
 *
 * El link recarga la página (`<a>` común, no `<Link>`): `/` reparte a otro
 * workspace (panel, salón o login) y en una navegación blanda el `<html>` del
 * layout raíz no se vuelve a dibujar, así que llegaría con el tema de acá.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-semibold">404</h1>
      <p className="text-muted-foreground">No encontramos lo que buscabas.</p>
      <Button asChild>
        <a href="/">Volver al inicio</a>
      </Button>
    </main>
  )
}
