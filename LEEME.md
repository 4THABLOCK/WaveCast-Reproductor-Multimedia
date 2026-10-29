# Wave Cast – reproductor de audio

Reproductor limpio para WAV, MP3 (y FLAC, OGG, M4A, AAC, Opus) con forma de onda, LUFS y normalización a −14 LUFS.

- **Sin compresión ni procesado**: el audio suena tal cual. La normalización solo cambia el volumen general (nunca sube por encima de −1 dBFS de pico).
- **Reproductor**: onda (o solo barra de progreso), saltos de ±N segundos (configurable), aleatorio, repetir, clic en la duración para ver el tiempo restante. El LUFS y el interruptor de normalización están discretos al pie.
- **Home** (icono de casa): historial con buscador, cola de reproducción (arrastra para reordenar), favoritos, abrir archivos/carpeta.
- **Pantalla completa** (icono de expandir o `F`): 7 efectos que reaccionan a la música (Líquido, Aurora, Túnel, Orbes, Círculo, Partículas, Barras). Teclas `1`–`7` o `E` para cambiar.
- **Personalizable**: tema, color, forma de onda, vista Onda/Barra, salto, siempre encima y **salida de audio** (se recuerda; útil con SteelSeries Sonar o varios dispositivos).

## Atajos
`Espacio` reproducir · `←` `→` saltar (con `Shift` ×3) · `↑` `↓` volumen · `M` silenciar · `R` repetir · `S` aleatorio · `N` normalizar · `F` pantalla completa · `H` home · `PgDn`/`PgUp` siguiente/anterior · `Ctrl/⌘+O` abrir

## Obtener los ejecutables
En GitHub: sube esta carpeta → *Actions* → *Construir Wave Cast* → *Run workflow*. Descargas `WaveCast-Instalador-1.1.1.exe`, `WaveCast-Portable-1.1.1.exe` (Windows) y `WaveCast-1.1.1-mac.dmg` (Mac).
O en tu equipo, con Node.js: `Construir-Windows.bat` / `Construir-Mac.command`.

## Predeterminado para .wav y .mp3
- Windows: clic derecho en un archivo → *Abrir con* → *Elegir otra aplicación* → Wave Cast → *Usar siempre*.
- Mac: clic derecho → *Obtener información* → *Abrir con* → Wave Cast → *Cambiar todo…*
- Mac, primera vez: clic derecho sobre la app → *Abrir*. Si dice que está dañada: `xattr -cr "/Applications/Wave Cast.app"`.

## Desarrollo
`npm install` · `npm start` · `npm test`
