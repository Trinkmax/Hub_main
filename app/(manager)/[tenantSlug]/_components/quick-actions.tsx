import { Receipt, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * Las acciones del encabezado del Resumen. La principal va última (kit §3.5):
 * en escritorio queda a la derecha y en el celular, debajo del título.
 * «Ver estadísticas» vive en la sección del gráfico, al lado de lo que amplía.
 */
export function QuickActions({ tenantSlug }: { tenantSlug: string }) {
  return (
    <>
      <Button asChild variant="secondary">
        <Link href={`/${tenantSlug}/clientes/nuevo`}>
          <UserPlus aria-hidden="true" />
          Nuevo cliente
        </Link>
      </Button>
      <Button asChild>
        <Link href={`/${tenantSlug}/visitas/nueva`}>
          <Receipt aria-hidden="true" />
          Cerrar mesa
        </Link>
      </Button>
    </>
  )
}
