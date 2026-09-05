/**
 * Qué plantillas se le muestran al bar.
 *
 * Meta crea sola, en toda cuenta nueva, un puñado de plantillas de muestra en
 * inglés ("hello_world", "jaspers_market_…"). En un bar de Córdoba no sirven
 * para nada y confunden: aparecían en el listado, en el selector de
 * difusiones y en los flows. Una sola regla, compartida por todos los
 * listados, las deja fuera; siguen existiendo en Meta y en la tabla (el
 * botón "Borrar las de ejemplo" las saca de verdad).
 *
 * Regla: se ocultan las que no están en español y las de muestra de Meta.
 * Puro, sin `server-only`: lo usan páginas, actions y tests.
 */

const META_SAMPLE_NAME_RE = /^(hello_world|sample_[a-z0-9_]+|jaspers_market_[a-z0-9_]+)$/i

export type TemplateIdentity = { name: string; language: string }

export function isHiddenTemplate(t: TemplateIdentity): boolean {
  if (!t.language.toLowerCase().startsWith('es')) return true
  return META_SAMPLE_NAME_RE.test(t.name)
}

/** El listado tal como lo ve el bar. */
export function visibleTemplates<T extends TemplateIdentity>(rows: ReadonlyArray<T>): T[] {
  return rows.filter((t) => !isHiddenTemplate(t))
}

/** Las que quedaron afuera (para el botón de borrarlas de Meta). */
export function hiddenTemplates<T extends TemplateIdentity>(rows: ReadonlyArray<T>): T[] {
  return rows.filter((t) => isHiddenTemplate(t))
}
