# Onda – reproductor de audio

Reproductor limpio para WAV, MP3 (y FLAC, OGG, M4A, AAC, Opus) con forma de onda, medición de sonoridad (LUFS) y normalización a −14 LUFS.

- **Sin compresión ni procesado**: el audio se decodifica y se reproduce tal cual. Sin compresor, limitador ni ecualizador. La normalización solo cambia la ganancia general (nunca sube por encima de −1 dBFS de pico).
- **Info justa**: título, formato real (p. ej. `WAV · 24-bit · 48 kHz · Estéreo`), LUFS integrado y el interruptor de normalización.
- **Personalizable** (botón de ajustes): tema Oscuro / Negro / Claro, color de acento, forma de onda (Barras / Suave / Finas), altura real o ajustada, siempre encima. Se recuerda entre sesiones.
- Pensado para ventana pequeña (560×340 por defecto, mínimo 420×280).
- Anterior/siguiente recorre los audios de la misma carpeta.

## Atajos

`Espacio` reproducir/pausar · `←` `→` ±5 s (con `Shift` ±15 s) · `↑` `↓` volumen · `M` silenciar · `L` repetir · `N` normalizar · `AvPág`/`RePág` siguiente/anterior · `Ctrl/⌘ + O` abrir

## Obtener los ejecutables

**Opción A – sin instalar nada (recomendada).** Sube esta carpeta a un repositorio de GitHub. En la pestaña *Actions* → *Construir Onda* → *Run workflow*. Al terminar (unos minutos) descargas:

- Windows: `Onda-Instalador-1.0.0.exe` (instala con doble clic y registra la asociación de archivos) y `Onda-Portable-1.0.0.exe` (un solo .exe, sin instalar).
- Mac: `Onda-1.0.0-mac.dmg` (Apple Silicon e Intel).

**Opción B – en tu propio equipo.** Instala [Node.js](https://nodejs.org) y haz doble clic en `Construir-Windows.bat` (en Windows) o `Construir-Mac.command` (en Mac). El resultado queda en la carpeta `dist`.

## Dejarlo como reproductor predeterminado

- **Windows**: clic derecho en un .wav o .mp3 → *Abrir con* → *Elegir otra aplicación* → Onda → *Usar siempre esta aplicación*. (Windows no permite que una app se ponga sola como predeterminada.)
- **Mac**: clic derecho en un archivo → *Obtener información* → *Abrir con* → Onda → *Cambiar todo…*

## Primera vez en Mac

La app no está firmada con una cuenta de desarrollador de Apple, así que macOS puede avisar la primera vez. Clic derecho sobre Onda → *Abrir* → *Abrir*. Si dijera que está dañada, en Terminal: `xattr -cr /Applications/Onda.app`.

## Desarrollo

```
npm install
npm start        # abrir la app
npm test         # pruebas de LUFS contra referencias EBU
```
