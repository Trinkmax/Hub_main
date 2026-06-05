/**
 * Sugiere el próximo label numérico libre para una mesa nueva dentro de un área.
 *
 * Devuelve `String(n)` del menor entero `n >= numberStart` tal que `String(n)`
 * no aparezca en `existingLabels`. Los labels no numéricos (o con formato
 * distinto a `String(n)`, p. ej. ceros a la izquierda o decimales) se ignoran,
 * porque solo nos interesa el espacio de enteros sugeridos.
 *
 * Puro: sin efectos, sin dependencias. Testeado en
 * `tests/lib/floor-plan-numbering.test.ts`.
 */
export function suggestNextLabel(numberStart: number, existingLabels: string[]): string {
  const taken = new Set(existingLabels)
  let n = numberStart
  // Cota: a lo sumo numberStart + cantidad de labels tomados; el bucle termina.
  const upperBound = numberStart + taken.size + 1
  while (n <= upperBound) {
    const candidate = String(n)
    if (!taken.has(candidate)) {
      return candidate
    }
    n += 1
  }
  // Inalcanzable en la práctica (el Set es finito), pero el type-system necesita
  // un retorno garantizado. Devolvemos el primer entero por encima de la cota.
  return String(upperBound + 1)
}
