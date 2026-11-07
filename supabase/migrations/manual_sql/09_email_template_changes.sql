-- ==============================================================================
-- 09_email_template_changes.sql
-- Incremental Migration: Customizable Transactional Email Templates
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Create public.custom_email_templates table
CREATE TABLE IF NOT EXISTS public.custom_email_templates (
  id SERIAL PRIMARY KEY,
  template_type VARCHAR(50) NOT NULL UNIQUE,
  subject VARCHAR(255) NOT NULL,
  body_text TEXT,
  body_html TEXT NOT NULL,
  updated_by INT REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Seed Default Professional Customizable Templates
INSERT INTO public.custom_email_templates (template_type, subject, body_text, body_html) VALUES
(
  'group_invitation',
  'You have been invited to join {{group_name}} on SplitWise',
  'Hello! {{inviter_name}} has invited you to join {{group_name}} on SplitWise.',
  '<div style="font-family:Inter,sans-serif;padding:24px;background:#f8fafc;color:#0f172a;"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-radius:16px;border:1px solid #e2e8f0;"><h2 style="color:#059669;margin-top:0;">You are invited!</h2><p>Hello! <strong>{{inviter_name}}</strong> has invited you to join the group <strong>{{group_name}}</strong> on SplitWise.</p><div style="margin:24px 0;"><a href="{{action_url}}" style="background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Accept Invitation</a></div><p style="font-size:12px;color:#64748b;">Keep track of shared spends and balances effortlessly.</p></div></div>'
),
(
  'expense_notification',
  'New expense added in {{group_name}}: {{description}} ({{amount}})',
  'A new expense of {{amount}} for {{description}} was added by {{paid_by}} in {{group_name}}.',
  '<div style="font-family:Inter,sans-serif;padding:24px;background:#f8fafc;color:#0f172a;"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-radius:16px;border:1px solid #e2e8f0;"><h2 style="color:#059669;margin-top:0;">New Expense Recorded</h2><p><strong>{{paid_by}}</strong> added a new expense in <strong>{{group_name}}</strong>:</p><div style="background:#f1f5f9;padding:16px;border-radius:12px;margin:16px 0;"><p style="margin:4px 0;font-size:18px;font-weight:bold;">{{description}}</p><p style="margin:4px 0;font-size:24px;color:#059669;font-weight:800;">{{amount}}</p></div><p style="font-size:13px;color:#475569;">Your split share has been added to your ledger balance.</p></div></div>'
),
(
  'settlement_reminder',
  'Settlement Reminder: Balance pending in {{group_name}}',
  'Hi! You have a pending settlement balance of {{amount}} in {{group_name}}.',
  '<div style="font-family:Inter,sans-serif;padding:24px;background:#f8fafc;color:#0f172a;"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-radius:16px;border:1px solid #e2e8f0;"><h2 style="color:#6366f1;margin-top:0;">Friendly Balance Reminder</h2><p>You have an outstanding settlement amount of <strong>{{amount}}</strong> in <strong>{{group_name}}</strong>.</p><div style="margin:20px 0;"><a href="{{action_url}}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Settle Up via UPI</a></div></div></div>'
),
(
  'monthly_digest',
  'Your SplitWise Monthly Ledger Summary',
  'Here is your monthly spending summary across all active groups.',
  '<div style="font-family:Inter,sans-serif;padding:24px;background:#f8fafc;color:#0f172a;"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-radius:16px;border:1px solid #e2e8f0;"><h2 style="color:#059669;margin-top:0;">Monthly Spend Digest</h2><p>Here is your personalized monthly summary across your circles.</p></div></div>'
)
ON CONFLICT (template_type) DO UPDATE
SET subject = EXCLUDED.subject, body_text = EXCLUDED.body_text, body_html = EXCLUDED.body_html;
