'use client'

import { useReducer, useState } from 'react'
import { Stepper } from '@/components/ui/stepper'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import type { PointsRule } from '@/lib/points/types'
import { CustomerStep } from './customer-step'
import { ItemsStep } from './items-step'
import { SummaryStep } from './summary-step'

export type WizardCustomer = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
}

export type WizardLine = { item_id: string; quantity: number }

type State = {
  step: 1 | 2 | 3
  customer: WizardCustomer | null
  lines: WizardLine[]
  notes: string
}

type Action =
  | { type: 'set_customer'; customer: WizardCustomer | null }
  | { type: 'add_line'; item_id: string }
  | { type: 'remove_line'; item_id: string }
  | { type: 'set_quantity'; item_id: string; quantity: number }
  | { type: 'set_notes'; notes: string }
  | { type: 'go'; step: 1 | 2 | 3 }

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'set_customer':
      return { ...s, customer: a.customer }
    case 'add_line': {
      const existing = s.lines.find((l) => l.item_id === a.item_id)
      if (existing) {
        return {
          ...s,
          lines: s.lines.map((l) =>
            l.item_id === a.item_id ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        }
      }
      return { ...s, lines: [...s.lines, { item_id: a.item_id, quantity: 1 }] }
    }
    case 'remove_line':
      return { ...s, lines: s.lines.filter((l) => l.item_id !== a.item_id) }
    case 'set_quantity': {
      if (a.quantity <= 0) return { ...s, lines: s.lines.filter((l) => l.item_id !== a.item_id) }
      return {
        ...s,
        lines: s.lines.map((l) => (l.item_id === a.item_id ? { ...l, quantity: a.quantity } : l)),
      }
    }
    case 'set_notes':
      return { ...s, notes: a.notes }
    case 'go':
      return { ...s, step: a.step }
  }
}

const STEPS = [
  { label: 'Cliente', description: 'Buscá o creá' },
  { label: 'Consumo', description: 'Cargá los ítems' },
  { label: 'Confirmar', description: 'Cobrar y otorgar puntos' },
]

export function CloseTableWizard({
  tenantSlug,
  categories,
  items,
  rules,
}: {
  tenantSlug: string
  categories: MenuCategory[]
  items: MenuItem[]
  rules: PointsRule[]
}) {
  const [state, dispatch] = useReducer(reducer, {
    step: 1,
    customer: null,
    lines: [],
    notes: '',
  } as State)
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={state.step - 1} />

      {state.step === 1 ? (
        <CustomerStep
          tenantSlug={tenantSlug}
          selected={state.customer}
          onSelect={(c) => {
            dispatch({ type: 'set_customer', customer: c })
            dispatch({ type: 'go', step: 2 })
          }}
        />
      ) : null}

      {state.step === 2 && state.customer ? (
        <ItemsStep
          customer={state.customer}
          categories={categories}
          items={items}
          lines={state.lines}
          notes={state.notes}
          onAdd={(id) => dispatch({ type: 'add_line', item_id: id })}
          onRemove={(id) => dispatch({ type: 'remove_line', item_id: id })}
          onQty={(id, q) => dispatch({ type: 'set_quantity', item_id: id, quantity: q })}
          onNotes={(n) => dispatch({ type: 'set_notes', notes: n })}
          onBack={() => dispatch({ type: 'go', step: 1 })}
          onNext={() => dispatch({ type: 'go', step: 3 })}
        />
      ) : null}

      {state.step === 3 && state.customer ? (
        <SummaryStep
          tenantSlug={tenantSlug}
          customer={state.customer}
          items={items}
          lines={state.lines}
          notes={state.notes}
          rules={rules}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onBack={() => dispatch({ type: 'go', step: 2 })}
        />
      ) : null}
    </div>
  )
}
