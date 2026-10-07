/**
 * La lógica pura de `LineItems` (kit §3.8): adónde va el foco al agregar o
 * quitar una línea y cómo se serializan. Sin React ni DOM, con tests.
 */

/** Adónde va el foco: el primer control de una línea, o «Agregar línea». */
export type LineFocusTarget = { key: string } | 'add'

/**
 * Después de quitar la línea `removedIndex`: el primer control de la línea
 * siguiente; si era la última, el de la anterior; si no queda ninguna,
 * «Agregar línea». Nunca `<body>`.
 */
export function focusAfterRemove(keys: readonly string[], removedIndex: number): LineFocusTarget {
  const next = keys[removedIndex + 1]
  if (next !== undefined) return { key: next }
  const previous = keys[removedIndex - 1]
  if (previous !== undefined) return { key: previous }
  return 'add'
}

/** «Línea 2» (los índices empiezan en 0). */
export function defaultLineLabel(index: number): string {
  return `Línea ${(index + 1).toString()}`
}

/** «Cuenta, línea 2»: el nombre de un control con el prefijo de su fila. */
export function lineControlLabel(control: string, lineLabel: string): string {
  return `${control}, ${lineLabel.charAt(0).toLowerCase()}${lineLabel.slice(1)}`
}

/** Las líneas sin su `key` (identidad de la vista, no dato): el JSON canónico del `hidden`. */
export function stripLineKeys<L extends { key: string }>(
  lines: readonly L[],
): Array<Omit<L, 'key'>> {
  return lines.map(({ key: _key, ...rest }) => rest)
}

/**
 * Un generador de keys estables por instancia: las de arranque las pone quien
 * llama (iguales en el server y en el cliente, sin desfasar la hidratación) y
 * las nuevas salen de un contador.
 */
export function createKeyFactory(prefix = 'n'): () => string {
  let seq = 0
  return () => {
    seq += 1
    return `${prefix}${seq.toString(36)}`
  }
}
