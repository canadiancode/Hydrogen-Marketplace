-- ============================================
-- Supabase Database Fix for "Database error creating new user"
-- ============================================
-- Run these queries in Supabase Dashboard → SQL Editor
-- ============================================

-- Step 1: Check if auth schema exists and is accessible
SELECT schema_name 
FROM information_schema.schemata 
WHERE schema_name = 'auth';

-- Step 2: Check if auth.users table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'auth' AND table_name = 'users';

-- Step 3: Check for required extensions
SELECT * FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto');

-- If uuid-ossp is missing, create it:
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- If pgcrypto is missing, create it:
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Step 4: Check if auth triggers exist
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'auth'
ORDER BY trigger_name;

-- Step 5: Check for RLS policies on auth.users that might block inserts
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'auth' AND tablename = 'users';

-- Step 6: Check if we can read from auth.users (should work)
SELECT COUNT(*) FROM auth.users;

-- Step 7: Check auth functions
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'auth'
ORDER BY routine_name;

-- ============================================
-- COMMON FIXES
-- ============================================

-- Fix 1: Ensure auth schema has proper permissions
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO postgres, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA auth TO postgres, service_role;

-- Fix 2: Ensure auth.users table has proper permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO postgres, service_role;
GRANT SELECT ON auth.users TO anon, authenticated;

-- Fix 3: Check if there's a blocking RLS policy (shouldn't be any on auth.users)
-- If there are policies blocking, you may need to disable RLS temporarily:
-- ALTER TABLE auth.users DISABLE ROW LEVEL SECURITY;

-- ============================================
-- NUCLEAR OPTION: Reset Auth Schema
-- ============================================
-- WARNING: This will delete all users! Only use if nothing else works.
-- Uncomment and run ONLY if you're okay with losing all user data:

-- DROP SCHEMA IF EXISTS auth CASCADE;
-- Then restart your Supabase project or contact support

-- ============================================
-- ALTERNATIVE: Contact Supabase Support
-- ============================================
-- If the above doesn't work, this is likely a project-level issue.
-- Contact Supabase support with:
-- 1. Your project reference
-- 2. The error message
-- 3. Results from the diagnostic queries above

