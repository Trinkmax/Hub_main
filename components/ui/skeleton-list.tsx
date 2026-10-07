/**
 * Compatibilidad: los esqueletos de lista y de grilla ahora viven con el resto
 * de los presets en `@/components/ui/skeleton` (kit HUB §3.4). Este archivo
 * queda para los `loading.tsx` que todavía importan de acá.
 *
 * @deprecated Importá `ListSkeleton` o `SkeletonCardGrid` de `@/components/ui/skeleton`.
 */
export { CardGridSkeleton, ListSkeleton } from '@/components/ui/skeleton'
