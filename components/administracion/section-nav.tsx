/**
 * Las pestañas de una pantalla de Administración (`?tab=` o sub-rutas), debajo del título. Desde
 * el 07/10/2026 son el componente compartido del panel (`components/shell/section-tabs.tsx`, el
 * mismo que arma las pestañas de sección de arriba): mismo aspecto, misma API, y en el celular
 * centran la pestaña activa solas. Este módulo queda para no tocar a quienes ya lo importan.
 */
export {
  type SectionTabItem as SectionNavItem,
  SectionTabs as SectionNav,
} from '@/components/shell/section-tabs'
