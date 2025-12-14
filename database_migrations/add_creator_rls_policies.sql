-- Migration: Add INSERT and UPDATE RLS policies for creators table
-- Date: 2025-01-XX
-- Description: Allows creators to insert and update their own profiles

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Creators can insert own profile" ON public.creators;
DROP POLICY IF EXISTS "Creators can update own profile" ON public.creators;

-- Policy: Creators can insert their own profile
-- This allows authenticated users to create their creator profile
CREATE POLICY "Creators can insert own profile"
ON public.creators
FOR INSERT
WITH CHECK (auth.email() = email);

-- Policy: Creators can update their own profile
-- This allows authenticated users to update their creator profile
CREATE POLICY "Creators can update own profile"
ON public.creators
FOR UPDATE
USING (auth.email() = email)
WITH CHECK (auth.email() = email);
