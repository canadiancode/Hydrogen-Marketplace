-- ============================================
-- Check Trigger Function Details
-- ============================================

-- Step 1: Check the trigger function that's being called
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'auth' 
AND p.proname LIKE '%user%created%'
OR p.proname LIKE '%on_auth_user%';

-- Step 2: Check what function the trigger calls
SELECT 
    t.tgname AS trigger_name,
    t.tgenabled AS is_enabled,
    pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'auth' 
AND c.relname = 'users'
AND t.tgname = 'on_auth_user_created';

-- Step 3: Check if the function exists and is valid
SELECT 
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'auth'
AND routine_name LIKE '%user%created%';

-- Step 4: Try to see the actual error (check recent logs)
-- This might show what's failing in the trigger

-- Step 5: Check if there are any constraints or foreign keys that might be blocking
SELECT
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'auth.users'::regclass;

-- Step 6: Check table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'users'
ORDER BY ordinal_position;

-- ============================================
-- COMMON FIXES
-- ============================================

-- Fix 1: Ensure the trigger function has proper permissions
-- (The function should be owned by postgres or service_role)

-- Fix 2: Check if there's a schema mismatch
-- Sometimes the trigger function references tables that don't exist

-- Fix 3: If the trigger function is trying to insert into your 'creators' table
-- Make sure that table exists and has proper structure

-- Check if creators table exists (since your schema uses email matching)
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'creators';

-- If creators table doesn't exist, the trigger might be failing
-- You may need to either:
-- A) Create the creators table
-- B) Modify the trigger to not require creators table
-- C) Make the trigger function handle missing creators table gracefully

