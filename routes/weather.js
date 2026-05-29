const express = require('express');
const router = express.Router();
const axios = require('axios');
const { coordinates } = require('../cities');

// Simple cache to avoid hitting API too much
const cache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const BULK_LIMIT = 10;

// WMO Weather interpretation codes → human-readable
const WMO_CODES = {
  0:  { main: 'Clear',        description: 'clear sky' },
  1:  { main: 'Clear',        description: 'mainly clear' },
  2:  { main: 'Clouds',       description: 'partly cloudy' },
  3:  { main: 'Clouds',       description: 'overcast' },
  45: { main: 'Fog',          description: 'fog' },
  48: { main: 'Fog',          description: 'depositing rime fog' },
  51: { main: 'Drizzle',      description: 'light drizzle' },
  53: { main: 'Drizzle',      description: 'moderate drizzle' },
  55: { main: 'Drizzle',      description: 'dense drizzle' },
  61: { main: 'Rain',         description: 'slight rain' },
  63: { main: 'Rain',         description: 'moderate rain' },
  65: { main: 'Rain',         description: 'heavy rain' },
  71: { main: 'Snow',         description: 'slight snow fall' },
  73: { main: 'Snow',         description: 'moderate snow fall' },
  75: { main: 'Snow',         description: 'heavy snow fall' },
  80: { main: 'Rain',         description: 'slight rain showers' },
  81: { main: 'Rain',         description: 'moderate rain showers' },
  82: { main: 'Rain',         description: 'violent rain showers' },
  85: { main: 'Snow',         description: 'slight snow showers' },
  86: { main: 'Snow',         description: 'heavy snow showers' },
  95: { main: 'Thunderstorm', description: 'thunderstorm' },
  96: { main: 'Thunderstorm', description: 'thunderstorm with slight hail' },
  99: { main: 'Thunderstorm', description: 'thunderstorm with heavy hail' },
};

// Find coordinates for a city (case-insensitive)
function getCityCoords(cityName) {
  if (coordinates[cityName]) return { ...coordinates[cityName], label: cityName };
  const key = Object.keys(coordinates).find(k => k.toLowerCase() === cityName.toLowerCase().trim());
  if (key) return { ...coordinates[key], label: key };
  return null;
}

// Fetch weather for a single city using Open-Meteo (free, no API key)
async function fetchWeather(cityName) {
  let coords = getCityCoords(cityName);

  // If not in our local coordinates, use Open-Meteo geocoding
  if (!coords) {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
    const geoRes = await axios.get(geoUrl, { timeout: 5000 });
    if (!geoRes.data.results || geoRes.data.results.length === 0) {
      throw new Error(`City not found: ${cityName}`);
    }
    const r = geoRes.data.results[0];
    coords = { lat: r.latitude, lng: r.longitude, label: r.name };
  }

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
  const weatherRes = await axios.get(weatherUrl, { timeout: 5000 });
  const current = weatherRes.data.current;

  const weatherInfo = WMO_CODES[current.weather_code] || { main: 'Unknown', description: 'unknown' };

  return {
    city:        coords.label,
    temp:        Math.round(current.temperature_2m),
    feels_like:  Math.round(current.temperature_2m),
    condition:   weatherInfo.main,
    description: weatherInfo.description,
    humidity:    current.relative_humidity_2m,
    wind_speed:  Math.round(current.wind_speed_10m * 10) / 10,
  };
}

// GET /api/weather?city=Delhi
router.get('/', async (req, res) => {
  const { city } = req.query;
  if (!city) return res.status(400).json({ error: 'City is required' });

  const key = city.trim().toLowerCase();
  if (cache[key] && Date.now() - cache[key].timestamp < CACHE_TTL) {
    return res.json({ ...cache[key].data, cached: true });
  }

  try {
    const result = await fetchWeather(city.trim());
    cache[key] = { data: result, timestamp: Date.now() };
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Weather fetch failed', detail: err.message });
  }
});

// GET /api/weather/bulk?cities=Delhi,Agra,Jaipur
router.get('/bulk', async (req, res) => {
  const cities = req.query.cities?.split(',').map(c => c.trim()).filter(Boolean) || [];

  if (cities.length === 0) {
    return res.status(400).json({ error: 'Cities are required' });
  }
  if (cities.length > BULK_LIMIT) {
    return res.status(400).json({ error: `Max ${BULK_LIMIT} cities allowed` });
  }

  const promises = cities.map(async (city) => {
    const key = city.toLowerCase();
    if (cache[key] && Date.now() - cache[key].timestamp < CACHE_TTL) {
      return { ...cache[key].data, cached: true };
    }
    try {
      const result = await fetchWeather(city);
      cache[key] = { data: result, timestamp: Date.now() };
      return result;
    } catch (e) {
      return { city, error: 'unavailable', detail: e.message };
    }
  });

  const weather = await Promise.all(promises);
  return res.json(weather);
});

module.exports = router;
