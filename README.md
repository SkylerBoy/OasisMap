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

## Próximos pasos

- Datos reales del parque.
- Horarios de shows y avisos (p. ej. "show en 15 min").
- Web pública con venta de tickets (backend Java + Spring Boot, pago Redsys/Stripe).
