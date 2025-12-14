# Verify Redirect URL in Supabase

## Critical: Exact URL Match Required

Supabase requires an **exact match** of the redirect URL. Even a small difference will cause it to fail.

## Step-by-Step Verification

### 1. Go to Supabase Dashboard
- Navigate to: **Authentication → URL Configuration**

### 2. Check the Redirect URLs Section

Look at the **"Redirect URLs"** section. You should see a list with your URL.

### 3. Verify the EXACT URL

The URL in Supabase must be **exactly** this (copy-paste to compare):

```
http://localhost:3000/creator/auth/callback
```

### 4. Common Mistakes to Check

Compare character-by-character:

- ❌ `http://localhost:3000/creator/auth/callback/` (trailing slash)
- ❌ `https://localhost:3000/creator/auth/callback` (https instead of http)
- ❌ `http://localhost:3000/creator/auth/callback ` (trailing space)
- ❌ `http://127.0.0.1:3000/creator/auth/callback` (127.0.0.1 instead of localhost)
- ❌ `http://localhost:3000/creator/auth/callback?` (trailing question mark)
- ✅ `http://localhost:3000/creator/auth/callback` (CORRECT - no trailing anything)

### 5. If URL Looks Correct

1. **Delete the URL** from Supabase
2. **Save changes**
3. **Wait 30 seconds**
4. **Add it again** exactly: `http://localhost:3000/creator/auth/callback`
5. **Save changes**
6. **Wait 1-2 minutes** for propagation
7. **Clear browser cache** or use incognito window
8. **Try again**

### 6. Double-Check Site URL

Site URL should be:
```
http://localhost:3000
```

(No trailing slash)

## Still Not Working?

### Check Browser Network Tab

1. Open browser DevTools → Network tab
2. Click "Continue with Google"
3. After Google authentication, look for the redirect to `/creator/auth/callback`
4. Check the **full URL** in the network request
5. It should have a `code` parameter: `/creator/auth/callback?code=abc123...`
6. If there's no `code` parameter, Supabase is still not recognizing the redirect URL

### Alternative: Try Wildcard Pattern

If exact match doesn't work, try using a wildcard pattern in Supabase:

```
http://localhost:3000/*
```

This allows any path under localhost:3000. (Less secure, but useful for debugging)

### Check Supabase Logs

1. Go to Supabase Dashboard → Logs → Auth Logs
2. Look for recent OAuth attempts
3. Check for any error messages about redirect URLs

## Expected Behavior After Fix

When it works, you'll see in server logs:
```
hasCode: true  ← This will be true!
```

And the callback URL will have a `code` parameter:
```
http://localhost:3000/creator/auth/callback?code=abc123xyz...
```

