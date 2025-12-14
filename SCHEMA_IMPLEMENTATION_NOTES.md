# Schema-Specific Implementation Notes

## Key Schema Characteristics

### Email-Based Linking (Not User ID)

**Important**: Your schema links Supabase Auth users to creators via **email**, not `user_id`.

```sql
-- RLS Policy Pattern
create policy "Creators can read own profile"
on creators
for select
using (auth.email() = email);
```

This means:
- ✅ Use `user.email` from Supabase Auth session
- ✅ Match against `creators.email` field
- ❌ Do NOT use `user.id` or `auth.uid()`

### Implementation Impact

#### 1. Creator Profile Checking

```javascript
// ✅ CORRECT - Check by email
const {data} = await supabase
  .from('creators')
  .select('*')
  .eq('email', user.email)  // Use email, not user_id
  .single();

// ❌ WRONG - Don't use user_id
// .eq('user_id', user.id)  // This won't work with your schema
```

#### 2. Session-Based Queries

When using RLS with your schema:
- Supabase automatically uses `auth.email()` in RLS policies
- The authenticated user's email must match `creators.email`
- No need to manually pass user_id

#### 3. Creating Creator Profiles

When a new user authenticates:
```javascript
// After successful auth, create creator profile
const {data, error} = await supabase
  .from('creators')
  .insert({
    email: user.email,  // Link via email
    display_name: user.user_metadata?.full_name || '',
    handle: generateHandle(user.email),
    verification_status: 'pending',  // Default status
  });
```

## RLS Policy Behavior

Your RLS policies use `auth.email()` which means:

1. **Automatic Filtering**: Supabase automatically filters queries based on authenticated user's email
2. **No Manual Filtering Needed**: You don't need to add `.eq('email', user.email)` in queries - RLS handles it
3. **Email Must Match Exactly**: The email in `auth.users` must exactly match `creators.email`

Example:
```javascript
// This query will automatically only return the creator where
// auth.email() = creators.email (enforced by RLS)
const {data} = await supabase
  .from('creators')
  .select('*')
  .single();  // RLS ensures only the matching creator is returned
```

## Admin Authentication

**Current Status**: No admin identification method in schema yet.

**Options to Consider**:

### Option 1: Add `is_admin` to creators table
```sql
ALTER TABLE creators ADD COLUMN is_admin boolean DEFAULT false;
```

### Option 2: Separate admins table
```sql
CREATE TABLE admins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

### Option 3: Email-based admin list
- Maintain a list of admin emails in environment variables
- Check if `user.email` is in the list

### Option 4: Supabase Auth metadata
- Use `user.user_metadata.is_admin` or `user.app_metadata.is_admin`
- Set via Supabase dashboard or admin API

**Recommendation**: Option 1 (add `is_admin` boolean) is simplest and most flexible.

## Verification Status Flow

Your schema has `verification_status` enum:
- `'pending'` - New creators, awaiting approval
- `'approved'` - Can submit listings, go live
- `'rejected'` - Application rejected

**Implementation Pattern**:
```javascript
// Check if creator is approved
const {data: creator} = await supabase
  .from('creators')
  .select('verification_status')
  .eq('email', user.email)
  .single();

const canSubmitListings = creator?.verification_status === 'approved';
```

## Session Cookie Handling

Supabase stores sessions in cookies. For server-side reading:

1. **Cookie Name Pattern**: `sb-<project-ref>-auth-token`
2. **Project Ref**: Extract from `SUPABASE_URL` (e.g., `vpzktiosvxbusozfjhrx` from `https://vpzktiosvxbusozfjhrx.supabase.co`)
3. **Cookie Contains**: Access token, refresh token, user data

**Server-Side Session Reading**:
```javascript
// Supabase client automatically reads from cookies if available
// But for SSR, we need to manually extract and verify
const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Get session - Supabase will read from cookies automatically
const {data: {session}, error} = await supabase.auth.getSession();
```

## OAuth Email Matching

**Important**: When users sign in with Google OAuth:
- Google provides an email address
- This email must match the email used to create the creator profile
- If emails don't match, RLS policies will fail

**Best Practice**: 
- Use the same email for both magic link and OAuth
- Or allow users to link accounts with the same email

## Database Queries with RLS

When querying creator data:

```javascript
// ✅ CORRECT - Let RLS handle filtering
const {data: creator} = await supabase
  .from('creators')
  .select('*')
  .single();  // RLS ensures only matching creator is returned

// ✅ CORRECT - Explicit email check (optional, RLS already does this)
const {data: creator} = await supabase
  .from('creators')
  .select('*')
  .eq('email', user.email)
  .single();

// ❌ WRONG - Don't use user_id
const {data: creator} = await supabase
  .from('creators')
  .select('*')
  .eq('user_id', user.id)  // This column doesn't exist!
  .single();
```

## Migration Considerations

If you need to migrate existing data:
1. Ensure all `creators.email` values match `auth.users.email`
2. Handle case sensitivity (emails are case-insensitive but strings are not)
3. Consider using `LOWER()` in RLS policies if needed:
   ```sql
   using (LOWER(auth.email()) = LOWER(email))
   ```

## Testing Checklist

- [ ] Magic link login creates session with correct email
- [ ] Google OAuth login creates session with correct email
- [ ] Creator profile queries return only the authenticated user's profile
- [ ] RLS policies prevent access to other creators' data
- [ ] Email matching works case-insensitively (if using LOWER())
- [ ] New creator profiles are created with correct email
- [ ] Verification status checks work correctly

