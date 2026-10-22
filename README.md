# OasisMap

Mapa web interactivo para visitantes de Oasis Wildlife Fuerteventura. Pensado
100 % para móvil: es una **PWA** (web instalable, funciona sin cobertura tras
la primera visita). El visitante entra escaneando un QR.

> ⚠️ Las coordenadas de `public/data/` son **de ejemplo**. Hay que sustituirlas
> por las reales (ver "Cómo cargar datos reales").

## Qué hace

- Minimapa con tu posición (GPS) que se amplía a pantalla completa.
- Lista de puntos (animales, shows, restaurantes, servicios…) ordenada por
  distancia **a pie**, con búsqueda y filtros por categoría.
- Ficha de cada punto con botón **Ir**: calcula la ruta más corta por los
  caminos (Dijkstra) y muestra una **flecha** que sigue el camino (apunta
  ~12 m por delante en la ruta, no en línea recta al destino), avisos de cruce
  ("gira a la izquierda en 20 m") y metros/minutos restantes.
- Brújula del móvil para orientar la flecha (en iOS se pide permiso al pulsar
  Ir). Sin brújula, la flecha se orienta con el norte del mapa.
- 7 idiomas: es, ca, eu, en, de, fr, it. Se detecta el del navegador.
- Fuera del parque (o con `?sim=1`) puedes **tocar el mapa para simular tu
  posición** y probarlo desde casa.
- **Modo desarrollador** (`?mode=dev`, pide PIN): herramienta para tomar datos reales
  caminando por el parque (ver abajo).

## Tecnologías

Vite + TypeScript (sin framework) · MapLibre GL JS · GeoJSON · Vitest.
Mapas base: OpenStreetMap y ortofoto PNOA del IGN.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173 (y en la IP local para probar en el móvil)
npm test
npm run build    # genera dist/, se puede subir a cualquier hosting estático
```

El GPS y la brújula del navegador **solo funcionan con HTTPS** (o localhost).
Para probar en el móvil usa el hosting final o un túnel HTTPS.

## Datos (`public/data/`)

| Fichero | Contenido |
|---|---|
| `config.json` | centro, zoom, límites, mapa base, imagen ilustrada, velocidad a pie |
| `paths.geojson` | caminos transitables (`LineString`) |
| `pois.geojson` | puntos de interés (`Point`) |

Propiedades de un punto:

```json
{
  "id": "jirafas",
  "category": "animal",            // animal | show | food | experience | botanic | service
  "number": "30",                  // opcional: número del mapa impreso
  "name": { "es": "Jirafas", "en": "Giraffes", "de": "Giraffen" },
  "description": { "es": "…", "en": "…" },
  "schedule": "11:30 · 15:00"      // opcional
}
```

Si falta un idioma se usa inglés y luego español.

**Caminos:** los caminos se conectan cuando comparten vértice (tolerancia 2 m)
o cuando el extremo de uno toca otro (cruce en T). En QGIS activa el
*snapping* al dibujar.

## Cómo cargar datos reales

1. **QGIS + ortofoto PNOA** (gratis, muy alta resolución): añade la capa WMTS
   `https://www.ign.es/wmts/pnoa-ma`, calca los caminos como `LineString` y
   coloca los puntos. Exporta como GeoJSON (EPSG:4326).
2. **Modo desarrollador** (`?mode=dev` + PIN) en el móvil, recorriendo el parque:
   - *Mover*: arrastra puntos en el mapa para corregirlos.
   - *Punto*: pide un nombre y promedia el GPS durante 10 s (quieto).
   - *Camino*: graba la ruta mientras caminas (un vértice cada 3 m).
   - *⋯ → Exportar ajustes*: descarga `position-overrides.json` con todo.
   Sirve para validar y corregir lo calcado sobre la ortofoto.
3. **Mapa ilustrado (opcional):** georreferéncialo con el *Georreferenciador*
   de QGIS usando 6–10 puntos de control (cruces, edificios), exporta a PNG y
   ponlo en `public/overlay/` (fuera de git). Luego en `config.json`:

   ```json
   "overlay": {
     "url": "./overlay/park.png",
     "coordinates": [[lngTL, latTL], [lngTR, latTR], [lngBR, latBR], [lngBL, latBL]],
     "opacity": 0.9
   }
   ```

4. Pon `"demoData": false` en `config.json` para quitar el aviso.

## Añadir un idioma

1. Copia `src/locales/es.json` a `src/locales/<código>.json` y tradúcelo.
2. Añádelo a `LANGUAGES` en `src/i18n.ts`.
3. Añade traducciones de `name`/`description` en `pois.geojson`.

## Estructura

```
src/
  geo.ts       distancias, rumbos, proyección local
  graph.ts     red de caminos, snapping y rutas (Dijkstra)
  nav.ts       flecha, giros, llegada, fuera de camino
  location.ts  GPS y brújula
  map.ts       MapLibre: capas, marcadores, ruta
  dev-tools.ts herramientas del modo desarrollador (mover, punto, camino, exportar)
  dev-pin.ts   PIN del modo desarrollador (solo guarda su hash)
  main.ts      interfaz
  locales/     textos por idioma
public/
  data/        datos del parque
  sw.js        caché offline
```

## Datos de OpenStreetMap

La tarea **Fetch OpenStreetMap data** (pestaña Actions de GitHub) descarga los datos
de OpenStreetMap de la zona a `data/osm/oasis.json`. Después:

```bash
python3 scripts/gen-park-data.py   # puntos (mapa oficial + posiciones conocidas)
python3 scripts/osm-to-paths.py    # caminos: senderos OSM + tramos del mapa oficial donde OSM no tiene
npm test                           # cada punto cerca de un camino y alcanzable
```

En el modo desarrollador, **Mover** permite arrastrar puntos en el mapa; los cambios
se guardan en el móvil y **⋯ → Exportar ajustes** los descarga en
`position-overrides.json` (junto con los puntos y caminos grabados, en `captured`).
Guardado en `data/position-overrides.json`, el generador aplica los puntos movidos
por encima de todo lo demás.

Las posiciones reales conocidas (restaurantes de OSM, comprobaciones en el parque)
van en `KNOWN`, dentro de `scripts/gen-park-data.py`. Datos © colaboradores de
OpenStreetMap (ODbL).

## Iconos

Los iconos de los puntos salen de [Fluent Emoji High Contrast](https://github.com/microsoft/fluentui-emoji)
(© Microsoft, MIT) y, para grulla, ibis, puercoespín, armadillo y prismáticos, de
[game-icons.net](https://game-icons.net) (CC BY 3.0). Se generan en `src/poi-icons.ts` con
`node scripts/build-icons.mjs`; el icono de cada punto se asigna en `scripts/gen-park-data.py`.

## Horarios y Ecotour

Los horarios están en `SCHEDULE` (`scripts/gen-park-data.py`). Un horario `9:00 – 17:30` se
muestra como *Abierto / Cierra en N min / Cerrado*, y una lista `11:15 · 15:40` como
*En N min / En curso / A las…* (hora de Canarias). El recorrido del Ecotour se dibuja con la
línea discontinua del mapa oficial (`ECOTOUR_ROUTE`) y cada parada muestra a qué hora pasa
el próximo tren por las siguientes.

## Avisos y planificador

- **Avísame**: en exhibiciones y paradas del Ecotour. Avisa cuando toca salir (tiempo a pie
  + 10 min). Sin servidor de notificaciones push, el aviso solo llega si la web sigue abierta
  (aunque sea en segundo plano); en iPhone, además, hay que instalarla en la pantalla de inicio.
- **Planifica tu visita**: eliges animales, exhibiciones y experiencias, hora de llegada y
  salida, si quieres comer, el **ritmo** (% sobre el tiempo habitual: Rápido 75 %, Normal 100 %,
  Tranquilo 135 %) y, en **Avanzado**, descansos (cada 1 h 30 – 3 h, en un snack o restaurante
  abierto) y el **interés** (poco / normal / mucho: decide qué se queda si no cabe todo) y el % de
  tiempo de cada parada. El tiempo habitual de cada punto es la **mediana real** de los visitantes
  (ver `docs/supabase.md`) o, sin datos, el valor por defecto. `src/planner.ts` respeta las sesiones (llegando 10 min antes),
  los horarios de las experiencias y la comida (12:30–14:45), y ordena el resto para andar lo
  menos posible. El plan se guarda en el móvil y el botón muestra la siguiente parada.
  Mantén pulsada una parada para moverla; deslízala a la izquierda para quitarla. En "Añadir
  paradas" se recupera lo que no cabía o se añade cualquier otra (va donde menos rodeo añade).
- **Ecotour como transporte** (opción "Usar el Ecotour para caminar menos"): entre dos paradas
  propone el tren si ahorra al menos 5 min de caminar y no tarda mucho más (3 / 8 / 15 min extra
  con ritmo rápido / normal / tranquilo). En este parque el tren es más lento que andar: sirve
  para descansar las piernas. Respeta sus horarios (0 → 5, 5 min entre paradas).
- **Planes listos** (Imprescindibles 3 h, Con niños, Solo exhibiciones, Visita rápida 2 h): un toque
  y planifica. Las listas están en `PRESETS` (`src/planner-ui.ts`).
- **Calendario**: descarga el plan como `.ics` (cada parada un evento; exhibiciones, comida,
  experiencias y tren con alarma a la hora de salir). Las alarmas suenan aunque la web esté cerrada.
- **Compartir**: botón verde en el plan. Abre la hoja de compartir del móvil (WhatsApp, Telegram…)
  o WhatsApp directamente con las paradas y un enlace corto `?p=…` (2 caracteres por parada, códigos
  fijos en `data/link-codes.json`) que lleva el día, las horas, los
  ajustes y el orden. Quien lo abre puede usarlo; las horas se recalculan en su móvil.
- **Plan en el mapa**: recorrido y número de parada en cada punto (los demás puntos no muestran
  número mientras tanto). La etiqueta de arriba lo abre o lo quita.
- **Empezar la visita**: barra abajo con la siguiente parada (Ir, ✓ hecho). Al llegar (a 20 m o
  al terminar la navegación) se marca sola. Con 10 min o más de retraso ofrece *Reorganizar*,
  que vuelve a planificar lo que queda desde donde estás. Tiempos: animal 6 min, exhibición 30, experiencia 30 (con cola), comida 45.

## Nuestros animales

Al deslizar hacia arriba la ficha de un animal se ven sus ejemplares (nombre, sexo, edad,
desde cuándo están en el parque, origen e historia) y el estado de conservación UICN de la
especie. Los datos están en `scripts/gen-animals.py` → `public/data/animals.json`.
**Ahora mismo son de ejemplo (inventados).**

## Dibujos del mapa

Los animales del mapa usan los dibujos del mapa oficial (PDF), recortados como SVG en
`public/img/map-art/`:

```bash
pip install pymupdf
python3 scripts/extract-map-art.py mapa_es.pdf   # posiciones de cada dibujo en ART
python3 scripts/gen-park-data.py
```

Los puntos sin dibujo siguen con su icono.

## Próximos pasos

- Datos reales del parque.
- Horarios de shows y avisos (p. ej. "show en 15 min").
- Web pública con venta de tickets (backend Java + Spring Boot, pago Redsys/Stripe).
