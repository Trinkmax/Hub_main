import { describe, expect, it } from 'vitest'
import type { SaveFlowGraphPayload } from '@/lib/flows/graph-schemas'
import { saveFlowGraphPayloadSchema, validateFlowGraph } from '@/lib/flows/graph-schemas'

// ─── Test UUIDs (RFC 4122 v4-compliant) ──────────────────────────────────────
const triggerNodeId = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
const sendNodeId = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6'
const edgeId = 'c3d4e5f6-a7b8-4c9d-ae0f-a2b3c4d5e6f7'
const unknownId = 'd4e5f6a7-b8c9-4d0e-bf10-b3c4d5e6f7a8'

const baseTriggerNode = {
  id: triggerNodeId,
  kind: 'trigger' as const,
  position: { x: 100, y: 100 },
  config: {},
}

const baseSendNode = {
  id: sendNodeId,
  kind: 'send_template' as const,
  position: { x: 100, y: 300 },
  config: { channel_id: 'abc', template_id: 'def', variables: [] },
}

const baseEdge = {
  id: edgeId,
  source: triggerNodeId,
  target: sendNodeId,
  sourceHandle: null as null,
}

function makePayload(overrides: Partial<SaveFlowGraphPayload> = {}): SaveFlowGraphPayload {
  return saveFlowGraphPayloadSchema.parse({
    name: 'Test flow',
    active: false,
    trigger: { type: 'after_visit' },
    nodes: [baseTriggerNode, baseSendNode],
    edges: [baseEdge],
    ...overrides,
  })
}

// ─── Schema validation tests ──────────────────────────────────────────────────

describe('saveFlowGraphPayloadSchema', () => {
  it('accepts a valid trigger → send_template graph', () => {
    const result = saveFlowGraphPayloadSchema.safeParse({
      name: 'Mi flow',
      active: true,
      trigger: { type: 'after_visit' },
      nodes: [baseTriggerNode, baseSendNode],
      edges: [baseEdge],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a name longer than 80 characters', () => {
    const result = saveFlowGraphPayloadSchema.safeParse({
      name: 'a'.repeat(81),
      active: false,
      trigger: { type: 'after_visit' },
      nodes: [baseTriggerNode],
      edges: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = saveFlowGraphPayloadSchema.safeParse({
      name: '   ',
      active: false,
      trigger: { type: 'after_visit' },
      nodes: [baseTriggerNode],
      edges: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a node kind not in the enum', () => {
    const result = saveFlowGraphPayloadSchema.safeParse({
      name: 'Flow',
      active: false,
      trigger: { type: 'after_visit' },
      nodes: [{ id: triggerNodeId, kind: 'unknown_kind', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    })
    expect(result.success).toBe(false)
  })
})

// ─── validateFlowGraph structural tests ──────────────────────────────────────

describe('validateFlowGraph', () => {
  it('accepts a valid graph with exactly one trigger node', () => {
    const payload = makePayload()
    expect(validateFlowGraph(payload)).toBeNull()
  })

  it('rejects a graph with zero trigger nodes', () => {
    const payload = makePayload({
      nodes: [baseSendNode],
      edges: [],
    })
    const error = validateFlowGraph(payload)
    expect(error).not.toBeNull()
    expect(error).toContain('activa')
  })

  it('rejects a graph with more than one trigger node', () => {
    const secondTriggerId = 'e5f6a7b8-c9d0-4e1f-af20-c4d5e6f7a8b9'
    const payload = makePayload({
      nodes: [baseTriggerNode, { ...baseTriggerNode, id: secondTriggerId }, baseSendNode],
      edges: [baseEdge],
    })
    const error = validateFlowGraph(payload)
    expect(error).not.toBeNull()
    expect(error).toContain('disparador')
  })

  it('rejects an edge referencing a missing source node id', () => {
    const payload = makePayload({
      edges: [{ ...baseEdge, source: unknownId }],
    })
    const error = validateFlowGraph(payload)
    expect(error).not.toBeNull()
    expect(error).toContain('sin conectar')
  })

  it('rejects an edge referencing a missing target node id', () => {
    const payload = makePayload({
      edges: [{ ...baseEdge, target: unknownId }],
    })
    const error = validateFlowGraph(payload)
    expect(error).not.toBeNull()
    expect(error).toContain('sin conectar')
  })

  it('accepts a graph with no edges (trigger-only)', () => {
    const payload = makePayload({ nodes: [baseTriggerNode], edges: [] })
    expect(validateFlowGraph(payload)).toBeNull()
  })

  it('accepts condition node edges with true/false sourceHandles', () => {
    const conditionId = 'f6a7b8c9-d0e1-4f2a-b031-d5e6f7a8b9c0'
    const yesTargetId = 'a7b8c9d0-e1f2-4a3b-b142-e6f7a8b9c0d1'
    const noTargetId = 'b8c9d0e1-f2a3-4b4c-a253-f7a8b9c0d1e2'
    const e1 = 'c9d0e1f2-a3b4-4c5d-a364-a8b9c0d1e2f3'
    const e2 = 'd0e1f2a3-b4c5-4d6e-a475-b9c0d1e2f3a4'
    const e3 = 'e1f2a3b4-c5d6-4e7f-a586-c0d1e2f3a4b5'

    const payload = makePayload({
      nodes: [
        baseTriggerNode,
        {
          id: conditionId,
          kind: 'condition' as const,
          position: { x: 100, y: 300 },
          config: { field: 'f', op: 'is_true' },
        },
        { id: yesTargetId, kind: 'send_template' as const, position: { x: 0, y: 500 }, config: {} },
        {
          id: noTargetId,
          kind: 'wait' as const,
          position: { x: 200, y: 500 },
          config: { minutes: 60 },
        },
      ],
      edges: [
        { id: e1, source: triggerNodeId, target: conditionId, sourceHandle: null },
        { id: e2, source: conditionId, target: yesTargetId, sourceHandle: 'true' as const },
        { id: e3, source: conditionId, target: noTargetId, sourceHandle: 'false' as const },
      ],
    })
    expect(validateFlowGraph(payload)).toBeNull()
  })

  it('rechaza un self-loop (send_template que apunta a sí mismo → loop infinito)', () => {
    const selfEdge = '11111111-1111-4111-8111-111111111111'
    const payload = makePayload({
      nodes: [baseTriggerNode, baseSendNode],
      edges: [
        baseEdge,
        { id: selfEdge, source: sendNodeId, target: sendNodeId, sourceHandle: null },
      ],
    })
    const error = validateFlowGraph(payload)
    expect(error).not.toBeNull()
    expect(error).toContain('círculo')
  })

  it('rechaza un ciclo de vuelta A→B→A (reenvío infinito)', () => {
    const aId = '22222222-2222-4222-8222-222222222222'
    const bId = '33333333-3333-4333-8333-333333333333'
    const eTA = '44444444-4444-4444-8444-444444444444'
    const eAB = '55555555-5555-4555-8555-555555555555'
    const eBA = '66666666-6666-4666-8666-666666666666'
    const payload = makePayload({
      nodes: [
        baseTriggerNode,
        { id: aId, kind: 'send_template' as const, position: { x: 0, y: 300 }, config: {} },
        { id: bId, kind: 'send_template' as const, position: { x: 0, y: 500 }, config: {} },
      ],
      edges: [
        { id: eTA, source: triggerNodeId, target: aId, sourceHandle: null },
        { id: eAB, source: aId, target: bId, sourceHandle: null },
        { id: eBA, source: bId, target: aId, sourceHandle: null },
      ],
    })
    const error = validateFlowGraph(payload)
    expect(error).not.toBeNull()
    expect(error).toContain('círculo')
  })

  it('acepta ramas que reconvergen sin ciclo (diamante cond→X, cond→Y, X→Z, Y→Z)', () => {
    const condId = '77777777-7777-4777-8777-777777777777'
    const xId = '88888888-8888-4888-8888-888888888888'
    const yId = '99999999-9999-4999-8999-999999999999'
    const zId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const eTc = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const ecX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const ecY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const eXZ = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const eYZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const payload = makePayload({
      nodes: [
        baseTriggerNode,
        { id: condId, kind: 'condition' as const, position: { x: 100, y: 300 }, config: {} },
        { id: xId, kind: 'send_template' as const, position: { x: 0, y: 500 }, config: {} },
        { id: yId, kind: 'send_template' as const, position: { x: 200, y: 500 }, config: {} },
        { id: zId, kind: 'add_tag' as const, position: { x: 100, y: 700 }, config: {} },
      ],
      edges: [
        { id: eTc, source: triggerNodeId, target: condId, sourceHandle: null },
        { id: ecX, source: condId, target: xId, sourceHandle: 'true' as const },
        { id: ecY, source: condId, target: yId, sourceHandle: 'false' as const },
        { id: eXZ, source: xId, target: zId, sourceHandle: null },
        { id: eYZ, source: yId, target: zId, sourceHandle: null },
      ],
    })
    expect(validateFlowGraph(payload)).toBeNull()
  })
})
