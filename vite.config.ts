/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// 【公開ルール】本番ビルドの base は相対パス './' に統一する（docs/deploy.md 参照）。
// 相対にすると、GitHub Pages（/<repo>/ 配下）でも Vercel等（ルート直下）でも、
// リポ名を書き換えずに同じ設定で動く。※画面ごとにURLを分けるルーティング未使用が前提。
// 開発サーバ(dev)は '/' のままにしておく。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
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
