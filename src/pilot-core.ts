export type SubmissionIntent = {
  artifactId: string
  agentId: string
  printerName: string
  idempotencyKey: string
  state: 'ready' | 'submitting' | 'uncertain' | 'confirmed'
}

export function getOrCreateSubmissionIntent(
  current: SubmissionIntent | null,
  artifactId: string,
  agentId: string,
  printerName: string,
  createKey: () => string,
) {
  if (
    current?.artifactId === artifactId
    && current.agentId === agentId
    && current.printerName === printerName
  ) {
    return current
  }
  return {
    artifactId,
    agentId,
    printerName,
    idempotencyKey: createKey(),
    state: 'ready' as const,
  }
}

export function validateArtifactValues(fields: { field_key: string; required: boolean }[], values: Record<string, string>) {
  const missing = fields.find((field) => field.required && !values[field.field_key]?.trim())
  if (missing) {
    return `请填写必填项“${missing.field_key}”。`
  }
  if (Object.values(values).some((value) => value.length > 1000)) {
    return '单个字段不能超过 1000 个字符。'
  }
  if (new TextEncoder().encode(JSON.stringify({ values })).byteLength > 64 * 1024) {
    return '本次填写内容超过 64 KiB，请减少内容后重试。'
  }
  return ''
}

export const TASK_STATUS: Record<string, { label: string; tone: string; description: string }> = {
  READY: { label: '等待领取', tone: 'neutral', description: '任务已建立，等待现场打印服务领取。' },
  CLAIMED: { label: '已领取', tone: 'active', description: '现场打印服务已领取任务。' },
  SUBMIT_INTENT: { label: '正在提交队列', tone: 'active', description: '已记录单次提交意图，正在联系 Windows 打印队列。' },
  SPOOL_BOUND: { label: '队列处理中', tone: 'active', description: '任务已关联 Windows 打印作业，正在跟踪队列状态。' },
  BLOCKED: { label: '已阻塞', tone: 'warning', description: '打印队列需要人工处理；系统不会自动补打。' },
  QUEUE_DELIVERED: { label: '队列已交付', tone: 'success', description: 'Windows 打印队列已正常完成，未声明设备已经出纸。' },
  FAILED: { label: '提交前失败', tone: 'danger', description: 'Windows 接受任务前失败，没有自动再次提交。' },
  RESULT_UNKNOWN: { label: '结果未知', tone: 'danger', description: '任务可能已经产生纸张；确认前系统会阻止新任务。' },
  DISPATCH_EXPIRED: { label: '下发已过期', tone: 'danger', description: '任务未在有效期内被领取。' },
}
