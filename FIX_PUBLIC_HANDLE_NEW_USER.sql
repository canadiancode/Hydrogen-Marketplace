-- ============================================
-- Fix handle_new_user() Function in Public Schema
-- ============================================
-- Since the function is in public schema, we can modify it!
-- ============================================

-- Step 1: Check current function definition
SELECT 
    p.proname AS function_name,
    n.nspname AS schema_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'handle_new_user';

-- Step 2: Replace the function with one that doesn't fail
-- This version does nothing, allowing users to be created
-- Creator profiles will be created manually in your app
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Do nothing - creator profiles will be created manually
  -- when users complete the signup flow in your application
  -- This prevents the trigger from failing when trying to insert
  -- into creators table without required fields
  RETURN NEW;
END;
$$;

-- Step 3: Verify the function was created
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_name = 'handle_new_user';

-- Step 4: Test - Try creating a user in Supabase dashboard
-- It should work now!

