import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkTaskFile,
  cleanFileName,
  extensionFor,
  formatBytes,
  isTaskFileMime,
  isTaskFilePath,
  linkLabel,
  MAX_TASK_FILE_BYTES,
  resolveTaskFileMime,
  TASK_FILE_ACCEPT,
  TASK_FILE_MESSAGES,
  TASK_FILE_MIMES,
  taskFileKind,
  taskFilePath,
} from '@/lib/marketing/files'

const TENANT = '11111111-2222-4333-8444-555555555555'
const TASK = '66666666-7777-4888-9999-aaaaaaaaaaaa'
const FILE = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const MB = 1024 * 1024

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('checkTaskFile', () => {
  it('lo que entra: con el tipo del navegador y su extensión de guardado', () => {
    expect(checkTaskFile({ name: 'arte.png', type: 'image/png', size: 10 })).toEqual({
      ok: true,
      mimeType: 'image/png',
      extension: 'png',
    })
    // `.jpeg` se guarda como `.jpg`: una sola extensión por tipo.
    expect(checkTaskFile({ name: 'foto.jpeg', type: 'image/jpeg', size: 10 })).toMatchObject({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    })
    expect(checkTaskFile({ name: 'planilla.xlsx', type: XLSX, size: 10 })).toMatchObject({
      extension: 'xlsx',
    })
  })

  it('sin tipo (o con uno raro), manda la extensión', () => {
    expect(checkTaskFile({ name: 'video.MOV', type: '', size: 10 })).toMatchObject({
      ok: true,
      mimeType: 'video/quicktime',
      extension: 'mov',
    })
    expect(
      checkTaskFile({ name: 'presupuesto.pdf', type: 'application/x-pdf', size: 10 }),
    ).toMatchObject({ ok: true, mimeType: 'application/pdf' })
  })

  it('lo que no entra va como link', () => {
    for (const file of [
      { name: 'pagina.html', type: 'text/html', size: 10 },
      { name: 'programa.exe', type: 'application/x-msdownload', size: 10 },
      { name: 'sin-extension', type: '', size: 10 },
      { name: 'nota.txt', type: 'text/plain', size: 10 },
    ]) {
      expect(checkTaskFile(file), file.name).toEqual({
        ok: false,
        message: TASK_FILE_MESSAGES.type,
      })
    }
  })

  it('hasta 50 MB justos', () => {
    expect(checkTaskFile({ name: 'reel.mp4', type: 'video/mp4', size: 50 * MB }).ok).toBe(true)
    expect(checkTaskFile({ name: 'reel.mp4', type: 'video/mp4', size: 50 * MB + 1 })).toEqual({
      ok: false,
      message: TASK_FILE_MESSAGES.tooBig,
    })
  })

  it('un archivo vacío se dice primero, sea del tipo que sea', () => {
    expect(checkTaskFile({ name: 'arte.png', type: 'image/png', size: 0 })).toEqual({
      ok: false,
      message: TASK_FILE_MESSAGES.empty,
    })
    expect(checkTaskFile({ name: 'x.exe', type: '', size: 0 })).toMatchObject({
      message: TASK_FILE_MESSAGES.empty,
    })
  })
})

describe('resolveTaskFileMime', () => {
  it('HEIC y HEIF del iPhone, que llegan sin tipo', () => {
    expect(resolveTaskFileMime({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic')
    expect(resolveTaskFileMime({ name: 'foto.heif', type: '' })).toBe('image/heif')
  })

  it('el zip de Windows', () => {
    expect(resolveTaskFileMime({ name: 'diseño.zip', type: 'application/x-zip-compressed' })).toBe(
      'application/zip',
    )
    expect(resolveTaskFileMime({ name: 'diseño', type: 'application/x-zip-compressed' })).toBe(
      'application/zip',
    )
  })

  it('el tipo sin espacios ni mayúsculas; lo desconocido, null', () => {
    expect(resolveTaskFileMime({ name: 'x', type: ' IMAGE/PNG ' })).toBe('image/png')
    expect(resolveTaskFileMime({ name: 'x.psd', type: '' })).toBeNull()
  })

  it('isTaskFileMime solo con los tipos de la lista', () => {
    expect(isTaskFileMime('image/png')).toBe(true)
    expect(isTaskFileMime('text/html')).toBe(false)
    expect(isTaskFileMime('constructor')).toBe(false)
    expect(isTaskFileMime(undefined)).toBe(false)
  })
})

describe('isTaskFilePath', () => {
  const path = `${TENANT}/${TASK}/${FILE}.png`

  it('acepta la ruta de esa tarea de ese bar, con la extensión de su tipo', () => {
    expect(taskFilePath(TENANT, TASK, FILE, 'png')).toBe(path)
    expect(isTaskFilePath(path, TENANT, TASK, 'image/png')).toBe(true)
    expect(isTaskFilePath(`${TENANT}/${TASK}/${FILE}.jpg`, TENANT, TASK, 'image/jpeg')).toBe(true)
  })

  it('rechaza otra tarea, otro bar u otra extensión', () => {
    expect(isTaskFilePath(path, TASK, TASK, 'image/png')).toBe(false)
    expect(isTaskFilePath(path, TENANT, FILE, 'image/png')).toBe(false)
    expect(isTaskFilePath(path, TENANT, TASK, 'image/jpeg')).toBe(false)
    expect(isTaskFilePath(`${TENANT}/${TASK}/${FILE}.jpeg`, TENANT, TASK, 'image/jpeg')).toBe(false)
    expect(isTaskFilePath(`${TENANT}/${TASK}/${FILE}.png.exe`, TENANT, TASK, 'image/png')).toBe(
      false,
    )
  })

  it('rechaza lo que no es un uuid o se sale de la carpeta', () => {
    for (const bad of [
      `${TENANT}/${TASK}/arte.png`,
      `${TENANT}/${TASK}/${FILE.toUpperCase()}.png`,
      `${TENANT}/${TASK}/../${FILE}.png`,
      `${TENANT}/${TASK}/sub/${FILE}.png`,
      `${TENANT}/${TASK}/${FILE}.png/`,
      `/${TENANT}/${TASK}/${FILE}.png`,
    ]) {
      expect(isTaskFilePath(bad, TENANT, TASK, 'image/png'), bad).toBe(false)
    }
  })
})

describe('taskFileKind', () => {
  it('cómo se muestra cada uno', () => {
    expect(taskFileKind('link', 'image/png')).toBe('link')
    expect(taskFileKind('file', 'image/png')).toBe('image')
    expect(taskFileKind('file', 'image/webp')).toBe('image')
    // El navegador no muestra HEIC: va como documento, para bajarlo.
    expect(taskFileKind('file', 'image/heic')).toBe('doc')
    expect(taskFileKind('file', 'image/heif')).toBe('doc')
    expect(taskFileKind('file', 'video/quicktime')).toBe('video')
    expect(taskFileKind('file', 'application/pdf')).toBe('pdf')
    expect(taskFileKind('file', XLSX)).toBe('sheet')
    expect(taskFileKind('file', PPTX)).toBe('slides')
    expect(taskFileKind('file', DOCX)).toBe('doc')
    expect(taskFileKind('file', 'application/zip')).toBe('zip')
    expect(taskFileKind('file', null)).toBe('doc')
  })
})

describe('formatBytes', () => {
  it('en es-AR: coma decimal y un decimal solo debajo de 10 MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(250 * 1024)).toBe('250 KB')
    expect(formatBytes(1_234_567)).toBe('1,2 MB')
    expect(formatBytes(1 * MB)).toBe('1 MB')
    expect(formatBytes(10.5 * MB)).toBe('11 MB')
    expect(formatBytes(50 * MB)).toBe('50 MB')
  })
})

describe('linkLabel', () => {
  it('el dominio sin «www.»; lo que no es un link, «Link»', () => {
    expect(linkLabel('https://www.drive.google.com/file/d/1')).toBe('drive.google.com')
    expect(linkLabel('https://frame.io/reviews/x')).toBe('frame.io')
    expect(linkLabel('http://WWW.Canva.com/design')).toBe('canva.com')
    expect(linkLabel('no es un link')).toBe('Link')
    expect(linkLabel('file:///Users/x/arte.png')).toBe('Link')
  })
})

describe('cleanFileName', () => {
  it('sin rutas ni caracteres de control, recortado y de hasta 160', () => {
    expect(cleanFileName('C:\\fakepath\\arte final.png')).toBe('arte final.png')
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('a\u0000b\u001f\u007f.png')).toBe('ab.png')
    expect(cleanFileName('  arte.png  ')).toBe('arte.png')
    expect(cleanFileName('   ')).toBe('archivo')
    expect(cleanFileName('carpeta/')).toBe('archivo')
    expect(cleanFileName(`${'x'.repeat(200)}.png`)).toHaveLength(160)
  })
})

describe('lo mismo que la base', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261115230118_marketing_tasks_board_v2.sql'),
    'utf8',
  )

  it('el bucket acepta exactamente estos tipos, con el mismo tope', () => {
    const allowed = migration.match(/array\[([^\]]+)\]/)?.[1] ?? ''
    const fromSql = [...allowed.matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect([...fromSql].sort()).toEqual([...TASK_FILE_MIMES].sort())
    expect(migration).toContain(`${MAX_TASK_FILE_BYTES},`)
    expect(migration).toContain(`size_bytes between 1 and ${MAX_TASK_FILE_BYTES}`)
  })

  it('cada extensión entra en la forma de ruta que exige la base', () => {
    for (const mime of TASK_FILE_MIMES) {
      expect(extensionFor(mime), mime).toMatch(/^[a-z0-9]{1,5}$/)
      const path = taskFilePath(TENANT, TASK, FILE, extensionFor(mime))
      expect(path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/)
      expect(path.slice(0, 74)).toBe(`${TENANT}/${TASK}/`)
    }
  })

  it('el selector ofrece lo que el navegador no reconoce solo', () => {
    for (const accept of ['.heic', '.zip', '.docx', '.xlsx', '.pptx', 'application/pdf']) {
      expect(TASK_FILE_ACCEPT.split(','), accept).toContain(accept)
    }
  })
})

describe('casos raros que no tienen que colarse', () => {
  it('una extensión con nombre de propiedad de Object no es un tipo', () => {
    expect(resolveTaskFileMime({ name: 'nota.constructor', type: '' })).toBeNull()
    expect(resolveTaskFileMime({ name: 'x.__proto__', type: '' })).toBeNull()
    expect(checkTaskFile({ name: 'nota.constructor', type: '', size: 10 })).toEqual({
      ok: false,
      message: TASK_FILE_MESSAGES.type,
    })
  })

  it('justo debajo de 1 MB ya dice «1 MB», no «1024 KB»', () => {
    expect(formatBytes(1_048_575)).toBe('1 MB')
  })
})
