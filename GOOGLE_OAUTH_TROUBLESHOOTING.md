# Google OAuth Troubleshooting

If clicking the Google button doesn't redirect you to Google's login page, check the following:

## 1. Verify Supabase Configuration

### Enable Google OAuth in Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Google** in the list
4. Click to enable it
5. Add your Google OAuth credentials:
   - **Client ID** (from Google Cloud Console)
   - **Client Secret** (from Google Cloud Console)

### Configure Redirect URLs

In Supabase dashboard, under **Authentication** > **URL Configuration**:

**Site URL:**
- Local: `http://localhost:3000`
- Production: `https://yourdomain.com`

**Redirect URLs** (add both):
- `http://localhost:3000/creator/auth/callback`
- `https://yourdomain.com/creator/auth/callback`

## 2. Verify Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google+ API**
4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. **Authorized redirect URIs** (add):
   - `https://YOUR_SUPABASE_PROJECT.supabase.co/auth/v1/callback`
   - (Supabase will handle the redirect to your app)

## 3. Check Environment Variables

Verify these are set in your `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

## 4. Check Browser Console

Open browser DevTools (F12) and check:
- **Console tab** for any JavaScript errors
- **Network tab** to see if the request to `/creator/login` is being made
- Look for any failed requests

## 5. Check Server Logs

When you click the Google button, check your terminal/console where the dev server is running for any error messages.

## 6. Test the OAuth Flow Manually

You can test if Supabase OAuth is working by visiting:
```
https://YOUR_SUPABASE_PROJECT.supabase.co/auth/v1/authorize?provider=google
```

If this redirects to Google, then Supabase is configured correctly and the issue is in the app code.

## Common Issues

### Issue: "Failed to initiate Google OAuth"
- **Cause**: Google OAuth not enabled in Supabase
- **Fix**: Enable Google provider in Supabase dashboard

### Issue: Redirect URL mismatch
- **Cause**: Redirect URL not in Supabase allowed list
- **Fix**: Add the exact redirect URL to Supabase dashboard

### Issue: No redirect happens at all
- **Cause**: Error in the action function
- **Fix**: Check server logs and browser console for errors

### Issue: "Invalid client" error
- **Cause**: Wrong Google OAuth credentials
- **Fix**: Verify Client ID and Secret in Supabase dashboard match Google Cloud Console

## Debugging Steps

1. Add console.log to see what's happening:
   ```javascript
   console.log('OAuth initiated', {url, error});
   ```

2. Check if environment variables are loaded:
   ```javascript
   console.log('Env check', {
     hasUrl: !!env.SUPABASE_URL,
     hasKey: !!env.SUPABASE_ANON_KEY
   });
   ```

3. Verify the redirect URL format:
   ```javascript
   console.log('Redirect URL', redirectTo);
   ```

