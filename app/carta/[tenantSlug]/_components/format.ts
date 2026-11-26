// Helpers compartidos por la carta pública (read-only). Sin imports server-only:
// todo esto corre en el cliente.

/** Formatea centavos a ARS sin decimales: 1500_00 → "$ 1.500". */
export function formatARS(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}
