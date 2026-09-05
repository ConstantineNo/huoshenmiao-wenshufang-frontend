export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function readErrorCode(response: Response) {
  const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null
  return typeof payload?.detail === 'string' && payload.detail ? payload.detail : `http_${response.status}`
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response))
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export async function requestOk(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response))
  }
}

export async function requestPdf(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response))
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/pdf')) {
    throw new ApiError(422, 'invalid_pdf')
  }
  return response.blob()
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: '请求内容不符合要求。',
  invalid_credentials: '用户名或密码错误。',
  invalid_token: '登录已失效，请重新登录。',
  forbidden: '当前账号没有执行此操作的权限。',
  resource_not_found: '没有找到该资源。',
  user_exists: '该用户名已存在。',
  idempotency_conflict: '提交标识已用于不同的打印内容，请生成新预览后再提交。',
  agent_busy: '打印服务正在处理另一项任务。',
  agent_offline: '打印服务当前离线，不能提交打印。',
  agent_not_ready: '打印机当前不可用，不能提交打印。',
  result_unknown_hold: '存在结果未知且尚未确认的任务，当前不能创建新任务。',
  artifact_already_submitted: '这个预览已经提交过。若确需再次打印，请生成新预览。',
  event_conflict: '任务状态发生冲突，请刷新后查看。',
  pilot_operation_unavailable: '试运行期间暂不支持此操作。',
  artifact_expired: '预览已过期，请重新生成。',
  legacy_task_protocol_disabled: '旧打印流程已停用。',
  template_not_ready: '模板尚未完成配置，不能分配或预览。',
  invalid_values: '填写内容未通过模板校验。',
  invalid_pdf: '服务返回的预览不是有效 PDF。',
  unsupported_print_profile: '打印机不支持本次固定打印设置。',
  rate_limited: '请求过于频繁，请稍后再试。',
  pilot_disabled: '试运行功能尚未启用。',
  pilot_binding_missing: '尚未配置现场打印机，仍可填写并预览。',
  render_unavailable: 'PDF 生成服务当前不可用。',
  service_busy: '服务繁忙，请稍后再试。',
  render_timeout: 'PDF 生成超时，请稍后再试。',
}

export function describeError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? `${fallback}（${error.code}）`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return ''
  }
  return `${fallback}，请检查网络连接。`
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function isNetworkError(error: unknown) {
  return error instanceof TypeError
}

export function isUncertainSubmissionError(error: unknown) {
  return isNetworkError(error) || !(error instanceof ApiError) || error.status >= 500
}
