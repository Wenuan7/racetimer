import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type S = { hasError: boolean; message: string }

const STORAGE_KEY = 'kart-endurance-mvp-state'

export class ErrorBoundary extends Component<Props, S> {
  state: S = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): S {
    return { hasError: true, message: error.message || String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  clearAndReload = () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h1>页面加载失败</h1>
          <p className="error-msg">{this.state.message}</p>
          <p className="error-hint">
            若你部署在 GitHub Pages，请尝试：强制刷新 (Ctrl+F5)、在开发者工具 Application 里注销
            Service Worker 并清除站点数据；或点击下方按钮清除本应用本地数据。
          </p>
          <button type="button" className="error-btn" onClick={this.clearAndReload}>
            清除本地数据并重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
