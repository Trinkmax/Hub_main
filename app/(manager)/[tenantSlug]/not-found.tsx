import { SearchX } from 'lucide-react'
import { GoBackButton, GoHomeButton } from '@/components/shell/shell-home'
import { EmptyState } from '@/components/ui/empty-state'
import { PageShell } from '@/components/ui/page-shell'

/**
 * El 404 del panel (kit §4.7): un `notFound()` de cualquier página del bar cae
 * acá, adentro del shell (el layout persiste), con el menú a mano. Antes
 * subía al 404 raíz, pelado y sin salida al panel. Si el que falla es el
 * layout (un bar que no existe), el 404 raíz sigue siendo el correcto.
 */
export default function ManagerNotFound() {
  return (
    <PageShell width="compact">
      <EmptyState
        size="lg"
        icon={SearchX}
        // Sin PageHeader en la pantalla: el título es el <h1>.
        headingLevel={1}
        title="No encontramos esta página"
        description="Puede que el link esté viejo o que no tengas acceso."
        secondaryAction={<GoBackButton />}
        action={<GoHomeButton />}
      />
    </PageShell>
  )
}
