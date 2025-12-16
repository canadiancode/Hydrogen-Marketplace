-- RLS Policies for creator-cover-images Storage Bucket
-- These policies mirror the creator-profile-images bucket policies

-- Policy 1: Creators can upload own cover images
CREATE POLICY "Creators can upload own cover images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'creator-cover-images' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy 2: Creators can update own cover images
CREATE POLICY "Creators can update own cover images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'creator-cover-images' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy 3: Creators can delete own cover images
CREATE POLICY "Creators can delete own cover images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'creator-cover-images' AND
  (storage.foldername(name))[1] = replace(replace(auth.email(), '@', '_'), '.', '_')
);

-- Policy 4: Public can view cover images
CREATE POLICY "Public can view cover images"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'creator-cover-images'
);
