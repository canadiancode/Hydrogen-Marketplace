-- Storage RLS Policies for creator-profile-images bucket
-- These policies allow authenticated users to upload/update/delete their own profile images
-- and allow public read access to all profile images

-- Drop existing policies if they exist (for idempotence)
DROP POLICY IF EXISTS "Creators can upload own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Creators can update own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Creators can delete own profile images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view profile images" ON storage.objects;

-- Policy: Creators can upload their own profile images
-- Note: Email is sanitized in code (replaces @ and . with _)
-- The folder name must match the sanitized email
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
