/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// GitHub Pages は https://<user>.github.io/<repo>/ のサブパス配信になるため、
// 本番ビルドだけ base を '/values-derby/' にする（開発サーバは '/' のまま）。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/values-derby/' : '/',
  plugins: [react(), tailwindcss()],
  build: {
    // 本番ビルドにソースマップを出さない（元コードを辿られにくくする）。Vite既定もoffだが意図を明示。
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
}))
