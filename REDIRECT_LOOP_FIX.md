# Redirect Loop Fix

## Issue

After email confirmation, users were stuck in an infinite redirect loop:

1. Supabase redirects to `/creator/login` with tokens in hash fragment
2. Login page redirects to `/creator/auth/callback`
3. Callback processes tokens and redirects to dashboard
4. Dashboard redirects back to login (cookie not found)
5. Loop continues

## Root Cause

1. **Double redirect**: Login page was redirecting to callback, which then processed tokens and redirected again
2. **Cookie timing**: Cookie might not be available immediately after redirect
3. **Multiple form submissions**: No protection against processing tokens multiple times

## Fixes Implemented ✅

### 1. **Direct Token Processing on Login Page**

**File:** `app/routes/creator.login.jsx`

Instead of redirecting to callback route, login page now processes hash fragments directly:

- Extracts tokens from hash fragment
- Validates JWT structure
- Submits form directly to callback action
- Prevents redirect loop

### 2. **Protection Against Multiple Submissions**

**Files:** `app/routes/creator.login.jsx`, `app/routes/creator.auth.callback.jsx`

Added `sessionStorage` flag to prevent processing tokens multiple times:

- Sets `auth_processing` flag before form submission
- Clears flag after processing or on error
- Prevents infinite loops from multiple useEffect runs

### 3. **Full Browser Redirect**

**File:** `app/routes/creator.auth.callback.jsx`

Changed from React Router's `redirect()` to raw `Response` with 302 status:

- Ensures full browser redirect (not SPA navigation)
- Guarantees cookie is set before dashboard loads
- Prevents race conditions

## Code Changes

### Login Page (`creator.login.jsx`)

```javascript
// Process hash fragments directly instead of redirecting
useEffect(() => {
  if (sessionStorage.getItem('auth_processing')) {
    return; // Prevent multiple submissions
  }

  const hash = window.location.hash.substring(1);
  if (hash) {
    const accessToken = params.get('access_token');
    if (accessToken) {
      sessionStorage.setItem('auth_processing', 'true');
      // Process tokens and submit form directly
      // Clear hash before submitting
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  }
}, []);
```

### Callback Action (`creator.auth.callback.jsx`)

```javascript
// Use raw Response for full browser redirect
return new Response(null, {
  status: 302,
  headers: {
    Location: redirectPath,
    'Set-Cookie': cookieHeader,
  },
});
```

## Testing

### Test Email Confirmation Flow:

1. Delete user from Supabase
2. Request magic link (will receive confirmation email)
3. Click confirmation link
4. Should redirect to `/creator/login` with tokens in hash
5. Login page processes tokens automatically
6. Should redirect to dashboard (no loop)

### Expected Behavior:

- ✅ No infinite redirects
- ✅ Cookie set correctly
- ✅ Dashboard loads successfully
- ✅ Session persists

## Troubleshooting

### Issue: Still seeing redirect loop

**Check:**

1. Browser console for errors
2. Network tab - verify cookie is being set
3. Application tab - verify cookie exists after redirect
4. Clear `sessionStorage` and try again

### Issue: Cookie not being set

**Check:**

1. Cookie size (should be under 4KB)
2. Cookie domain/path settings
3. HTTPS requirement (Secure flag in production)
4. SameSite settings (should be Lax)

### Issue: Tokens not processing

**Check:**

1. Hash fragment is present in URL
2. `sessionStorage.getItem('auth_processing')` is not blocking
3. Form submission is happening
4. Network tab shows POST to `/creator/auth/callback`

## Files Modified

1. `app/routes/creator.login.jsx` - Direct token processing
2. `app/routes/creator.auth.callback.jsx` - Full browser redirect + protection

## Additional Notes

- The `sessionStorage` flag is cleared on component unmount
- Hash fragment is cleared from URL before form submission
- Full browser redirect ensures cookie is available for dashboard loader
- Protection against multiple submissions prevents race conditions
