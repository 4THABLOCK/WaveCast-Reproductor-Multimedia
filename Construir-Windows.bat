@echo off
cd /d "%~dp0"
echo Instalando dependencias (solo la primera vez)...
call npm install
if errorlevel 1 goto fail
call npm run dist:win
if errorlevel 1 goto fail
echo.
echo Listo. En la carpeta "dist" esta WaveCast-Instalador (se instala) y WaveCast-Portable (sin instalar).
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo Algo fallo. Necesitas tener Node.js instalado: https://nodejs.org
pause
