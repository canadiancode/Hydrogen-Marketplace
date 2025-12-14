# Supabase Storage Setup for Creator Profile Images

## Step 1: Create Storage Bucket in Supabase

1. Go to your Supabase Dashboard
2. Navigate to **Storage** → **Buckets**
3. Click **New Bucket**
4. Configure:
   - **Name**: `creator-profile-images`
   - **Public**: ✅ Yes (so images can be accessed via URL)
   - **File size limit**: 5MB (recommended for profile images)
   - **Allowed MIME types**: `image/jpeg, image/png, image/webp, image/gif`

## Step 2: Set Up RLS Policies

Run this SQL in Supabase SQL Editor:

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
  (storage.foldername(name))[1] = auth.email()
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

## Step 3: Storage Path Structure

Images will be stored as:

```
creator-profile-images/
  {user-email}/
    profile.{ext}
```

**Note**: Email addresses are sanitized for file paths (replaces `@` and `.` with `_`)

Example:

- Email: `user@example.com`
- File path: `creator-profile-images/user_example_com/profile.jpg`

## Benefits

- ✅ Secure: Only users can upload to their own folder
- ✅ Organized: Each user has their own folder
- ✅ Public URLs: Images accessible via CDN
- ✅ Free tier: 1GB storage, 2GB bandwidth/month
- ✅ Fast: Global CDN included
