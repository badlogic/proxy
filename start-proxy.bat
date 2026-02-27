@echo off
REM Start the proxy server on boot
cd /d D:\workspaces\proxy
set PORT=9000
npx tsx src/backend/server.ts
