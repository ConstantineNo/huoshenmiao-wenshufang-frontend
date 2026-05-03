import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Cloud Print Platform</p>
        <h1>云端打印平台前端已初始化</h1>
        <p>
          下一步在这里实现模板管理、打印任务发起、节点选择和任务进度查看。
        </p>
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
