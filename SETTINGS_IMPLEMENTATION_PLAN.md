# Creator Settings Page - Database Connection Implementation Plan

## Overview

Connect the `/creator/settings` page form inputs to Supabase database, excluding image upload (to be handled separately). Remove password-related sections since authentication uses OTP/magic links.

## Current State Analysis

### Form Fields Present

1. **Personal Information Section:**
   - `first-name` → `first_name` (DB column)
   - `last-name` → `last_name` (DB column)
   - `email` → `email` (DB column, should be read-only)
   - `username` → `handle` (DB column, unique constraint)
   - `timezone` → ❌ Not in DB (skip for now)
   - `displayName` → `display_name` (DB column, required)
   - `bio` → `bio` (DB column)
   - `notificationEmail` → ❌ Not in DB (skip for now)
   - `payoutMethod` → `payout_method` (DB column)

2. **Sections to Remove:**
   - Change Password Section (lines 249-324)
   - Log Out Other Sessions Section (lines 326-366)

3. **Keep:**
   - Delete Account Section (can be implemented later)

## Implementation Steps

### Step 1: Create Helper Functions (`app/lib/supabase.js`)

**Function 1: `fetchCreatorProfile`**

- Purpose: Fetch creator profile by email
- Parameters: `userEmail`, `supabaseUrl`, `anonKey`, `accessToken`
- Returns: Creator profile object or null
- Error handling: Handle missing profile gracefully (new creator)

**Function 2: `updateCreatorProfile`**

- Purpose: Update creator profile fields
- Parameters: `userEmail`, `updates` (object), `supabaseUrl`, `anonKey`, `accessToken`
- Returns: Updated profile object
- Error handling:
  - Handle unique constraint violations (handle/username)
  - Handle validation errors
  - Return user-friendly error messages

### Step 2: Update Loader (`app/routes/creator.settings.jsx`)

**Current Issues:**

- Returns hardcoded empty profile data
- Doesn't fetch from database

**Changes Needed:**

1. Import helper functions from `~/lib/supabase`
2. Get user session (already have `user` from `requireAuth`)
3. Fetch creator profile using `fetchCreatorProfile`
4. Map database fields to form field names:
   ```javascript
   {
     firstName: profile.first_name || '',
     lastName: profile.last_name || '',
     email: profile.email || user.email || '',
     username: profile.handle || '',
     displayName: profile.display_name || '',
     bio: profile.bio || '',
     payoutMethod: profile.payout_method || '',
   }
   ```
5. Handle case where profile doesn't exist (new creator) - return defaults
6. Handle errors gracefully (log but don't crash)

### Step 3: Update Action (`app/routes/creator.settings.jsx`)

**Current Issues:**

- Returns hardcoded success
- Doesn't update database
- No form action type handling

**Changes Needed:**

1. Import helper functions from `~/lib/supabase`
2. Get form data
3. Extract form fields:
   - `first-name` → `firstName`
   - `last-name` → `lastName`
   - `username` → `username` (maps to `handle`)
   - `displayName` → `displayName` (maps to `display_name`)
   - `bio` → `bio`
   - `payoutMethod` → `payoutMethod` (maps to `payout_method`)
   - `email` → Skip (read-only, shouldn't be updated)
4. Validate required fields:
   - `display_name` is required (NOT NULL in DB)
   - `handle` is required (NOT NULL in DB)
5. Call `updateCreatorProfile` with updates
6. Handle errors:
   - Unique constraint violation (username/handle taken)
   - Validation errors
   - Network errors
7. Return appropriate response:
   - Success: `{success: true, message: 'Profile updated successfully'}`
   - Error: `{success: false, error: 'Error message'}`

### Step 4: Update Component (`app/routes/creator.settings.jsx`)

**Changes Needed:**

1. **Remove Password Sections:**
   - Remove "Change Password Section" (lines 249-324)
   - Remove "Log Out Other Sessions Section" (lines 326-366)

2. **Update Personal Information Form:**
   - Add `method="post"` to form
   - Make email field read-only:
     - Add `readOnly` attribute
     - Add visual indication (gray background or disabled styling)
     - Remove from form submission (or explicitly skip in action)

3. **Add Form Feedback:**
   - Import `useActionData` from `react-router`
   - Import `useNavigation` from `react-router`
   - Display success/error messages
   - Show loading state during submission
   - Disable form during submission

4. **Update Form Fields:**
   - Ensure all fields use `defaultValue` (already done)
   - Ensure form field names match what we extract in action

5. **Handle Timezone & Notification Email:**
   - Keep fields in UI but don't submit to database (or remove them)
   - Option: Remove these fields since they're not in DB
   - **Decision: Remove timezone and notificationEmail fields for now**

### Step 5: Error Handling & UX

**Error Display:**

- Use `useActionData()` to get error/success messages
- Display errors above form or inline with fields
- Show success message (can auto-dismiss after 3 seconds)

**Loading States:**

- Use `useNavigation()` to detect form submission
- Disable submit button during submission
- Show loading indicator

**Validation:**

- Client-side: HTML5 validation + custom checks
- Server-side: Required field validation
- Handle unique constraint errors (username taken)

## Field Mapping Reference

| Form Field Name     | Database Column | Required | Notes                |
| ------------------- | --------------- | -------- | -------------------- |
| `first-name`        | `first_name`    | No       | Nullable             |
| `last-name`         | `last_name`     | No       | Nullable             |
| `email`             | `email`         | Yes      | Read-only, from auth |
| `username`          | `handle`        | Yes      | Unique constraint    |
| `displayName`       | `display_name`  | Yes      | Required in DB       |
| `bio`               | `bio`           | No       | Nullable             |
| `payoutMethod`      | `payout_method` | No       | Nullable             |
| `timezone`          | ❌              | N/A      | Remove from form     |
| `notificationEmail` | ❌              | N/A      | Remove from form     |

## Code Structure

### Helper Functions Location

`app/lib/supabase.js` - Add two new exported functions

### Route File Structure

```javascript
// Imports
import {Form, useLoaderData, useActionData, useNavigation} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, updateCreatorProfile} from '~/lib/supabase';

// Loader
export async function loader({context, request}) {
  // Fetch profile from DB
}

// Action
export async function action({request, context}) {
  // Update profile in DB
}

// Component
export default function CreatorSettings() {
  const {profile, user} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  // Render form with error/success messages
}
```

## Testing Checklist

- [ ] Load existing profile data correctly
- [ ] Handle missing profile (new creator)
- [ ] Update profile successfully
- [ ] Display success message after update
- [ ] Handle unique constraint error (username taken)
- [ ] Handle validation errors (required fields)
- [ ] Email field is read-only
- [ ] Form shows loading state during submission
- [ ] Form is disabled during submission
- [ ] Password sections are removed
- [ ] Timezone and notificationEmail fields are removed
- [ ] Error messages display correctly
- [ ] Page reloads with updated data after successful save

## Security Considerations

1. **RLS Policies**: Ensure UPDATE policy exists (already planned)
2. **Email Changes**: Email is read-only (tied to auth)
3. **Handle Uniqueness**: Validate before allowing update
4. **Required Fields**: Enforce `display_name` and `handle` requirements
5. **Input Sanitization**: Supabase handles SQL injection, but validate input format

## Next Steps After Implementation

1. Test thoroughly
2. Add image upload functionality (separate task)
3. Implement delete account functionality (if needed)
4. Add timezone/notificationEmail if database columns are added later
