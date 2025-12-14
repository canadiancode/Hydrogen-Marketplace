# Verify Supabase OAuth Configuration

## The Problem

Your logs show:
```
OAuth Callback Loader: {
  pathname: /creator/auth/callback,
  hasTokenHash: false,
  hasType: false,
  hasCode: false,  ← This is the problem!
  hasError: false
}
```

This means Supabase redirected to your callback URL but **stripped all parameters**. This happens when the redirect URL is **not in Supabase's allowed list**.

## Important: Two Different URLs

There are **two different URLs** in the OAuth flow:

1. **Supabase Callback URL** (where Google redirects TO Supabase):
   - `https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback`
   - ✅ This is already configured correctly in Google Cloud Console
   - ✅ This is NOT what you add to Supabase

2. **Your App's Redirect URL** (where Supabase redirects TO your app):
   - `http://localhost:3000/creator/auth/callback`
   - ❌ This is what's MISSING in Supabase
   - ✅ This is what you need to add to Supabase's "Redirect URLs" list

## Step-by-Step Verification

### 1. Go to Supabase Dashboard
- Navigate to: **Authentication → URL Configuration**

### 2. Find "Redirect URLs" Section
Look for a section called **"Redirect URLs"** or **"Allowed Redirect URLs"**. This is different from the "Callback URL" field.

**CRITICAL:** In the Redirect URLs list, you need:
```
http://localhost:3000/creator/auth/callback
```

**NOT** the Supabase callback URL (`https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback`) - that's already handled by Supabase.

**Common mistakes:**
- ❌ `http://localhost:3000/creator/auth/callback/` (trailing slash)
- ❌ `https://localhost:3000/creator/auth/callback` (https instead of http)
- ❌ `http://localhost:3000/creator/auth/callback ` (trailing space)
- ❌ `http://127.0.0.1:3000/creator/auth/callback` (127.0.0.1 instead of localhost)
- ✅ `http://localhost:3000/creator/auth/callback` (CORRECT)

### 3. Add Your App's Redirect URL

In the **"Redirect URLs"** section (NOT the "Callback URL" field):

1. Click **"Add URL"** or the **"+"** button
2. Type exactly: `http://localhost:3000/creator/auth/callback`
3. **Do NOT** add a trailing slash
4. **Do NOT** use the Supabase callback URL - that's different!
5. Click **Save**

**Visual Guide:**
```
Supabase Dashboard → Authentication → URL Configuration

┌─────────────────────────────────────────┐
│ Site URL:                                │
│ http://localhost:3000                    │
│                                          │
│ Redirect URLs:  ← ADD YOUR APP URL HERE │
│ [ ] http://localhost:3000/creator/...    │
│                                          │
│ Callback URL:  ← IGNORE THIS FIELD      │
│ (This is for Supabase's internal use)    │
└─────────────────────────────────────────┘
```

### 4. Verify Site URL

**Site URL** should be:
```
http://localhost:3000
```

### 5. Save and Wait

1. Click **Save** at the bottom of the page
2. **Wait 30-60 seconds** for changes to propagate
3. Supabase may show a message like "Changes saved" or "Updating..."

### 6. Clear Browser Cache

- Use an **incognito/private window**, OR
- Clear your browser cache for localhost

### 7. Test Again

Try logging in with Google again. You should now see in the logs:
```
hasCode: true  ← This should be true now!
```

## Still Not Working?

### Check Google Cloud Console

Your Google configuration looks correct:
- ✅ Authorized domains: `vpzktiosvxbusozfjhrx.supabase.co`
- ✅ Authorized redirect URIs: `https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback`

### Verify Supabase Provider Settings

1. Go to **Authentication → Providers → Google**
2. Ensure the toggle is **ON** (enabled)
3. Check that **Client ID** and **Client Secret** are filled in
4. These should match your Google Cloud Console credentials

### Check for Multiple Projects

Make sure you're editing the **correct Supabase project**:
- Your project URL: `https://vpzktiosvxbusozfjhrx.supabase.co`
- Verify this matches the project you're configuring

## Expected Flow After Fix

1. Click "Continue with Google"
2. Redirected to Google sign-in
3. Authenticate with Google
4. Google redirects to: `https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback`
5. Supabase processes OAuth and redirects to: `http://localhost:3000/creator/auth/callback?code=abc123...`
6. Your callback route receives the `code` parameter
7. Code is exchanged for session
8. Redirected to `/creator/dashboard`

## Debug Checklist

- [ ] Redirect URL added to Supabase (exact match, no trailing slash)
- [ ] Site URL set to `http://localhost:3000`
- [ ] Changes saved in Supabase
- [ ] Waited 30-60 seconds after saving
- [ ] Browser cache cleared or using incognito
- [ ] Google provider enabled in Supabase
- [ ] Google credentials correct in Supabase
- [ ] Testing with the correct Supabase project

