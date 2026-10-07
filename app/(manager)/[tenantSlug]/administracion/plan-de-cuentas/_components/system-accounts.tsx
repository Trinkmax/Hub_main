'use client'

import { Cog, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { normalizeCodeQuery } from '@/components/administracion/account-paths'
import { normalizeText, rankAccount } from '@/components/administracion/search'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar } from '@/components/ui/filter-bar'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import { Callout } from '../../ajustes/_components/form-bits'
import { SYSTEM_USE_GROUPS, SYSTEM_USES, systemKeysOf } from '../_lib/system-uses'
import type { ChartAccount } from '../_lib/tree'
import { useChartWorkspace } from './workspace-context'

type Item = { key: SystemAccountKey; account: ChartAccount | null }

/**
 * «Cuentas del sistema» (#16): cada uso que tiene el motor, en criollo, con la cuenta que tiene hoy y
 * «Usar otra cuenta» (solo cuentas compatibles). El motor busca las cuentas por su uso, nunca por el
 * código ni el nombre: por eso se pueden renombrar, recodificar o mover sin romper nada.
 */
export function SystemAccounts() {
  const { index, readOnly, canAdmin, openAccount, remapKey } = useChartWorkspace()
  const [query, setQuery] = useState('')

  const byKey = useMemo(() => {
    const map = new Map<string, ChartAccount>()
    for (const account of index.ordered) {
      if (account.systemKey) map.set(account.systemKey, account)
    }
    return map
  }, [index])

  const q = normalizeText(query)
  const sections = SYSTEM_USE_GROUPS.map((group) => ({
    ...group,
    items: systemKeysOf(group.value)
      .map((key): Item => ({ key, account: byKey.get(key) ?? null }))
      .filter(({ key, account }) => {
        if (!q) return true
        const use = SYSTEM_USES[key]
        if (normalizeText(`${use.label} ${use.use}`).includes(q)) return true
        return account !== null && rankAccount(account, normalizeCodeQuery(query)) >= 0
      }),
  })).filter((section) => section.items.length > 0)

  return (
    <div className="space-y-6">
      <Callout tone="info" title="El sistema arma los asientos con estas cuentas.">
        Las busca por su uso, nunca por el código ni por el nombre: podés renombrarlas, cambiarles
        el código o moverlas sin que se rompa nada.
        {readOnly
          ? ''
          : canAdmin
            ? ' Si querés que un uso vaya a otra cuenta, tocá «Usar otra cuenta»: lo ya cargado queda en la anterior.'
            : ' Cambiar la cuenta de un uso lo hace quien administra los accesos de Administración.'}
      </Callout>

      <FilterBar>
        <label className="relative flex flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Buscar un uso o una cuenta</span>
          <input
            type="search"
            value={query}
            placeholder="Un uso o una cuenta («IVA», «proveedores», «1.1.03»)"
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-lg border border-transparent bg-background/40 pl-9 pr-3 text-base shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40 md:h-9 md:text-sm"
          />
        </label>
      </FilterBar>

      {sections.length === 0 ? (
        <EmptyState
          icon={Cog}
          title="No hay usos con eso"
          description="Probá con otra palabra, con el código de la cuenta o con su nombre."
        />
      ) : (
        sections.map((section) => (
          <section
            key={section.value}
            aria-labelledby={`sistema-${section.value}`}
            className="card-hairline rounded-xl border bg-card"
          >
            <header className="border-b border-border/60 px-5 py-4">
              <h2
                id={`sistema-${section.value}`}
                className="font-serif text-lg font-semibold tracking-tight"
              >
                {section.title}
              </h2>
              <p className="text-sm text-muted-foreground text-pretty">{section.description}</p>
            </header>
            <ul className="divide-y divide-border/60">
              {section.items.map(({ key, account }) => {
                const use = SYSTEM_USES[key]
                return (
                  <li
                    key={key}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{use.label}</p>
                      <p className="text-xs text-muted-foreground text-pretty">{use.use}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      {account ? (
                        <button
                          type="button"
                          onClick={() => openAccount(account.id)}
                          className="max-w-full rounded-md text-left text-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs sm:text-right"
                          aria-label={`Ver la cuenta ${account.code} ${account.name}`}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {account.code}
                          </span>{' '}
                          {account.name}
                          {account.active ? null : (
                            <span className="text-xs text-muted-foreground"> (inactiva)</span>
                          )}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin cuenta asignada</span>
                      )}
                      {canAdmin && account ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 md:h-8"
                          onClick={() => remapKey(key)}
                        >
                          Usar otra cuenta
                        </Button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
