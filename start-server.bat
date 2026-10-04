@echo off
title Wedding Fund Tracker - Local Preview Server
echo ====================================================
echo  Menjalankan Wedding Fund Tracker Preview Server...
echo ====================================================
echo.
start http://localhost:3000
node tools/serve.mjs
pause
