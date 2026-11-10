@echo off
chcp 65001 >nul
title Шиномонтаж PRO — сервер CRM (не закрывать)
cd /d "%~dp0"
echo Сервер CRM запускается. Это окно не закрывайте, можно свернуть.
echo.
:start
"C:\Program Files\nodejs\node.exe" server.js
echo.
echo Сервер остановился. Перезапуск через 5 секунд...
timeout /t 5 /nobreak >nul
goto start
