@echo off
REM ==========================================================================
REM  Cutline Cloud Clipper - one-click Windows starter
REM  1. Stops Edge (unlocks its cookie database) and any running Python worker
REM  2. Uses C:\cutline as the worker folder
REM  3. Downloads the latest app.py (keeps the old copy if the download fails)
REM  4. Exports your YouTube cookies from Edge into cookies.txt
REM  5. Starts the worker on port 8000
REM
REM  WARNING: step 1 closes EVERY msedge.exe and python.exe on this machine.
REM ==========================================================================
setlocal EnableExtensions

set "WORKDIR=C:\cutline"
set "APP_URL=https://cart-to-camera-stories.lovable.app/cloud-clipper/app.py"
set "PORT=8000"

echo.
echo [1/5] Stopping Edge and old Python worker processes...
taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
REM Give Windows a moment to release file locks on the Edge cookie database.
timeout /t 2 /nobreak >nul

echo [2/5] Switching to %WORKDIR% ...
if not exist "%WORKDIR%" mkdir "%WORKDIR%"
cd /d "%WORKDIR%" || (
  echo ERROR: Could not open %WORKDIR%.
  goto :fail
)

where python >nul 2>&1 || (
  echo ERROR: Python was not found on PATH. Install Python 3.10+ and tick "Add to PATH".
  goto :fail
)

echo [3/5] Downloading latest app.py ...
curl.exe -sSL --fail "%APP_URL%" -o app.py.new
if errorlevel 1 (
  if exist app.py.new del /q app.py.new >nul 2>&1
  if exist app.py (
    echo WARNING: Download failed. Keeping the existing app.py.
  ) else (
    echo ERROR: Download failed and no app.py exists yet. Check the internet connection.
    goto :fail
  )
) else (
  move /y app.py.new app.py >nul
  echo        app.py updated.
)

echo [4/5] Exporting YouTube cookies from Edge into cookies.txt ...
REM A small helper script avoids fragile quoting inside "python -c".
> export_cookies.py echo try:
>> export_cookies.py echo     from yt_dlp.cookies import extract_cookies_from_browser
>> export_cookies.py echo     extract_cookies_from_browser("edge").save("cookies.txt", ignore_discard=True, ignore_expires=True)
>> export_cookies.py echo     print("COOKIES_OK")
>> export_cookies.py echo except Exception as e:
>> export_cookies.py echo     print("COOKIE_NOTE:", e)
python export_cookies.py
del /q export_cookies.py >nul 2>&1
REM A cookie failure is not fatal: the worker can still try without cookies.

echo [5/5] Starting the worker on port %PORT% ...  (press Ctrl+C to stop)
echo.
python -m uvicorn app:app --port %PORT%
if errorlevel 1 (
  echo.
  echo ERROR: The worker stopped with an error. If it says "No module named uvicorn", run:
  echo    python -m pip install -U fastapi uvicorn requests "yt-dlp[default]"
  goto :fail
)
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
