-- ============================================
-- Alternative Fixes (No Auth Schema Modification)
-- ============================================
-- Since we can't modify auth schema directly, try these options:
-- ============================================

-- OPTION 1: Check if the function is actually in public schema
-- (Sometimes Supabase creates it there)
SELECT 
    p.proname AS function_name,
    n.nspname AS schema_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'handle_new_user';

-- OPTION 2: Try to disable the trigger (might work)
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- OPTION 3: Check if we can modify it in public schema instead
-- If the function exists in public schema, we can modify it:
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Do nothing - creator profiles will be created manually
  RETURN NEW;
END;
$$;

-- OPTION 4: Make creators table fields nullable temporarily
-- This allows the trigger to work, then you can update them later
-- WARNING: Only do this if you're okay with nullable fields temporarily

-- ALTER TABLE creators 
--   ALTER COLUMN display_name DROP NOT NULL,
--   ALTER COLUMN handle DROP NOT NULL;

-- Then create a function that inserts with defaults:
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- BEGIN
--   INSERT INTO public.creators (email, display_name, handle)
--   VALUES (
--     NEW.email,
--     'User',  -- temporary default
--     'user_' || substr(NEW.id::text, 1, 8)  -- temporary default
--   )
--   ON CONFLICT (email) DO NOTHING;
--   RETURN NEW;
-- END;
-- $$;

-- OPTION 5: Check what schema the function is actually in
-- Run this first to see where it is:
SELECT 
    routine_schema,
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_name = 'handle_new_user';

