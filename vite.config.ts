import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
// GitHub Pages：项目页在 /<仓库名>/ 下；本地开发仍用 "/"，避免必须访问 /racetimer/
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/racetimer/' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
}))
