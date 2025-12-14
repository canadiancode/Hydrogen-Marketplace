# Supabase Setup Troubleshooting Guide

## "Database error saving new user" Error

This error typically indicates a Supabase database configuration issue. Here's how to fix it:

### 1. Check Database Triggers

Supabase requires database triggers to be set up for the `auth.users` table. These are usually created automatically, but may be missing.

**Solution:**
1. Go to Supabase Dashboard → SQL Editor
2. Run this query to check if triggers exist:

```sql
SELECT * FROM pg_trigger WHERE tgname LIKE '%auth%';
```

3. If triggers are missing, Supabase should have created them automatically. Try:
   - Go to Authentication → Settings
   - Check "Enable email confirmations" (or disable if you want passwordless)
   - Save settings

### 2. Check Email Provider Settings

**In Supabase Dashboard:**
1. Go to **Authentication** → **Settings** → **Email Templates**
2. Ensure **Email Auth** is enabled
3. Check **Email confirmation** settings:
   - For magic links: Can be disabled (they're one-time use)
   - For regular signups: Should be enabled

### 3. Verify SMTP Configuration

**For Production:**
- Set up custom SMTP (recommended)
- Go to **Project Settings** → **Auth** → **SMTP Settings**
- Configure your SMTP provider (SendGrid, AWS SES, etc.)

**For Development:**
- Supabase's default email service should work
- Check spam folder
- Verify email is not blocked

### 4. Check RLS Policies

Ensure RLS policies aren't blocking user creation:

```sql
-- Check if auth schema is accessible
SELECT * FROM auth.users LIMIT 1;
```

If this fails, there's a database permission issue.

### 5. Verify Database Extensions

Ensure required extensions are enabled:

```sql
-- Check uuid extension
SELECT * FROM pg_extension WHERE extname = 'uuid-ossp';

-- If missing, create it:
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 6. Check Supabase Project Status

1. Go to **Project Settings** → **General**
2. Verify project is active and not paused
3. Check for any service alerts

### 7. Test Email Sending

1. Go to **Authentication** → **Users**
2. Try manually sending a test email
3. Check **Logs** for any errors

### 8. Common Configuration Issues

**Issue: Email confirmation required but not configured**
- Solution: Disable email confirmation for magic links in Auth settings

**Issue: Database migrations not applied**
- Solution: Check if all migrations have been run

**Issue: Service role key permissions**
- Solution: Ensure service role key has proper permissions (should be automatic)

### 9. Debug Steps

1. **Check Supabase Logs:**
   - Go to **Logs** → **Auth Logs**
   - Look for detailed error messages

2. **Test with Supabase CLI:**
   ```bash
   supabase auth sign-in --email test@example.com
   ```

3. **Verify Environment Variables:**
   - Ensure `SUPABASE_URL` is correct
   - Ensure `SUPABASE_ANON_KEY` is the anon/public key (not service role)

### 10. Quick Fix Checklist

- [ ] Email Auth enabled in Authentication settings
- [ ] Email templates configured
- [ ] Database triggers exist
- [ ] RLS policies allow auth operations
- [ ] UUID extension enabled
- [ ] Project is active (not paused)
- [ ] Environment variables are correct
- [ ] SMTP configured (for production)

### Still Having Issues?

1. Check Supabase Status: https://status.supabase.com
2. Review Supabase Auth Docs: https://supabase.com/docs/guides/auth
3. Check Supabase Discord/Forum for similar issues

## Email Not Received

If magic link email is not received:

1. **Check Spam Folder** - Most common issue
2. **Verify Email Address** - Ensure it's correct
3. **Check Supabase Logs** - See if email was sent
4. **Rate Limiting** - Wait a few minutes between requests
5. **SMTP Configuration** - For production, use custom SMTP
6. **Email Provider Blocking** - Some providers block automated emails

## Best Practices

1. **Use Custom SMTP for Production**
   - Better deliverability
   - More control
   - Professional appearance

2. **Configure Email Templates**
   - Customize magic link emails
   - Match your brand
   - Clear instructions

3. **Monitor Auth Logs**
   - Track signup attempts
   - Identify issues early
   - Debug problems

4. **Set Up Rate Limiting**
   - Prevent abuse
   - Protect your email reputation
   - Use Supabase's built-in rate limiting

