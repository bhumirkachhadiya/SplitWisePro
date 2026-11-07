# SplitWise — Production Ready Collaborative Expense Management & UPI Settlement

A comprehensive, production-grade shared expense management system featuring automated UPI settlements, real-time multi-party debt simplification, AI voice assistance with conversational memory, and cryptographically secure email OTP verification for signup and password recovery.

---

## 🌟 Key Production Features

### 1. Secure Authentication & Email OTP Verification
- **Email OTP Verification for Signup**:
  - Cryptographically secure 6-digit OTP generation (`crypto.randomInt`).
  - HMAC-SHA256 hashed storage bound to user email and purpose.
  - Automatic branded HTML & plaintext email dispatch via Resend or SMTP.
  - 5-minute expiry, max 5 attempts lockout, and 30-second resend cooldown.
  - Responsive 6-digit input UI with auto-focus, paste parsing, and backspace navigation.
- **Forgot Password via OTP**:
  - Neutral security messaging prevents account enumeration.
  - Verification issues a single-use, 10-minute reset token.
  - Direct password update requires valid token; old passwords immediately invalidated.
- **Production Clean**: Zero demo credentials or hardcoded 1-click test logins.

### 2. Automated UPI Payment Settlement
- **Zero Manual Confirmation**:
  - Eliminates manual "Record Settled" confirmation buttons.
  - Dynamic UPI payment request generation with unique request IDs (`UPIR-...`).
  - Live polling and HMAC-SHA256 webhook signature verification.
  - Server-to-server payment status verification (`PENDING`, `SUCCESS`, `FAILED`, `CANCELLED`).
  - Atomic database settlement and debt balance reconciliation on confirmed success.

### 3. AI Voice Assistant (Multi-Lingual NLP)
- **Natural Language Understanding**:
  - Full conversational understanding in English (including Indian accents), Hindi, and Gujarati.
  - Contextual multi-turn follow-ups (e.g., "Show my expenses" → "Only for last month" → "What about Rahul?").
  - Live query resolution directly against PostgreSQL database ledgers.
- **Voice Playback Management**:
  - Female voice synthesis across supported languages.
  - Play, pause, resume, stop, and replay controls.
  - Click-to-stop active utterance directly on chat bubbles.
  - Anti-truncation KeepAlive guard preventing browser audio pause timeouts.

### 4. Group & Expense Management (RBAC)
- **Role-Based Access Control (RBAC)**:
  - Admin (Creator): Full management, group edit, member management, expense recording.
  - Editor: Expense recording and edit capabilities.
  - Member: Split participant with view and settlement access.
- **Split Engine**:
  - Equal split with rounding adjustment ensuring penny-accurate totals.
  - Exact (₹) allocation.
  - Percentage (%) split with live auto-balance calculation.
- **Debt Simplification**:
  - Graph collapse algorithm reducing cross-transfers between friends by up to 70%.

### 5. Responsive Multi-Device UI/UX
- Mobile-first architecture with dedicated bottom navigation bar on handheld screens.
- Desktop multi-column layout with collapsible sidebar (16rem to 5rem).
- Adaptive modals and forms fitting viewports from 320px up to 1920px without horizontal scroll.

---

## 🗄️ Database Architecture

The system runs on **PostgreSQL** and is 100% compatible with **Supabase**.

### Primary Tables
| Table | Description |
|---|---|
| `users` | User accounts, hashed passwords, avatar initials, phone, UPI IDs, verified flags |
| `groups` | Expense circles, categories, descriptions, creator references |
| `group_members` | Circle enrollment with RBAC roles (`admin`, `editor`, `member`) |
| `expenses` | Expense records, categories, currencies, split types, dates |
| `expense_splits` | Individual member shares, settlement statuses, timestamps |
| `settlements` | Transaction audit log of recorded/verified settlements |
| `activity_logs` | Real-time audit ledger for activities and notifications |
| `upi_payment_requests` | Payment request tokens, status, UTRs, idempotency keys |
| `email_verifications` | OTP hashes, verification purposes, attempts, expiry, reset tokens |

### Views
- `events`: Backward-compatible view of `groups`
- `event_members`: Backward-compatible view of `group_members`

---

## 🚀 Supabase Deployment Guide

1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard) and create a project.
2. Navigate to **SQL Editor** in the left sidebar.
3. Open [`supabase_database_setup.sql`](file:///d:/SplitWisePersonal/supabase_database_setup.sql) located in the project root.
4. Copy and paste the entire script into the query editor and click **Run**.
5. All extensions, tables, foreign keys, triggers, views, and Row Level Security (RLS) policies will be created cleanly.

---

## ⚙️ Environment Variables

Create a `.env` file in the project root (refer to [`.env.example`](file:///d:/SplitWisePersonal/.env.example)):

```env
PORT=5000
NODE_ENV=production

# Supabase / PostgreSQL Connection String
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/[DATABASE]?sslmode=require

# Supabase API Credentials
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Email Provider Configuration (Resend or SMTP)
RESEND_API_KEY=re_your_api_key_here
# or
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=your_smtp_pass
EMAIL_FROM="SplitWise Security" <no-reply@yourdomain.com>

# Security Secrets (HMAC-SHA256)
OTP_SECRET=your_32_char_random_otp_secret_key
UPI_WEBHOOK_SECRET=your_32_char_random_webhook_secret_key
```

---

## 🧪 Comprehensive Test Suites (100% Pass)

Run all verified test suites locally:

```bash
# 1. Email OTP Verification Suite (17 tests)
node test-otp-verification.js

# 2. Automated UPI Settlement Suite (9 tests)
node test-upi-automation.js

# 3. AI Voice Assistant Conversation Suite (7 tests)
node test-ai-assistant-conversation.js

# 4. Advanced Verification & Audio Checks (15 tests)
node test-advanced-verification.js

# 5. Full Responsive Design Audit (44 checks across 9 resolutions)
node test-responsive-design.js

# 6. End-to-End API Integration Suite (10 tests)
node test-e2e-api.js

# 7. Production CRUD Operations Suite (9 tests)
node test-production-features.js
```

---

## 💻 Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Initialize database
npm run setup-db
npm run seed-db

# 3. Start server
npm start
# Server will run on http://localhost:5000
```
