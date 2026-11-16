/**
 * Catálogo del tablero de tareas de marketing (estilo Monday, pedido de Nacho
 * Badra del 15/11/2026). Las claves viven en la DB (enum `marketing_task_status`,
 * check `mtg_color`); los textos y los colores viven acá. Fuente ÚNICA: el
 * tablero, el panel de la tarea, Tex y los tests importan de este archivo.
 *
 * Los colores son tokens de `app/globals.css` (bloque «Tareas de marketing»),
 * escritos como clases literales para que Tailwind las encuentre.
 */

// ──────────────────────────────────────────────
// Estados
// ──────────────────────────────────────────────

/**
 * En el orden en que Nacho Badra los nombró en el video y en que aparecen en el
 * menú (teclas 1 a 6): Por hacer, En curso, Interrumpido, Terminado, Backlog y
 * Esperando feedback.
 */
export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'backlog',
  'waiting_feedback',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En curso',
  blocked: 'Interrumpido',
  done: 'Terminado',
  backlog: 'Backlog',
  waiting_feedback: 'Esperando feedback',
}

/** Para la píldora angosta del celular. */
export const STATUS_SHORT: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En curso',
  blocked: 'Interrumpido',
  done: 'Terminado',
  backlog: 'Backlog',
  waiting_feedback: 'Esperando',
}

/** Lo que quiere decir cada uno, para el menú y los lectores de pantalla. */
export const STATUS_HINTS: Record<TaskStatus, string> = {
  todo: 'Nadie la empezó',
  in_progress: 'Alguien la está haciendo',
  blocked: 'Está trabada por algo',
  done: 'Lista: pasa a Terminadas',
  backlog: 'La dejamos para después',
  waiting_feedback: 'Entregada, falta el visto bueno',
}

/**
 * Celda sólida, como en Monday (lo que Nacho Badra marcó como «mejor»). Rojo,
 * verde y azul llevan texto claro; amarillo, naranja y gris, oscuro: así el
 * texto pasa AA en los seis.
 */
export const STATUS_SOLID: Record<TaskStatus, string> = {
  todo: 'bg-(--task-todo) text-(--task-todo-fg)',
  in_progress: 'bg-(--task-doing) text-(--task-doing-fg)',
  blocked: 'bg-(--task-stuck) text-(--task-stuck-fg)',
  done: 'bg-(--task-done) text-(--task-done-fg)',
  backlog: 'bg-(--task-backlog) text-(--task-backlog-fg)',
  waiting_feedback: 'bg-(--task-waiting) text-(--task-waiting-fg)',
}

/** Solo el color de fondo: la barrita del reparto de estados y los puntos. */
export const STATUS_FILL: Record<TaskStatus, string> = {
  todo: 'bg-(--task-todo)',
  in_progress: 'bg-(--task-doing)',
  blocked: 'bg-(--task-stuck)',
  done: 'bg-(--task-done)',
  backlog: 'bg-(--task-backlog)',
  waiting_feedback: 'bg-(--task-waiting)',
}

// ──────────────────────────────────────────────
// Grupos
// ──────────────────────────────────────────────

/** La paleta fija de los grupos (la misma lista que el check `mtg_color` de la DB). */
export const GROUP_COLORS = [
  'forest',
  'sky',
  'violet',
  'rose',
  'coral',
  'amber',
  'teal',
  'slate',
] as const
export type GroupColor = (typeof GROUP_COLORS)[number]

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === 'string' && (GROUP_COLORS as readonly string[]).includes(value)
}

export const GROUP_COLOR_LABELS: Record<GroupColor, string> = {
  forest: 'Verde',
  sky: 'Azul',
  violet: 'Violeta',
  rose: 'Rosa',
  coral: 'Coral',
  amber: 'Ámbar',
  teal: 'Petróleo',
  slate: 'Gris',
}

/** El título del grupo (texto con contraste AA sobre la crema y sobre el fondo oscuro). */
export const GROUP_TEXT: Record<GroupColor, string> = {
  forest: 'text-(--task-group-forest)',
  sky: 'text-(--task-group-sky)',
  violet: 'text-(--task-group-violet)',
  rose: 'text-(--task-group-rose)',
  coral: 'text-(--task-group-coral)',
  amber: 'text-(--task-group-amber)',
  teal: 'text-(--task-group-teal)',
  slate: 'text-(--task-group-slate)',
}

/** El riel de color al costado de las filas del grupo (como el borde de Monday). */
export const GROUP_RAIL: Record<GroupColor, string> = {
  forest: 'bg-(--task-group-forest)',
  sky: 'bg-(--task-group-sky)',
  violet: 'bg-(--task-group-violet)',
  rose: 'bg-(--task-group-rose)',
  coral: 'bg-(--task-group-coral)',
  amber: 'bg-(--task-group-amber)',
  teal: 'bg-(--task-group-teal)',
  slate: 'bg-(--task-group-slate)',
}

/**
 * El estado vacío: en vez de una pantalla en blanco, grupos sugeridos en un
 * toque. Son las tres secciones del tablero de septiembre más dos que usan los
 * bares para Instagram y diseño.
 */
export const SUGGESTED_GROUPS: ReadonlyArray<{ name: string; color: GroupColor }> = [
  { name: 'Eventos', color: 'forest' },
  { name: 'Promociones', color: 'coral' },
  { name: 'Impresiones', color: 'sky' },
  { name: 'Redes', color: 'violet' },
  { name: 'Diseño', color: 'amber' },
]

// ──────────────────────────────────────────────
// Personas
// ──────────────────────────────────────────────

export const TASK_PERSON_ROLES = ['responsible', 'involved'] as const
export type TaskPersonRole = (typeof TASK_PERSON_ROLES)[number]

export const PERSON_ROLE_LABELS: Record<TaskPersonRole, string> = {
  responsible: 'Responsable',
  involved: 'Involucrados',
}

/**
 * Cada persona tiene su color, siempre el mismo (sale de su id): en Monday cada
 * nombre de «Involucrado» tenía el suyo y así se reconoce de un vistazo.
 */
export const PERSON_COLORS = [
  'bg-(--task-person-0)',
  'bg-(--task-person-1)',
  'bg-(--task-person-2)',
  'bg-(--task-person-3)',
  'bg-(--task-person-4)',
  'bg-(--task-person-5)',
  'bg-(--task-person-6)',
  'bg-(--task-person-7)',
  'bg-(--task-person-8)',
  'bg-(--task-person-9)',
] as const

// ──────────────────────────────────────────────
// Rutina de la semana (Orgánico)
// ──────────────────────────────────────────────

/**
 * Punto de partida para la rutina semanal. NO se siembra en la migración: se
 * carga con un click desde el estado vacío y después el bar lo edita como
 * quiera (agregar, sacar, cambiar el cupo semanal).
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

// ──────────────────────────────────────────────
// Vistas de la pantalla
// ──────────────────────────────────────────────

/** `?vista=` de /tareas: el tablero o la rutina semanal. */
export const TASK_VIEWS = ['tablero', 'rutina'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export function isTaskView(value: unknown): value is TaskView {
  return typeof value === 'string' && (TASK_VIEWS as readonly string[]).includes(value)
}
