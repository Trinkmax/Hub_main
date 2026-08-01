// El catálogo de íconos se mudó a components/icons/curated-lucide para que lo
// compartan el lado que RENDERIZA (esta billetera) y el lado que ELIGE (los
// selectores del editor del club). Este archivo queda como re-export para no
// tocar los seis componentes de la wallet que ya lo importan por acá.
export { LucideByName, resolveIcon } from '@/components/icons/curated-lucide'
