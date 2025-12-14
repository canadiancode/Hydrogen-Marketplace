-- ============================================
-- Check handle_new_user() Function
-- ============================================

-- Step 1: Get the function definition
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition,
    p.prosrc AS function_source
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'auth' 
AND p.proname = 'handle_new_user';

-- Step 2: Check if creators table exists (fixed query)
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'creators';

-- Step 3: Check creators table structure if it exists
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'creators'
ORDER BY ordinal_position;

-- Step 4: Check if there are any other functions that might be called
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%user%' OR routine_name LIKE '%creator%';

-- Step 5: Try to manually call the function to see the error
-- (This will help us see what's failing)
-- WARNING: This might fail, but the error message will be helpful
-- SELECT handle_new_user();

