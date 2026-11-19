@echo off
rem SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 - zapusk ustanovshchika LORE iz menyu "Pusk".
rem Node: svoy iz papki ustanovshchika (MSI kladet ego, tolko esli na mashine net Node 20+), inache - sistemnyy.
setlocal
chcp 65001 >nul
set "APP=%~dp0"
set "NODE=%APP%node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo Node.js ne nayden. Pereustanovite LORE Installer: on polozhit svoy Node.
  pause
  exit /b 1
)
set "CFG=%APPDATA%\LORE Installer"
if not exist "%CFG%" mkdir "%CFG%"
if not exist "%CFG%\lore-migrate.env" (
  copy "%APP%lore-migrate.env.example" "%CFG%\lore-migrate.env" >nul
  echo Создан файл доступа: %CFG%\lore-migrate.env
  echo Заполните его и запустите LORE Installer снова.
  start "" notepad "%CFG%\lore-migrate.env"
  pause
  exit /b 0
)
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:2499/"
"%NODE%" "%APP%lore-migrate.mjs" ui --env "%CFG%\lore-migrate.env" --decisions "%CFG%\decisions.json" --port 2499
pause
