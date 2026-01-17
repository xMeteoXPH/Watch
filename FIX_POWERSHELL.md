# Fix PowerShell Execution Policy Error

## Quick Fix: Use Command Prompt Instead

**Easiest Solution:**
1. Close PowerShell
2. In File Explorer, navigate to your folder
3. In the address bar, type: `cmd` and press Enter
4. Command Prompt opens (black window)
5. Now run: `npm install` and `npm start`

## OR Fix PowerShell (Permanent Solution)

Run this command in PowerShell (as Administrator):

1. Right-click on PowerShell in the Start menu
2. Select "Run as Administrator"
3. Type this command:
   ```
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
4. Press Enter
5. Type `Y` and press Enter to confirm
6. Close that window
7. Open PowerShell normally in your project folder
8. Now `npm install` should work!

## OR Temporary Fix (Just for this session)

In your current PowerShell window, type:
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
```
Press Enter, then type `Y` and press Enter.

Then try `npm install` again.

