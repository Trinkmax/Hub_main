import { THEME_COOKIE } from '@/lib/theme/types'

/**
 * Script inyectado en <head> que corre antes de hidratar.
 * Lee la cookie de preferencia y aplica `dark` class según corresponda.
 * Evita el flash de tema incorrecto cuando la pref es 'auto'.
 *
 * El panel del salón (`/{slug}/salon…`) es light-only: ahí el script fuerza la
 * paleta clara y se va. El root layout ya emite el `<html>` correcto desde el
 * server (ver lib/workspace.ts); esto es la red de seguridad para el HTML que
 * sirve el service worker desde cache, que puede venir de otra ruta.
 */
export const noFlashScript = `
(function() {
  try {
    var d = document.documentElement;
    var p = location.pathname.split('/').filter(Boolean);
    if (p.length >= 2 && p[1] === 'salon') {
      d.classList.remove('dark');
      d.classList.add('force-light');
      d.dataset.forceLight = '1';
      return;
    }
    d.classList.remove('force-light');
    delete d.dataset.forceLight;
    var m = document.cookie.match(/(?:^|; )${THEME_COOKIE}=(auto|light|dark)/);
    var pref = m ? m[1] : 'auto';
    var isDark = pref === 'dark' || (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.classList.toggle('dark', isDark);
    d.dataset.themePref = pref;
  } catch (_e) {}
})();
`.trim()
