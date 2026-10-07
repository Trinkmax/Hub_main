import { FileUp } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * El cartel que aparece mientras se arrastra un archivo .html sobre el listado
 * o el editor. No captura el mouse (`pointer-events-none`): el drop lo atiende
 * el contenedor de abajo. Flota sobre todo, así que es la única caja de estas
 * pantallas con sombra (`shadow-modal`).
 */
export function DropOverlay({ description }: { description: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/80 p-6"
    >
      <EmptyState
        variant="dashed"
        icon={FileUp}
        title="Soltá tu archivo .html"
        description={description}
        className="border-2 border-primary bg-card px-10 shadow-modal"
      />
    </div>
  )
}
