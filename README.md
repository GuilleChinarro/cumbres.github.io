# Cuaderno de cumbres

Cuaderno personal de alta montaña y alpinismo. Web estática (GitHub Pages), sin servidor ni cuentas:
**los datos de cada persona se guardan solo en su dispositivo** (IndexedDB) y se llevan de un sitio a otro
con «Datos → Exportar / Importar».

## Qué hace

- **Rutas**: importa GPX y FIT (el original de Garmin Connect), estadísticas, perfil, duplicados y exportación a GPX.
- **Cumbres**: cruza cada track con las cimas de OpenStreetMap; lista de montañas, retos (tresmiles, dosmiles, techos) y planificador.
- **Alpinismo**: vía, graduaciones (alpina, roca, hielo, mixto, nieve, esquí, ferrata, compromiso), cordada, material,
  condiciones de nieve y hielo, resultado (cumbre o retirada) y rutas en proyecto.
- **Horario**: método de Munter, hora límite, luz solar y puntos de retirada marcados sobre el perfil.
- **Terreno y aludes**: capas de pendientes (>30°) y orientaciones calculadas en el navegador, análisis de cada ruta
  (qué parte pisa laderas de más de 30°, en qué orientación y altitud) y enlace al boletín de aludes de la zona.
- **Meteo**: previsión a 7 días a la altitud de la cumbre, con isoterma de 0 °C.
- **Mapa**: IGN topográfico, ortofoto PNOA, OpenStreetMap, OpenTopoMap, senderos, lugares de interés y zonas sin conexión.
- **3D**: relieve real (MDT de 2 m en España), exageración ajustable, sombras según la hora solar y vuelo sobre la ruta.

## Estructura

```
index.html            marcado
css/app.css           estilos
js/*.js               código por secciones, scripts clásicos sin compilación (el orden está en index.html)
data/*.gz             cumbres OSM, sierras GMBA, mapa base y glifos
vendor/               MapLibre GL JS
sw.js                 caché para abrir sin conexión y guardar teselas
```

Para probar en local: `python3 -m http.server` y abrir `http://localhost:8000`.

## Datos y licencias

| Dato | Fuente | Licencia |
| --- | --- | --- |
| Cumbres, lugares, senderos | © colaboradores de OpenStreetMap (Overpass, Waymarked Trails) | ODbL / CC BY-SA |
| Sierras | GMBA Mountain Inventory v2 (Snethlage et al., 2022) | CC BY 4.0 |
| Mapa esquemático | Natural Earth | Dominio público |
| Topográfico MTN y ortofoto PNOA | © Instituto Geográfico Nacional de España | CC BY 4.0 |
| Topográfico mundial | OpenTopoMap | CC BY-SA |
| Relieve | Mapterhorn (MDT02 IGN, Copernicus) y Terrain Tiles (Mapzen/AWS) | ver mapterhorn.com/attribution |
| Meteo | Open-Meteo | CC BY 4.0 (uso no comercial) |
| Rutas por sendero | BRouter | datos OSM, ODbL |
| Motor de mapas | MapLibre GL JS | BSD-3-Clause |

La app no sustituye al boletín oficial de aludes ni al parte de montaña: los enlaza.
