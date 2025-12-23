-- RLS Policies for listing-photos Storage Bucket
-- These policies allow creators to upload photos for their listings

-- Enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy 1: Creators can upload photos to their own listing folders
-- Path structure: listings/{creator_id}/{listing_id}/{filename}
-- This policy checks that the creator_id in the path matches the authenticated user's creator_id
CREATE POLICY "Creators can upload listing photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'listing-photos' AND
  (storage.foldername(name))[1] = 'listings' AND
  -- Check that the creator_id in the path matches the authenticated user's creator_id
  -- This requires joining with the creators table to get creator_id from auth.email()
  (storage.foldername(name))[2] IN (
    SELECT id::text 
    FROM creators 
    WHERE user_id = auth.uid()
  )
);

-- Policy 2: Creators can update photos in their own listing folders
CREATE POLICY "Creators can update own listing photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'listing-photos' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] IN (
    SELECT id::text 
    FROM creators 
    WHERE user_id = auth.uid()
  )
);

-- Policy 3: Creators can delete photos from their own listing folders
CREATE POLICY "Creators can delete own listing photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'listing-photos' AND
  (storage.foldername(name))[1] = 'listings' AND
  (storage.foldername(name))[2] IN (
    SELECT id::text 
    FROM creators 
    WHERE user_id = auth.uid()
  )
);

-- Policy 4: Public can view listing photos (since bucket is public)
CREATE POLICY "Public can view listing photos"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'listing-photos'
);

