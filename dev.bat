@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title FreeClaude (dev)

REM Runs the sources from this folder directly, without building the exe.
REM Same app as FreeClaude.exe: http://127.0.0.1:3847, OmniRoute starts alongside.

node server.js
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] FreeClaude exit code: %EC%
  pause
)
exit /b %EC%
