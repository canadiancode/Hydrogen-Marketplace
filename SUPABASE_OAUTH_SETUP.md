# Supabase OAuth Setup Guide

## Required Supabase Configuration

### ⚠️ Important: Two Different URLs

There are **two different URLs** in the OAuth flow:

1. **Supabase Callback URL** (where Google redirects TO Supabase):
   - `https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback`
   - ✅ Already configured in Google Cloud Console
   - ✅ This is Supabase's internal callback - you don't configure this

2. **Your App's Redirect URL** (where Supabase redirects TO your app):
   - `http://localhost:3000/creator/auth/callback`
   - ❌ **This is what you need to add to Supabase**
   - ✅ Add this to Supabase's "Redirect URLs" list

### 1. Redirect URL Configuration

Go to **Supabase Dashboard → Authentication → URL Configuration**:

**In the "Redirect URLs" section** (NOT the "Callback URL" field), add:

```
http://localhost:3000/creator/auth/callback
```

**Set Site URL to:**
```
http://localhost:3000
```

**Visual Guide:**
- Look for a section called **"Redirect URLs"** or **"Allowed Redirect URLs"**
- This is a **list** where you can add multiple URLs
- Add your app's callback URL here: `http://localhost:3000/creator/auth/callback`
- The "Callback URL" field (if visible) is for Supabase's internal use - ignore it

### 2. Google OAuth Provider Setup

1. Go to **Authentication → Providers → Google**
2. Enable the Google provider
3. Add your Google OAuth credentials:
   - Client ID (from Google Cloud Console)
   - Client Secret (from Google Cloud Console)
4. **Important:** Make sure the authorized redirect URI in Google Cloud Console includes:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```

### 3. Verify Configuration

After saving, test the OAuth flow. If you see `error=oauth_failed`, check:

1. **Redirect URL matches exactly** - No trailing slashes, exact match
2. **Google OAuth credentials are correct** - Double-check Client ID and Secret
3. **Google Cloud Console redirect URI** - Must include Supabase callback URL
4. **Provider is enabled** - Check the toggle in Supabase dashboard

## Common Issues

### Issue: Redirects to `/creator/login?error=oauth_failed`

**Cause:** Redirect URL not in Supabase allowed list or OAuth misconfiguration

**Solution:**
1. Verify redirect URL is exactly: `http://localhost:3000/creator/auth/callback`
2. Check Google OAuth credentials in Supabase
3. Verify Google Cloud Console redirect URI includes Supabase callback

### Issue: "Invalid redirect URL" error

**Cause:** Redirect URL is not absolute or doesn't match configuration

**Solution:** Ensure redirect URL is absolute (starts with `http://` or `https://`)

## Testing

1. Click "Continue with Google" on login page
2. You should be redirected to Google sign-in
3. After signing in, you should be redirected to `/creator/auth/callback`
4. Then automatically redirected to `/creator/dashboard`

If any step fails, check the browser console and server logs for detailed error messages.

