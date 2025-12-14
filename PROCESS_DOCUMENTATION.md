# WornVault Process Documentation

This document consolidates all implementation, setup, and troubleshooting documentation for the WornVault project.

---

## Table of Contents

1. [Environment Setup](#environment-setup)
2. [Supabase Configuration](#supabase-configuration)
3. [Authentication Implementation](#authentication-implementation)
4. [Listing Submission](#listing-submission)
5. [Image Upload](#image-upload)
6. [Settings Implementation](#settings-implementation)
7. [Security & Best Practices](#security--best-practices)
8. [Troubleshooting](#troubleshooting)
9. [Implementation Phases](#implementation-phases)

---

## Environment Setup

### Required Environment Variables

Your `.env` file should contain:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional: For admin operations
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### Important Notes

1. **No quotes needed** - Don't wrap values in quotes
2. **No spaces** - Don't add spaces around the `=`
3. **File location** - The `.env` file should be in the **root** of your project

### Verifying Environment Variables

1. **Restart your dev server** - Environment variables are loaded when the server starts
2. **Check server console** - Look for environment check logs
3. **If variables are missing** - You'll see an error message in the browser and logs in the console

---

## Supabase Configuration

### Supabase Auth Setup

#### 1. Enable Email Magic Links

1. Go to Authentication > Providers in Supabase dashboard
2. Enable "Email" provider
3. Configure email templates (optional, defaults work fine)
4. Set redirect URLs:
   - Add `http://localhost:3000/creator/auth/callback` for local development
   - Add your production URL: `https://yourdomain.com/creator/auth/callback`

#### 2. Enable Google OAuth (Optional but Recommended)

1. Go to Authentication > Providers
2. Enable "Google" provider
3. Add your Google OAuth credentials:
   - Client ID
   - Client Secret
4. Add authorized redirect URIs:
   - `http://localhost:3000/creator/auth/callback` (local)
   - `https://yourdomain.com/creator/auth/callback` (production)

#### 3. Configure Row Level Security (RLS)

RLS policies will be set up in your database schema. See database migrations in `database_migrations/` directory.

### Storage Buckets Setup

#### Creator Profile Images Bucket

1. Go to **Supabase Dashboard** → **Storage** → **Buckets**
2. Click **New Bucket**
3. Configure:
   - **Name**: `creator-profile-images` (exact name, case-sensitive)
   - **Public bucket**: ✅ **Yes** (must be checked)
   - **File size limit**: `5242880` (5MB in bytes)
   - **Allowed MIME types**: `image/jpeg,image/png,image/webp,image/gif`

#### Listing Photos Bucket

1. Go to **Supabase Dashboard** → **Storage** → **Buckets**
2. Click **New Bucket**
3. Configure:
   - **Name**: `listing-photos` (exact name, case-sensitive)
   - **Public bucket**: ✅ **Yes** (must be checked for public access)
   - **File size limit**: `10485760` (10MB in bytes)
   - **Allowed MIME types**: `image/jpeg,image/png,image/webp,image/gif`

### RLS Policies for Storage

Run these SQL policies in **Supabase SQL Editor**:

```sql
-- Profile Images Policies
CREATE POLICY "Creators can upload own profile images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'creator-profile-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

CREATE POLICY "Creators can update own profile images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'creator-profile-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

CREATE POLICY "Creators can delete own profile images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'creator-profile-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

CREATE POLICY "Public can view profile images"
ON storage.objects FOR SELECT
USING (bucket_id = 'creator-profile-images');

-- Listing Photos Policies
CREATE POLICY "Creators can upload listing photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'listing-photos' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

CREATE POLICY "Creators can update listing photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'listing-photos' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

CREATE POLICY "Creators can delete listing photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'listing-photos' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

CREATE POLICY "Public can view listing photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'listing-photos');
```

---

## Authentication Implementation

### Schema Characteristics

**Important**: The schema links Supabase Auth users to creators via **email**, not `user_id`.

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

### Authentication Flow

#### Magic Link Flow

1. User enters email on `/creator/login`
2. `sendMagicLink()` sends email via Supabase
3. User clicks link in email
4. Redirected to `/creator/auth/callback?token_hash=...&type=magiclink`
5. `verifyMagicLink()` verifies token and creates session
6. User redirected to `/creator/dashboard`

#### Google OAuth Flow

1. User clicks "Continue with Google" on `/creator/login`
2. `initiateGoogleOAuth()` redirects to Google
3. User authorizes on Google
4. Google redirects to `/creator/auth/callback?code=...`
5. Supabase exchanges code for session
6. User redirected to `/creator/dashboard`

### Session Cookie Handling

The callback route sets the Supabase session cookie:

- **Cookie Name**: `sb-<project-ref>-auth-token`
- **Cookie Format**: JSON string containing access_token, refresh_token, expires_at, etc.
- **Cookie Attributes**: Path=/, HttpOnly, SameSite=Lax, Secure (if HTTPS)

---

## Listing Submission

### Form Fields

- **Title** (required) - maps to `title` column
- **Category** (required) - maps to `category` column
- **Description** (required) - maps to `story` column
- **Price** (required) - converts to `price_cents` (multiplied by 100)
- **Photos** (required, multiple) - uploaded to Supabase Storage

### Database Fields Mapping

| Form Field    | Database Column  | Type    | Notes                      |
| ------------- | ---------------- | ------- | -------------------------- |
| `title`       | `title`          | text    | Required                   |
| `category`    | `category`       | text    | Required                   |
| `description` | `story`          | text    | Required                   |
| `price`       | `price_cents`    | integer | Converted: `price * 100`   |
| -             | `currency`       | text    | Default: 'USD'             |
| -             | `status`         | enum    | Set to: 'pending_approval' |
| -             | `creator_id`     | uuid    | From authenticated user    |
| `photos[]`    | `listing_photos` | table   | Multiple records created   |

### File Structure

Photos stored as:

```
listing-photos/
  listings/
    {sanitized-email}/
      {listing-id}/
        {timestamp}-{random}.{ext}
```

### How It Works

1. User fills form → Title, category, description, price, photos
2. Form submits → POST request to `/creator/listings/new`
3. Action validates → Checks all required fields and price format
4. Gets creator_id → Queries creators table by user email
5. Creates listing → Inserts record with status `pending_approval`
6. Uploads photos → Each photo uploaded to Supabase Storage
7. Creates photo records → Inserts into `listing_photos` table
8. Redirects → Sends user to `/creator/listings` page

---

## Image Upload

### Profile Image Upload

#### Implementation

- `uploadProfileImage()` function - Uploads images to Supabase Storage
- `deleteProfileImage()` function - Deletes user's profile images
- File type validation (JPEG, PNG, WebP, GIF)
- File size validation (5MB max)
- Email sanitization for file paths

#### File Structure

Images stored as:

```
creator-profile-images/
  {sanitized-email}/
    profile.{ext}
```

#### How It Works

1. User selects image → File input triggers
2. Form auto-submits → `onChange` handler submits form
3. Action receives file → Extracts `profileImage` from FormData
4. Uploads to Supabase → `uploadProfileImage()` function
5. Gets public URL → Returns CDN URL
6. Saves to database → Updates `profile_image_url` column
7. Displays image → Shows uploaded image on page

---

## Settings Implementation

### Form Fields

| Form Field Name | Database Column | Required | Notes                |
| --------------- | --------------- | -------- | -------------------- |
| `first-name`    | `first_name`    | No       | Nullable             |
| `last-name`     | `last_name`     | No       | Nullable             |
| `email`         | `email`         | Yes      | Read-only, from auth |
| `username`      | `handle`        | Yes      | Unique constraint    |
| `displayName`   | `display_name`  | Yes      | Required in DB       |
| `bio`           | `bio`           | No       | Nullable             |
| `payoutMethod`  | `payout_method` | No       | Nullable             |

### Implementation Details

- Loader fetches creator profile from database
- Action updates profile fields
- Form uses `defaultValue` for controlled inputs
- Email field is read-only
- Password sections removed (using OTP/magic links)

---

## Security & Best Practices

### Security Features Implemented

#### 1. XSS Protection

- HTML sanitization using DOMPurify on all `dangerouslySetInnerHTML` usage
- Prevents malicious script injection attacks

#### 2. SQL Injection Protection

- Supabase uses parameterized queries automatically
- All database queries use Supabase's safe query builder

#### 3. Error Information Leakage Prevention

- ErrorBoundary only shows detailed errors in development
- Production errors show user-friendly messages
- Full error details logged server-side only

#### 4. Authentication Security

- Server-side token validation (no client-side JWT parsing)
- Rate limiting on auth endpoints (5 req/15min login, 10 req/15min callback)
- Secure cookie configuration (SameSite=Strict, HttpOnly, Secure in production)

#### 5. Input Validation & Sanitization

- Comprehensive validation utilities for email, handles, passwords
- All user inputs validated and sanitized before processing

#### 6. Request Security

- Request size limits (10MB maximum)
- Request timeout protection (30 seconds)
- CSRF token validation

### RLS Policies

- Creators can only access their own records
- Admins can access all records
- Storage policies enforce user-specific folder access

---

## Troubleshooting

### Environment Variables Not Loading

1. Check file name - Must be exactly `.env` (not `.env.local`, `.env.development`, etc.)
2. Check file location - Should be in project root
3. Restart server - Environment variables are only loaded on server start
4. Check for typos - Variable names are case-sensitive

### Authentication Issues

#### Magic link not received

- Check spam folder
- Verify email provider settings in Supabase
- Check Supabase logs for errors

#### OAuth redirect errors

- Verify redirect URLs match exactly in Supabase dashboard
- Check Google OAuth credentials are correct
- Ensure HTTPS in production

#### Session not persisting

- Check cookie settings
- Verify domain settings
- Ensure session is being set correctly

### Listing Submission Issues

#### Listing not created

- Check that creator profile exists (user must complete signup first)
- Verify all required fields are filled
- Check browser console for validation errors
- Verify Supabase environment variables are set

#### Photos not uploading

- Check bucket name is exactly `listing-photos`
- Verify bucket is set to **Public**
- Check RLS policies are created
- Verify file size is under 10MB
- Check file type is JPEG, PNG, WebP, or GIF

### Image Upload Issues

#### Image not uploading

- Check bucket name is exactly `creator-profile-images`
- Verify bucket is set to **Public**
- Check RLS policies are created
- Check browser console for errors

#### Image not displaying

- Check `profile_image_url` column has the URL
- Verify bucket is public
- Check URL format in database

---

## Implementation Phases

### Phase 1: Core Supabase Client Setup ✅

**Completed**: Core Supabase client creation and session management

- `createServerSupabaseClient()` - Creates client with service role key
- `createUserSupabaseClient()` - Creates client for authenticated users
- `getSupabaseSession()` - Extracts session from request cookies
- `checkCreatorAuth()` - Convenience function for auth checks

### Phase 2: Magic Link Authentication ✅

**Completed**: Email magic link login for creators

- `sendMagicLink()` - Sends magic link email
- `verifyMagicLink()` - Verifies token and creates session
- `checkCreatorProfileExists()` - Checks if creator profile exists
- Session cookie handling after verification

### Phase 3: Google OAuth Authentication ✅

**Completed**: Google OAuth login for creators

- `initiateGoogleOAuth()` - Initiates OAuth flow
- OAuth callback handling
- Code exchange for session
- Session cookie handling after OAuth

### Phase 4: Session Management ✅

**Completed**: Robust session reading and authentication verification

- Complete session reading implementation
- Token refresh handling
- Creator profile checking
- Admin authentication

---

## Additional Resources

- Database migrations: `database_migrations/`
- Supabase client utilities: `app/lib/supabase.js`
- Authentication helpers: `app/lib/auth-helpers.js`
- Image upload utilities: `app/lib/image-upload.js`
- Rate limiting: `app/lib/rate-limit.js`
- HTML sanitization: `app/lib/sanitize.js`

---

_Last updated: Consolidated from multiple process documentation files_
