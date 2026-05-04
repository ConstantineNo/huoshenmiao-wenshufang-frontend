import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

type AdminProfile = {
  id: string
  user_name: string
  nick_name: string | null
  status: string
}

type LoginResponse = {
  access_token: string
  token_type: 'bearer'
  scope: 'admin'
  expires_in: number
  profile: AdminProfile
}

type PersistedSession = {
  accessToken: string
  profile: AdminProfile
  apiBaseUrl: string
}

type TemplateSummary = {
  id: string
  name: string
  source_type: string
  status: string
  template_version_id: string
  version_no: number
  source_file_url: string
  checksum: string
  field_count: number
  created_at: string
  updated_at: string
}

type ScanResult = {
  template_id: string
  template_version_id: string
  editable_segments: EditableSegment[]
  text_blocks: TextBlock[]
  found_placeholders: Placeholder[]
  found_regions: BookmarkRegion[]
  issues: ScanIssue[]
}

type EditableSegment = {
  segment_key: string
  text: string
  highlight_color: string
  location: { block_key?: string; start_offset?: number; end_offset?: number }
  style?: Record<string, unknown>
}

type TextBlock = {
  block_key: string
  text: string
  container_type: string
  style?: Record<string, unknown>
}

type Placeholder = {
  token: string
  field_key: string
  scope: string
  formatter?: { kind: string; pattern: string } | null
  default_value?: string | null
}

type BookmarkRegion = {
  bookmark_name: string
  region_key: string
  region_type: string
}

type ScanIssue = {
  code: string
  severity: string
  message: string
  target: Record<string, string | null | undefined>
}

type FieldDefinition = {
  segment_key?: string
  field_key: string
  label: string
  value_type: string
  required: boolean
  binding_kind: string
}

type TableDraftRow = {
  row_key: string
  cells: Record<string, string>
  print_config: { printer_id: string | null; copies: number; operator_name: string | null }
}

type PreviewRun = {
  text: string
  editable: boolean
  field_key?: string
}

type PreviewBlock = {
  block_key: string
  container_type: string
  runs: PreviewRun[]
}

type TableDraftResponse = {
  template_version_id: string
  columns: { field_key: string; label: string; value_type: string; required: boolean; binding_kind: string }[]
  active_row_key: string | null
  rows: TableDraftRow[]
  preview: { blocks: PreviewBlock[] }
}

type PreflightResult = {
  template_id: string
  template_version_id: string
  passed: boolean
  issues: ScanIssue[]
}

type PdfPageInfo = { page: number; width_pt: number; height_pt: number; width_mm: number; height_mm: number }
type PdfInfo = { template_id: string; page_count: number; pages: PdfPageInfo[] }
type FieldPosition = { field_key: string; label: string; page: number; x: number; y: number; width: number; font_name: string; font_size: number; align: string }

const SESSION_STORAGE_KEY = 'cloud-print-web/admin-session'

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function preferSameOriginApiBaseUrl(value: string) {
  const normalizedValue = normalizeApiBaseUrl(value)
  if (typeof window === 'undefined') {
    return normalizedValue
  }

  if (window.location.hostname === 'print.1to.top' && normalizedValue === 'https://api.print.1to.top') {
    return window.location.origin
  }

  return normalizedValue
}

function readDefaultApiBaseUrl() {
  const envValue = import.meta.env.VITE_API_BASE_URL
  if (typeof envValue === 'string' && envValue.trim()) {
    return preferSameOriginApiBaseUrl(envValue)
  }

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:18080'
    }
    return origin
  }

  return 'http://127.0.0.1:18080'
}

function readPersistedSession(): PersistedSession | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as PersistedSession
    if (!parsed.accessToken || !parsed.profile || !parsed.apiBaseUrl) {
      return null
    }
    parsed.apiBaseUrl = preferSameOriginApiBaseUrl(parsed.apiBaseUrl)
    return parsed
  } catch {
    return null
  }
}

function persistSession(session: PersistedSession | null) {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(readDefaultApiBaseUrl)
  const [userName, setUserName] = useState('admin_test')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState<PersistedSession | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [savingFields, setSavingFields] = useState(false)
  const [tableDraft, setTableDraft] = useState<TableDraftResponse | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null)
  const [runningPreflight, setRunningPreflight] = useState(false)
  const [activeStep, setActiveStep] = useState(1)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [fontStatus, setFontStatus] = useState<{ compatible: boolean; available: { name: string; resolved_to: string }[]; missing: { name: string; substitute: string }[]; template_fonts: string[] } | null>(null)
  const [checkingFonts, setCheckingFonts] = useState(false)
  const [uploadingFont, setUploadingFont] = useState(false)
  const [fontUploadMsg, setFontUploadMsg] = useState('')
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null)
  const [fieldPositions, setFieldPositions] = useState<FieldPosition[]>([])
  const [savingPositions, setSavingPositions] = useState(false)

  useEffect(() => {
    const persisted = readPersistedSession()
    if (!persisted) {
      return
    }
    setSession(persisted)
    setApiBaseUrl(persisted.apiBaseUrl)
  }, [])

  useEffect(() => {
    if (!session) {
      setTemplates([])
      setTemplatesError('')
      return
    }

    const activeSession = session

    let cancelled = false

    async function loadTemplates() {
      setTemplatesLoading(true)
      setTemplatesError('')
      try {
        const response = await fetch(`${activeSession.apiBaseUrl}/api/v1/templates`, {
          headers: {
            Authorization: `Bearer ${activeSession.accessToken}`,
          },
        })

        if (!response.ok) {
          throw new Error('模板列表读取失败，请确认登录状态和后端服务。')
        }

        const payload = (await response.json()) as { items: TemplateSummary[] }
        if (!cancelled) {
          setTemplates(payload.items)
        }
      } catch (error) {
        if (!cancelled) {
          setTemplatesError(error instanceof Error ? error.message : '模板列表读取失败。')
        }
      } finally {
        if (!cancelled) {
          setTemplatesLoading(false)
        }
      }
    }

    void loadTemplates()

    return () => {
      cancelled = true
    }
  }, [session])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage('')

    const normalizedApiBaseUrl = preferSameOriginApiBaseUrl(apiBaseUrl)

    try {
      const response = await fetch(`${normalizedApiBaseUrl}/api/v1/auth/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_name: userName.trim(),
          password,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null
        const detail = payload?.detail
        if (detail === 'invalid_credentials') {
          throw new Error('用户名或密码错误。')
        }
        if (detail === 'admin_inactive') {
          throw new Error('当前管理员账号已被停用。')
        }
        throw new Error('登录失败，请检查后端地址和服务状态。')
      }

      const payload = (await response.json()) as LoginResponse
      const nextSession: PersistedSession = {
        accessToken: payload.access_token,
        profile: payload.profile,
        apiBaseUrl: normalizedApiBaseUrl,
      }
      persistSession(nextSession)
      setSession(nextSession)
      setApiBaseUrl(normalizedApiBaseUrl)
      setPassword('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '登录失败，请稍后重试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleLogout() {
    persistSession(null)
    setSession(null)
    setPassword('')
    setErrorMessage('')
    setTemplateFile(null)
    setTemplateName('')
    setUploadMessage('')
  }

  async function refreshTemplates() {
    if (!session) {
      return
    }

    setTemplatesLoading(true)
    setTemplatesError('')
    try {
      const response = await fetch(`${session.apiBaseUrl}/api/v1/templates`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      })
      if (!response.ok) {
        throw new Error('模板列表刷新失败。')
      }
      const payload = (await response.json()) as { items: TemplateSummary[] }
      setTemplates(payload.items)
    } catch (error) {
      setTemplatesError(error instanceof Error ? error.message : '模板列表刷新失败。')
    } finally {
      setTemplatesLoading(false)
    }
  }

  async function handleTemplateUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) {
      return
    }
    if (!templateFile) {
      setUploadMessage('请选择要上传的模板文件。')
      return
    }

    setUploadingTemplate(true)
    setUploadMessage('')
    const formData = new FormData()
    formData.set('name', templateName.trim() || templateFile.name.replace(/\.[^.]+$/, ''))
    formData.set('file', templateFile)

    try {
      const response = await fetch(`${session.apiBaseUrl}/api/v1/templates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: formData,
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null
        if (payload?.detail === 'unsupported_template_type') {
          throw new Error('当前只支持上传 .docx、.html、.pdf 模板文件。')
        }
        if (payload?.detail === 'template_file_required') {
          throw new Error('后端未收到模板文件，请重新选择后上传。')
        }
        throw new Error('模板上传失败，请检查后端服务与管理员登录状态。')
      }

      setUploadMessage('模板上传成功，已写入云端模板列表。')
      setTemplateName('')
      setTemplateFile(null)
      await refreshTemplates()
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : '模板上传失败。')
    } finally {
      setUploadingTemplate(false)
    }
  }

  async function handleScanTemplate(templateId: string, versionId: string) {
    if (!session) return
    setScanning(true)
    setScanError('')
    try {
      const resp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${templateId}/scan-markers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (!resp.ok) {
        const payload = await resp.json().catch(() => null) as { detail?: string } | null
        throw new Error(payload?.detail || '扫描失败')
      }
      const result = (await resp.json()) as ScanResult
      setScanResult(result)
      const autoFields: FieldDefinition[] = result.editable_segments.map((seg) => ({
        segment_key: seg.segment_key,
        field_key: seg.segment_key,
        label: seg.text || seg.segment_key,
        value_type: 'string',
        required: false,
        binding_kind: 'text',
      }))
      setFields(autoFields)
      void handleFontCheck(templateId)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : '扫描失败')
    } finally {
      setScanning(false)
    }
  }

  async function handleSaveFields(versionId: string) {
    if (!session) return
    setSavingFields(true)
    try {
      await fetch(`${session.apiBaseUrl}/api/v1/templates/${versionId}/fields`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ fields }),
      })
    } finally {
      setSavingFields(false)
    }
  }

  async function handleSaveTableDraft(versionId: string, draft: { active_row_key: string | null; rows: TableDraftRow[] }) {
    if (!session) return
    setSavingDraft(true)
    try {
      const resp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${versionId}/table-draft`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(draft),
      })
      if (resp.ok) {
        const result = (await resp.json()) as TableDraftResponse
        setTableDraft(result)
      }
    } finally {
      setSavingDraft(false)
    }
  }

  async function loadPdfInfo(templateId: string) {
    if (!session) return
    try {
      const resp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${templateId}/pdf-info`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (resp.ok) setPdfInfo(await resp.json())
    } catch { /* ignore */ }
  }

  async function saveFieldPositions(templateId: string) {
    if (!session) return
    setSavingPositions(true)
    try {
      await fetch(`${session.apiBaseUrl}/api/v1/templates/${templateId}/field-positions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ positions: fieldPositions }),
      })
    } finally { setSavingPositions(false) }
  }

  async function handlePreflight(templateId: string) {
    if (!session) return
    setRunningPreflight(true)
    try {
      const resp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${templateId}/preflight`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (resp.ok) {
        setPreflightResult((await resp.json()) as PreflightResult)
      }
    } finally {
      setRunningPreflight(false)
    }
  }

  async function handleSelectTemplate(item: TemplateSummary) {
    setActiveTemplateId(item.id)
    setScanResult(null)
    setScanError('')
    setFields([])
    setTableDraft(null)
    setPreflightResult(null)
    setActiveStep(1)
    setPdfBlobUrl(null)
    setPdfError('')
    setFontStatus(null)
    setFontUploadMsg('')
    setPdfInfo(null)
    setFieldPositions([])

    if (!session) return

    try {
      const scanResp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${item.id}/scan-result`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (scanResp.ok) {
        const data = await scanResp.json()
        if (data.scanned) {
          setScanResult({
            template_id: data.template_id,
            template_version_id: data.template_version_id,
            editable_segments: data.editable_segments,
            text_blocks: data.text_blocks,
            found_placeholders: data.found_placeholders,
            found_regions: data.found_regions,
            issues: data.issues,
          })
          if (data.field_schema?.length) {
            setFields(data.field_schema as FieldDefinition[])
          }
          void handleFontCheck(item.id)
        }
      }

      const previewResp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${item.id}/preview`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (previewResp.ok) {
        const previewData = await previewResp.json()
        if (previewData.rows?.length || previewData.columns?.length) {
          setTableDraft(previewData as TableDraftResponse)
        }
      }

      if (item.source_type === 'pdf_template') {
        await loadPdfInfo(item.id)
      }
    } catch {
      // silently ignore — user can re-scan
    }
  }

  async function handleFontCheck(templateId: string) {
    if (!session) return
    setCheckingFonts(true)
    try {
      const resp = await fetch(`${session.apiBaseUrl}/api/v1/templates/${templateId}/font-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (resp.ok) {
        const data = await resp.json()
        setFontStatus(data)
      }
    } catch {
      // ignore
    } finally {
      setCheckingFonts(false)
    }
  }

  async function handleFontUpload(file: File) {
    if (!session) return
    setUploadingFont(true)
    setFontUploadMsg('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      let url = `${session.apiBaseUrl}/api/v1/system/fonts`
      if (activeTemplateId) {
        url += `?for_template_id=${encodeURIComponent(activeTemplateId)}`
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
        body: formData,
      })
      if (resp.ok) {
        const data = await resp.json()
        const aliases = data.aliases_created as Record<string, string> | undefined
        if (aliases && Object.keys(aliases).length > 0) {
          const mappings = Object.entries(aliases).map(([k, v]) => `${k} → ${v}`).join('、')
          setFontUploadMsg(`${file.name} 上传成功，已建立字体映射：${mappings}`)
        } else {
          setFontUploadMsg(`${file.name} 上传成功，字体族名：${(data.font_families as string[]).join(', ') || '未知'}`)
        }
        if (activeTemplateId) {
          await handleFontCheck(activeTemplateId)
        }
      } else {
        const payload = await resp.json().catch(() => null) as { detail?: string } | null
        setFontUploadMsg(payload?.detail === 'unsupported_font_format'
          ? '仅支持 .ttf、.otf、.ttc 字体文件'
          : '字体上传失败')
      }
    } catch {
      setFontUploadMsg('字体上传失败，请检查后端服务。')
    } finally {
      setUploadingFont(false)
    }
  }

  async function loadPdfPreview() {
    if (!session || !activeTemplateId) return
    setPdfLoading(true)
    setPdfError('')
    setPdfBlobUrl(null)
    try {
      const resp = await fetch(
        `${session.apiBaseUrl}/api/v1/templates/${activeTemplateId}/preview.pdf`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } },
      )
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => null)) as { detail?: string } | null
        if (detail?.detail === 'pdf_preview_unavailable') {
          setPdfError('当前服务器环境不支持 PDF 预览（需要 LibreOffice 或 Word）。')
        } else {
          setPdfError('PDF 预览加载失败。')
        }
        return
      }
      const blob = await resp.blob()
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(URL.createObjectURL(blob))
    } catch {
      setPdfError('PDF 预览加载失败，请确认后端服务正常。')
    } finally {
      setPdfLoading(false)
    }
  }

  function handleBackToList() {
    setActiveTemplateId(null)
    setScanResult(null)
    setScanError('')
    setFields([])
    setTableDraft(null)
    setPreflightResult(null)
    setActiveStep(1)
    setPdfBlobUrl(null)
    setPdfError('')
    setPdfInfo(null)
    setFieldPositions([])
  }

  const activeTemplate = templates.find((t) => t.id === activeTemplateId)

  const dashboard = session ? (
    <section className="dashboard-shell">
      <header className="topbar-card">
        <div>
          <p className="eyebrow">Cloud Print Platform</p>
          <h1>云端打印管理台</h1>
          <p className="lede">
            登录状态已经打通，下一步可以在这里继续接模板上传、模板配置、节点扫描和打印流程。
          </p>
        </div>
        <div className="topbar-actions">
          <div className="identity-chip">
            <span className="identity-label">当前管理员</span>
            <strong>{session.profile.nick_name || session.profile.user_name}</strong>
            <span className="identity-meta">{session.profile.user_name}</span>
          </div>
          <button type="button" className="ghost-button" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </header>

      <section className="grid-board">
        <article className="panel-card accent-card">
          <p className="panel-kicker">当前状态</p>
          <h2>Web 管理台入口已可用</h2>
          <ul className="status-list">
            <li>管理员登录已接入 backend 接口</li>
            <li>access token 已持久化到浏览器 localStorage</li>
            <li>页面刷新后会自动恢复最近一次登录态</li>
            <li>模板上传与模板列表最小链路已经接通</li>
          </ul>
        </article>

        <article className="panel-card">
          <p className="panel-kicker">后端连接</p>
          <dl className="detail-list">
            <div>
              <dt>API Base URL</dt>
              <dd>{session.apiBaseUrl}</dd>
            </div>
            <div>
              <dt>Token Scope</dt>
              <dd>admin</dd>
            </div>
            <div>
              <dt>管理员状态</dt>
              <dd>{session.profile.status}</dd>
            </div>
          </dl>
        </article>

        <article className="panel-card wide-card">
          <p className="panel-kicker">模板中心</p>
          <div className="template-workspace">
            <form className="upload-form" onSubmit={handleTemplateUpload}>
              <div className="field-group">
                <label htmlFor="template-name">模板名称</label>
                <input
                  id="template-name"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="例如：借据模板"
                />
              </div>

              <div className="field-group">
                <label htmlFor="template-file">模板文件</label>
                <input
                  id="template-file"
                  type="file"
                  accept=".docx,.html,.pdf"
                  onChange={(event) => setTemplateFile(event.target.files?.[0] ?? null)}
                />
              </div>

              <p className="upload-hint">当前最小支持格式：.docx、.html、.pdf</p>

              {uploadMessage ? <p className="info-banner">{uploadMessage}</p> : null}

              <button type="submit" className="primary-button" disabled={uploadingTemplate}>
                {uploadingTemplate ? '上传中...' : '上传模板'}
              </button>
            </form>

            <section className="template-list-panel">
              <div className="template-list-header">
                <div>
                  <h3>模板列表</h3>
                  <p>上传成功后，这里会立刻显示 backend 当前保存的模板记录。</p>
                </div>
                <button type="button" className="ghost-button" onClick={() => void refreshTemplates()}>
                  刷新列表
                </button>
              </div>

              {templatesError ? <p className="error-banner">{templatesError}</p> : null}

              {templatesLoading ? <p className="empty-state">正在读取模板列表...</p> : null}

              {!templatesLoading && templates.length === 0 ? (
                <p className="empty-state">当前还没有模板。先上传一个模板，确认 Web 到 backend 的业务链路已经打通。</p>
              ) : null}

              {templates.length > 0 ? (
                <div className="template-table-wrap">
                  <table className="template-table">
                    <thead>
                      <tr>
                        <th>模板名称</th>
                        <th>类型</th>
                        <th>状态</th>
                        <th>版本</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((item) => (
                        <tr
                          key={item.id}
                          className={activeTemplateId === item.id ? 'selected-row' : ''}
                          onClick={() => handleSelectTemplate(item)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <strong>{item.name}</strong>
                            <span className="table-subtext">{item.id}</span>
                          </td>
                          <td>{item.source_type}</td>
                          <td>{item.status}</td>
                          <td>v{item.version_no}</td>
                          <td>{new Date(item.updated_at).toLocaleString('zh-CN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </div>
        </article>

        {activeTemplate ? (
          <article className="panel-card wide-card">
            <div className="template-workspace-header">
              <div>
                <p className="panel-kicker">模板工作区</p>
                <h2>{activeTemplate.name}</h2>
              </div>
              <button type="button" className="ghost-button" onClick={handleBackToList}>← 返回列表</button>
            </div>

            <nav className="step-nav">
              <button className={activeStep === 1 ? 'active' : ''} onClick={() => setActiveStep(1)}>1. 扫描标记</button>
              <button className={activeStep === 2 ? 'active' : ''} onClick={() => setActiveStep(2)} disabled={!scanResult && activeTemplate?.source_type !== 'pdf_template'}>2. {activeTemplate?.source_type === 'pdf_template' ? '字段位置' : '字段定义'}</button>
              <button className={activeStep === 3 ? 'active' : ''} onClick={() => setActiveStep(3)} disabled={!scanResult && activeTemplate?.source_type !== 'pdf_template'}>3. 待打数据</button>
              <button className={activeStep === 4 ? 'active' : ''} onClick={() => setActiveStep(4)} disabled={!scanResult && activeTemplate?.source_type !== 'pdf_template'}>4. 打印预览</button>
            </nav>

            {activeStep === 1 && (
              <div className="stage-panel">
                {activeTemplate?.source_type === 'pdf_template' ? (
                  <>
                    <h3 style={{ margin: '0 0 4px' }}>PDF 模板信息</h3>
                    <p className="upload-hint">已上传排版好的 PDF 模板，云端将在指定位置叠印文字。</p>
                    {pdfInfo ? (
                      <div style={{ marginTop: 14 }}>
                        <div className="scan-stats">
                          <div className="scan-stat"><span className="scan-stat-num">{pdfInfo.page_count}</span><span className="scan-stat-label">页数</span></div>
                          {pdfInfo.pages.slice(0, 3).map(p => (
                            <div className="scan-stat" key={p.page}>
                              <span className="scan-stat-num" style={{ fontSize: 18 }}>{p.width_mm}×{p.height_mm}</span>
                              <span className="scan-stat-label">第{p.page + 1}页 (mm)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 16 }}>
                        <button type="button" className="primary-button"
                          onClick={() => loadPdfInfo(activeTemplate.id)}>
                          加载页面信息
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: '0 0 4px' }}>扫描标记</h3>
                    <p className="upload-hint">识别模板中的黄色高亮片段、占位符 [[field_key]] 和结构书签。</p>
                    {!scanResult ? (
                      <div style={{ marginTop: 16 }}>
                        <button type="button" className="primary-button" disabled={scanning}
                          onClick={() => handleScanTemplate(activeTemplate.id, activeTemplate.template_version_id)}>
                          {scanning ? '扫描中...' : '开始扫描'}
                        </button>
                        {scanError ? <p className="error-banner" style={{ marginTop: 10 }}>{scanError}</p> : null}
                      </div>
                    ) : (
                      <div style={{ marginTop: 16 }}>
                        <div className="scan-stats">
                          <div className="scan-stat"><span className="scan-stat-num">{scanResult.editable_segments.length}</span><span className="scan-stat-label">高亮片段</span></div>
                          <div className="scan-stat"><span className="scan-stat-num">{scanResult.found_placeholders.length}</span><span className="scan-stat-label">占位符</span></div>
                          <div className="scan-stat"><span className="scan-stat-num">{scanResult.found_regions.length}</span><span className="scan-stat-label">结构书签</span></div>
                          <div className={`scan-stat ${scanResult.issues.filter(i => i.severity === 'error').length > 0 ? 'warn' : ''}`}>
                            <span className="scan-stat-num">{scanResult.issues.length}</span><span className="scan-stat-label">问题</span>
                          </div>
                        </div>
                        {scanResult.issues.length > 0 && (
                          <details style={{ marginTop: 10 }}>
                            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)' }}>查看问题详情</summary>
                            <ul className="issues-list">
                              {scanResult.issues.map((iss, idx) => (
                                <li key={idx} className={iss.severity === 'error' ? 'err' : 'warn'}>[{iss.severity}] {iss.message}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )}
                  </>
                )}
                {fontStatus && (
                  <div style={{ marginTop: 14, padding: 16, borderRadius: 10, border: '1px solid #e2e0db', background: '#fafaf9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                        {fontStatus.compatible ? '✓ 字体检查通过' : '⚠ 字体兼容性'}
                      </p>
                      <button type="button" className="ghost-button" style={{ fontSize: 12, height: 32 }}
                        onClick={() => activeTemplateId && handleFontCheck(activeTemplateId)}>
                        {checkingFonts ? '检查中...' : '重新检查'}
                      </button>
                    </div>
                    {fontStatus.available.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, fontSize: 12 }}>
                        <tbody>
                          {fontStatus.available.map(f => (
                            <tr key={f.name}><td style={{ padding: '3px 8px', color: '#1b7a3d' }}>✓</td><td style={{ padding: '3px 0', fontWeight: 500 }}>{f.name}</td><td style={{ padding: '3px 8px', color: '#8894aa' }}>→ {f.resolved_to}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {fontStatus.missing.length > 0 && (
                      <>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10, fontSize: 12 }}>
                          <tbody>
                            {fontStatus.missing.map(f => (
                              <tr key={f.name} style={{ borderBottom: '1px solid #efede8' }}><td style={{ padding: '3px 8px', color: '#c62828' }}>✗</td><td style={{ padding: '3px 0', fontWeight: 500 }}>{f.name}</td><td style={{ padding: '3px 8px', color: '#8894aa' }}>→ {f.substitute}</td></tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <label className="ghost-button" style={{ fontSize: 12, height: 34, cursor: 'pointer', display: 'inline-flex' }}>
                            {uploadingFont ? '上传中...' : '上传字体 (.ttf/.otf)'}
                            <input type="file" accept=".ttf,.otf,.ttc" style={{ display: 'none' }}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleFontUpload(f) }} disabled={uploadingFont} />
                          </label>
                        </div>
                      </>
                    )}
                    {fontUploadMsg && (
                      <p className={fontUploadMsg.includes('成功') ? 'success-banner' : 'error-banner'} style={{ marginTop: 8 }}>{fontUploadMsg}</p>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  <button type="button" className="primary-button" onClick={() => setActiveStep(2)}>下一步：字段定义 →</button>
                </div>
              </div>
            )}

            {activeStep === 2 && (scanResult || activeTemplate?.source_type === 'pdf_template') && (
              <div className="stage-panel">
                {activeTemplate?.source_type === 'pdf_template' ? (
                  <>
                    <h3 style={{ margin: '0 0 4px' }}>字段位置</h3>
                    <p className="upload-hint">定义每个字段在 PDF 页面上的叠印位置（单位：点 pt，1pt ≈ 0.353mm）。Y 坐标从页面底部算起。</p>
                    <table className="draft-table" style={{ marginTop: 8 }}>
                      <thead><tr>
                        <th>field_key</th><th>标签</th><th>页</th><th>X</th><th>Y</th><th>字号</th><th>字体</th><th>对齐</th>
                      </tr></thead>
                      <tbody>
                        {fieldPositions.map((fp, idx) => (
                          <tr key={fp.field_key || idx}>
                            <td><input className="cell-input" value={fp.field_key} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], field_key: e.target.value}; setFieldPositions(n)
                            }} /></td>
                            <td><input className="cell-input" value={fp.label} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], label: e.target.value}; setFieldPositions(n)
                            }} /></td>
                            <td><input className="cell-input cell-narrow" type="number" min={0} value={fp.page} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], page: parseInt(e.target.value)||0}; setFieldPositions(n)
                            }} /></td>
                            <td><input className="cell-input cell-narrow" type="number" value={fp.x} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], x: parseFloat(e.target.value)||0}; setFieldPositions(n)
                            }} /></td>
                            <td><input className="cell-input cell-narrow" type="number" value={fp.y} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], y: parseFloat(e.target.value)||0}; setFieldPositions(n)
                            }} /></td>
                            <td><input className="cell-input cell-narrow" type="number" min={6} max={72} value={fp.font_size} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], font_size: parseInt(e.target.value)||12}; setFieldPositions(n)
                            }} /></td>
                            <td><input className="cell-input" value={fp.font_name} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], font_name: e.target.value}; setFieldPositions(n)
                            }} placeholder="楷体" /></td>
                            <td><select className="compact-select" value={fp.align} onChange={e => {
                              const n = [...fieldPositions]; n[idx] = {...n[idx], align: e.target.value}; setFieldPositions(n)
                            }}><option value="left">left</option><option value="center">center</option><option value="right">right</option></select></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="draft-actions">
                      <button type="button" className="ghost-button" onClick={() => setFieldPositions([...fieldPositions, { field_key: '', label: '', page: 0, x: 100, y: 100, width: 0, font_name: '', font_size: 12, align: 'left' }])}>+ 添加字段</button>
                      <button type="button" className="primary-button" disabled={savingPositions} onClick={() => { saveFieldPositions(activeTemplate.id); setActiveStep(3) }}>{savingPositions ? '保存中...' : '保存并继续'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: '0 0 4px' }}>字段定义</h3>
                <p className="upload-hint">每个黄色高亮片段对应一个字段。请设置 field_key（小写 snake_case）和中文标签。</p>
                <div className="field-editor-header">
                  <span>片段</span><span>field_key</span><span>标签</span><span>类型</span>
                </div>
                {fields.map((fd, idx) => (
                  <div key={fd.segment_key || idx} className="field-row">
                    <span className="seg-key">{fd.segment_key}</span>
                    <input value={fd.field_key}
                      onChange={e => { const n = [...fields]; n[idx] = {...n[idx], field_key: e.target.value}; setFields(n) }}
                      placeholder="field_key" />
                    <input value={fd.label}
                      onChange={e => { const n = [...fields]; n[idx] = {...n[idx], label: e.target.value}; setFields(n) }}
                      placeholder="字段标签" />
                    <select value={fd.value_type}
                      onChange={e => { const n = [...fields]; n[idx] = {...n[idx], value_type: e.target.value}; setFields(n) }}>
                      <option value="string">string</option>
                      <option value="integer">integer</option>
                      <option value="decimal">decimal</option>
                      <option value="date">date</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </div>
                ))}
                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                  <button type="button" className="primary-button" disabled={savingFields}
                    onClick={() => { handleSaveFields(activeTemplate.template_version_id); setActiveStep(3) }}>
                    {savingFields ? '保存中...' : '保存并继续'}
                  </button>
                  <button type="button" className="ghost-button" disabled={runningPreflight}
                    onClick={() => handlePreflight(activeTemplate.id)}>
                    {runningPreflight ? '预检中...' : '发布预检'}
                  </button>
                </div>
                {preflightResult && (
                  <div className={`preflight-result ${preflightResult.passed ? 'pass' : 'fail'}`}>
                    {preflightResult.passed ? '✓ 预检通过' : `✗ ${preflightResult.issues.length} 个问题待解决`}
                  </div>
                )}
                </>
              )}
              </div>
            )}

            {activeStep === 3 && (scanResult || activeTemplate?.source_type === 'pdf_template') && (
              <div className="stage-panel">
                <h3 style={{ margin: '0 0 4px' }}>待打数据</h3>
                <p className="upload-hint">填写需要批量打印的数据行。点击「保存并预览」查看实际排版效果。</p>
                {fields.length > 0 ? (
                  <>
                    <div className="draft-table-wrap">
                      <table className="draft-table">
                        <thead><tr>
                          {fields.map(fd => <th key={fd.field_key}>{fd.label || fd.field_key}</th>)}
                          <th style={{ width: 68, textAlign: 'center' }}>份数</th>
                        </tr></thead>
                        <tbody>
                          {(tableDraft?.rows?.length ? tableDraft.rows : [{ row_key: 'draft_001', cells: {}, print_config: { printer_id: null, copies: 1, operator_name: null } }] as TableDraftRow[]).map((row, ri) => (
                            <tr key={row.row_key}>
                              {fields.map(fd => (
                                <td key={fd.field_key}>
                                  <input className="cell-input" value={row.cells[fd.field_key] || ''}
                                    onChange={e => {
                                      const rows = [...(tableDraft?.rows?.length ? tableDraft.rows : [{ row_key: 'draft_001', cells: {}, print_config: { printer_id: null, copies: 1, operator_name: null } }])] as TableDraftRow[]
                                      rows[ri] = { ...rows[ri], cells: { ...rows[ri].cells, [fd.field_key]: e.target.value } }
                                      setTableDraft(prev => ({ ...prev!, active_row_key: rows[rows.length-1]?.row_key || null, rows } as TableDraftResponse))
                                    }} />
                                </td>
                              ))}
                              <td>
                                <input className="cell-input cell-narrow" type="number" min={1}
                                  value={row.print_config?.copies || 1}
                                  onChange={e => {
                                    const rows = [...(tableDraft?.rows?.length ? tableDraft.rows : [{ row_key: 'draft_001', cells: {}, print_config: { printer_id: null, copies: 1, operator_name: null } }])] as TableDraftRow[]
                                    rows[ri] = { ...rows[ri], print_config: { ...rows[ri].print_config, copies: parseInt(e.target.value) || 1 } }
                                    setTableDraft(prev => ({ ...prev!, active_row_key: rows[rows.length-1]?.row_key || null, rows } as TableDraftResponse))
                                  }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="draft-actions">
                      <button type="button" className="ghost-button"
                        onClick={() => {
                          const rows = [...(tableDraft?.rows || [])] as TableDraftRow[]
                          const n = String(rows.length + 1).padStart(3, '0')
                          rows.push({ row_key: `draft_${n}`, cells: {}, print_config: { printer_id: null, copies: 1, operator_name: null } })
                          setTableDraft(prev => ({ ...prev!, active_row_key: `draft_${n}`, rows } as TableDraftResponse))
                        }}>+ 添加行</button>
                      <button type="button" className="primary-button" disabled={savingDraft}
                        onClick={() => {
                          const rows = tableDraft?.rows || []
                          if (!rows.length) return
                          handleSaveTableDraft(activeTemplate.template_version_id, { active_row_key: tableDraft?.active_row_key || rows[0].row_key, rows })
                          setActiveStep(4)
                          void loadPdfPreview()
                        }}>{savingDraft ? '保存中...' : '保存并预览'}</button>
                    </div>
                  </>
                ) : <p className="empty-state">请先扫描模板并保存字段定义。</p>}
              </div>
            )}

            {activeStep === 4 && (scanResult || activeTemplate?.source_type === 'pdf_template') && (
              <div className="stage-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>打印预览</h3>
                  <button type="button" className="ghost-button" disabled={pdfLoading}
                    onClick={() => { void loadPdfPreview() }}>刷新预览</button>
                </div>
                {pdfLoading ? (
                  <p className="empty-state" style={{ padding: 40, textAlign: 'center' }}>正在生成 PDF 预览...</p>
                ) : pdfError ? (
                  <div>
                    <p className="error-banner">{pdfError}</p>
                    {tableDraft?.preview?.blocks && tableDraft.preview.blocks.length > 0 && (
                      <details style={{ marginTop: 14 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)' }}>文字对照</summary>
                        <div className="preview-fallback" style={{ marginTop: 8 }}>
                          {tableDraft.preview.blocks.map(blk => (
                            <p key={blk.block_key} style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>
                              {blk.runs.map((run, ri) => (
                                <span key={ri} className={run.editable ? 'preview-editable' : ''} title={run.field_key}>{run.text}</span>
                              ))}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ) : pdfBlobUrl ? (
                  <div className="preview-pdf-container">
                    <iframe src={pdfBlobUrl} title="PDF 预览" />
                  </div>
                ) : null}
              </div>
            )}
          </article>
        ) : null}
      </section>
    </section>
  ) : (
    <section className="login-layout">
      <div className="intro-panel">
        <p className="eyebrow">Cloud Print Platform</p>
        <h1>云端打印管理台登录</h1>
        <p className="lede">
          先把管理员登录入口接通，确认 Web 管理台可以稳定进入，再继续做模板上传、配置和打印主链路。
        </p>
        <div className="hint-card">
          <strong>当前验证目标</strong>
          <ul className="status-list compact-list">
            <li>管理员账号密码登录</li>
            <li>登录态持久化</li>
            <li>刷新后自动恢复管理台入口</li>
            <li>登录后直接测试模板上传与模板列表</li>
          </ul>
        </div>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <div className="field-group">
          <label htmlFor="api-base-url">后端地址</label>
          <input
            id="api-base-url"
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrl(event.target.value)}
            placeholder="http://127.0.0.1:18080"
            autoComplete="url"
          />
        </div>

        <div className="field-group">
          <label htmlFor="user-name">管理员账号</label>
          <input
            id="user-name"
            value={userName}
            onChange={(event) => setUserName(event.target.value)}
            placeholder="admin_test"
            autoComplete="username"
          />
        </div>

        <div className="field-group">
          <label htmlFor="password">密码</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入管理员密码"
            autoComplete="current-password"
          />
        </div>

        <p className="upload-hint">默认测试管理员示例：admin_test / Test123456!</p>

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? '登录中...' : '进入管理台'}
        </button>
      </form>
    </section>
  )

  return (
    <main className="app-shell">
      {dashboard}
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
