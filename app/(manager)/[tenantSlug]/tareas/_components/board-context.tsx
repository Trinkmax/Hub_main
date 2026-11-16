'use client'

import { createContext, useContext } from 'react'
import type { BoardGroup, BoardTask, TeamMember } from '@/lib/marketing/board'
import type { GroupColor, TaskPersonRole, TaskStatus } from '@/lib/marketing/constants'

/** Lo que cualquier pieza del tablero necesita saber de quién mira. */
export type BoardEnv = {
  tenantSlug: string
  tenantId: string
  team: TeamMember[]
  currentUserId: string
  /** Hoy en el reloj del bar (lo resuelve el server: sin desfase de hidratación). */
  today: string
  /** Dueño: arma los grupos y borra cualquier tarea. */
  canManage: boolean
  /** Arrastrar está apagado mientras hay un filtro (reordenar una parte rompería el resto). */
  dragEnabled: boolean
  groups: BoardGroup[]
}

/** Los gestos del tablero: todos optimistas, con el error en un toast si la base no acepta. */
export type BoardActions = {
  createTask: (groupId: string, title: string, where?: 'top' | 'bottom') => void
  changeStatus: (task: BoardTask, status: TaskStatus) => void
  rename: (task: BoardTask, title: string) => void
  setDue: (task: BoardTask, date: string | null) => void
  /** Devuelve si se guardó (las notas dicen «Guardado» recién ahí). */
  setNotes: (task: BoardTask, notes: string | null) => Promise<boolean>
  setPeople: (task: BoardTask, role: TaskPersonRole, userIds: string[]) => void
  moveToGroup: (task: BoardTask, groupId: string) => void
  removeTask: (task: BoardTask) => void
  openTask: (taskId: string, tab?: 'updates' | 'files') => void
  createGroup: (name: string, color: GroupColor) => void
  renameGroup: (group: BoardGroup, name: string) => void
  recolorGroup: (group: BoardGroup, color: GroupColor) => void
  moveGroup: (group: BoardGroup, direction: -1 | 1) => void
  removeGroup: (group: BoardGroup) => void
}

export type BoardContextValue = BoardEnv & BoardActions

const BoardContext = createContext<BoardContextValue | null>(null)

export const BoardProvider = BoardContext.Provider

export function useBoard(): BoardContextValue {
  const value = useContext(BoardContext)
  if (!value) throw new Error('useBoard tiene que usarse adentro del tablero de tareas')
  return value
}

/** Una tarea recién creada que todavía no volvió de la base: se ve, pero no se toca. */
export function isPendingTask(task: Pick<BoardTask, 'id'>): boolean {
  return task.id.startsWith('tmp-')
}
