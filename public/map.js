
let map, layer, loading, state;

function loadLibrary() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    css.crossOrigin = '';
    document.head.append(css);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';

    const timer = setTimeout(() => {
      reject(Error('Карта не загрузилась вовремя.'));
    }, 15000);

    script.onload = () => {
      clearTimeout(timer);
      resolve(window.L);
    };

    script.onerror = () => {
      clearTimeout(timer);
      reject(Error('Карта недоступна. Координаты можно указать вручную.'));
    };

    document.head.append(script);
  }).catch(error => {
    loading = null;
    throw error;
  });

  return loading;
}

export function updateMap(next) {
  state = next;
  if (map) draw();
}

export function resizeMap() {
  if (map) {
    requestAnimationFrame(() => map.invalidateSize());
  }
}

export async function showMap() {
  const status = document.getElementById('map-status');
  status.textContent = 'Загружаем карту…';

  try {
    const L = await loadLibrary();

    if (!map) {
      document.getElementById('map-placeholder')?.remove();

      map = L.map('places-map', {
        scrollWheelZoom: false
      }).setView([51.13213, 71.402828], 14);

      // MapTiler background map
      const tiles = L.tileLayer(
        'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=Yd3km88ShgyWzBLvrdKT',
        {
          maxZoom: 19,
          tileSize: 256,
          attribution: '&copy; MapTiler &copy; OpenStreetMap contributors'
        }
      ).addTo(map);

      tiles.on('tileerror', () => {
        status.textContent =
          'Подложка недоступна. Метки и карточки можно использовать.';
      });

      L.circle([51.13213, 71.402828], {
        radius: 2000,
        color: '#7951bd',
        fillOpacity: 0.04,
        weight: 1.5,
        dashArray: '6 6',
        interactive: false
      }).addTo(map);

      layer = L.layerGroup().addTo(map);

      map.on('click', e => {
        state?.onPoint?.({
          lat: Number(e.latlng.lat.toFixed(6)),
          lon: Number(e.latlng.lng.toFixed(6))
        });
      });
    }

    map.invalidateSize();
    draw();

    status.textContent =
      'Нажмите внутри области 2 км, чтобы выбрать новую исходную точ.';

  } catch (e) {
    status.textContent = e.message;
  }
}

function draw() {
  if (!state || !map) return;

  const L = window.L;
  layer.clearLayers();

  const { items, point, onDetail } = state;
  const coords = [[point.lat, point.lon]];

  L.marker(coords[0], {
    icon: L.divIcon({
      className: 'origin-pin',
      html: '<span>◎</span>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    }),
    title: 'Исходная точка'
  })
    .addTo(layer)
    .bindPopup('Отсюда ищем места');

  items.forEach((p, i) => {
    const coord = [p.point.lat, p.point.lon];
    coords.push(coord);

    const content = document.createElement('div');
    content.className = 'map-popup';

    const title = document.createElement('h3');
    title.textContent = p.name;

    const info = document.createElement('p');
    const travel = p.travel || p.route;

    info.textContent = travel?.durationSeconds != null
      ? `Около ${Math.ceil(travel.durationSeconds / 60)} мин пешком`
      : `${p.distanceMeters} м по прямой`;

    const button = document.createElement('button');
    button.textContent = 'Подробнее';
    button.onclick = () => onDetail(i);

    const route = document.createElement('a');
    route.textContent = 'Маршрут ↗';

    route.href =
      'https://2gis.kz/astana/directions/points/' +
      encodeURIComponent(
        point.lon + ',' + point.lat + ';' +
        p.point.lon + ',' + p.point.lat
      );

    route.target = '_blank';
    route.rel = 'noopener noreferrer';

    content.append(title, info, button, route);

    L.marker(coord, {
      title: p.name,
      icon: L.divIcon({
        className: 'place-pin',
        html: '<span>' + (i + 1) + '</span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    })
      .addTo(layer)
      .bindPopup(content);
  });

  map.fitBounds(L.latLngBounds(coords), {
    padding: [40, 40],
    maxZoom: 15
  });
}
