# 公開ルール（デプロイ規約）— 個人プロジェクト共通

pokechan / values-derby など、自作の静的Webアプリを **同じ手順で無料公開**するための決めごと。
毎回悩まないための「自分ルール」。新しいアプリもこの通りにやれば公開できる。

> 対象: サーバー不要の静的SPA（Vite + React 等）。画面ごとにURLを分ける機能
> （クライアントサイド・ルーティング）を使わない素朴な作りを前提とする。

---

## 決めごと（要点）

| # | ルール | 理由 |
|---|--------|------|
| ① | 配信先は **GitHub Pages** 1つに統一 | 無料・全部GitHubで完結・複数アプリで手順が揃う |
| ② | リポジトリは **Public** | 無料Pagesの条件。※クライアントに秘密（APIキー等）を置かない |
| ③ | 公開は **GitHub Actions** で push→test→build→deploy（自動） | pushするだけ。テスト通過が公開の条件＝安全網 |
| ④ | Vite `base` は本番のみ **相対 `./`** | リポ名に依存せず、どのプロジェクトも同じ設定で使い回せる |
| ⑤ | `.gitignore` に **CLAUDE.md / ローカル設定 / 巨大素材** | 公開リポに私物・不要物を載せない |
| ⑥ | 本番 **ソースマップOFF** | 元コードを辿られにくくする（Vite既定もoff、明示する） |
| ⑦ | 公開後チェック: **トップ200 / JS200 / .map404** | 実際に配信され、元コードが露出していないことの確認 |

---

## 手順（新しいアプリを公開するとき）

### 1. Vite 設定（`vite.config.ts`）
```ts
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/', // ← ④ 相対パス。dev は '/'
  build: { sourcemap: false },            // ← ⑥ 本番ソースマップOFF
  // plugins など…
}))
```

### 2. `.gitignore` に追記（⑤）
```
CLAUDE.md
.claude/
.playwright-mcp/
# 巨大な素材など公開不要物があれば追記
```

### 3. Pages公開ワークフロー（`.github/workflows/deploy.yml`）
`values-derby` の同ファイルをそのままコピーでよい。中身:
push(main) で `npm ci → npm run test:run → npm run build → Pagesへdeploy`。
（`permissions: pages: write / id-token: write` と `path: dist` が肝）

### 4. GitHub に上げて公開（外部操作＝実行前に本人確認）
```bash
git init -b main                     # 未初期化なら
git add -A && git commit -m "初回"
gh repo create <name> --public --source=. --remote=origin --push
gh api -X POST repos/<user>/<name>/pages -f build_type=workflow   # Pages有効化(source=Actions)
```
> すでにPrivateで作ってしまったら:
> `gh repo edit <user>/<name> --visibility public --accept-visibility-change-consequences`

### 5. 公開URL
```
https://<user>.github.io/<name>/
```
push するたびに Actions が自動で再公開（数分）。**GitHubにpushするだけ**でよく、
配信サービスへ個別にpushする必要はない。

### 6. 公開後チェック（⑦）
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<user>.github.io/<name>/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<user>.github.io/<name>/assets/<...>.js      # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<user>.github.io/<name>/assets/<...>.js.map  # 404
```

### 7. スマホで“アプリのように”開く
`index.html` に下記を入れておくと、ホーム画面追加で全画面起動になる:
```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#4f46e5" />
<link rel="apple-touch-icon" href="/favicon.svg" />
```
- iPhone(Safari): 共有 → ホーム画面に追加
- Android(Chrome): ⋮ → ホーム画面に追加 / インストール

---

## 例外・注意
- **ルーティングを足すなら** `base: './'` をやめ `base: '/<repo>/'`（明示）に戻す。相対パスは深い階層のURLで崩れることがあるため。
- **独自ドメイン**（`○○.com`）を付けると `base: '/'` で運用でき、より一般的な形になる（任意・有料）。
- Pages は「URLを知る人は誰でも開ける」。本当に限定したいなら別の認証が必要（Phase外）。

---

## このリポ(values-derby)の実際
- 公開URL: https://babadocomodake.github.io/values-derby/
- 設定: base `./`（相対）/ ソースマップOFF / Actions自動デプロイ。
- 相対パスにしたので Vercel(`values-derby.vercel.app`)でも動くが、**本命はGitHub Pages**。
