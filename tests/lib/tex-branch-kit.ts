/**
 * Las sucursales de prueba para Tex (`TexToolContext.branch`). Puro: lo puede importar cualquier prueba sin
 * arrastrar los simulacros de la base.
 */

import type { TexBranch, TexBranchView } from '@/lib/tex/tools/types'

/** Sin sucursales a la vista: Tex lee todo el bar y no manda sucursal (como antes de las sucursales). */
export const NO_BRANCHES: TexBranchView = {
  isAll: true,
  currentId: null,
  branches: [],
  filter: { ids: null },
}

export const ALTA: TexBranch = {
  id: '00000000-0000-4000-8000-0000000000b1',
  name: 'Alta Córdoba',
  shortName: 'AC',
  isDefault: true,
}

export const CERRO: TexBranch = {
  id: '00000000-0000-4000-8000-0000000000b2',
  name: 'Cerro',
  shortName: null,
  isDefault: false,
}

/** Mirando una sucursal. */
export function viewing(
  branch: TexBranch,
  branches: readonly TexBranch[] = [ALTA, CERRO],
): TexBranchView {
  return { isAll: false, currentId: branch.id, branches, filter: { ids: [branch.id] } }
}

/** Mirando «Todas», como un dueño (sin filtro). */
export function viewingAll(branches: readonly TexBranch[] = [ALTA, CERRO]): TexBranchView {
  return { isAll: true, currentId: null, branches, filter: { ids: null } }
}
