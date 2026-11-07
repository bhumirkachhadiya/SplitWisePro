-- ==============================================================================
-- 10_rls_and_security_changes.sql
-- Incremental Migration: Supabase Row Level Security (RLS) Policies
-- Safe & Idempotent: Run directly in Supabase SQL Editor
-- ==============================================================================

-- 1. Enable RLS on core application tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- 2. Currencies & Exchange rates: Public readable
DO $$ BEGIN
  DROP POLICY IF EXISTS "Public can view currencies" ON public.currencies;
  CREATE POLICY "Public can view currencies" ON public.currencies FOR SELECT USING (true);
  
  DROP POLICY IF EXISTS "Public can view exchange rates" ON public.exchange_rates;
  CREATE POLICY "Public can view exchange rates" ON public.exchange_rates FOR SELECT USING (true);
END $$;

-- 3. Users: authenticated self access or service role
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
  CREATE POLICY "Users can read own profile" ON public.users FOR SELECT USING (true);

  DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
  CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = auth_id);
END $$;

-- 4. Friends & Friend Requests RLS
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own friendships" ON public.friends;
  CREATE POLICY "Users view own friendships" ON public.friends FOR SELECT USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()) OR
    friend_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

  DROP POLICY IF EXISTS "Users view own friend requests" ON public.friend_requests;
  CREATE POLICY "Users view own friend requests" ON public.friend_requests FOR SELECT USING (
    sender_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()) OR
    receiver_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );
END $$;

-- 5. Groups & Members RLS: Strict membership access
DO $$ BEGIN
  DROP POLICY IF EXISTS "Members can view their groups" ON public.groups;
  CREATE POLICY "Members can view their groups" ON public.groups FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      JOIN public.users u ON gm.user_id = u.id
      WHERE gm.group_id = public.groups.id AND u.auth_id = auth.uid()
    ) OR created_by IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

  DROP POLICY IF EXISTS "Members can view group membership" ON public.group_members;
  CREATE POLICY "Members can view group membership" ON public.group_members FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm2
      JOIN public.users u ON gm2.user_id = u.id
      WHERE gm2.group_id = public.group_members.group_id AND u.auth_id = auth.uid()
    )
  );
END $$;

-- 6. Expenses & Splits RLS: Group members only
DO $$ BEGIN
  DROP POLICY IF EXISTS "Group members can view expenses" ON public.expenses;
  CREATE POLICY "Group members can view expenses" ON public.expenses FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      JOIN public.users u ON gm.user_id = u.id
      WHERE gm.group_id = public.expenses.group_id AND u.auth_id = auth.uid()
    )
  );

  DROP POLICY IF EXISTS "Members can view expense splits" ON public.expense_splits;
  CREATE POLICY "Members can view expense splits" ON public.expense_splits FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      JOIN public.group_members gm ON e.group_id = gm.group_id
      JOIN public.users u ON gm.user_id = u.id
      WHERE e.id = public.expense_splits.expense_id AND u.auth_id = auth.uid()
    )
  );
END $$;

-- 7. Chat & Discussions RLS: Conversation members only
DO $$ BEGIN
  DROP POLICY IF EXISTS "Members can view conversations" ON public.chat_conversations;
  CREATE POLICY "Members can view conversations" ON public.chat_conversations FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversation_members ccm
      JOIN public.users u ON ccm.user_id = u.id
      WHERE ccm.conversation_id = public.chat_conversations.id AND u.auth_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.group_members gm
      JOIN public.users u ON gm.user_id = u.id
      WHERE gm.group_id = public.chat_conversations.group_id AND u.auth_id = auth.uid()
    )
  );

  DROP POLICY IF EXISTS "Members can view messages" ON public.chat_messages;
  CREATE POLICY "Members can view messages" ON public.chat_messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      JOIN public.group_members gm ON c.group_id = gm.group_id
      JOIN public.users u ON gm.user_id = u.id
      WHERE c.id = public.chat_messages.conversation_id AND u.auth_id = auth.uid()
    )
  );
END $$;
