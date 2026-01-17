# How to Get Your Railway URL

## Step 1: Get the URL from Railway

1. **Click on your "Watch" service** (the purple card that says "Watch" with "Online" status)
2. **Go to the "Settings" tab** (in the top navigation)
3. **Look for "Networking" or "Domains" section**
4. **You'll see a URL like:** `https://your-app-name.up.railway.app`
   - Or it might be: `https://watch-production-xxxx.up.railway.app`

## Alternative: Check the Service Overview

1. Click on "Watch" service
2. Look at the top of the page - the URL might be displayed there
3. Or check the "Deployments" tab - the URL is often shown there

## Step 2: Update Your Frontend Code

Once you have the URL, you need to update `script.js`:

1. Open `script.js` in your code editor
2. Find this line (around line 17):
   ```javascript
   const SERVER_URL = 'http://localhost:3000';
   ```
3. Change it to:
   ```javascript
   const SERVER_URL = 'https://your-railway-url.up.railway.app';
   ```
   (Replace with your actual Railway URL)

4. Save the file
5. Upload the updated `script.js` to GitHub
6. Railway will automatically redeploy (or you can trigger a new deployment)

## Step 3: Test It

1. Open your `index.html` in browser
2. The webpage should now connect to your Railway server
3. Create a room and test!

## Quick Tip

If you can't find the URL:
- Railway sometimes generates it automatically
- Check the "Settings" → "Networking" section
- You might need to add a custom domain or Railway provides a default one

