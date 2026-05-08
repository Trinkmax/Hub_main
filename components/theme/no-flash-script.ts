import { THEME_COOKIE } from '@/lib/theme/types'

/**
 * Script inyectado en <head> que corre antes de hidratar.
 * Lee la cookie de preferencia y aplica `dark` class según corresponda.
 * Evita el flash de tema incorrecto cuando la pref es 'auto'.
 */
export const noFlashScript = `
(function() {
  try {
    var m = document.cookie.match(/(?:^|; )${THEME_COOKIE}=(auto|light|dark)/);
    var pref = m ? m[1] : 'auto';
    var isDark = pref === 'dark' || (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.dataset.themePref = pref;
  } catch (_e) {}
})();
`.trim()
