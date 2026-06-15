import { describe, expect, it } from 'vitest'
import { nextNodeId, pickConditionBranch } from '@/lib/flows/runtime'

// ---------------------------------------------------------------------------
// nextNodeId
// ---------------------------------------------------------------------------

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const D = 'dddddddd-0000-4000-8000-000000000004'

type MinEdge = { source_node_id: string; target_node_id: string; source_handle: string | null }

describe('nextNodeId', () => {
  it('returns the target for an unconditional edge (source_handle null)', () => {
    const edges: MinEdge[] = [{ source_node_id: A, target_node_id: B, source_handle: null }]
    expect(nextNodeId(edges, A, null)).toBe(B)
  })

  it('defaults branch param to null (same as unconditional)', () => {
    const edges: MinEdge[] = [{ source_node_id: A, target_node_id: B, source_handle: null }]
    // Call without third arg — should behave like null branch.
    expect(nextNodeId(edges, A)).toBe(B)
  })

  it('returns correct target for true branch', () => {
    const edges: MinEdge[] = [
      { source_node_id: A, target_node_id: B, source_handle: 'true' },
      { source_node_id: A, target_node_id: C, source_handle: 'false' },
    ]
    expect(nextNodeId(edges, A, 'true')).toBe(B)
  })

  it('returns correct target for false branch', () => {
    const edges: MinEdge[] = [
      { source_node_id: A, target_node_id: B, source_handle: 'true' },
      { source_node_id: A, target_node_id: C, source_handle: 'false' },
    ]
    expect(nextNodeId(edges, A, 'false')).toBe(C)
  })

  it('returns null when no matching edge exists for the branch', () => {
    const edges: MinEdge[] = [{ source_node_id: A, target_node_id: B, source_handle: 'true' }]
    // No false-branch edge.
    expect(nextNodeId(edges, A, 'false')).toBeNull()
  })

  it('returns null when no edges at all', () => {
    expect(nextNodeId([], A, null)).toBeNull()
  })

  it('ignores edges from other source nodes', () => {
    const edges: MinEdge[] = [
      { source_node_id: C, target_node_id: D, source_handle: null },
      { source_node_id: A, target_node_id: B, source_handle: null },
    ]
    expect(nextNodeId(edges, A, null)).toBe(B)
    expect(nextNodeId(edges, C, null)).toBe(D)
  })

  it('returns first matching edge when multiple unconditional edges share source (defensive)', () => {
    const edges: MinEdge[] = [
      { source_node_id: A, target_node_id: B, source_handle: null },
      { source_node_id: A, target_node_id: C, source_handle: null },
    ]
    // Array.find returns the first match.
    expect(nextNodeId(edges, A, null)).toBe(B)
  })
})

// ---------------------------------------------------------------------------
// pickConditionBranch
// ---------------------------------------------------------------------------

describe('pickConditionBranch', () => {
  it('returns "true" for a truthy result', () => {
    expect(pickConditionBranch(true)).toBe('true')
  })

  it('returns "false" for a falsy result', () => {
    expect(pickConditionBranch(false)).toBe('false')
  })
})
