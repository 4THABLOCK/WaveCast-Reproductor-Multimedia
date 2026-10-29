@echo off
cd /d "%~dp0"
echo Instalando dependencias (solo la primera vez)...
call npm install
if errorlevel 1 goto fail
call npm run dist:win
if errorlevel 1 goto fail
echo.
echo Listo. Abre la carpeta "dist" y ejecuta Onda-Instalador-1.0.0.exe
echo (o Onda-Portable-1.0.0.exe si no quieres instalar nada).
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo Algo fallo. Necesitas tener Node.js instalado: https://nodejs.org
pause
