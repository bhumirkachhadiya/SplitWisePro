# Supabase SQL Incremental Execution Guide

This guide details the exact step-by-step procedure for applying incremental database changes to your Supabase PostgreSQL database using the scripts located in:
```
supabase/migrations/manual_sql/
```

> **Safety Guarantee**: Every script is written using safe, incremental `IF NOT EXISTS`, `ON CONFLICT DO NOTHING / UPDATE`, and explicit policy drops before creation. **No existing user data, expense records, or balances are deleted.**

---

## 1. Summary of Execution Order & Dependencies

Execute the 11 scripts in sequential order inside the **Supabase Dashboard → SQL Editor**:

| Order | Script File | Target Functional Area | Type of Operation |
| :---: | :--- | :--- | :--- |
| **01** | `01_user_profile_changes.sql` | Users, Profiles & Email OTP | Adds `default_currency`, `user_code`; creates `email_verifications`, `profiles` |
| **02** | `02_friend_management_changes.sql` | Friends & Connection Requests | Creates `friends`, `friend_requests` with self-request prevention |
| **03** | `03_group_management_changes.sql` | Group Base Currency & Roles | Adds `base_currency` to `groups`, `role` to `group_members` |
| **04** | `04_expense_and_split_changes.sql` | Multi-Currency Expenses & Splits | Adds original/converted amounts, historical rates & split percentages |
| **05** | `05_settlement_and_upi_changes.sql` | Settlements & UPI Idempotency | Creates/verifies `settlements`, `upi_payment_requests` |
| **06** | `06_chat_and_notification_changes.sql` | Group Chat, Messages & Activity | Creates `chat_conversations`, `chat_messages`, `activity_logs` |
| **07** | `07_currency_and_exchange_rate_changes.sql` | Currency Master & Exchange Rates | Creates `currencies`, `exchange_rates`; seeds 9 ISO currencies |
| **08** | `08_ai_assistant_changes.sql` | AI Agent Tool Actions & Audit | Creates `ai_agent_actions` for voice/text command confirmation logging |
| **09** | `09_email_template_changes.sql` | Customizable Transactional Emails | Creates `custom_email_templates`; seeds 4 HTML templates |
| **10** | `10_rls_and_security_changes.sql` | Row Level Security (RLS) | Enables RLS and attaches participant-scoped policies |
| **11** | `11_indexes_and_performance_changes.sql` | Query Performance Indexes | Adds compound indexes for dates, lookups, and foreign keys |

---

## 2. Detailed Breakdown of Each Script

### Script 01: `01_user_profile_changes.sql`
- **Existing Tables Modified**: `public.users` (adds `default_currency VARCHAR(10) DEFAULT 'INR'`, `user_code VARCHAR(32) UNIQUE`).
- **New Tables Created**: `public.profiles`, `public.email_verifications`.
- **Changes**: Auto-populates `user_code` with format `SW-XXXXXX` for all existing users where null.
- **Verification Query**:
  ```sql
  SELECT id, email, user_code, default_currency FROM public.users LIMIT 5;
  ```

### Script 02: `02_friend_management_changes.sql`
- **Existing Tables Modified**: None.
- **New Tables Created**: `public.friends`, `public.friend_requests`.
- **Changes**: Implements friend relationships with `chk_friends_no_self` and `uq_friend_pair`, plus pending request indexing.
- **Verification Query**:
  ```sql
  SELECT table_name FROM information_schema.tables 
  WHERE table_name IN ('friends', 'friend_requests');
  ```

### Script 03: `03_group_management_changes.sql`
- **Existing Tables Modified**: `public.groups` (adds `base_currency`), `public.group_members` (adds `role`).
- **New Tables Created**: None.
- **Changes**: Backfills existing creators as `admin` and others as `member`.
- **Verification Query**:
  ```sql
  SELECT g.name, g.base_currency, gm.user_id, gm.role 
  FROM public.groups g 
  JOIN public.group_members gm ON g.id = gm.group_id LIMIT 5;
  ```

### Script 04: `04_expense_and_split_changes.sql`
- **Existing Tables Modified**:
  - `public.expenses` (adds `original_amount`, `exchange_rate`, `converted_amount`, `rate_provider`, `rate_timestamp`, `expense_date`).
  - `public.expense_splits` (adds `split_percentage`, `shares`).
- **Changes**: Backfills existing expenses to ensure `original_amount = amount` and `exchange_rate = 1.0`.
- **Verification Query**:
  ```sql
  SELECT id, description, amount, currency, original_amount, exchange_rate, converted_amount 
  FROM public.expenses LIMIT 5;
  ```

### Script 05: `05_settlement_and_upi_changes.sql`
- **Existing Tables Modified / Verified**: `public.settlements`.
- **New Tables Created**: `public.upi_payment_requests`.
- **Changes**: Adds positive amount check constraints (`amount > 0`) and unique idempotency keys for UPI requests.
- **Verification Query**:
  ```sql
  SELECT table_name FROM information_schema.tables WHERE table_name = 'upi_payment_requests';
  ```

### Script 06: `06_chat_and_notification_changes.sql`
- **New Tables Created**: `public.chat_conversations`, `public.chat_messages`, `public.chat_conversation_members`, `public.activity_logs`.
- **Changes**: Sets up multi-user group chat messaging with read status and audit timeline.
- **Verification Query**:
  ```sql
  SELECT table_name FROM information_schema.tables 
  WHERE table_name IN ('chat_conversations', 'chat_messages', 'activity_logs');
  ```

### Script 07: `07_currency_and_exchange_rate_changes.sql`
- **New Tables Created**: `public.currencies`, `public.exchange_rates`.
- **Changes**: Seeds 9 supported world currencies (`INR, USD, EUR, GBP, AED, SGD, AUD, CAD, JPY`) with decimal precision standards.
- **Verification Query**:
  ```sql
  SELECT code, name, symbol, decimals FROM public.currencies ORDER BY code;
  ```

### Script 08: `08_ai_assistant_changes.sql`
- **New Tables Created**: `public.ai_agent_actions`.
- **Changes**: Tracks user voice/text commands, proposed payloads (`CREATE_GROUP`, `ADD_EXPENSE`), confirmation states, and execution audit logs.
- **Verification Query**:
  ```sql
  SELECT column_name, data_type FROM information_schema.columns 
  WHERE table_name = 'ai_agent_actions';
  ```

### Script 09: `09_email_template_changes.sql`
- **New Tables Created**: `public.custom_email_templates`.
- **Changes**: Seeds 4 default responsive HTML email templates with dynamic tokens (`{{group_name}}`, `{{inviter_name}}`, `{{amount}}`, `{{action_url}}`).
- **Verification Query**:
  ```sql
  SELECT template_type, subject FROM public.custom_email_templates;
  ```

### Script 10: `10_rls_and_security_changes.sql`
- **Existing Tables Modified**: Enables RLS across 15 public tables.
- **Policies Added**:
  - `Public can view currencies` & `Public can view exchange rates`
  - `Users can read own profile`
  - `Users view own friendships` & `Users view own friend requests`
  - `Members can view their groups` & `Members can view group membership`
  - `Group members can view expenses` & `Members can view expense splits`
  - `Members can view conversations` & `Members can view messages`
- **Verification Query**:
  ```sql
  SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
  ```

### Script 11: `11_indexes_and_performance_changes.sql`
- **Changes**: Creates compound B-Tree indexes on user email, auth ID, user code, group dates, expense dates, friend lookups, and message timelines.
- **Verification Query**:
  ```sql
  SELECT indexname, tablename FROM pg_indexes 
  WHERE schemaname = 'public' AND indexname LIKE 'idx_%';
  ```

### Script 12: `12_paid_expense_protection_and_corrections.sql`
- **New Tables Created**: `public.expense_corrections`.
- **Triggers Added**:
  - `trg_protect_paid_expense_delete`: Blocks hard deletion of any expense that has settled splits (`is_settled = TRUE`) or active correction records.
  - `trg_protect_settled_split`: Blocks deletion or unauthorized reduction of settled split amounts.
- **RLS Policies**: Enables RLS on `expense_corrections` allowing group members to view correction audit histories.
- **Verification Query**:
  ```sql
  SELECT table_name FROM information_schema.tables WHERE table_name = 'expense_corrections';
  SELECT trigger_name, event_manipulation, event_object_table FROM information_schema.triggers WHERE trigger_name LIKE 'trg_protect%';
  ```

---

## 3. How to Execute in Supabase SQL Editor

1. Log in to your **Supabase Dashboard**: [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Open your project.
3. Click the **SQL Editor** tab on the left sidebar.
4. Click **New query**.
5. Open `supabase/migrations/manual_sql/01_user_profile_changes.sql`, paste the content into the editor, and click **Run** (or `Ctrl + Enter`).
6. Repeat for `02` through `12` in order.
7. Confirm that each query displays: `Success. No rows returned` or the expected rows.
