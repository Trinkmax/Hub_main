/**
 * Catálogo del tablero de marketing: las claves viven en la DB (enums
 * `marketing_task_*`), los textos en español viven acá. Fuente ÚNICA — el
 * formulario, las tarjetas, los filtros y los tests importan de este archivo.
 */

// ──────────────────────────────────────────────
// Secciones del tablero
// ──────────────────────────────────────────────

export const TASK_CATEGORIES = ['eventos', 'promociones', 'impresiones'] as const
export type TaskCategory = (typeof TASK_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  eventos: 'Eventos',
  promociones: 'Promociones',
  impresiones: 'Impresiones',
}

/**
 * Las "vistas" del tablero. Las tres primeras son categorías reales de la DB;
 * `organico` es el checklist semanal (otra tabla) y `mias` es un filtro sobre
 * todo lo demás. Se modelan juntas porque para el dueño son cinco solapas.
 */
export const BOARD_VIEWS = ['eventos', 'promociones', 'impresiones', 'organico', 'mias'] as const
export type BoardView = (typeof BOARD_VIEWS)[number]

export const VIEW_LABELS: Record<BoardView, string> = {
  ...CATEGORY_LABELS,
  organico: 'Orgánico',
  mias: 'Mis tareas',
}

export function isBoardView(value: unknown): value is BoardView {
  return typeof value === 'string' && (BOARD_VIEWS as readonly string[]).includes(value)
}

export function isTaskCategory(value: unknown): value is TaskCategory {
  return typeof value === 'string' && (TASK_CATEGORIES as readonly string[]).includes(value)
}

// ──────────────────────────────────────────────
// Estado
// ──────────────────────────────────────────────

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En proceso',
  blocked: 'Interrumpido',
  done: 'Terminado',
}

/**
 * Color del punto y del chip por estado. Tokens del design system (nunca hex):
 * `blocked` usa warning y no destructive — está trabado, no roto.
 */
export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'bg-muted-foreground/40',
  in_progress: 'bg-info',
  blocked: 'bg-warning',
  done: 'bg-success',
}

export const STATUS_CHIP: Record<TaskStatus, string> = {
  todo: 'border-border bg-secondary/60 text-muted-foreground',
  in_progress: 'border-info/30 bg-info/10 text-info',
  blocked: 'border-warning/30 bg-warning/10 text-warning',
  done: 'border-success/30 bg-success/10 text-success',
}

// ──────────────────────────────────────────────
// Tipo de trabajo
// ──────────────────────────────────────────────

export const TASK_KINDS = [
  'design',
  'shoot',
  'edit',
  'script',
  'ads',
  'publish',
  'print',
  'coordinate',
  'other',
] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export const KIND_LABELS: Record<TaskKind, string> = {
  design: 'Diseñar',
  shoot: 'Grabar contenido',
  edit: 'Editar contenido',
  script: 'Armar guion',
  ads: 'Pautar',
  publish: 'Subir contenido',
  print: 'Imprimir',
  coordinate: 'Coordinar',
  other: 'Otro',
}

// ──────────────────────────────────────────────
// Filtro de "Mis tareas"
// ──────────────────────────────────────────────

export const MINE_MODES = ['both', 'responsible', 'involved'] as const
export type MineMode = (typeof MINE_MODES)[number]

export const MINE_MODE_LABELS: Record<MineMode, string> = {
  both: 'Ambos',
  responsible: 'Responsable',
  involved: 'Involucrado',
}

// ──────────────────────────────────────────────
// Checklist semanal sugerido
// ──────────────────────────────────────────────

/**
 * Punto de partida para la sección Orgánico. NO se siembra en la migración: se
 * carga con un click desde el estado vacío y después el bar lo edita como
 * quiera (agregar, sacar, cambiar el cupo semanal). Así un bar nuevo arranca
 * con algo usable sin que el schema imponga el contenido de nadie.
 */
export const SUGGESTED_ROUTINES: ReadonlyArray<{
  title: string
  description: string
  slots: number
}> = [
  {
    title: 'Historia del aperitivo de la casa',
    description: 'Una vez por semana. Si hay noche temática, se puede reusar ese contenido.',
    slots: 1,
  },
  {
    title: 'Historia de Happy Hour',
    description: 'Las marcas y los tragos del 2x1, con el horario bien claro.',
    slots: 1,
  },
  {
    title: 'Historia de Happy Hour (cerveza)',
    description: 'Una vez por semana, el 2x1 de la cerveza tirada.',
    slots: 1,
  },
  {
    title: 'Historias de merienda',
    description: 'Foto, video, promoción o contenido espontáneo.',
    slots: 2,
  },
  {
    title: 'Eventos de la semana',
    description: 'Una historia con todos los eventos y promociones de la semana.',
    slots: 1,
  },
  {
    title: 'Historias de los menús del mediodía',
    description: 'Alternar todos los menús juntos, fotos de platos y variantes.',
    slots: 3,
  },
  {
    title: 'Marcar eventos agotados',
    description: 'Subir SOLD OUT cada vez que un evento se agota.',
    slots: 1,
  },
  {
    title: 'Mostrar el evento mientras sucede',
    description: 'Pedir fotos o videos a quien esté presente y subir una historia.',
    slots: 1,
  },
  {
    title: 'Promo de las primeras personas',
    description: 'Subir una vez durante la semana.',
    slots: 1,
  },
  {
    title: 'Mensaje al canal de difusión',
    description: 'Recordar promociones y eventos de la semana.',
    slots: 1,
  },
  {
    title: 'Publicar reels',
    description: 'Comida, experiencia o contenido divertido.',
    slots: 3,
  },
]
