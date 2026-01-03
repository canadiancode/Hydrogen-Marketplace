-- Migration: Add PayPal email verification columns to creators table
-- Run this SQL in your Supabase SQL Editor

-- Add PayPal email verification columns
ALTER TABLE creators 
ADD COLUMN IF NOT EXISTS paypal_email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS paypal_payer_id TEXT,
ADD COLUMN IF NOT EXISTS paypal_email_verified_at TIMESTAMP WITH TIME ZONE;

-- Add comment to columns for documentation
COMMENT ON COLUMN creators.paypal_email_verified IS 'Whether the PayPal email has been verified via PayPal API';
COMMENT ON COLUMN creators.paypal_payer_id IS 'PayPal payer ID returned from verification API';
COMMENT ON COLUMN creators.paypal_email_verified_at IS 'Timestamp when PayPal email was verified';

