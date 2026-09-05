import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, describeError, isAbortError, isUncertainSubmissionError, requestJson, requestOk, requestPdf } from './api'
import { getOrCreateSubmissionIntent, TASK_STATUS, type SubmissionIntent, validateArtifactValues } from './pilot-core'

type Profile = { id: string; user_name: string; status: string; nick_name?: string | null }
type UserSession = { accessToken: string; apiBaseUrl: string; profile: Profile; scope: 'user' }
type LoginResponse = { access_token: string; token_type: string; scope: string; expires_in: number; profile: Profile }
type PilotField = { field_key: string; label: string; required: boolean; value_type: string }
type PilotTemplate = { id: string; name: string; version_no: number; fields: PilotField[] }
type PilotPrinter = {
  agent_id: string
  agent_name: string
  printer_name: string
  online: boolean
  reason: string | null
  ownership_generation: number
  authorization_revision: number
}
type Artifact = { artifact_id: string; template_id: string; sha256: string; page_count: number; expires_at: string }
type PrintTask = {
  task_id: string
  artifact_id: string
  sha256: string
  page_count: number
  copies: number
  agent_id: string
  printer_name: string
  status: string
  reason: string | null
  created_at: string
  dispatch_expires_at: string
  windows_job_id: number | null
  document_marker: string | null
  profile_id: string
  unknown_acknowledged_at: string | null
}

const USER_SESSION_KEY = 'cloud-print-web/pilot-user-session'

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function defaultApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL
  if (typeof configured === 'string' && configured.trim()) return normalizeApiBaseUrl(configured)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return 'http://127.0.0.1:18080'
  return window.location.origin
}

function readUserSession(): UserSession | null {
  const raw = window.sessionStorage.getItem(USER_SESSION_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as UserSession
    return value.accessToken && value.apiBaseUrl && value.profile?.id && value.scope === 'user' ? value : null
  } catch {
    return null
  }
}

function authHeaders(session: UserSession, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

export function UserPortal({ openAdmin }: { openAdmin: () => void }) {
  const [session, setSession] = useState<UserSession | null>(readUserSession)
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl)
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function login(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const base = normalizeApiBaseUrl(apiBaseUrl)
    try {
      const payload = await requestJson<LoginResponse>(`${base}/api/v1/auth/user/password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name: userName.trim(), password }),
      })
      if (payload.scope !== 'user' || typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer' || !payload.access_token || !payload.profile?.id) {
        throw new ApiError(403, 'forbidden')
      }
      const next: UserSession = { accessToken: payload.access_token, apiBaseUrl: base, profile: payload.profile, scope: 'user' }
      window.sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(next))
      setSession(next)
      setPassword('')
    } catch (cause) {
      setError(describeError(cause, '登录失败'))
    } finally {
      setPassword('')
      setSubmitting(false)
    }
  }

  function logout() {
    window.sessionStorage.removeItem(USER_SESSION_KEY)
    setSession(null)
    setPassword('')
    setError('')
  }

  if (session) return <UserWorkbench session={session} logout={logout} />

  return (
    <section className="login-layout">
      <div className="intro-panel">
        <p className="eyebrow">受控单机打印 · 0.2.0</p>
        <h1>文档填写与打印</h1>
        <p className="lede">登录后选择管理员为你准备的模板，填写内容、核对同一份 PDF 预览，再提交给已授权的现场打印机。</p>
        <div className="hint-card">
          <strong>提交前请确认</strong>
          <ul className="status-list">
            <li>预览与打印使用同一个短期 PDF</li>
            <li>现场离线时仍可填写和预览</li>
            <li>系统不会自动补打结果未知的任务</li>
          </ul>
        </div>
      </div>
      <form className="login-card" onSubmit={login}>
        <div className="field-group">
          <label htmlFor="user-api-base">后端地址</label>
          <input id="user-api-base" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} autoComplete="url" />
        </div>
        <div className="field-group">
          <label htmlFor="pilot-user-name">用户名</label>
          <input id="pilot-user-name" value={userName} onChange={(event) => setUserName(event.target.value)} autoComplete="username" required />
        </div>
        <div className="field-group">
          <label htmlFor="pilot-user-password">密码</label>
          <input id="pilot-user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </div>
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={submitting}>{submitting ? '登录中…' : '进入打印工作台'}</button>
        <button className="text-button" type="button" onClick={openAdmin}>管理员入口</button>
      </form>
    </section>
  )
}

function UserWorkbench({ session, logout }: { session: UserSession; logout: () => void }) {
  const [templates, setTemplates] = useState<PilotTemplate[]>([])
  const [printers, setPrinters] = useState<PilotPrinter[]>([])
  const [tasks, setTasks] = useState<PrintTask[]>([])
  const [resourceErrors, setResourceErrors] = useState({ templates: '', printers: '', tasks: '' })
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [selectedPrinterKey, setSelectedPrinterKey] = useState('')
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const previewAbortRef = useRef<AbortController | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [intent, setIntent] = useState<SubmissionIntent | null>(null)
  const intentRef = useRef<SubmissionIntent | null>(null)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [claim, setClaim] = useState({ agentId: '', ownershipKey: '', generation: '', revision: '' })
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimMessage, setClaimMessage] = useState('')

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) ?? null
  const selectedPrinter = printers.find((item) => `${item.agent_id}\u0000${item.printer_name}` === selectedPrinterKey) ?? null

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    setPreviewUrl(null)
  }, [])

  const invalidateArtifact = useCallback(() => {
    previewAbortRef.current?.abort()
    revokePreview()
    setArtifact(null)
    setPreviewError('')
    intentRef.current = null
    setIntent(null)
    setSubmitMessage('')
  }, [revokePreview])

  const refreshTasks = useCallback(async (signal?: AbortSignal, quiet = false) => {
    try {
      const payload = await requestJson<{ items: PrintTask[] }>(`${session.apiBaseUrl}/api/v1/pilot/tasks`, {
        headers: authHeaders(session), signal,
      })
      setTasks(payload.items)
      setResourceErrors((current) => ({ ...current, tasks: '' }))
      return payload.items
    } catch (cause) {
      if (!isAbortError(cause) && !quiet) {
        setResourceErrors((current) => ({ ...current, tasks: describeError(cause, '任务列表读取失败') }))
      }
      return []
    }
  }, [session])

  const refreshPrinters = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await requestJson<{ items: PilotPrinter[] }>(`${session.apiBaseUrl}/api/v1/pilot/printers`, {
        headers: authHeaders(session), signal,
      })
      setPrinters(payload.items)
      setResourceErrors((current) => ({ ...current, printers: '' }))
    } catch (cause) {
      if (!isAbortError(cause)) {
        setResourceErrors((current) => ({ ...current, printers: describeError(cause, '打印机列表读取失败') }))
      }
    }
  }, [session])

  useEffect(() => {
    const controller = new AbortController()
    void requestJson<{ items: PilotTemplate[] }>(`${session.apiBaseUrl}/api/v1/pilot/templates`, {
      headers: authHeaders(session), signal: controller.signal,
    }).then((payload) => {
      setTemplates(payload.items)
      setResourceErrors((current) => ({ ...current, templates: '' }))
    }).catch((cause) => {
      if (!isAbortError(cause)) setResourceErrors((current) => ({ ...current, templates: describeError(cause, '模板列表读取失败') }))
    })
    void refreshPrinters(controller.signal)
    void refreshTasks(controller.signal)
    return () => controller.abort()
  }, [refreshPrinters, refreshTasks, session])

  useEffect(() => {
    let controller: AbortController | null = null
    const timer = window.setInterval(() => {
      controller?.abort()
      controller = new AbortController()
      void refreshTasks(controller.signal, true)
    }, 5000)
    return () => {
      window.clearInterval(timer)
      controller?.abort()
    }
  }, [refreshTasks])

  useEffect(() => {
    let controller: AbortController | null = null
    const timer = window.setInterval(() => {
      controller?.abort()
      controller = new AbortController()
      void refreshPrinters(controller.signal)
    }, 10000)
    return () => {
      window.clearInterval(timer)
      controller?.abort()
    }
  }, [refreshPrinters])

  useEffect(() => () => {
    previewAbortRef.current?.abort()
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
  }, [])

  function chooseTemplate(templateId: string) {
    invalidateArtifact()
    setSelectedTemplateId(templateId)
    const template = templates.find((item) => item.id === templateId)
    setValues(Object.fromEntries((template?.fields ?? []).map((field) => [field.field_key, ''])))
  }

  function changeValue(fieldKey: string, value: string) {
    invalidateArtifact()
    setValues((current) => ({ ...current, [fieldKey]: value }))
  }

  async function loadArtifactContent(nextArtifact: Artifact) {
    previewAbortRef.current?.abort()
    const controller = new AbortController()
    previewAbortRef.current = controller
    setPreviewBusy(true)
    setPreviewError('')
    revokePreview()
    try {
      const blob = await requestPdf(`${session.apiBaseUrl}/api/v1/pilot/artifacts/${nextArtifact.artifact_id}/content`, {
        headers: authHeaders(session), signal: controller.signal,
      })
      const url = URL.createObjectURL(blob)
      previewUrlRef.current = url
      setPreviewUrl(url)
    } catch (cause) {
      if (!isAbortError(cause)) setPreviewError(describeError(cause, 'PDF 预览读取失败'))
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null
        setPreviewBusy(false)
      }
    }
  }

  async function createPreview() {
    if (!selectedTemplate) return
    const issue = validateArtifactValues(selectedTemplate.fields, values)
    if (issue) {
      setPreviewError(issue)
      return
    }
    invalidateArtifact()
    const controller = new AbortController()
    previewAbortRef.current = controller
    setPreviewBusy(true)
    try {
      const next = await requestJson<Artifact>(`${session.apiBaseUrl}/api/v1/pilot/artifacts`, {
        method: 'POST', headers: authHeaders(session, true), signal: controller.signal,
        body: JSON.stringify({ template_id: selectedTemplate.id, values }),
      })
      setArtifact(next)
      await loadArtifactContent(next)
    } catch (cause) {
      if (!isAbortError(cause)) setPreviewError(describeError(cause, 'PDF 预览生成失败'))
      if (previewAbortRef.current === controller) setPreviewBusy(false)
    }
  }

  async function claimAgent(event: React.FormEvent) {
    event.preventDefault()
    setClaimBusy(true)
    setClaimMessage('')
    try {
      await requestJson(`${session.apiBaseUrl}/api/v1/agents/${encodeURIComponent(claim.agentId.trim())}/claim`, {
        method: 'POST', headers: authHeaders(session, true),
        body: JSON.stringify({
          ownership_key: claim.ownershipKey,
          expected_ownership_generation: Number(claim.generation),
          expected_authorization_revision: Number(claim.revision),
        }),
      })
      setClaimMessage('认领成功，正在刷新可用打印机。')
      await refreshPrinters()
    } catch (cause) {
      setClaimMessage(describeError(cause, '认领失败'))
    } finally {
      setClaim((current) => ({ ...current, ownershipKey: '' }))
      setClaimBusy(false)
    }
  }

  async function submitPrint() {
    if (!artifact || !selectedPrinter?.online || !previewUrl) return
    const next = getOrCreateSubmissionIntent(
      intentRef.current,
      artifact.artifact_id,
      selectedPrinter.agent_id,
      selectedPrinter.printer_name,
      () => crypto.randomUUID(),
    )
    const submittingIntent = { ...next, state: 'submitting' as const }
    intentRef.current = submittingIntent
    setIntent(submittingIntent)
    setSubmitBusy(true)
    setSubmitMessage('')
    try {
      const task = await requestJson<PrintTask>(`${session.apiBaseUrl}/api/v1/pilot/tasks`, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Idempotency-Key': next.idempotencyKey },
        body: JSON.stringify({ artifact_id: artifact.artifact_id, agent_id: selectedPrinter.agent_id, printer_name: selectedPrinter.printer_name, copies: 1 }),
      })
      const confirmed = { ...next, state: 'confirmed' as const }
      intentRef.current = confirmed
      setIntent(confirmed)
      setTasks((current) => [task, ...current.filter((item) => item.task_id !== task.task_id)])
      setSubmitMessage('任务已创建。请根据任务状态判断队列结果。')
    } catch (cause) {
      const uncertain = isUncertainSubmissionError(cause)
      const state = uncertain ? 'uncertain' as const : 'ready' as const
      const retained = { ...next, state }
      intentRef.current = retained
      setIntent(retained)
      setSubmitMessage(uncertain
        ? '提交响应中断，结果可能未知。系统没有自动再次提交；请先刷新任务列表，必要时再明确使用原提交标识重试。'
        : describeError(cause, '打印任务提交失败'))
      const latest = await refreshTasks(undefined, true)
      const recovered = latest.find((task) => task.artifact_id === artifact.artifact_id
        && task.agent_id === selectedPrinter.agent_id && task.printer_name === selectedPrinter.printer_name)
      if (recovered) {
        const confirmed = { ...next, state: 'confirmed' as const }
        intentRef.current = confirmed
        setIntent(confirmed)
        setSubmitMessage('已从任务列表核对到本次任务，请继续查看状态。')
      }
    } finally {
      setSubmitBusy(false)
    }
  }

  async function refreshTask(taskId: string) {
    try {
      const task = await requestJson<PrintTask>(`${session.apiBaseUrl}/api/v1/pilot/tasks/${encodeURIComponent(taskId)}`, { headers: authHeaders(session) })
      setTasks((current) => current.map((item) => item.task_id === task.task_id ? task : item))
    } catch (cause) {
      setResourceErrors((current) => ({ ...current, tasks: describeError(cause, '任务状态读取失败') }))
    }
  }

  async function acknowledgeUnknown(taskId: string) {
    try {
      await requestOk(`${session.apiBaseUrl}/api/v1/pilot/tasks/${encodeURIComponent(taskId)}/acknowledge-unknown`, {
        method: 'POST', headers: authHeaders(session, true), body: JSON.stringify({ acknowledge_possible_duplicate: true }),
      })
      await refreshTask(taskId)
      await refreshTasks()
    } catch (cause) {
      setResourceErrors((current) => ({ ...current, tasks: describeError(cause, '结果未知确认失败') }))
    }
  }

  const currentTask = useMemo(() => artifact
    ? tasks.find((task) => task.artifact_id === artifact.artifact_id) ?? null
    : null, [artifact, tasks])
  const canPrint = Boolean(artifact && previewUrl && selectedPrinter?.online && !submitBusy && intent?.state !== 'confirmed')

  return (
    <section className="dashboard-shell pilot-shell">
      <header className="topbar-card">
        <div>
          <p className="eyebrow">受控单机打印 · 0.2.0</p>
          <h1>打印工作台</h1>
          <p className="lede">填写、核对 PDF、选择在线打印机，然后提交一次受控打印。</p>
        </div>
        <div className="topbar-actions">
          <div className="identity-chip"><span className="identity-label">当前用户</span><strong>{session.profile.user_name}</strong><span className="identity-meta">{session.profile.status}</span></div>
          <button type="button" className="ghost-button" onClick={logout} disabled={submitBusy || claimBusy}>退出登录</button>
        </div>
      </header>

      <div className="pilot-grid">
        <section className="panel-card pilot-main">
          <div className="section-heading"><div><p className="panel-kicker">步骤 1</p><h2>选择模板并填写</h2></div></div>
          {resourceErrors.templates ? <p className="error-banner">{resourceErrors.templates}</p> : null}
          <div className="template-choice-grid">
            {templates.map((template) => (
              <button key={template.id} type="button" className={`choice-card ${selectedTemplateId === template.id ? 'selected' : ''}`} onClick={() => chooseTemplate(template.id)}>
                <strong>{template.name}</strong><span>版本 {template.version_no} · {template.fields.length} 个字段</span>
              </button>
            ))}
          </div>
          {!templates.length && !resourceErrors.templates ? <p className="empty-state">管理员尚未为你准备模板。</p> : null}
          {selectedTemplate ? (
            <div className="pilot-fields">
              {selectedTemplate.fields.map((field) => (
                <div className="field-group" key={field.field_key}>
                  <label htmlFor={`value-${field.field_key}`}>{field.label}{field.required ? ' *' : ''}</label>
                  <textarea id={`value-${field.field_key}`} value={values[field.field_key] ?? ''} maxLength={1000} rows={2} onChange={(event) => changeValue(field.field_key, event.target.value)} />
                </div>
              ))}
              <button type="button" className="primary-button" disabled={previewBusy} onClick={() => void createPreview()}>{previewBusy ? '正在生成…' : artifact ? '生成新预览' : '生成 PDF 预览'}</button>
            </div>
          ) : null}
          {previewError ? <p className="error-banner">{previewError}</p> : null}
        </section>

        <aside className="panel-card pilot-side">
          <p className="panel-kicker">现场认领</p><h2>认领打印服务</h2>
          <p className="upload-hint">密钥只用于本次 TLS 请求，页面不会保存；提交完成后立即从表单清除。</p>
          <form className="compact-form" onSubmit={claimAgent}>
            <div className="field-group"><label htmlFor="claim-agent">Agent ID</label><input id="claim-agent" value={claim.agentId} onChange={(event) => setClaim({ ...claim, agentId: event.target.value })} required /></div>
            <div className="field-group"><label htmlFor="claim-key">所有权密钥</label><input id="claim-key" type="password" value={claim.ownershipKey} onChange={(event) => setClaim({ ...claim, ownershipKey: event.target.value })} autoComplete="off" required /></div>
            <div className="two-fields">
              <div className="field-group"><label htmlFor="claim-generation">Generation</label><input id="claim-generation" type="number" min="0" value={claim.generation} onChange={(event) => setClaim({ ...claim, generation: event.target.value })} required /></div>
              <div className="field-group"><label htmlFor="claim-revision">Revision</label><input id="claim-revision" type="number" min="0" value={claim.revision} onChange={(event) => setClaim({ ...claim, revision: event.target.value })} required /></div>
            </div>
            <button className="ghost-button" disabled={claimBusy}>{claimBusy ? '认领中…' : '认领'}</button>
          </form>
          {claimMessage ? <p className={claimMessage.includes('成功') ? 'success-banner' : 'error-banner'}>{claimMessage}</p> : null}
        </aside>

        <section className="panel-card pilot-main">
          <div className="section-heading"><div><p className="panel-kicker">步骤 2</p><h2>核对同一份 PDF</h2></div>{artifact ? <span className="meta-pill">{artifact.page_count} 页</span> : null}</div>
          {artifact ? <p className="artifact-meta">SHA-256 {artifact.sha256}<br />有效期至 {new Date(artifact.expires_at).toLocaleString('zh-CN')}</p> : null}
          {previewBusy ? <p className="empty-state preview-wait">正在取得受保护的 PDF…</p> : null}
          {!previewBusy && previewUrl ? <div className="preview-pdf-container"><iframe src={previewUrl} title="待打印 PDF 预览" /></div> : null}
          {artifact && !previewUrl && !previewBusy ? <button className="ghost-button" type="button" onClick={() => void loadArtifactContent(artifact)}>重新加载 PDF</button> : null}
        </section>

        <aside className="panel-card pilot-side print-control">
          <div className="section-heading"><div><p className="panel-kicker">步骤 3</p><h2>选择打印机并提交</h2></div><button className="ghost-button small-button" type="button" onClick={() => void refreshPrinters()}>刷新状态</button></div>
          <div className="print-profile"><strong>A4 · 纵向 · 适合可打印区域 · 1份</strong><span>300 dpi · 彩色 · 单面 · 不自动旋转</span></div>
          {resourceErrors.printers ? <p className="info-banner">{resourceErrors.printers}</p> : null}
          <div className="field-group">
            <label htmlFor="pilot-printer">已授权打印机</label>
            <select id="pilot-printer" value={selectedPrinterKey} onChange={(event) => { setSelectedPrinterKey(event.target.value); intentRef.current = null; setIntent(null); setSubmitMessage('') }}>
              <option value="">请选择</option>
              {printers.map((printer) => <option key={`${printer.agent_id}\u0000${printer.printer_name}`} value={`${printer.agent_id}\u0000${printer.printer_name}`}>{printer.agent_name} / {printer.printer_name} · {printer.online ? '在线' : '不可用'}</option>)}
            </select>
          </div>
          {selectedPrinter && !selectedPrinter.online ? <p className="warning-banner">当前不可提交：{selectedPrinter.reason || '打印服务离线'}。你仍可继续填写和预览。</p> : null}
          <button className="primary-button" type="button" disabled={!canPrint} onClick={() => void submitPrint()}>{submitBusy ? '提交中…' : intent?.state === 'uncertain' ? '使用原提交标识重试' : '确认提交打印'}</button>
          {!artifact ? <p className="upload-hint">请先生成并核对 PDF 预览。</p> : null}
          {intent?.state === 'confirmed' ? <p className="info-banner">这个预览已经建立任务。如需再次打印，请生成新预览。</p> : null}
          {submitMessage ? <p className={intent?.state === 'confirmed' ? 'success-banner' : 'warning-banner'}>{submitMessage}</p> : null}
          {currentTask ? <TaskCard task={currentTask} refreshTask={refreshTask} acknowledgeUnknown={acknowledgeUnknown} compact /> : null}
        </aside>

        <section className="panel-card pilot-history">
          <div className="section-heading"><div><p className="panel-kicker">任务查询</p><h2>最近任务</h2></div><button className="ghost-button small-button" type="button" onClick={() => void refreshTasks()}>刷新</button></div>
          {resourceErrors.tasks ? <p className="error-banner">{resourceErrors.tasks}</p> : null}
          <div className="task-list">{tasks.map((task) => <TaskCard key={task.task_id} task={task} refreshTask={refreshTask} acknowledgeUnknown={acknowledgeUnknown} />)}</div>
          {!tasks.length && !resourceErrors.tasks ? <p className="empty-state">暂无打印任务。</p> : null}
        </section>
      </div>
    </section>
  )
}

function TaskCard({ task, refreshTask, acknowledgeUnknown, compact = false }: {
  task: PrintTask
  refreshTask: (taskId: string) => Promise<void>
  acknowledgeUnknown: (taskId: string) => Promise<void>
  compact?: boolean
}) {
  const view = TASK_STATUS[task.status] ?? { label: task.status, tone: 'neutral', description: '请刷新查看最新状态。' }
  return (
    <article className={`task-card tone-${view.tone} ${compact ? 'compact' : ''}`}>
      <div className="task-card-head"><div><span className="status-badge">{view.label}</span><strong>{task.printer_name}</strong></div><button className="text-button" type="button" onClick={() => void refreshTask(task.task_id)}>查询</button></div>
      <p>{view.description}</p>
      <dl className="task-meta"><div><dt>任务</dt><dd>{task.task_id}</dd></div><div><dt>创建</dt><dd>{new Date(task.created_at).toLocaleString('zh-CN')}</dd></div>{task.windows_job_id ? <div><dt>Windows JobId</dt><dd>{task.windows_job_id}</dd></div> : null}{task.reason ? <div><dt>原因</dt><dd>{task.reason}</dd></div> : null}</dl>
      {task.status === 'RESULT_UNKNOWN' && !task.unknown_acknowledged_at ? (
        <div className="unknown-confirm"><strong>可能已经产生纸张</strong><p>请先人工核对。确认只会解除新任务限制，不会重打，也不会把原结果改成失败。</p><button className="danger-button" type="button" onClick={() => void acknowledgeUnknown(task.task_id)}>我已知晓可能重复出纸</button></div>
      ) : null}
      {task.unknown_acknowledged_at ? <p className="acknowledged">已于 {new Date(task.unknown_acknowledged_at).toLocaleString('zh-CN')} 确认未知结果。</p> : null}
    </article>
  )
}

type AdminUser = { id: string; user_name: string; status: string }
type AdminSourceTemplate = { id: string; name: string; source_type: string; field_count: number; status: string }

export function AdminPilotPanel({ session, templates }: {
  session: { accessToken: string; apiBaseUrl: string }
  templates: AdminSourceTemplate[]
}) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersError, setUsersError] = useState('')
  const [createForm, setCreateForm] = useState({ userName: '', password: '' })
  const [createBusy, setCreateBusy] = useState(false)
  const [createMessage, setCreateMessage] = useState('')
  const [provision, setProvision] = useState({ sourceTemplateId: '', ownerUserId: '', name: '' })
  const [provisionBusy, setProvisionBusy] = useState(false)
  const [provisionMessage, setProvisionMessage] = useState('')

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await requestJson<{ items: AdminUser[] }>(`${session.apiBaseUrl}/api/v1/admin/users`, {
        headers: { Authorization: `Bearer ${session.accessToken}` }, signal,
      })
      setUsers(payload.items)
      setUsersError('')
    } catch (cause) {
      if (!isAbortError(cause)) setUsersError(describeError(cause, '用户列表读取失败'))
    }
  }, [session])

  useEffect(() => {
    const controller = new AbortController()
    void loadUsers(controller.signal)
    return () => controller.abort()
  }, [loadUsers])

  async function createUser(event: React.FormEvent) {
    event.preventDefault()
    setCreateBusy(true)
    setCreateMessage('')
    try {
      const created = await requestJson<AdminUser>(`${session.apiBaseUrl}/api/v1/admin/users`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name: createForm.userName.trim(), password: createForm.password }),
      })
      setCreateMessage(`普通用户 ${created.user_name} 已创建。`)
      setCreateForm({ userName: '', password: '' })
      await loadUsers()
    } catch (cause) {
      setCreateMessage(describeError(cause, '创建普通用户失败'))
    } finally {
      setCreateForm((current) => ({ ...current, password: '' }))
      setCreateBusy(false)
    }
  }

  async function provisionTemplate(event: React.FormEvent) {
    event.preventDefault()
    setProvisionBusy(true)
    setProvisionMessage('')
    try {
      const result = await requestJson<{ id: string; name: string; version_no: number; owner_user_id: string }>(`${session.apiBaseUrl}/api/v1/admin/pilot/templates`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_template_id: provision.sourceTemplateId, owner_user_id: provision.ownerUserId, name: provision.name.trim() }),
      })
      setProvisionMessage(`已为用户准备“${result.name}”版本 ${result.version_no}。`)
      setProvision({ sourceTemplateId: '', ownerUserId: '', name: '' })
    } catch (cause) {
      setProvisionMessage(describeError(cause, '模板分配失败'))
    } finally {
      setProvisionBusy(false)
    }
  }

  const readyDocx = templates.filter((template) => template.source_type.toLowerCase() === 'docx' && template.field_count > 0)
  return (
    <article className="panel-card wide-card">
      <p className="panel-kicker">试运行账号与模板</p>
      <div className="admin-pilot-grid">
        <section>
          <h2>创建普通用户</h2>
          <form className="compact-form" onSubmit={createUser}>
            <div className="field-group"><label htmlFor="new-user-name">用户名</label><input id="new-user-name" minLength={3} maxLength={64} value={createForm.userName} onChange={(event) => setCreateForm({ ...createForm, userName: event.target.value })} required /></div>
            <div className="field-group"><label htmlFor="new-user-password">初始密码</label><input id="new-user-password" type="password" minLength={12} maxLength={128} value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} autoComplete="new-password" required /></div>
            <button className="primary-button" disabled={createBusy}>{createBusy ? '创建中…' : '创建普通用户'}</button>
          </form>
          {createMessage ? <p className={createMessage.includes('已创建') ? 'success-banner' : 'error-banner'}>{createMessage}</p> : null}
        </section>
        <section>
          <div className="section-heading"><h2>普通用户</h2><button className="ghost-button small-button" type="button" onClick={() => void loadUsers()}>刷新</button></div>
          {usersError ? <p className="error-banner">{usersError}</p> : null}
          <div className="user-list">{users.map((user) => <div key={user.id}><strong>{user.user_name}</strong><span>{user.status}</span></div>)}</div>
        </section>
        <section>
          <h2>为用户准备模板</h2>
          <p className="upload-hint">只列出已配置字段的 DOCX 制作稿。分配后会建立独立只读快照。</p>
          <form className="compact-form" onSubmit={provisionTemplate}>
            <div className="field-group"><label htmlFor="provision-source">制作稿</label><select id="provision-source" value={provision.sourceTemplateId} onChange={(event) => setProvision({ ...provision, sourceTemplateId: event.target.value })} required><option value="">请选择</option>{readyDocx.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
            <div className="field-group"><label htmlFor="provision-user">用户</label><select id="provision-user" value={provision.ownerUserId} onChange={(event) => setProvision({ ...provision, ownerUserId: event.target.value })} required><option value="">请选择</option>{users.map((user) => <option key={user.id} value={user.id}>{user.user_name}</option>)}</select></div>
            <div className="field-group"><label htmlFor="provision-name">用户看到的模板名称</label><input id="provision-name" value={provision.name} onChange={(event) => setProvision({ ...provision, name: event.target.value })} required /></div>
            <button className="primary-button" disabled={provisionBusy || !readyDocx.length}>{provisionBusy ? '准备中…' : '准备模板'}</button>
          </form>
          {provisionMessage ? <p className={provisionMessage.includes('已为用户') ? 'success-banner' : 'error-banner'}>{provisionMessage}</p> : null}
        </section>
      </div>
    </article>
  )
}
