# Listing Submission Implementation Summary

## ✅ What Has Been Implemented

### 1. Form Updates (`app/routes/creator.listings.new.jsx`)

- ✅ Added **Title** field (required) - maps to `title` column in database
- ✅ Existing fields:
  - **Category** (required) - maps to `category` column
  - **Description** (required) - maps to `story` column
  - **Price** (required) - converts to `price_cents` (multiplied by 100)
  - **Photos** (required, multiple) - uploaded to Supabase Storage

### 2. Action Function Implementation

- ✅ Authentication check using `requireAuth()`
- ✅ Form data validation (title, category, description, price, photos)
- ✅ Price conversion from dollars to cents
- ✅ Creator ID lookup from authenticated user email
- ✅ Listing creation in `listings` table with status `pending_approval`
- ✅ Photo upload to Supabase Storage bucket `listing-photos`
- ✅ Photo records creation in `listing_photos` table
- ✅ Error handling and rollback if photo upload fails

## 📋 What You Need to Do

### Step 1: Create Supabase Storage Bucket

1. Go to **Supabase Dashboard** → **Storage** → **Buckets**
2. Click **New Bucket**
3. Configure:
   - **Name**: `listing-photos` (exact name, case-sensitive)
   - **Public bucket**: ✅ **Yes** (must be checked for public access)
   - **File size limit**: `10485760` (10MB in bytes)
   - **Allowed MIME types**: `image/jpeg,image/png,image/webp,image/gif`
4. Click **Create bucket**

### Step 2: Set Up RLS Policies for Storage

Run this SQL in **Supabase SQL Editor**:

```sql
-- Policy: Creators can upload photos for their own listings
CREATE POLICY "Creators can upload listing photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'listing-photos' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy: Creators can update photos for their own listings
CREATE POLICY "Creators can update listing photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'listing-photos' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy: Creators can delete photos for their own listings
CREATE POLICY "Creators can delete listing photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'listing-photos' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy: Anyone can view listing photos (public read)
CREATE POLICY "Public can view listing photos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'listing-photos');
```

### Step 3: Verify Database Schema

Ensure your database has the following tables and columns:

**`listings` table:**

- `id` (uuid, primary key)
- `creator_id` (uuid, foreign key to creators.id)
- `title` (text, required)
- `category` (text, nullable)
- `story` (text, nullable) - this is the "description" field from the form
- `condition` (text, nullable) - optional, not in form yet
- `price_cents` (integer, required)
- `currency` (text, default 'USD')
- `status` (listing_status enum, default 'draft')
- `created_at` (timestamptz, default now())

**`listing_photos` table:**

- `id` (uuid, primary key)
- `listing_id` (uuid, foreign key to listings.id)
- `storage_path` (text, required)
- `photo_type` (listing_photo_type enum: 'reference', 'intake', 'internal')
- `created_at` (timestamptz, default now())

**`creators` table:**

- `id` (uuid, primary key)
- `email` (text, unique, required)

## 🔒 Security Features

- ✅ **RLS Policies**: Only creators can upload photos to their own folders
- ✅ **Authentication**: Requires authenticated user session
- ✅ **Creator Verification**: Checks that creator profile exists before creating listing
- ✅ **File Path Sanitization**: Email sanitization prevents path traversal
- ✅ **Error Handling**: Rollback listing creation if photo upload fails
- ✅ **Status Control**: Listings created with `pending_approval` status (not publicly visible)

## 📁 File Structure

Photos stored as:

```
listing-photos/
  listings/
    {sanitized-email}/
      {listing-id}/
        {timestamp}-{random}.{ext}
```

Example:

- Email: `user@example.com`
- Listing ID: `abc123-def456-...`
- Path: `listing-photos/listings/user_example_com/abc123-def456-.../1234567890-xyz789.jpg`
- URL: `https://{project-ref}.supabase.co/storage/v1/object/public/listing-photos/listings/user_example_com/abc123-def456-.../1234567890-xyz789.jpg`

## 🎯 How It Works

1. **User fills form** → Title, category, description, price, photos
2. **Form submits** → POST request to `/creator/listings/new`
3. **Action validates** → Checks all required fields and price format
4. **Gets creator_id** → Queries creators table by user email
5. **Creates listing** → Inserts record with status `pending_approval`
6. **Uploads photos** → Each photo uploaded to Supabase Storage
7. **Creates photo records** → Inserts into `listing_photos` table
8. **Redirects** → Sends user to `/creator/listings` page

## 📝 Database Fields Mapping

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

## 🐛 Troubleshooting

### Listing not created

- Check that creator profile exists (user must complete signup first)
- Verify all required fields are filled
- Check browser console for validation errors
- Verify Supabase environment variables are set

### Photos not uploading

- Check bucket name is exactly `listing-photos`
- Verify bucket is set to **Public**
- Check RLS policies are created (see Step 2)
- Verify file size is under 10MB
- Check file type is JPEG, PNG, WebP, or GIF

### RLS policy errors

- Make sure you ran the SQL policies from Step 2
- Verify email sanitization matches (replaces `@` and `.` with `_`)
- Check that folder structure matches: `listings/{sanitized-email}/{listing-id}/`

### Creator profile not found

- User must complete creator signup at `/creator/signup`
- Verify creator record exists in `creators` table with matching email

## 🚀 Ready to Use!

After completing Steps 1-2 above, the listing submission functionality will be fully operational!

## 🔄 Next Steps (Optional Enhancements)

- Add `condition` field to form (maps to `condition` column)
- Add photo preview before submission
- Add progress indicator during photo upload
- Add validation for minimum/maximum price
- Add character limits for title and description
- Add photo compression before upload
