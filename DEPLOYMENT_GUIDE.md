# Deployment Guide - Make Your MovieHub Accessible Online

## The Problem
GitHub Pages can only host static files (HTML/CSS/JS). It **cannot** run a Node.js server. So if you upload to GitHub Pages, the server won't run and the webpage won't work.

## Solution: Deploy to a Free Hosting Service

You have several free options to host your server:

### Option 1: Railway (Recommended - Easiest)
**Free tier available**

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Connect your GitHub account
6. Select your repository
7. Railway will automatically detect it's a Node.js app
8. It will deploy and give you a URL like: `https://your-app.railway.app`
9. Update `SERVER_URL` in `script.js` to use this URL

### Option 2: Render
**Free tier available**

1. Go to https://render.com
2. Sign up
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Set:
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Deploy
7. Get your URL and update `SERVER_URL`

### Option 3: Fly.io
**Free tier available**

1. Install Fly CLI
2. Run: `fly launch`
3. Follow prompts
4. Deploy

## What You Need to Do

### Step 1: Upload to GitHub
1. Create a new repository on GitHub
2. Upload all your files (except `node_modules` and `uploads/` folder)
3. Make sure `.gitignore` is there to exclude those

### Step 2: Deploy Server
Use one of the services above (Railway is easiest)

### Step 3: Update Frontend
Change `SERVER_URL` in `script.js` from:
```javascript
const SERVER_URL = 'http://localhost:3000';
```
To:
```javascript
const SERVER_URL = 'https://your-deployed-url.com';
```

### Step 4: Deploy Frontend
- Option A: GitHub Pages (for the HTML/CSS/JS files)
- Option B: Same hosting service (serve static files from server)
- Option C: Netlify/Vercel (free static hosting)

## Quick Setup for Railway (Recommended)

1. **Upload to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy on Railway:**
   - Sign up at railway.app
   - New Project → Deploy from GitHub
   - Select your repo
   - Railway auto-detects Node.js
   - Get your URL

3. **Update script.js:**
   - Change SERVER_URL to your Railway URL

4. **Redeploy or push changes**

## Important Notes

- **Free tiers have limits:** May sleep after inactivity
- **File storage:** Uploaded videos are stored on the server (may need cloud storage for production)
- **CORS:** Make sure your server allows requests from your frontend domain

## Alternative: Keep It Local

If you want to keep it simple:
- Only people on your local network can access it
- They need to connect to: `http://YOUR_IP_ADDRESS:3000`
- Find your IP: Run `ipconfig` in terminal, look for IPv4 Address

Would you like me to help you set up deployment to Railway or another service?

