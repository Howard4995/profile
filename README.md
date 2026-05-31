# Profile / 個人頁面

## English

### Overview
This repository hosts a personal profile + journal site on Cloudflare Workers. Static assets live in `public/`, and the Worker in `src/index.js` serves API routes that read from Notion.

### Tech implementation
- **Runtime**: Cloudflare Workers configured by `wrangler.jsonc` with an `ASSETS` binding for static files.
- **Frontend**: Single-page HTML/CSS/JavaScript in `public/index.html` (no build step).
- **Backend**: Worker fetches Notion database entries and converts Notion blocks into HTML for journal detail pages.
- **Client rendering**: The browser requests `/api/journal` for metadata and `/api/journal/:id` for HTML content, then sanitizes and renders the response.

### Repository layout
- `public/`: Static assets and the UI.
- `src/index.js`: Worker router + Notion integration.
- `functions/api/`: Cloudflare Pages Functions equivalents of the journal APIs (optional if deploying with Pages).

### API
- `GET /api/journal`
  - Returns `{ entries: [...] }` with title, date, mood, energy, tags.
- `GET /api/journal/:id`
  - Returns `text/html` for the entry’s Notion blocks.
- `OPTIONS` is supported for CORS preflight.

### Notion database requirements
The Notion database is expected to contain these properties:
- `標題` (title)
- `日期` (date)
- `Mood` (select)
- `Energy` (select)
- `Tags` (multi-select)

Default Notion API version: `2022-06-28`.

### Environment variables
| Name | Required | Description |
| --- | --- | --- |
| `NOTION_TOKEN` | Yes | Notion integration token. |
| `NOTION_DB_ID` | Yes | Target Notion database ID. |
| `NOTION_VERSION` | No | Overrides the Notion API version. |
| `ALLOWED_ORIGIN` | No | CORS allowlist origin (defaults to `*`). |

### Development / deployment
```bash
npx wrangler dev
npx wrangler deploy
```

Validation (dry run):
```bash
npx wrangler deploy --dry-run
```

---

## 中文

### 簡介
此專案是一個部署在 Cloudflare Workers 的個人頁面＋日誌站點。靜態檔案位於 `public/`，`src/index.js` 中的 Worker 提供讀取 Notion 的 API。

### 技術實作
- **執行環境**：使用 `wrangler.jsonc` 設定 Cloudflare Workers，並透過 `ASSETS` 綁定提供靜態資源。
- **前端**：`public/index.html` 內建 HTML/CSS/JavaScript，無需建置流程。
- **後端**：Worker 向 Notion API 查詢資料庫，並把 Notion block 轉為 HTML。
- **前端渲染**：瀏覽器呼叫 `/api/journal` 取得列表，再呼叫 `/api/journal/:id` 取得 HTML，最後在前端做清理與渲染。

### 專案結構
- `public/`：前端介面與靜態資源。
- `src/index.js`：Worker 路由與 Notion 整合。
- `functions/api/`：Cloudflare Pages Functions 的 API 對應版本（如使用 Pages 部署可參考）。

### API
- `GET /api/journal`
  - 回傳 `{ entries: [...] }`，包含標題、日期、情緒、能量與標籤。
- `GET /api/journal/:id`
  - 回傳日誌內容的 `text/html`。
- `OPTIONS` 支援 CORS preflight。

### Notion 資料庫欄位需求
Notion 資料庫需包含以下欄位：
- `標題`
- `日期`
- `Mood`
- `Energy`
- `Tags`

預設 Notion API 版本：`2022-06-28`。

### 環境變數
| 名稱 | 必填 | 說明 |
| --- | --- | --- |
| `NOTION_TOKEN` | 是 | Notion integration token。 |
| `NOTION_DB_ID` | 是 | Notion 資料庫 ID。 |
| `NOTION_VERSION` | 否 | 覆寫 Notion API 版本。 |
| `ALLOWED_ORIGIN` | 否 | CORS 允許來源（預設 `*`）。 |

### 開發 / 部署
```bash
npx wrangler dev
npx wrangler deploy
```

驗證（dry run）：
```bash
npx wrangler deploy --dry-run
```
