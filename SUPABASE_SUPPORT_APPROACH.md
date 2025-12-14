# Supabase Support Approach

## Issue
Cannot modify `auth.handle_new_user()` function due to permission restrictions.

## Root Cause
The `auth` schema is managed by Supabase and has restricted permissions. Regular database users cannot modify functions in this schema.

## Solutions

### Solution 1: Disable the Trigger (Try This First)
```sql
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
```

This should work because you're modifying the trigger, not the schema itself.

### Solution 2: Check Function Location
The function might actually be in the `public` schema, not `auth`. Run:
```sql
SELECT routine_schema, routine_name
FROM information_schema.routines
WHERE routine_name = 'handle_new_user';
```

If it's in `public`, you can modify it there.

### Solution 3: Make Creators Table Fields Nullable (Temporary Fix)
If disabling the trigger doesn't work, you can temporarily make the required fields nullable:

```sql
ALTER TABLE creators 
  ALTER COLUMN display_name DROP NOT NULL,
  ALTER COLUMN handle DROP NOT NULL;
```

Then modify the function (if it's in public schema) to insert with temporary defaults:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.creators (email, display_name, handle)
  VALUES (
    NEW.email,
    'User',  -- temporary default
    'user_' || substr(NEW.id::text, 1, 8)  -- temporary default
  )
  ON CONFLICT (email) DO NOTHING;
  RETURN NEW;
END;
$$;
```

**Then later**, when users complete signup, update these fields with real values.

### Solution 4: Contact Supabase Support
If none of the above work, contact Supabase support with:

**Subject:** Cannot create users - trigger function failing

**Message:**
```
Hi Supabase Team,

I'm experiencing an issue where I cannot create new users in my project. 
The error is "Database error creating new user".

I've identified that there's a trigger `on_auth_user_created` that calls 
`handle_new_user()` function, and this function is trying to insert into 
my `creators` table which has required fields (display_name, handle) that 
the function cannot provide.

Project Reference: [your-project-ref]
Error: Database error creating new user

I need to either:
1. Disable this trigger, or
2. Modify the function to not auto-create creator records (I handle this manually in my app)

Can you help me resolve this?

Thanks!
```

### Solution 5: Create New Supabase Project
If you're early in development and support can't help quickly:
1. Create a new Supabase project
2. Run your schema SQL (without any custom triggers)
3. Update environment variables
4. This ensures a clean setup without conflicting triggers

## Recommended Approach

1. **First**: Try disabling the trigger (Solution 1)
2. **If that works**: Test creating a user
3. **If that doesn't work**: Check function location (Solution 2)
4. **If function is in public**: Modify it there
5. **If function is in auth**: Contact Supabase support (Solution 4)

## Verification

After applying a solution:
1. Try creating a user in Supabase dashboard
2. Try magic link authentication
3. Verify users can be created successfully

