import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// GitHub Pages：项目页在 /<仓库名>/ 下；本地开发仍用 "/"，避免必须访问 /racetimer/
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/racetimer/' : '/',
  plugins: [react()],
}))
