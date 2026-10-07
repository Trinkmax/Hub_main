import { Hourglass, Lock, PowerOff } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'

/** «Franco» · «Franco y Nacho» · «Franco, Nacho y Luz». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell width="compact">
      <PageHeader title="Administración" description="La plata y los libros de la SAS." />
      {children}
    </PageShell>
  )
}

/** El bar tiene Administración apagada y entra la contadora (H.18). */
export function AdministracionApagada() {
  return (
    <Shell>
      <EmptyState
        icon={PowerOff}
        title="Administración está apagada"
        description="Avisale a los dueños: cuando la vuelvan a prender, vas a ver acá los libros y las cuentas."
      />
    </Shell>
  )
}

/** Todavía nadie hizo la puesta en marcha (contadora, o dueño que no la hace). */
export function AdministracionPendiente({
  who,
  adminNames,
}: {
  who: 'accountant' | 'owner'
  adminNames: readonly string[]
}) {
  const names = joinNames(adminNames)
  return (
    <Shell>
      <EmptyState
        icon={Hourglass}
        title="Todavía no está lista"
        description={
          who === 'accountant'
            ? 'Cuando los dueños la configuren, vas a ver acá los libros, el IVA y las cuentas corrientes.'
            : names
              ? `Administración la va a configurar ${names}. Cuando esté lista, te puede habilitar desde Ajustes › Accesos.`
              : 'Administración la va a configurar otro dueño. Cuando esté lista, te puede habilitar desde Ajustes › Accesos.'
        }
      />
    </Shell>
  )
}

/** Configurada, pero este dueño no tiene acceso (H.18). Nombres, nunca emails. */
export function AdministracionSinAcceso({ adminNames }: { adminNames: readonly string[] }) {
  const names = joinNames(adminNames)
  return (
    <Shell>
      <EmptyState
        icon={Lock}
        title="Administración es privada"
        description={
          names
            ? `Solo la ven los dueños que habilitó ${names} y la contadora. Si necesitás entrar, pedíselo.`
            : 'Solo la ven los dueños habilitados y la contadora. Si necesitás entrar, pedíselo a quien la administra.'
        }
      />
    </Shell>
  )
}
