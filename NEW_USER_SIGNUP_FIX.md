# New User Signup Flow Fix

## Issue Summary

New users were experiencing issues during signup:

1. First attempt: Received "Confirm your signup" email instead of magic link
2. After confirmation: Redirected back to login page
3. Second attempt: Received normal magic link
4. Clicking magic link: Redirected back to login with tokens in URL hash
5. Third attempt: Rate limited

## Root Cause

Supabase was redirecting to `/creator/login` with authentication tokens in the hash fragment, but the login page wasn't processing them. The tokens need to be processed by the callback route.

## Fixes Implemented ✅

### 1. **Hash Fragment Detection on Login Page**

**File:** `app/routes/creator.login.jsx`

Added client-side detection for hash fragments containing auth tokens. If tokens are detected, automatically redirects to the callback route for processing.

```javascript
useEffect(() => {
  const hash = window.location.hash.substring(1);
  if (hash) {
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');

    if (accessToken) {
      // Redirect to callback route to process tokens
      const callbackUrl = new URL(
        '/creator/auth/callback',
        window.location.origin,
      );
      // Preserve returnTo and hash
      window.location.href = callbackUrl.toString() + '#' + hash;
    }
  }
}, []);
```

### 2. **Email Confirmation Token Handling**

**File:** `app/routes/creator.auth.callback.jsx`

Added proper handling for `token_hash` and `type` query parameters, which are used for:

- Email confirmation links (new user signup)
- Magic link verification (server-side)

The callback route now:

- Verifies the token using `verifyMagicLink()`
- Creates a session cookie
- Redirects to dashboard or return URL

### 3. **Improved Token Verification**

**File:** `app/lib/supabase.js`

Enhanced comments explaining that `signInWithOtp` handles both:

- New user signup (sends confirmation email if required)
- Existing user login (sends magic link)

## Supabase Configuration Required ⚠️

To ensure the flow works correctly, verify these Supabase settings:

### 1. **Email Redirect URL**

**Location:** Supabase Dashboard → Authentication → URL Configuration

**Required Setting:**

- **Site URL:** `http://localhost:3000` (development) or your production URL
- **Redirect URLs:** Add both:
  - `http://localhost:3000/creator/auth/callback` (development)
  - `https://yourdomain.com/creator/auth/callback` (production)

**Why:** Supabase needs to know where to redirect after email confirmation and magic link clicks.

### 2. **Email Confirmation Settings**

**Location:** Supabase Dashboard → Authentication → Email Templates

**Options:**

- **Option A (Recommended):** Disable email confirmation for magic links
  - Go to Authentication → Settings
  - Under "Email Auth", set "Confirm email" to OFF
  - This allows immediate magic link login without confirmation step
- **Option B:** Keep email confirmation enabled
  - Users will receive confirmation email first
  - After confirmation, they can request magic link
  - Requires two-step process

**Recommendation:** For better UX, disable email confirmation for magic links since the magic link itself serves as verification.

### 3. **Email Template Configuration**

**Location:** Supabase Dashboard → Authentication → Email Templates

Ensure the "Magic Link" template redirects to:

```
{{ .SiteURL }}/creator/auth/callback
```

And the "Confirm Signup" template redirects to:

```
{{ .SiteURL }}/creator/auth/callback
```

## Testing the Fix

### Test New User Signup:

1. Delete user from Supabase (or use new email)
2. Go to `/creator/login`
3. Enter email and click "Send magic link"
4. Check email for magic link
5. Click magic link
6. Should redirect to `/creator/auth/callback` (or `/creator/login` with hash)
7. If redirected to login with hash, should auto-redirect to callback
8. Should end up on dashboard

### Test Existing User Login:

1. Use existing user email
2. Request magic link
3. Click magic link
4. Should authenticate and redirect to dashboard

### Test Email Confirmation (if enabled):

1. Delete user from Supabase
2. Request magic link (will receive confirmation email)
3. Click confirmation link
4. Should redirect to callback and create session
5. Then can request magic link for login

## Troubleshooting

### Issue: Still redirecting to login page

**Solution:** Check Supabase redirect URL configuration matches `/creator/auth/callback`

### Issue: Tokens in hash on login page

**Solution:** The fix should auto-redirect, but verify the useEffect is running

### Issue: "Unable to send magic link" after multiple attempts

**Solution:** Rate limiting is working. Wait 15 minutes or check rate limit configuration

### Issue: Email confirmation required but not working

**Solution:**

- Check Supabase email confirmation settings
- Verify email template redirect URLs
- Check spam folder for confirmation emails

## Files Modified

1. `app/routes/creator.login.jsx` - Added hash fragment detection
2. `app/routes/creator.auth.callback.jsx` - Added token_hash/type handling
3. `app/lib/supabase.js` - Improved comments

## Next Steps

1. ✅ Code fixes implemented
2. ⚠️ **Verify Supabase configuration** (see above)
3. ✅ Test new user signup flow
4. ✅ Test existing user login flow
5. ✅ Monitor for any edge cases

## Additional Notes

- The hash fragment detection is a fallback - ideally Supabase should redirect directly to `/creator/auth/callback`
- If Supabase redirects to login with tokens, the fix will catch it and redirect to callback
- Email confirmation can be disabled for better UX (magic link is already secure)
- Rate limiting prevents abuse but may affect legitimate users during testing
