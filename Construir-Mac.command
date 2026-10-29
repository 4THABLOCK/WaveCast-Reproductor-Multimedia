#!/bin/bash
cd "$(dirname "$0")"
echo "Instalando dependencias (solo la primera vez)..."
npm install || { echo "Necesitas tener Node.js instalado: https://nodejs.org"; read -p "Enter para salir"; exit 1; }
npm run dist:mac || { read -p "Algo falló. Enter para salir"; exit 1; }
echo
echo "Listo. Abre la carpeta dist y arrastra Wave Cast a Aplicaciones."
open dist
