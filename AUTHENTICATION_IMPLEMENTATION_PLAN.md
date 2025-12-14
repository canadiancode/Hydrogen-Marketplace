# WornVault Authentication Implementation Plan

## Overview

This document outlines the step-by-step plan for implementing Supabase Auth in WornVault, following the authentication strategy defined in your requirements document.

## Current State Assessment

### ✅ Already in Place
- Supabase JS SDK installed (`@supabase/supabase-js`)
- Login route structure (`app/routes/creator.login.jsx`)
- Callback route structure (`app/routes/creator.auth.callback.jsx`)
- Supabase utility functions scaffolded (`app/lib/supabase.js`)
- Creator layout and routes exist
- Environment variable access pattern established (`context.env`)

### ⚠️ Needs Implementation
- All Supabase client functions are commented out (placeholders)
- Session management not implemented
- Magic link sending not functional
- OAuth callback handling incomplete
- Creator profile checking not implemented
- Admin authentication not implemented
- Logout functionality not implemented

### 📋 Configuration Status
Based on your screenshots:
- ✅ Supabase Site URL: `http://localhost:3000`
- ✅ Supabase Redirect URL: `http://localhost:3000/creator/auth/callback`
- ✅ Google Authorized JavaScript Origins: `http://localhost:3000`
- ✅ Google Authorized Redirect URI: `https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback`

## Implementation Phases

### Phase 1: Core Supabase Client Setup
**Goal**: Enable basic Supabase client creation and session management

**Tasks**:
1. Uncomment and implement `createServerSupabaseClient()` in `app/lib/supabase.js`
2. Uncomment and implement `createUserSupabaseClient()` in `app/lib/supabase.js`
3. Implement `getSupabaseSession()` to read sessions from cookies
4. Test client creation with environment variables

**Files to Modify**:
- `app/lib/supabase.js` (lines 27-104)

**Dependencies**:
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

### Phase 2: Magic Link Authentication
**Goal**: Enable email magic link login for creators

**Tasks**:
1. Uncomment and implement `sendMagicLink()` in `app/lib/supabase.js`
2. Uncomment magic link sending in `app/routes/creator.login.jsx` action
3. Implement `verifyMagicLink()` in `app/lib/supabase.js`
4. Implement magic link verification in `app/routes/creator.auth.callback.jsx`
5. Add session cookie handling after successful verification
6. Test end-to-end magic link flow

**Files to Modify**:
- `app/lib/supabase.js` (lines 115-134, 172-193)
- `app/routes/creator.login.jsx` (lines 39-48)
- `app/routes/creator.auth.callback.jsx` (lines 23-48)

**Session Cookie Strategy**:
- Supabase stores session in `sb-<project-ref>-auth-token` cookie
- We need to read this cookie and verify the session server-side
- For SSR, we'll use Supabase's `getSession()` method with the cookie

---

### Phase 3: Google OAuth Authentication
**Goal**: Enable Google OAuth login for creators

**Tasks**:
1. Verify `initiateGoogleOAuth()` is working (already implemented)
2. Implement OAuth callback handling in `app/routes/creator.auth.callback.jsx`
3. Handle OAuth code exchange for session
4. Add session cookie handling after OAuth
5. Test end-to-end Google OAuth flow

**Files to Modify**:
- `app/routes/creator.auth.callback.jsx` (lines 52-68)
- Potentially add `handleOAuthCallback()` helper in `app/lib/supabase.js`

**OAuth Flow Notes**:
- Google redirects to Supabase callback URL first
- Supabase then redirects to our callback with `code` parameter
- We need to exchange the code for a session using Supabase client

---

### Phase 4: Session Management & Authentication Checks
**Goal**: Implement robust session reading and authentication verification

**Tasks**:
1. Complete `getSupabaseSession()` implementation
2. Implement `checkCreatorAuth()` to verify authenticated users
3. Add authentication checks to protected routes (creator dashboard, listings, etc.)
4. Implement redirect logic for unauthenticated users
5. Add session refresh handling

**Files to Modify**:
- `app/lib/supabase.js` (lines 76-104, 202-216)
- `app/routes/creator.dashboard.jsx` (add auth check)
- `app/routes/creator.listings._index.jsx` (add auth check)
- `app/routes/creator.listings.new.jsx` (add auth check)
- `app/routes/creator.payouts.jsx` (add auth check)
- `app/routes/creator.settings.jsx` (add auth check)
- `app/routes/creator.jsx` (add auth check in layout)

**Protected Route Pattern**:
```javascript
export async function loader({request, context}) {
  const {isAuthenticated, user} = await checkCreatorAuth(request, context.env);
  if (!isAuthenticated) {
    return redirect('/creator/login');
  }
  // ... rest of loader
}
```

---

### Phase 5: Creator Profile Management
**Goal**: Handle creator profile creation and verification status

**Tasks**:
1. Create helper function `checkCreatorProfileExists()` in `app/lib/supabase.js`
   - Check by `email` (not `user_id`) since schema uses email matching
2. Update callback route to check for creator profile
3. Create/update creator profile route (`/creator/signup` or similar)
4. Handle profile completion flow
5. Separate authentication from creator approval (per requirements doc)
   - User can be authenticated but have `verification_status = 'pending'`

**Files to Create/Modify**:
- `app/lib/supabase.js` (add `checkCreatorProfileExists()`)
- `app/routes/creator.auth.callback.jsx` (add profile check)
- `app/routes/creator.signup.jsx` (create if needed)

**Database Schema (Confirmed)**:
- `creators` table with `email` (matches `auth.users.email`)
- `verification_status` enum: 'pending', 'approved', 'rejected'
- Profile fields: `display_name`, `handle`, `bio`, `primary_platform`, etc.
- RLS policies use `auth.email() = email` pattern

---

### Phase 6: Logout Functionality
**Goal**: Implement secure logout

**Tasks**:
1. Implement logout in `app/routes/creator.logout.jsx`
2. Clear Supabase session
3. Clear session cookies
4. Redirect to login page

**Files to Modify**:
- `app/routes/creator.logout.jsx` (implement logout)
- Add logout helper in `app/lib/supabase.js` if needed

---

### Phase 7: Admin Authentication
**Goal**: Implement admin role checking and access control

**Tasks**:
1. Complete `checkAdminAuth()` implementation in `app/lib/supabase.js`
2. Add admin checks to admin routes
3. Implement admin flag checking from database
4. Test admin access control

**Files to Modify**:
- `app/lib/supabase.js` (lines 226-254)
- `app/routes/admin._index.jsx` (add admin check)
- `app/routes/admin.jsx` (add admin check)
- `app/routes/admin.listings.$id.jsx` (add admin check)
- `app/routes/admin.logistics.jsx` (add admin check)

**Admin Check Pattern** (pending admin identification method):
```javascript
export async function loader({request, context}) {
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  if (!isAdmin) {
    return redirect('/creator/login');
  }
  // ... rest of loader
}
```

**Note**: Admin checking implementation depends on how admins are identified (see Questions to Resolve section).

---

## Detailed Implementation Notes

### Session Cookie Handling

Supabase stores authentication tokens in cookies with the pattern:
- Cookie name: `sb-<project-ref>-auth-token`
- Contains: Access token, refresh token, and user data

**Server-Side Session Reading**:
```javascript
// In getSupabaseSession()
const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Get cookies from request
const cookieHeader = request.headers.get('Cookie') || '';
const cookies = parseCookies(cookieHeader);

// Supabase client will automatically read from cookies if we set them
// But for server-side, we need to manually extract and verify
const {data: {session}, error} = await supabase.auth.getSession();
```

**Important**: For SSR with Supabase, we may need to use a different approach:
- Option 1: Use Supabase's server-side auth helpers
- Option 2: Manually parse cookies and verify tokens
- Option 3: Use Supabase's `getUser()` with the access token from cookies

### OAuth Callback Handling

When Google OAuth completes:
1. Google redirects to: `https://vpzktiosvxbusozfjhrx.supabase.co/auth/v1/callback?code=...`
2. Supabase processes this and redirects to: `http://localhost:3000/creator/auth/callback?code=...`
3. Our callback route receives the `code` parameter
4. We need to exchange the code for a session

**Code Exchange**:
```javascript
const supabase = createClient(supabaseUrl, anonKey);
const {data, error} = await supabase.auth.exchangeCodeForSession(code);
```

### Environment Variables Required

Ensure these are set in your environment:
```env
SUPABASE_URL=https://vpzktiosvxbusozfjhrx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Error Handling

All authentication functions should:
- Return structured error objects: `{error: Error | null, ...}`
- Log errors server-side for debugging
- Return user-friendly error messages to the client
- Handle network errors gracefully

### Security Considerations

1. **Never expose `SUPABASE_SERVICE_ROLE_KEY`** client-side
2. **Always validate redirect URLs** to prevent open redirects
3. **Use HTTPS in production** (required for OAuth)
4. **Set secure cookie flags** (httpOnly, secure, sameSite)
5. **Validate tokens server-side** before trusting them
6. **Implement rate limiting** on login endpoints (future)

## Testing Checklist

### Magic Link Flow
- [ ] Enter email on login page
- [ ] Receive magic link email
- [ ] Click magic link
- [ ] Redirected to callback route
- [ ] Session created successfully
- [ ] Redirected to dashboard
- [ ] Session persists on page refresh

### Google OAuth Flow
- [ ] Click "Continue with Google"
- [ ] Redirected to Google
- [ ] Authorize on Google
- [ ] Redirected back to callback
- [ ] Session created successfully
- [ ] Redirected to dashboard
- [ ] Session persists on page refresh

### Protected Routes
- [ ] Unauthenticated user redirected from `/creator/dashboard`
- [ ] Unauthenticated user redirected from `/creator/listings`
- [ ] Authenticated user can access protected routes
- [ ] Session check works on all protected routes

### Logout
- [ ] Click logout
- [ ] Session cleared
- [ ] Redirected to login
- [ ] Cannot access protected routes after logout

### Admin Routes
- [ ] Non-admin user cannot access admin routes
- [ ] Admin user can access admin routes
- [ ] Admin check works correctly

## Migration Path

1. **Start with Phase 1** - Get basic client working
2. **Test Phase 1** - Verify client creation
3. **Move to Phase 2** - Implement magic links
4. **Test Phase 2** - Full magic link flow
5. **Continue sequentially** through remaining phases
6. **Test each phase** before moving to next

## Future Enhancements (Post-MVP)

- Multi-factor authentication (MFA)
- Device/session management UI
- CAPTCHA for rate limiting
- Social login providers (Twitter, Apple, Discord)
- Password-based auth (if needed)
- Remember me functionality
- Session timeout warnings

## Schema Details (Confirmed)

Based on the provided Supabase schema:

1. **Creators Table**: 
   - Links to Supabase Auth via `email` field (not `user_id`)
   - Has `verification_status` enum: 'pending', 'approved', 'rejected'
   - No `is_admin` field currently exists

2. **RLS Policies**: 
   - Use `auth.email() = email` pattern (not `auth.uid()`)
   - All policies match authenticated user's email to `creators.email`

3. **Admin Authentication**: 
   - **Question**: How should admins be identified?
   - Options:
     a) Add `is_admin` boolean to `creators` table
     b) Create separate `admins` table
     c) Use specific email addresses/domain
     d) Use Supabase Auth metadata/claims

## Questions to Resolve

1. **Admin Identification**: How should we identify admin users? (See options above)
2. **Profile Completion**: What fields are required for creator profile completion?
3. **Session Storage**: Should we use Supabase's cookie-based sessions or custom session storage?
4. **Error Messages**: What level of detail should we show users on auth errors?

## Next Steps

1. Review this plan
2. Confirm database schema for creators and admins
3. Set environment variables
4. Begin Phase 1 implementation
5. Test incrementally as you go

---

**Last Updated**: Based on current codebase state and requirements document
**Status**: Ready for implementation

