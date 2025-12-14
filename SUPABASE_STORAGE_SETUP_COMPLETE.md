# Supabase Storage Setup - Complete Guide

## Step 1: Create Storage Bucket in Supabase Dashboard

1. Go to your **Supabase Dashboard**
2. Navigate to **Storage** → **Buckets**
3. Click **New Bucket**
4. Configure the bucket:
   - **Name**: `creator-profile-images`
   - **Public bucket**: ✅ **Yes** (check this - images need to be publicly accessible)
   - **File size limit**: `5242880` (5MB in bytes)
   - **Allowed MIME types**: `image/jpeg,image/png,image/webp,image/gif`

5. Click **Create bucket**

## Step 2: Set Up RLS Policies

Run this SQL in your Supabase **SQL Editor**:

```sql
-- Policy: Creators can upload their own profile images
-- Note: Email is sanitized in code (replaces @ and . with _)
CREATE POLICY "Creators can upload own profile images"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'creator-profile-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy: Creators can update their own profile images
CREATE POLICY "Creators can update own profile images"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'creator-profile-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy: Creators can delete their own profile images
CREATE POLICY "Creators can delete own profile images"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'creator-profile-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy: Anyone can view profile images (public read)
CREATE POLICY "Public can view profile images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'creator-profile-images');
```

## Step 3: Verify Setup

After running the SQL, verify the policies were created:

```sql
-- Check policies
SELECT * FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND policyname LIKE '%profile images%';
```

You should see 4 policies listed.

## Step 4: Test the Implementation

1. Go to `/creator/settings` page
2. Click "Change avatar" button
3. Select an image file (JPG, PNG, WebP, or GIF)
4. The form will auto-submit and upload the image
5. The image URL will be saved to the `profile_image_url` column in the `creators` table

## Storage Structure

Images are stored in Supabase Storage as:

```
creator-profile-images/
  {sanitized-user-email}/
    profile.{ext}
```

**Note**: Email addresses are sanitized for file paths (replaces `@` and `.` with `_`)

Example:

- Email: `user@example.com`
- File path: `creator-profile-images/user_example_com/profile.jpg`
- Public URL: `https://{project-ref}.supabase.co/storage/v1/object/public/creator-profile-images/user_example_com/profile.jpg`

## Security Features

✅ **RLS Policies**: Only authenticated users can upload to their own folder
✅ **File Type Validation**: Only image types allowed (JPEG, PNG, WebP, GIF)
✅ **File Size Limit**: Maximum 5MB per image
✅ **Public Read**: Images are publicly accessible via CDN
✅ **Private Write**: Only the owner can upload/update/delete

## Troubleshooting

### Error: "new row violates row-level security policy"

- **Solution**: Make sure you ran the RLS policies SQL (Step 2)

### Error: "Bucket not found"

- **Solution**: Verify the bucket name is exactly `creator-profile-images` (case-sensitive)

### Error: "File size exceeds limit"

- **Solution**: Image must be 5MB or less. Compress the image before uploading.

### Image not displaying

- **Solution**:
  1. Check that the bucket is set to **Public**
  2. Verify the URL is correct in the database
  3. Check browser console for CORS errors

## Next Steps

The image upload functionality is now fully integrated! Users can:

- Upload profile images
- Images are automatically saved to Supabase Storage
- Image URLs are stored in the database
- Images are displayed on the settings page
