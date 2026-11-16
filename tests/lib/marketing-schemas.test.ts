import { describe, expect, it } from 'vitest'
import { GROUP_COLORS, TASK_STATUSES } from '@/lib/marketing/constants'
import { MAX_FILES_PER_BATCH, MAX_TASK_FILE_BYTES } from '@/lib/marketing/files'
import {
  addLinkSchema,
  createGroupSchema,
  createTaskSchema,
  editUpdateSchema,
  postUpdateSchema,
  prepareUploadsSchema,
  registerFilesSchema,
  reorderGroupsSchema,
  reorderTasksSchema,
  routineCheckSchema,
  routineUpsertSchema,
  setTaskPeopleSchema,
  taskPatchSchema,
  updateGroupSchema,
  updateTaskSchema,
} from '@/lib/marketing/schemas'

// uuid v4 real: `z.uuid()` de zod 4 valida versión y variante, no sólo la forma.
const UUID = '11111111-2222-4333-8444-555555555555'
const OTHER = '66666666-7777-4888-9999-aaaaaaaaaaaa'

const issue = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  result.success ? null : (result.error?.issues[0]?.message ?? null)

describe('createTaskSchema', () => {
  it('recorta el título y la pone al fondo del grupo si no se dice otra cosa', () => {
    expect(createTaskSchema.parse({ groupId: UUID, title: '  Diseñar el flyer  ' })).toEqual({
      groupId: UUID,
      title: 'Diseñar el flyer',
      where: 'bottom',
    })
    expect(createTaskSchema.parse({ groupId: UUID, title: 'x', where: 'top' }).where).toBe('top')
    expect(createTaskSchema.safeParse({ groupId: UUID, title: 'x', where: 'middle' }).success).toBe(
      false,
    )
  })

  it('exige un título de verdad, de hasta 160', () => {
    expect(issue(createTaskSchema.safeParse({ groupId: UUID, title: '   ' }))).toBe(
      'Escribí qué hay que hacer',
    )
    expect(createTaskSchema.safeParse({ groupId: UUID, title: 'x'.repeat(160) }).success).toBe(true)
    expect(issue(createTaskSchema.safeParse({ groupId: UUID, title: 'x'.repeat(161) }))).toBe(
      'El título no puede superar 160 caracteres',
    )
  })

  it('el grupo es un id', () => {
    expect(issue(createTaskSchema.safeParse({ groupId: 'Eventos', title: 'x' }))).toBe(
      'ID inválido',
    )
  })
})

describe('taskPatchSchema', () => {
  it('sin nada para cambiar no pasa', () => {
    expect(issue(taskPatchSchema.safeParse({}))).toBe('No hay nada para cambiar')
    expect(taskPatchSchema.safeParse({ title: undefined }).success).toBe(false)
  })

  it('los seis estados del tablero, ni uno más', () => {
    for (const status of TASK_STATUSES) {
      expect(taskPatchSchema.safeParse({ status }).success, status).toBe(true)
    }
    expect(taskPatchSchema.safeParse({ status: 'Terminado' }).success).toBe(false)
    expect(taskPatchSchema.safeParse({ status: 'organico' }).success).toBe(false)
  })

  it('el vencimiento es un día que existe, o null para sacarlo', () => {
    expect(taskPatchSchema.parse({ dueDate: '2026-11-15' })).toEqual({ dueDate: '2026-11-15' })
    expect(taskPatchSchema.parse({ dueDate: null })).toEqual({ dueDate: null })
    expect(issue(taskPatchSchema.safeParse({ dueDate: '2026-02-30' }))).toBe('Fecha inválida')
    expect(taskPatchSchema.safeParse({ dueDate: '15/11/2026' }).success).toBe(false)
  })

  it('las notas vacías se borran (null), nunca un string vacío', () => {
    expect(taskPatchSchema.parse({ notes: '   ' })).toEqual({ notes: null })
    expect(taskPatchSchema.parse({ notes: null })).toEqual({ notes: null })
    expect(taskPatchSchema.parse({ notes: '  Con logo  ' })).toEqual({ notes: 'Con logo' })
    expect(issue(taskPatchSchema.safeParse({ notes: 'x'.repeat(10_001) }))).toBe(
      'Las notas son demasiado largas',
    )
  })

  it('el título se recorta y el grupo es un id', () => {
    expect(taskPatchSchema.parse({ title: '  Reel  ', groupId: UUID })).toEqual({
      title: 'Reel',
      groupId: UUID,
    })
    expect(taskPatchSchema.safeParse({ title: ' ' }).success).toBe(false)
    expect(taskPatchSchema.safeParse({ groupId: 'Eventos' }).success).toBe(false)
  })

  it('el update pide el id de la tarea y un cambio', () => {
    expect(updateTaskSchema.safeParse({ id: UUID, patch: { status: 'done' } }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ patch: { status: 'done' } }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ id: UUID, patch: {} }).success).toBe(false)
  })
})

describe('setTaskPeopleSchema', () => {
  it('responsables o involucrados, con ids; la lista vacía saca a todos', () => {
    expect(
      setTaskPeopleSchema.safeParse({ taskId: UUID, role: 'responsible', userIds: [OTHER] })
        .success,
    ).toBe(true)
    expect(
      setTaskPeopleSchema.safeParse({ taskId: UUID, role: 'involved', userIds: [] }).success,
    ).toBe(true)
    expect(
      setTaskPeopleSchema.safeParse({ taskId: UUID, role: 'owner', userIds: [] }).success,
    ).toBe(false)
    expect(
      setTaskPeopleSchema.safeParse({ taskId: UUID, role: 'involved', userIds: ['Luz'] }).success,
    ).toBe(false)
  })

  it('hasta 20 personas', () => {
    const many = (count: number) =>
      Array.from(
        { length: count },
        (_, index) => `${String(index).padStart(8, '0')}-2222-4333-8444-555555555555`,
      )
    expect(
      setTaskPeopleSchema.safeParse({ taskId: UUID, role: 'involved', userIds: many(20) }).success,
    ).toBe(true)
    expect(
      issue(setTaskPeopleSchema.safeParse({ taskId: UUID, role: 'involved', userIds: many(21) })),
    ).toBe('Demasiadas personas')
  })
})

describe('el orden', () => {
  it('reordenar tareas: el grupo y al menos una', () => {
    expect(reorderTasksSchema.safeParse({ groupId: UUID, ids: [OTHER] }).success).toBe(true)
    expect(reorderTasksSchema.safeParse({ groupId: UUID, ids: [] }).success).toBe(false)
  })

  it('reordenar grupos: de uno a cien', () => {
    expect(reorderGroupsSchema.safeParse({ ids: [UUID] }).success).toBe(true)
    expect(reorderGroupsSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(reorderGroupsSchema.safeParse({ ids: Array(101).fill(UUID) }).success).toBe(false)
  })
})

describe('los grupos', () => {
  it('un nombre de 1 a 60 y un color de la paleta', () => {
    expect(createGroupSchema.parse({ name: '  Redes  ', color: 'violet' })).toEqual({
      name: 'Redes',
      color: 'violet',
    })
    expect(issue(createGroupSchema.safeParse({ name: ' ', color: 'violet' }))).toBe(
      'Ponele un nombre al grupo',
    )
    expect(createGroupSchema.safeParse({ name: 'x'.repeat(61), color: 'violet' }).success).toBe(
      false,
    )
    for (const color of GROUP_COLORS) {
      expect(createGroupSchema.safeParse({ name: 'x', color }).success, color).toBe(true)
    }
    expect(createGroupSchema.safeParse({ name: 'x', color: '#ff0000' }).success).toBe(false)
  })

  it('editar pide el nombre o el color', () => {
    expect(updateGroupSchema.safeParse({ id: UUID, color: 'sky' }).success).toBe(true)
    expect(updateGroupSchema.safeParse({ id: UUID, name: 'Promos' }).success).toBe(true)
    expect(issue(updateGroupSchema.safeParse({ id: UUID }))).toBe('No hay nada para cambiar')
  })
})

describe('las actualizaciones', () => {
  const file = {
    path: `${UUID}/${OTHER}/${UUID}.png`,
    fileName: 'arte.png',
    mimeType: 'image/png',
    sizeBytes: 1200,
  }

  it('texto recortado, archivos o las dos cosas; vacía del todo no', () => {
    expect(postUpdateSchema.parse({ taskId: UUID, body: '  Listo  ' })).toEqual({
      taskId: UUID,
      body: 'Listo',
      files: [],
    })
    expect(postUpdateSchema.safeParse({ taskId: UUID, body: '', files: [file] }).success).toBe(true)
    expect(issue(postUpdateSchema.safeParse({ taskId: UUID, body: '   ' }))).toBe(
      'Escribí algo o sumá un archivo',
    )
  })

  it('hasta 10 archivos de hasta 50 MB, y el texto hasta 10.000', () => {
    const files = (count: number) => Array.from({ length: count }, () => file)
    expect(
      postUpdateSchema.safeParse({ taskId: UUID, body: 'x', files: files(MAX_FILES_PER_BATCH) })
        .success,
    ).toBe(true)
    expect(
      postUpdateSchema.safeParse({ taskId: UUID, body: 'x', files: files(MAX_FILES_PER_BATCH + 1) })
        .success,
    ).toBe(false)
    expect(
      postUpdateSchema.safeParse({
        taskId: UUID,
        body: 'x',
        files: [{ ...file, sizeBytes: MAX_TASK_FILE_BYTES + 1 }],
      }).success,
    ).toBe(false)
    expect(issue(postUpdateSchema.safeParse({ taskId: UUID, body: 'x'.repeat(10_001) }))).toBe(
      'La actualización es demasiado larga',
    )
  })

  it('editar una no la deja vacía', () => {
    expect(editUpdateSchema.parse({ id: UUID, body: ' Corregido ' }).body).toBe('Corregido')
    expect(issue(editUpdateSchema.safeParse({ id: UUID, body: '   ' }))).toBe('Escribí algo')
  })
})

describe('los archivos y los links', () => {
  it('antes de subir: de 1 a 10, ninguno vacío', () => {
    const one = { fileName: 'arte.png', mimeType: 'image/png', sizeBytes: 10 }
    expect(prepareUploadsSchema.safeParse({ taskId: UUID, files: [one] }).success).toBe(true)
    expect(prepareUploadsSchema.safeParse({ taskId: UUID, files: [] }).success).toBe(false)
    expect(
      prepareUploadsSchema.safeParse({ taskId: UUID, files: [{ ...one, sizeBytes: 0 }] }).success,
    ).toBe(false)
  })

  it('registrar sueltos: la tarea y sus archivos (lo de una actualización va con ella)', () => {
    const file = {
      path: `${UUID}/${OTHER}/${UUID}.pdf`,
      fileName: 'presupuesto.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 99,
    }
    // Un `updateId` de afuera ya no entra: no estaba atado a la tarea (revisión del 15/11).
    expect(
      registerFilesSchema.parse({ taskId: UUID, files: [file], updateId: OTHER } as never),
    ).toEqual({ taskId: UUID, files: [file] })
    expect(registerFilesSchema.safeParse({ taskId: UUID, files: [] }).success).toBe(false)
  })

  it('el link solo puede ser http/https (nada de javascript:) y el nombre vacío no cuenta', () => {
    expect(addLinkSchema.parse({ taskId: UUID, url: ' https://drive.google.com/x ' })).toEqual({
      taskId: UUID,
      url: 'https://drive.google.com/x',
    })
    expect(
      addLinkSchema.parse({ taskId: UUID, url: 'http://frame.io/a', title: '  Corte 2  ' }).title,
    ).toBe('Corte 2')
    expect(
      addLinkSchema.parse({ taskId: UUID, url: 'http://frame.io/a', title: '   ' }).title,
    ).toBeUndefined()
    for (const url of [
      'javascript:alert(1)',
      'drive.google.com/x',
      'ftp://x.com/a',
      'https://a b',
    ]) {
      expect(issue(addLinkSchema.safeParse({ taskId: UUID, url })), url).toBe(
        'El link tiene que empezar con http:// o https://',
      )
    }
    expect(
      addLinkSchema.safeParse({ taskId: UUID, url: `https://x.com/${'a'.repeat(2000)}` }).success,
    ).toBe(false)
  })
})

describe('routineUpsertSchema', () => {
  it('el cupo semanal es un entero de 1 a 14', () => {
    expect(routineUpsertSchema.parse({ title: 'Reels', description: '', slots: '3' }).slots).toBe(3)
    expect(
      routineUpsertSchema.safeParse({ title: 'Reels', description: '', slots: '0' }).success,
    ).toBe(false)
    expect(
      routineUpsertSchema.safeParse({ title: 'Reels', description: '', slots: '15' }).success,
    ).toBe(false)
    expect(
      routineUpsertSchema.safeParse({ title: 'Reels', description: '', slots: '2.5' }).success,
    ).toBe(false)
  })

  it('sin id es alta, con id es edición', () => {
    // El form manda siempre todas las claves; `id` sólo existe al editar y
    // `formData.get('id')` devuelve null cuando el hidden no está.
    const alta = routineUpsertSchema.parse({ id: null, title: 'Reels', description: '', slots: 1 })
    expect(alta.id).toBeNull()
    expect(alta.description).toBeNull()
    const edicion = routineUpsertSchema.parse({
      id: UUID,
      title: 'Reels',
      description: '',
      slots: 1,
    })
    expect(edicion.id).toBe(UUID)
  })
})

describe('routineCheckSchema', () => {
  it('el slot es 0-based y no puede salirse del máximo de la tabla', () => {
    expect(
      routineCheckSchema.parse({
        routine_id: UUID,
        week_start: '2026-08-31',
        slot: '0',
        done: true,
      }).slot,
    ).toBe(0)
    expect(
      routineCheckSchema.safeParse({
        routine_id: UUID,
        week_start: '2026-08-31',
        slot: 14,
        done: true,
      }).success,
    ).toBe(false)
  })

  it('la semana tiene que ser una fecha ISO', () => {
    expect(
      routineCheckSchema.safeParse({
        routine_id: UUID,
        week_start: 'esta',
        slot: 0,
        done: true,
      }).success,
    ).toBe(false)
  })
})
