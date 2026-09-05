import { describe, expect, it } from 'vitest'
import { getOrCreateSubmissionIntent, TASK_STATUS, validateArtifactValues } from './pilot-core'

describe('controlled print submission intent', () => {
  it('reuses the same key after an uncertain response for the exact same intent', () => {
    const first = getOrCreateSubmissionIntent(null, 'artifact-1', 'agent-1', 'L1300', () => 'key-1')
    const uncertain = { ...first, state: 'uncertain' as const }
    const replay = getOrCreateSubmissionIntent(uncertain, 'artifact-1', 'agent-1', 'L1300', () => 'key-2')

    expect(replay.idempotencyKey).toBe('key-1')
  })

  it('creates a new key only after the user changes the concrete print input', () => {
    const first = getOrCreateSubmissionIntent(null, 'artifact-1', 'agent-1', 'L1300', () => 'key-1')
    const next = getOrCreateSubmissionIntent(first, 'artifact-2', 'agent-1', 'L1300', () => 'key-2')

    expect(next.idempotencyKey).toBe('key-2')
  })
})

describe('artifact value limits', () => {
  it('blocks a missing required field before sending content', () => {
    expect(validateArtifactValues([{ field_key: 'name', required: true }], { name: '  ' }))
      .toContain('必填项')
  })

  it('accepts a bounded string field', () => {
    expect(validateArtifactValues([{ field_key: 'name', required: true }], { name: '测试用户' }))
      .toBe('')
  })
})

describe('task wording', () => {
  it('describes queue delivery without claiming paper output', () => {
    expect(TASK_STATUS.QUEUE_DELIVERED.label).toBe('队列已交付')
    expect(TASK_STATUS.QUEUE_DELIVERED.description).toContain('未声明设备已经出纸')
  })

  it('keeps blocked and unknown results explicit', () => {
    expect(TASK_STATUS.BLOCKED.label).toBe('已阻塞')
    expect(TASK_STATUS.RESULT_UNKNOWN.label).toBe('结果未知')
  })
})
