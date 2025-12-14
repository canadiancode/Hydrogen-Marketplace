# Environment Variables Setup for WornVault

## Required Environment Variables

Your `.env` file should contain:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional: For admin operations
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Important Notes

1. **No quotes needed** - Don't wrap values in quotes:
   ```env
   # ✅ Correct
   SUPABASE_URL=https://abc123.supabase.co
   
   # ❌ Wrong
   SUPABASE_URL="https://abc123.supabase.co"
   ```

2. **No spaces** - Don't add spaces around the `=`:
   ```env
   # ✅ Correct
   SUPABASE_URL=https://abc123.supabase.co
   
   # ❌ Wrong
   SUPABASE_URL = https://abc123.supabase.co
   ```

3. **File location** - The `.env` file should be in the **root** of your project (same level as `package.json`)

## Verifying Environment Variables

After adding your variables:

1. **Restart your dev server** - Environment variables are loaded when the server starts
   ```bash
   # Stop the server (Ctrl+C) and restart
   npm run dev
   ```

2. **Check server console** - When you click the login button, you should see logs like:
   ```
   Environment check: {
     hasEnv: true,
     envKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
     supabaseUrl: 'https://...',
     anonKey: 'Set'
   }
   ```

3. **If variables are missing** - You'll see an error message in the browser and logs in the console

## Troubleshooting

### Variables not loading?

1. **Check file name** - Must be exactly `.env` (not `.env.local`, `.env.development`, etc.)

2. **Check file location** - Should be in project root:
   ```
   worn-vault/
   ├── .env          ← Here
   ├── package.json
   ├── app/
   └── ...
   ```

3. **Restart server** - Environment variables are only loaded on server start

4. **Check for typos** - Variable names are case-sensitive:
   - ✅ `SUPABASE_URL`
   - ❌ `supabase_url` or `SUPABASE_url`

### Still not working?

Check your server console when clicking the login button. The debug logs will show:
- What environment variables are available
- Which ones are missing
- The exact error message

