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

const SESSION_STORAGE_KEY = 'cloud-print-web/admin-session'

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function readDefaultApiBaseUrl() {
  const envValue = import.meta.env.VITE_API_BASE_URL
  if (typeof envValue === 'string' && envValue.trim()) {
    return normalizeApiBaseUrl(envValue)
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
  const [userName, setUserName] = useState('admin')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState<PersistedSession | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const persisted = readPersistedSession()
    if (!persisted) {
      return
    }
    setSession(persisted)
    setApiBaseUrl(persisted.apiBaseUrl)
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage('')

    const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl)

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
  }

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
          <p className="panel-kicker">下一批接入项</p>
          <div className="roadmap-grid">
            <section>
              <h3>模板中心</h3>
              <p>上传模板、触发扫描、保存字段配置、发布模板版本。</p>
            </section>
            <section>
              <h3>边缘节点</h3>
              <p>查看在线打印端、拉取打印机目录、确认节点状态。</p>
            </section>
            <section>
              <h3>打印任务</h3>
              <p>基于已发布模板发起打印，并跟踪任务状态。</p>
            </section>
          </div>
        </article>
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
            placeholder="admin"
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
