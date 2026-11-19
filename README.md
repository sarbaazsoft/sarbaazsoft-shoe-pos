# SarbaazSoft Shoe POS

> **Enterprise Multi-Tenant Dual-Engine Wholesale & Retail Footwear POS & Inventory Management SaaS**  
> Engineered for counter speed, offline resilience, direct thermal printing, multi-store isolation, and dynamic SaaS subscription activations.

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (PostgreSQL & JWT)
cp .env.example .env

# 3. Start full-stack development server (Express API + Vite SPA)
npm run dev

# 4. Verify TypeScript & lint rules (strict 0-error policy)
npm run lint

# 5. Build for production deployment
npm run build
```

The unified full-stack server listens on `http://0.0.0.0:3000`.

---

## ⚠️ AI Studio Rules & Development Directives

All engineers, contributors, and automated agents working in this repository must strictly adhere to the following directives:

### 1. Unified Single-Process Architecture
- The entire application runs as a **single full-stack process** on port `3000`.
- The entry point is `server.ts`, which runs Express with `vite.middlewares` mounted in development (`"dev": "tsx server.ts"`).
- In production, `"start": "node server.ts"` serves pre-built static assets from `/dist` while hosting all `/api/*` endpoints.
- **Never** mount Express inside `vite.config.ts`.
- **Never** change the server port from `3000`.

### 2. Pure Dynamic Origin Detection (No Hardcoded URLs)
- The application **dynamically resolves its base domain, protocol, and port** on every incoming request using `req.headers.origin`, `x-forwarded-proto`, and `x-forwarded-host`.
- Global base URL recording in `server.ts` guarantees that welcome notifications, direct portal links (`?tenantId=<storeId>`), and password reset links work seamlessly across local development, AI Studio previews, and custom production domains.
- **Do not configure or rely on `APP_URL` in `.env`**.

### 3. Database-Managed Email & Application Settings
- **Never put email API keys or SMTP secrets into `.env`.**
- Transactional email credentials (`RESEND_API_KEY`, `GMAIL_APP_PASSWORD`, `GMAIL_USER`, `GMAIL_FROM_NAME`) are strictly stored in the PostgreSQL `app_setting` database table with encryption for sensitive keys.
- Configuration and provider selection (Resend vs. Gmail SMTP) are managed dynamically through **SuperAdmin &rarr; Settings &rarr; Email Settings**.

### 4. Zero Regressions & Strict TypeScript Verification
- Always maintain **0 compiler errors and 0 lint warnings** (`npm run lint` / `tsc --noEmit`).
- When modifying backend routes, utility helpers, or types, systematically update:
  - Frontend client methods (`src/services/api.ts`).
  - Shared TypeScript interfaces (`src/types.ts`).
  - Related state hooks and component consumers.

### 5. Invoice Print Purity
- Printed invoices and the Print Preview modal must contain **only clean transactional data** (store header, customer details, line items, subtotals, khata balances, payment breakdown).
- **Application branding and SaaS footer credits** (`Powered by SarbaazSoft Shoe POS • © 2026 All rights reserved.`) are strictly stripped from all print and PDF outputs while remaining visible on web pages.

---

## 🏗️ Core Architecture & Tech Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Motion, jsPDF | High-density counter POS UI, modals, analytics, client PDF export, responsive design |
| **Backend** | Node.js (v22+ ESM / `node server.ts` in prod, `tsx` in dev), Express | Multi-tenant REST API, SSE streaming, authentication, HTML email receipt templates |
| **Database** | PostgreSQL (`pg` connection pool) | Relational tenant isolation, footwear catalog, inventory, ledger, SaaS control plane |
| **Build & Dev** | Vite 8, TypeScript 7 | Development middleware (`vite.middlewares`) and production bundling (`vite build`) |
| **Hardware** | WebUSB API, TSPL, ESC/POS | Direct thermal receipt and barcode label printing without external drivers |
| **Offline** | IndexedDB, Service Worker, LocalStorage | Full POS checkout and stock deduction when internet connectivity drops |

---

## 🚀 Key Modules & Feature Highlights

### 1. Multi-Tenant SaaS Control Plane
- **Tenant Isolation:** Stores are isolated via PostgreSQL `tenant_id` foreign keys and URL resolution (`?tenantId=<id>`).
- **Dynamic Store PWA Manifests:** `/api/pwa/manifest.webmanifest` generates per-store and SuperAdmin names, icons, and standalone launcher shortcuts.
- **30-Day Free Trial Activations:** Instant store onboarding with automatic 30-day trial creation, staff account provisioning, and welcome email dispatch.
- **Subscription Tracking:** SuperAdmin overview for active, expiring, expired, and suspended stores with one-click trial extensions.

### 2. POS Terminal & Fast Barcode Scanning
- **Optimized for Hardware Scanners:** Instant barcode input recognition with audio scanner feedback (Honeywell / Zebra laser chimes).
- **Code-128 Standardization:** Store barcodes follow the compact Code-128 formula: `[CategoryPrefix]-[ExactStoreId]` (e.g., `MN-01`, `SN-9`, `TD-12`).
- **Manufacturer Box Override:** Supports scanning box barcodes (13-digit EAN-13, 12-digit UPC-A, 8-digit EAN-8) without ID collisions.
- **Floor Price Guard:** Prevents selling below store-configured minimum floor prices unless explicitly authorized by store management.

### 3. Retail & Wholesale Footwear Operations
- **Dual Business Models:** Supports individual pair retail checkout as well as wholesale carton operations (12 or 16 pairs/carton).
- **Half-Carton Logic:** Product-level and store-level overrides for wholesale partial-box selling.
- **Customer Khata (Ledger):** Tracks customer credit limits, previous balances, partial cash payments, and running ledger records.

### 4. Thermal Printing & Hardware Manager
- **ESC/POS Receipts:** Formatted for 50mm, 58mm, and 80mm thermal receipt rolls with automatic paper cut and cash drawer kick pulses.
- **TSPL Barcode Stickers:** Vector-rendered barcode stickers in 50&times;30mm, 40&times;25mm, 60&times;40mm, and A4 24-up sheet formats.
- **Side-Box Shelf Labels:** 3"&times;4" (76&times;102mm) industrial shelf labels with rack storage write-in boxes for shoe size and color.
- **Hardware Integration Modes:** Direct WebUSB, Local Print Agent (`localhost:9100`), or System Print dialog fallback.

### 5. Offline-First Resilience
- **Local IndexedDB Catalog:** Synchronizes footwear catalog locally with tenant-scoped indexing.
- **Optimistic Stock Deduction:** Deducts stock immediately in browser storage during offline billing.
- **Background Sync Queue:** Automatically replays queued sales, customer ledger updates, and stock adjustments when internet connectivity returns.

### 6. Three-Way Theme Engine
- **Themes:** `light`, `dark` (deep purple-indigo gradient), and `system` (real-time OS `prefers-color-scheme` synchronization).
- **State Persistence:** Stored in `localStorage('pos_theme')` with smooth CSS cross-fade transitions and no theme flicker.

---

## 📁 Repository Structure

```
.
├── server.ts                       # Unified Node.js + Express entry point (vite.middlewares in dev, /dist in prod)
├── index.html                      # HTML5 entry with synced metadata
├── metadata.json                   # AI Studio applet capabilities and permissions
├── package.json                    # Project dependencies and npm scripts
├── .env.example                    # Environment variable template (DATABASE_URL, JWT_SECRET)
│
├── src/
│   ├── main.tsx                    # React client entry point
│   ├── App.tsx                     # Top-level routing & role-based view orchestration
│   ├── types.ts                    # Strict TypeScript interfaces across full stack
│   ├── hooks/                      # Live data fetch, PWA install, idle logout, and UI hooks
│   ├── services/                   # API client (`api.ts`), Firebase push config, offline queue sync
│   │
│   ├── components/
│   │   ├── auth/                   # AuthModal, UserProfileModal, VerifyEmailNoticeView
│   │   ├── common/                 # Header, Sidebar, StatCard, ThemeDropdown, BarcodeSvg, RouteSkeletons
│   │   ├── inventory/              # ProductFormModal, BarcodeGeneratorTool, StockLedgerView, CsvImportModal
│   │   ├── pos/                    # PosTerminal, QuickReceiveChips, ShoeExchangeModal, InvoicePrintModal, OfflineSyncModal
│   │   ├── saas/                   # SuperAdminControlPanel, SuperAdminReportsView, SaasLandingPage, FreeTrialOnboardingModal
│   │   └── settings/               # SettingsView, PrinterHardwareSettings, DataBackupRestore, CreateStaffModal
│   │
│   ├── context/
│   │   └── ThemeContext.tsx        # 3-way theme state (light, dark, system) + 11 accent palettes
│   │
│   ├── db/
│   │   ├── index.ts                # PostgreSQL connection pool and query executor
│   │   ├── schemaInit.ts           # Automatic database schema initialization & migrations
│   │   └── tenantDb.ts             # Tenant-scoped SQL query helpers
│   │
│   ├── server/
│   │   ├── auth.ts                 # JWT signing, cookie verification, RBAC guards
│   │   ├── gemini.ts               # Gemini AI assistant client
│   │   ├── pushNotificationService.ts # SSE broadcasting, FCM push dispatch, and trial lifecycle alerts
│   │   ├── middleware/             # Shared-domain multi-tenant routing middleware
│   │   ├── routes/                 # Express API routes (pos, products, auth, tenantSaas, settings...)
│   │   ├── services/               # appSettingsService, emailAlertService, ledgerService, welcomeService
│   │   └── utils/                  # email.ts, staticCacheHeaders.ts, windowsExePatcher.ts
│   │
│   └── utils/
│       ├── audio.ts                # Web Audio scanner laser chimes & alerts
│       ├── barcode.ts              # Code-128 generator and analysis
│       ├── footwear.ts             # Shoe categories, prefixes, and suggested articles
│       ├── offlineDb.ts            # IndexedDB offline store catalog & sales queue
│       ├── pdfExport.ts            # PDF sticker, side-box label, and digital receipt generator
│       ├── priceFormat.ts          # Pakistani Rupee (Rs.) formatting utilities
│       ├── printer/                # ESC/POS and TSPL command builders & hardware manager
│       └── subscription.ts         # Trial countdown calculation & plan resolution
```

---

## 🔐 Environment Configuration

Create a `.env` file in the project root (see `.env.example`):

```env
# Required: PostgreSQL connection URL
DATABASE_URL=postgresql://user:password@localhost:5432/shoe_pos

# Required: JWT session token secret
JWT_SECRET=your-super-secure-jwt-secret-key-2026
```

> **Important Reminder:**  
> Do not add `RESEND_API_KEY`, `GMAIL_APP_PASSWORD`, or email configuration to `.env`. Configure email delivery in the running app via **SuperAdmin &rarr; Settings &rarr; Email Settings**.

---

## 🛠️ Verification & Testing

Before submitting changes or committing code, run the verification pipeline:

```bash
# Verify TypeScript types and lint rules
npm run lint

# Verify full production build
npm run build
```

Both commands must pass with **0 errors and 0 warnings**.

---

## 📄 License & Attribution

Copyright &copy; 2026 SarbaazSoft. All rights reserved.  
Built for high-performance footwear dual-engine wholesale & retail management.
