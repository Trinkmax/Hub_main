import type { PostingCatalog } from '@/lib/accounting/context'
import { treasuryTones } from '@/lib/accounting/home'
import type { AccessOverview } from '@/lib/accounting/queries/access'
import type { OnboardingOverview } from '@/lib/accounting/queries/onboarding'
import {
  type ArcaTileState,
  accessCounts,
  SAS_SHEET_FIELDS,
  TILE_ORDER,
  type TileState,
  tileAccess,
  tileArca,
  tileArcaOf,
  tileMethods,
  tileSalesPoints,
  tileSas,
  tileTreasuries,
} from '../../_lib/portada'
import { type OwnerRoom, ROOMS, roomHref } from '../../_lib/rooms'
import { ArcaCable } from '../arca-cable'
import { InvoiceNumber } from '../invoice-number'
import { KeyDots } from '../key-dots'
import { SettingsTile } from './settings-tile'
import { CardStack, MiniColumn, MiniSheet } from './tile-arts'

/**
 * Los seis objetos de la portada de Ajustes: las llaves, la billetera, la
 * columna del cierre, la constancia, el número de la factura y el cable a
 * ARCA. Contestan, sin entrar a ningún lado: ¿quién entra?, ¿está el banco?,
 * ¿cuántos medios tengo prendidos?, ¿falta la CUIT?, ¿con qué número facturo?,
 * ¿ARCA está conectado?
 *
 * Todo sale de tres lecturas que ya se hicieron (el catálogo, la guía y los
 * accesos). Una que falló no tira la portada: su objeto dice «—» y «No pudimos
 * cargarlo», y sigue llevando a su habitación.
 */
export function SettingsBoard({
  base,
  catalog,
  onboarding,
  access,
  showMembers,
  arcaState,
}: {
  base: string
  /** `null` = la lectura falló. */
  catalog: PostingCatalog | null
  /** `undefined` = falló; `null` = la guía todavía no está en la base. */
  onboarding: OnboardingOverview | null | undefined
  access: AccessOverview | null
  /** Quien mira ve la lista de socios (un dueño). */
  showMembers: boolean
  /** El estado de ARCA como lo dice su habitación; sin él, vale el de la guía. */
  arcaState?: ArcaTileState | null
}) {
  const guide = onboarding?.state ?? null
  const manualDone = (id: string) => guide?.items.find((i) => i.id === id)?.manualDone === true
  // En uso y en el orden de Ajustes: así cada caja lleva el mismo color que en el Resumen y en Cajas.
  const inUse = (catalog?.treasuries ?? [])
    .filter((t) => t.active)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
  const tones = catalog ? treasuryTones(inUse) : {}
  const counts = access ? accessCounts(access) : null
  const sas = tileSas(catalog?.settings ?? null, onboarding?.data.sasMissing)
  const points = tileSalesPoints(catalog?.salesPoints ?? null)
  const arca = arcaState
    ? tileArcaOf(arcaState)
    : tileArca(onboarding === undefined ? undefined : (onboarding?.data.arca ?? null))
  const methodsOn = catalog?.methods.filter((m) => m.active).length ?? 0

  const tiles: Record<OwnerRoom, { state: TileState; art: React.ReactNode; hint?: string }> = {
    accesos: {
      state: tileAccess(access, { showMembers, manualDone: manualDone('access') }),
      art: counts ? (
        // Con pocos socios (HUB arrancó con tres), puntos de 12 px: tres puntitos de 8 px se
        // pierden en el casillero. Hasta nueve entran en tres filas de tres.
        <KeyDots
          {...counts}
          size={counts.inCount + counts.outCount <= 9 ? 'md' : 'sm'}
          center
          className="w-[68px]"
        />
      ) : (
        <KeyDots inCount={0} adminCount={0} outCount={0} />
      ),
    },
    cajas: {
      state: tileTreasuries(catalog?.treasuries ?? null, {
        manualDone: manualDone('treasuries'),
      }),
      art: (
        <CardStack
          cards={inUse.map((t) => ({ id: t.id, kind: t.kind, tone: tones[t.id] ?? null }))}
        />
      ),
    },
    medios: {
      state: tileMethods(catalog),
      art: <MiniColumn count={methodsOn} />,
    },
    sas: {
      state: sas,
      art: <MiniSheet missing={SAS_SHEET_FIELDS.map((f) => sas.missing.includes(f))} />,
      hint: catalog?.settings.legalName,
    },
    'puntos-de-venta': {
      state: points,
      art: <InvoiceNumber size="sm" number={points.first} />,
    },
    arca: {
      state: arca,
      art: <ArcaCable size="sm" state={arca.state ?? 'not_started'} className="w-[68px]" />,
    },
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {TILE_ORDER.map((room, index) => (
        <SettingsTile
          key={room}
          index={index}
          href={roomHref(base, room)}
          title={ROOMS[room].title}
          state={tiles[room].state}
          art={tiles[room].art}
          sentenceTitle={tiles[room].hint}
        />
      ))}
    </ul>
  )
}
