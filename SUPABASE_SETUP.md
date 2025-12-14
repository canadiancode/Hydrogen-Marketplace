# Supabase Auth Setup Guide for WornVault

This guide explains how to set up Supabase Authentication for WornVault creators and admins.

## Prerequisites

1. A Supabase account and project
2. Node.js 18+ installed
3. Environment variables configured

## Installation

```bash
npm install @supabase/supabase-js
```

## Environment Variables

Add these to your `.env` file (or your deployment environment):

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Important Security Notes:**
- `SUPABASE_ANON_KEY`: Safe to use client-side, respects RLS
- `SUPABASE_SERVICE_ROLE_KEY`: **NEVER expose client-side**, bypasses RLS, use only server-side

## Supabase Dashboard Configuration

### 1. Enable Email Magic Links

1. Go to Authentication > Providers in Supabase dashboard
2. Enable "Email" provider
3. Configure email templates (optional, defaults work fine)
4. Set redirect URLs:
   - Add `http://localhost:3000/creator/auth/callback` for local development
   - Add your production URL: `https://yourdomain.com/creator/auth/callback`

### 2. Enable Google OAuth (Optional but Recommended)

1. Go to Authentication > Providers
2. Enable "Google" provider
3. Add your Google OAuth credentials:
   - Client ID
   - Client Secret
4. Add authorized redirect URIs:
   - `http://localhost:3000/creator/auth/callback` (local)
   - `https://yourdomain.com/creator/auth/callback` (production)

### 3. Configure Row Level Security (RLS)

RLS policies will be set up in your database schema. Example:

```sql
-- Creators can only access their own records
CREATE POLICY "Creators can view own data"
ON creators FOR SELECT
USING (auth.uid() = user_id);

-- Admins can access all records
CREATE POLICY "Admins can view all data"
ON creators FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM creators
    WHERE user_id = auth.uid() AND is_admin = true
  )
);
```

## Uncommenting the Code

Once Supabase is installed and configured:

1. **Uncomment all code in `app/lib/supabase.js`**
   - Remove the placeholder returns
   - Uncomment the actual Supabase client creation

2. **Update `app/routes/creator.login.jsx`**
   - The action function already has the structure
   - Uncomment the Supabase calls

3. **Update `app/routes/creator.auth.callback.jsx`**
   - Uncomment the verification logic
   - Add session cookie handling

## Authentication Flow

### Magic Link Flow

1. User enters email on `/creator/login`
2. `sendMagicLink()` sends email via Supabase
3. User clicks link in email
4. Redirected to `/creator/auth/callback?token_hash=...&type=magiclink`
5. `verifyMagicLink()` verifies token and creates session
6. User redirected to `/creator/dashboard`

### Google OAuth Flow

1. User clicks "Continue with Google" on `/creator/login`
2. `initiateGoogleOAuth()` redirects to Google
3. User authorizes on Google
4. Google redirects to `/creator/auth/callback?code=...`
5. Supabase exchanges code for session
6. User redirected to `/creator/dashboard`

## Testing

1. Start your dev server: `npm run dev`
2. Visit `/creator/login`
3. Enter your email
4. Check your email for the magic link
5. Click the link
6. You should be redirected to `/creator/dashboard`

## Troubleshooting

### Magic link not received
- Check spam folder
- Verify email provider settings in Supabase
- Check Supabase logs for errors

### OAuth redirect errors
- Verify redirect URLs match exactly in Supabase dashboard
- Check Google OAuth credentials are correct
- Ensure HTTPS in production

### Session not persisting
- Check cookie settings
- Verify domain settings
- Ensure session is being set correctly

## Next Steps

After authentication is working:

1. Create creator profile table in Supabase
2. Set up RLS policies
3. Add profile completion flow
4. Implement admin role checking
5. Add logout functionality

