# Tiempos reales de visita (Supabase)

La web mide, con permiso del visitante, cuánto tiempo pasa junto a cada recinto y lo
envía de forma anónima (solo el punto y los minutos). Con esos datos el planificador usa
la **mediana real** de cada punto en lugar de un tiempo fijo.

## Puesta en marcha (una vez)

1. Crea un proyecto gratuito en <https://supabase.com> (región Europa).
2. *SQL Editor* → pega y ejecuta [`supabase/schema.sql`](../supabase/schema.sql).
3. *Project Settings → API*: copia la **Project URL** y la clave **anon public**.
4. Ponlas en `public/data/config.json`:

   ```json
   "stats": { "url": "https://xxxx.supabase.co", "key": "eyJ..." }
   ```

La clave *anon* es pública a propósito: con las reglas del esquema solo permite **añadir**
visitas y **leer las medias**, no ver ni borrar los datos.

## Cómo se mide

- Solo si el visitante acepta el aviso ("¿Nos ayudas a mejorar los tiempos?").
- Estancia = tiempo seguido a menos de 20 m de un punto (animales, exhibiciones,
  experiencias, botánico). Se descartan las de menos de 1,5 min (pasar de largo) y las de
  más de 90.
- Se envían en lotes; sin cobertura se guardan en el móvil y se mandan después.
- Un punto usa su mediana cuando tiene al menos 20 visitas en los últimos 6 meses; mientras
  tanto, el tiempo por defecto (`STAY` en `src/planner-ui.ts`).

Para ver los datos: *Table Editor → visits* o la vista `poi_times`.

## Enlaces cortos de planes compartidos

Para que al compartir un plan el enlace sea corto (`…/OasisMap/?plan=K7XQ2M`), ejecuta también
[`supabase/shared-plans.sql`](../supabase/shared-plans.sql). Cada plan compartido se guarda hasta el
día siguiente al del plan y se borra solo. Solo se puede leer sabiendo su código. Si al compartir
no hay conexión, la web envía el enlace largo (`?p=…`), que funciona sin internet.
