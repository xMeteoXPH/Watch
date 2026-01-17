# Quick Setup Guide

## Step 1: Install Node.js
If you don't have Node.js installed:
- Download from: https://nodejs.org/
- Install it (includes npm)

## Step 2: Open Terminal in Your Project Folder
- Windows: Right-click in the folder → "Open in Terminal" or "Open PowerShell here"
- Or open Command Prompt and navigate to your folder:
  ```
  cd "C:\Users\Joshua\Downloads\movie webpage"
  ```

## Step 3: Install Dependencies
Run this command:
```
npm install
```
Wait for it to finish (may take 1-2 minutes)

## Step 4: Start the Server
Run this command:
```
npm start
```

You should see:
```
🎬 MovieHub Server running on port 3000
📁 Uploads directory: C:\Users\Joshua\Downloads\movie webpage\uploads
```

## Step 5: Open Your Webpage
- Open `index.html` in your browser
- The error should be gone!
- Create a room and start watching!

## Keep the Server Running
- **IMPORTANT**: Keep the terminal window open while using the webpage
- The server must be running for the webpage to work
- To stop the server: Press `Ctrl + C` in the terminal

## Troubleshooting

**Error: "npm is not recognized"**
- Node.js is not installed or not in PATH
- Install Node.js from nodejs.org

**Error: "Cannot connect to server"**
- Make sure the server is running (Step 4)
- Check that port 3000 is not being used by another program

**Port already in use?**
- Change the port in `server.js` (line 12): `const PORT = 3001;`
- Update `SERVER_URL` in `script.js` (line 20): `const SERVER_URL = 'http://localhost:3001';`

