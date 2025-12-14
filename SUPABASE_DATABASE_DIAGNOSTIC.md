# Supabase Database Error Diagnostic Guide

## Issue: "Database error creating new user"

This error occurs when trying to create users in Supabase, either through the dashboard or your application.

## Quick Diagnosis

Run these queries in **Supabase Dashboard → SQL Editor**:

### 1. Check Auth Schema Exists
```sql
SELECT schema_name 
FROM information_schema.schemata 
WHERE schema_name = 'auth';
```
**Expected:** Should return one row with `auth`

### 2. Check Auth Users Table
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'auth' AND table_name = 'users';
```
**Expected:** Should return one row with `users`

### 3. Check Required Extensions
```sql
SELECT * FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto');
```
**Expected:** Should return 2 rows

**If missing, run:**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### 4. Check Auth Triggers
```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'auth'
ORDER BY trigger_name;
```
**Expected:** Should return multiple triggers (at least 3-5)

### 5. Test Reading from auth.users
```sql
SELECT COUNT(*) FROM auth.users;
```
**Expected:** Should return a number (even if 0)

## Common Causes & Fixes

### Cause 1: Missing Extensions
**Fix:**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Cause 2: Missing Database Triggers
**Symptom:** No triggers found in Step 4
**Fix:** This usually requires Supabase support or project reset

### Cause 3: Permission Issues
**Fix:**
```sql
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO postgres, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA auth TO postgres, service_role;
```

### Cause 4: Corrupted Auth Schema
**Symptom:** All checks fail
**Fix:** Contact Supabase support - may need project reset

## Step-by-Step Fix Process

1. **Run Diagnostic Queries** (from `SUPABASE_DATABASE_FIX.sql`)
   - Note which queries fail
   - Document the results

2. **Try Quick Fixes:**
   - Ensure extensions exist
   - Fix permissions
   - Check triggers

3. **If Still Failing:**
   - Go to **Project Settings** → **Database** → **Reset Database**
   - ⚠️ **WARNING:** This will delete all data!
   - Or contact Supabase support

4. **Contact Supabase Support:**
   - Include your project reference
   - Include error message
   - Include results from diagnostic queries
   - Mention it happens in dashboard too

## Prevention

After fixing:
1. Verify you can create a test user in dashboard
2. Test magic link authentication
3. Monitor auth logs for any issues

## Alternative: Create New Supabase Project

If nothing works and you're early in development:
1. Create a new Supabase project
2. Copy your schema (from your SQL files)
3. Update environment variables
4. This ensures a clean auth setup

