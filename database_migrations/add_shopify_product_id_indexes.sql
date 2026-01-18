-- Migration: Add indexes for shopify_product_id lookups
-- Purpose: Optimize webhook queries that match listings by shopify_product_id
-- Date: 2025-01-XX
-- 
-- These indexes improve performance when:
-- 1. Webhook handler queries listings by shopify_product_id
-- 2. Finding listings with specific status (e.g., 'live')
--
-- Run this in Supabase SQL Editor or via migration tool

-- Index for shopify_product_id lookups (partial index for non-null values)
CREATE INDEX IF NOT EXISTS idx_listings_shopify_product_id 
ON listings(shopify_product_id) 
WHERE shopify_product_id IS NOT NULL;

-- Composite index for the common webhook query pattern
-- This optimizes: WHERE shopify_product_id = X AND status = 'live'
CREATE INDEX IF NOT EXISTS idx_listings_shopify_product_id_status 
ON listings(shopify_product_id, status) 
WHERE shopify_product_id IS NOT NULL AND status = 'live';

-- Optional: Index for status lookups (if not already exists)
-- Useful for queries filtering by status
CREATE INDEX IF NOT EXISTS idx_listings_status 
ON listings(status) 
WHERE status IN ('live', 'sold', 'pending_approval', 'draft');
