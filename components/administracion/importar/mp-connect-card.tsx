/**
 * El aviso de lo que viene para Mercado Pago: conectar la cuenta y que los
 * movimientos lleguen solos. Hasta que exista es una línea gris al final de la
 * página (antes era un cartel «Próximamente» que ocupaba lugar fijo arriba de
 * la tarea). Server-safe.
 */
export function MpConnectCard({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-sm text-muted-foreground text-pretty'}>
      Próximamente, sin bajar archivos: vas a poder conectar tu cuenta de Mercado Pago y los
      movimientos van a llegar solos todos los días. Vos solo revisás.
    </p>
  )
}
