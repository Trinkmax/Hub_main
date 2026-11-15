/**
 * El «tic» que se siente en el dedo al pasar de una pestaña a otra, como en la barra de iOS.
 *
 * - iPhone (iOS 18 o más): Safari no tiene `navigator.vibrate`, pero un `<input type="checkbox" switch>`
 *   da un toque háptico al cambiar. Se arma uno escondido, se lo toca y se lo saca. Solo funciona dentro
 *   de un gesto del usuario (acá siempre lo es: el dedo está apoyado en la barra).
 * - Android: `navigator.vibrate`, muy corto.
 * - Escritorio o cualquier otro: no hace nada.
 *
 * Nunca rompe nada: si el navegador no deja, no pasa nada.
 */

/** Entre dos tics, al menos esto (arrastrar rápido por cinco pestañas no es un zumbido). */
const MIN_GAP_MS = 45

let last = 0

function isIOS(): boolean {
  const ua = navigator.userAgent
  // El iPad con iPadOS se presenta como una Mac: se lo reconoce porque tiene pantalla táctil.
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function hapticTick(): void {
  if (typeof window === 'undefined') return
  const now = performance.now()
  if (now - last < MIN_GAP_MS) return
  last = now
  try {
    if (isIOS()) {
      const label = document.createElement('label')
      label.setAttribute('aria-hidden', 'true')
      label.style.display = 'none'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      label.appendChild(input)
      document.head.appendChild(label)
      label.click()
      label.remove()
      return
    }
    if (typeof navigator.vibrate === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      navigator.vibrate(8)
    }
  } catch {
    // Sin háptica: la barra funciona igual.
  }
}
