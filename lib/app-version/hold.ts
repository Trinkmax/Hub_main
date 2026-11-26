/**
 * «Ahora no»: lo que pide que la app no se recargue sola en este momento (ver `decide.ts`).
 *
 * Hay dos maneras de pedirlo, y valen igual:
 *   · una pantalla marca un elemento con `data-no-reload` mientras tiene algo a medio hacer (la cuenta, la
 *     comanda con cosas cargadas, la cámara prendida);
 *   · una tarea que no dibuja nada (la comandera mandando un papel) llama a `holdReload()` y suelta al terminar.
 *
 * Vive en el navegador, fuera de React: lo consulta `AppVersionWatcher` cada vez que decide.
 */
let holds = 0

/** Pide que no se recargue. Devuelve cómo soltarlo (llamarlo dos veces no suelta dos). */
export function holdReload(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
  }
}

/** ¿Alguien pidió que no se recargue? (Lo marcado con `data-no-reload` lo mira aparte quien decide.) */
export function reloadHeld(): boolean {
  return holds > 0
}
