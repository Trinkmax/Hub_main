import { crc32 } from '@/lib/imports/zip'

/**
 * Escritor de ZIP mínimo para fixtures y tests (no es código de la app). Imita
 * lo que hace falta probar del lector: el ZIP «en streaming» de ARCA (bit 3,
 * con descriptor después de los datos y ceros en el encabezado local), nombres
 * UTF-8 (bit 11), ZIP64 forzado, la marca de contraseña y entradas guardadas o
 * comprimidas. La compresión se inyecta (`zlib.deflateRawSync` en Node).
 */

export type ZipFileInput = {
  readonly name: string
  readonly data: Uint8Array
  /** 8 = deflate (default), 0 = guardado. */
  readonly method?: 0 | 8
}

export type BuildZipOptions = {
  readonly deflateRaw: (data: Uint8Array) => Uint8Array
  /** Bit 3: CRC y tamaños en un descriptor después de los datos (como ARCA). */
  readonly dataDescriptor?: boolean
  /** Bit 11: nombres en UTF-8 (default `true`). */
  readonly utf8Names?: boolean
  /** Registros ZIP64 aunque no hagan falta. */
  readonly zip64?: boolean
  /** Bit 0 (contraseña). Solo la marca: los datos no se cifran. */
  readonly encrypted?: boolean
  /** Rompe el CRC declarado (para probar la verificación). */
  readonly corruptCrc?: boolean
  /** Fecha y hora DOS fijas (default 2025-12-02 10:15). */
  readonly dosDate?: number
  readonly dosTime?: number
}

class Out {
  private parts: Uint8Array[] = []
  length = 0
  push(bytes: Uint8Array): void {
    this.parts.push(bytes)
    this.length += bytes.length
  }
  u16(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]))
  }
  u32(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]))
  }
  u64(v: number): void {
    this.u32(v % 0x1_0000_0000)
    this.u32(Math.floor(v / 0x1_0000_0000))
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}

/** Fecha DOS: ((año − 1980) << 9) | (mes << 5) | día. */
export function dosDate(year: number, month: number, day: number): number {
  return ((year - 1980) << 9) | (month << 5) | day
}

/** Hora DOS: (hora << 11) | (minuto << 5) | (segundo / 2). */
export function dosTime(hour: number, minute: number, second = 0): number {
  return (hour << 11) | (minute << 5) | Math.floor(second / 2)
}

export function buildZip(files: readonly ZipFileInput[], opts: BuildZipOptions): Uint8Array {
  const out = new Out()
  const utf8 = opts.utf8Names ?? true
  const date = opts.dosDate ?? dosDate(2025, 12, 2)
  const time = opts.dosTime ?? dosTime(10, 15)
  const flags =
    (opts.encrypted ? 0x0001 : 0) | (opts.dataDescriptor ? 0x0008 : 0) | (utf8 ? 0x0800 : 0)
  const central: Array<{
    name: Uint8Array
    method: number
    crc: number
    csize: number
    usize: number
    offset: number
  }> = []

  for (const f of files) {
    const method = f.method ?? 8
    const name = new TextEncoder().encode(f.name)
    const payload = method === 8 ? opts.deflateRaw(f.data) : f.data
    const crc = opts.corruptCrc ? (crc32(f.data) ^ 0x1) >>> 0 : crc32(f.data)
    const offset = out.length
    const zip64Local = opts.zip64 && !opts.dataDescriptor
    out.u32(0x04034b50)
    out.u16(opts.zip64 ? 45 : 20)
    out.u16(flags)
    out.u16(method)
    out.u16(time)
    out.u16(date)
    out.u32(opts.dataDescriptor ? 0 : crc)
    out.u32(opts.dataDescriptor ? 0 : zip64Local ? 0xffffffff : payload.length)
    out.u32(opts.dataDescriptor ? 0 : zip64Local ? 0xffffffff : f.data.length)
    out.u16(name.length)
    out.u16(zip64Local ? 20 : 0)
    out.push(name)
    if (zip64Local) {
      out.u16(0x0001)
      out.u16(16)
      out.u64(f.data.length)
      out.u64(payload.length)
    }
    out.push(payload)
    if (opts.dataDescriptor) {
      out.u32(0x08074b50)
      out.u32(crc)
      out.u32(payload.length)
      out.u32(f.data.length)
    }
    central.push({ name, method, crc, csize: payload.length, usize: f.data.length, offset })
  }

  const cdStart = out.length
  for (const c of central) {
    out.u32(0x02014b50)
    out.u16(opts.zip64 ? 45 : 20) // hecho por: MS-DOS, versión 2.0 (4.5 con ZIP64)
    out.u16(opts.zip64 ? 45 : 20)
    out.u16(flags)
    out.u16(c.method)
    out.u16(time)
    out.u16(date)
    out.u32(c.crc)
    out.u32(opts.zip64 ? 0xffffffff : c.csize)
    out.u32(opts.zip64 ? 0xffffffff : c.usize)
    out.u16(c.name.length)
    out.u16(opts.zip64 ? 28 : 0)
    out.u16(0) // comentario
    out.u16(0) // disco
    out.u16(0) // atributos internos
    out.u32(0) // atributos externos
    out.u32(opts.zip64 ? 0xffffffff : c.offset)
    out.push(c.name)
    if (opts.zip64) {
      out.u16(0x0001)
      out.u16(24)
      out.u64(c.usize)
      out.u64(c.csize)
      out.u64(c.offset)
    }
  }
  const cdSize = out.length - cdStart

  if (opts.zip64) {
    const z64 = out.length
    out.u32(0x06064b50)
    out.u64(44)
    out.u16(45)
    out.u16(45)
    out.u32(0)
    out.u32(0)
    out.u64(central.length)
    out.u64(central.length)
    out.u64(cdSize)
    out.u64(cdStart)
    out.u32(0x07064b50)
    out.u32(0)
    out.u64(z64)
    out.u32(1)
  }
  out.u32(0x06054b50)
  out.u16(0)
  out.u16(0)
  out.u16(opts.zip64 ? 0xffff : central.length)
  out.u16(opts.zip64 ? 0xffff : central.length)
  out.u32(opts.zip64 ? 0xffffffff : cdSize)
  out.u32(opts.zip64 ? 0xffffffff : cdStart)
  out.u16(0)
  return out.bytes()
}
