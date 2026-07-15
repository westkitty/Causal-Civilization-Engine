import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'tests/e2e'],
  }
})
