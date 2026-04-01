export const APP_AUTH_SESSION_KEY = 'kart-endurance-mvp-auth'

export const APP_ACCESS_PASSWORD = 'tfgnb'

export function readAuthSession(): boolean {
  try {
    return sessionStorage.getItem(APP_AUTH_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAuthSession(): void {
  try {
    sessionStorage.setItem(APP_AUTH_SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}
