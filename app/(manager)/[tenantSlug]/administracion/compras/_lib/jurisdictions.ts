/**
 * Jurisdicciones de Ingresos Brutos (códigos del Convenio Multilateral, los
 * que usa SIFERE: 901 a 924). Para la percepción de IIBB de una factura.
 */
export const IIBB_JURISDICTIONS: ReadonlyArray<{ code: number; name: string }> = [
  { code: 901, name: 'Ciudad de Buenos Aires' },
  { code: 902, name: 'Buenos Aires' },
  { code: 903, name: 'Catamarca' },
  { code: 904, name: 'Córdoba' },
  { code: 905, name: 'Corrientes' },
  { code: 906, name: 'Chaco' },
  { code: 907, name: 'Chubut' },
  { code: 908, name: 'Entre Ríos' },
  { code: 909, name: 'Formosa' },
  { code: 910, name: 'Jujuy' },
  { code: 911, name: 'La Pampa' },
  { code: 912, name: 'La Rioja' },
  { code: 913, name: 'Mendoza' },
  { code: 914, name: 'Misiones' },
  { code: 915, name: 'Neuquén' },
  { code: 916, name: 'Río Negro' },
  { code: 917, name: 'Salta' },
  { code: 918, name: 'San Juan' },
  { code: 919, name: 'San Luis' },
  { code: 920, name: 'Santa Cruz' },
  { code: 921, name: 'Santa Fe' },
  { code: 922, name: 'Santiago del Estero' },
  { code: 923, name: 'Tierra del Fuego' },
  { code: 924, name: 'Tucumán' },
]

/** Un código válido (901–924) o Córdoba. */
export function jurisdictionOrDefault(code: number | null | undefined): number {
  return typeof code === 'number' && IIBB_JURISDICTIONS.some((j) => j.code === code) ? code : 904
}
