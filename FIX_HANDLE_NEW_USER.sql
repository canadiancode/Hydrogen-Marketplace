-- ============================================
-- Fix handle_new_user() Function
-- ============================================
-- This function is called when a new auth user is created
-- It's trying to insert into creators table but failing
-- ============================================

-- Step 1: First, let's see what the current function does
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'auth' 
AND p.proname = 'handle_new_user';

-- Step 2: Check if creators table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'creators';

-- ============================================
-- SOLUTION OPTIONS
-- ============================================

-- OPTION 1: Disable the trigger temporarily
-- This allows users to be created, then you handle creator profile creation in your app
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- OPTION 2: Fix the function to work with your schema
-- Replace the handle_new_user() function with one that doesn't auto-create creators
-- (Creators will be created manually when users complete signup)

-- Drop the old function if it exists
DROP FUNCTION IF EXISTS auth.handle_new_user() CASCADE;

-- Create a new function that does nothing (or logs)
-- This way the trigger won't fail, but won't auto-create creators
CREATE OR REPLACE FUNCTION auth.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Do nothing - creator profiles will be created manually
  -- when users complete the signup flow in your application
  RETURN NEW;
END;
$$;

-- Re-enable the trigger (if you disabled it)
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

-- ============================================
-- OPTION 3: Create a function that generates defaults
-- ============================================
-- If you want to auto-create creators with default values:

-- DROP FUNCTION IF EXISTS auth.handle_new_user() CASCADE;

-- CREATE OR REPLACE FUNCTION auth.handle_new_user()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- BEGIN
--   INSERT INTO public.creators (email, display_name, handle)
--   VALUES (
--     NEW.email,
--     COALESCE(NEW.raw_user_meta_data->>'display_name', 'User'),
--     COALESCE(
--       NEW.raw_user_meta_data->>'handle',
--       'user_' || substr(replace(NEW.email, '@', '_'), 1, 20) || '_' || substr(NEW.id::text, 1, 8)
--     )
--   )
--   ON CONFLICT (email) DO NOTHING;
--   RETURN NEW;
-- END;
-- $$;

-- ============================================
-- VERIFICATION
-- ============================================

-- Test: Try creating a user in the dashboard
-- It should work now!

-- Check the function exists
SELECT routine_name 
FROM information_schema.routines
WHERE routine_schema = 'auth'
AND routine_name = 'handle_new_user';

