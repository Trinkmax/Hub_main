/**
 * Excel ejecuta como fórmula una celda que arranca con `=`, `+`, `-`, `@`, tab
 * o CR. Lo que escribió una persona (una nota, el nombre de un evento o de un
 * proveedor, un concepto) va con un apóstrofo adelante, que Excel no muestra.
 *
 * Solo para TEXTO: los números nunca pasan por acá (un negativo legítimo
 * empieza con `-`, y con apóstrofo Excel lo leería como texto).
 *
 * Se mudó desde `lib/salon/event-marketing.ts`, que lo reexporta sin cambios.
 */
export function csvFormulaGuard(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}
