import { type FormEvent, type ReactNode, useState } from 'react'
import { APP_ACCESS_PASSWORD, readAuthSession, writeAuthSession } from './auth'

type LoginGateProps = {
  children: ReactNode
}

export default function LoginGate({ children }: LoginGateProps) {
  const [unlocked, setUnlocked] = useState(readAuthSession)
  const [password, setPassword] = useState('')
  const [showError, setShowError] = useState(false)

  if (unlocked) {
    return <>{children}</>
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (password === APP_ACCESS_PASSWORD) {
      writeAuthSession()
      setShowError(false)
      setUnlocked(true)
      setPassword('')
    } else {
      setShowError(true)
      setPassword('')
    }
  }

  return (
    <div className="app-shell login-gate-shell">
      <div className="login-gate-center">
        <div className="login-gate-card card">
          <div className="manage-brand login-gate-brand">
            <h1 className="brand-title">TFG RaceTimer</h1>
            <p className="brand-sub">请输入密码以继续</p>
          </div>
          <form className="login-gate-form" onSubmit={handleSubmit}>
            <label className="login-gate-label">
              密码
              <input
                className="login-gate-input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => {
                  setPassword(ev.target.value)
                  setShowError(false)
                }}
                placeholder="密码"
              />
            </label>
            {showError ? <p className="login-gate-error">密码错误</p> : null}
            <button type="submit" className="btn-primary login-gate-submit">
              进入
            </button>
          </form>
        </div>
      </div>
      <p className="login-gate-version">TFG RaceTimer v1</p>
    </div>
  )
}
