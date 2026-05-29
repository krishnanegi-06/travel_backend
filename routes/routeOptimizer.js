const express = require('express');
const router = express.Router();
const { geocodeCity, getRoute } = require('../ors');
const { dfs } = require('../algorithms/dfs');
const dijkstra = require('../algorithms/dijkstra');
const { cityGraph, cityList, getRegionalAlternatives, coordinates } = require('../cities');

// Haversine distance (km) between two lat/lng points
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ─────────────────────────────────────────────
//  Mode availability sets
// ─────────────────────────────────────────────
const flightCities = new Set([
  'Delhi', 'Mumbai', 'Chennai', 'Bangalore', 'Kolkata', 'Hyderabad',
  'Kochi', 'Jaipur', 'Ahmedabad', 'Pune', 'Panaji', 'Srinagar',
  'Leh', 'Chandigarh', 'Coimbatore', 'Trivandrum', 'Nagpur', 'Indore',
  'Bhopal', 'Patna', 'Varanasi', 'Guwahati', 'Bhubaneswar', 'Ranchi',
  'Amritsar', 'Jammu', 'Udaipur', 'Jodhpur', 'Shimla', 'Dharamshala',
  'Aurangabad', 'Visakhapatnam', 'Tirupati', 'Madurai', 'Lucknow',
  'Agra', 'Surat', 'Vadodara', 'Rajkot', 'Pondicherry'
]);

const trainCities = new Set([
  'Delhi', 'Mumbai', 'Chennai', 'Bangalore', 'Kolkata', 'Hyderabad',
  'Kochi', 'Jaipur', 'Ahmedabad', 'Pune', 'Chandigarh', 'Coimbatore',
  'Trivandrum', 'Nagpur', 'Indore', 'Bhopal', 'Patna', 'Varanasi',
  'Guwahati', 'Bhubaneswar', 'Amritsar', 'Jammu', 'Udaipur', 'Jodhpur',
  'Jaisalmer', 'Aurangabad', 'Visakhapatnam', 'Lucknow', 'Agra',
  'Mathura', 'Haridwar', 'Dehradun', 'Nainital', 'Shimla', 'Mysore',
  'Mangalore', 'Allahabad', 'Gwalior', 'Jhansi', 'Surat', 'Vadodara',
  'Rajkot', 'Kolhapur', 'Nashik', 'Shirdi', 'Tirupati', 'Madurai',
  'Salem', 'Ranchi', 'Jamshedpur', 'Siliguri', 'Darjeeling', 'Gaya',
  'Bodhgaya', 'Kanpur', 'Ludhiana', 'Bikaner', 'Ajmer', 'Rishikesh',
  'Mussoorie', 'Khajuraho', 'Ujjain', 'Ranthambore', 'Pushkar'
]);

const roadOnlyCities = new Set([
  'Munsiyari', 'Chakrata', 'Tehri', 'Auli', 'Chopta', 'Lansdowne',
  'Kedarnath', 'Badrinath', 'Ranikhet', 'Almora', 'Kasol', 'Spiti',
  'Chitkul', 'Kinnaur', 'Bir Billing', 'Kufri', 'Narkanda', 'Chail',
  'Dalhousie', 'Palampur', 'Kullu', 'Tawang', 'Ziro', 'Majuli',
  'Lachung', 'Dzukou Valley', 'Cherrapunji', 'Gulmarg', 'Pahalgam',
  'Sonamarg', 'Dal Lake', 'Nubra Valley', 'Pangong Lake', 'Coorg',
  'Chikmagalur', 'Sakleshpur', 'Kabini', 'Wayanad', 'Varkala',
  'Thekkady', 'Munnar', 'Lonavala', 'Mahabaleshwar', 'Matheran',
  'Igatpuri', 'Alibaug', 'Palolem', 'Vagator', 'Anjuna', 'Arambol',
  'Candolim', 'Bundi', 'Kumbhalgarh', 'Mandawa', 'Orchha', 'Pachmarhi',
  'Bandhavgarh', 'Kanha', 'Hampi', 'Badami', 'Belur', 'Halebidu',
  'Dandeli', 'Sundarbans', 'Bishnupur', 'Shantiniketan', 'Netarhat',
  'Horsley Hills', 'Araku Valley', 'Nagarjunasagar', 'Simlipal',
  'Chilika', 'Konark', 'Vrindavan', 'Ayodhya', 'Mussoorie', 'Mount Abu'
]);

// ─────────────────────────────────────────────
//  Build mode info — availability + duration
// ─────────────────────────────────────────────
function getModeInfo(from, to, distanceKm) {
  const fromRoad = roadOnlyCities.has(from);
  const toRoad   = roadOnlyCities.has(to);

  // Bus — always available
  const bus = {
    available: true,
    durationMinutes: Math.round((distanceKm / 45) * 60),
    note: null
  };

  // Car — always available
  const car = {
    available: true,
    durationMinutes: Math.round((distanceKm / 60) * 60),
    note: null
  };

  // Train
  let train = { available: false, durationMinutes: null, note: null };
  if (fromRoad || toRoad) {
    train.note = `No railway station near ${fromRoad ? from : to}. Use Bus or Car to reach this destination.`;
  } else if (!trainCities.has(from) || !trainCities.has(to)) {
    train.note = `No direct train between ${from} and ${to}. Try Bus or Car.`;
  } else {
    train = { available: true, durationMinutes: Math.round((distanceKm / 80) * 60) + 30, note: null };
  }

  // Flight
  let flight = { available: false, durationMinutes: null, note: null };
  if (fromRoad || toRoad) {
    flight.note = `No airport near ${fromRoad ? from : to}. This is a road-only destination — fly to the nearest city then drive.`;
  } else if (!flightCities.has(from) || !flightCities.has(to)) {
    flight.note = `No direct flights between ${from} and ${to}. Try Train or Bus.`;
  } else if (distanceKm < 300) {
    flight.note = `Distance too short for a flight (${distanceKm}km). Train or Car recommended.`;
  } else {
    flight = { available: true, durationMinutes: Math.round((distanceKm / 800) * 60) + 180, note: null };
  }

  return { Bus: bus, Car: car, Train: train, Flight: flight };
}

// ─────────────────────────────────────────────
//  Graph path helper
// ─────────────────────────────────────────────
function getGraphPath(from, to) {
  if (!cityGraph[from] || !cityGraph[to]) return [from, to];
  const result = dijkstra(cityGraph, from, to);
  if (result && result.reachable && result.path.length >= 2) return result.path;
  return [from, to];
}

// GET /api/routes?from=Delhi&to=Manali&mode=Bus
router.get('/', async (req, res) => {
  const { from, to, mode = 'Bus' } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  const alternatives = getRegionalAlternatives(to, 6);
  const graphPath    = getGraphPath(from, to);

  try {
    const [fromCoords, toCoords] = await Promise.all([geocodeCity(from), geocodeCity(to)]);
    const realRoute    = await getRoute(fromCoords, toCoords);
    const shortestDist = realRoute.distanceKm;
    const cheapestCost = Math.round(shortestDist * 1.2);
    const modeInfo     = getModeInfo(from, to, shortestDist);

    let dfsPath = null;
    if (cityGraph[from] && cityGraph[to]) dfsPath = dfs(from, to);

    // Use selected mode duration for fastest, fallback to Bus
    const fastestMins = modeInfo[mode]?.durationMinutes ?? modeInfo.Bus.durationMinutes;

    res.json({
      from: fromCoords.label,
      to:   toCoords.label,
      coordinates: { from: fromCoords, to: toCoords },
      routes: {
        shortest: { distanceKm: shortestDist, path: graphPath, label: 'Shortest Route' },
        fastest:  { timeMinutes: fastestMins,  path: graphPath, label: 'Fastest Route'  },
        cheapest: { costRupees: cheapestCost,  path: graphPath, label: 'Budget Route'   }
      },
      modeInfo,
      realRouteCoordinates: realRoute.coordinates,
      alternativeCities: alternatives,
      dfsPath
    });

  } catch (err) {
    if (cityGraph[from] && cityGraph[to]) {
      const shortest = dijkstra(cityGraph, from, to);
      const timeGraph = {}, costGraph = {};

      for (let city in cityGraph) {
        timeGraph[city] = {}; costGraph[city] = {};
        for (let n in cityGraph[city]) {
          timeGraph[city][n] = Math.round(cityGraph[city][n] / 80 * 60);
          costGraph[city][n] = Math.round(cityGraph[city][n] * 1.2);
        }
      }

      const fastest  = dijkstra(timeGraph, from, to);
      const cheapest = dijkstra(costGraph, from, to);
      const modeInfo = getModeInfo(from, to, shortest.totalDistance || 400);

      return res.json({
        from, to, fallback: true,
        routes: {
          shortest: { distanceKm: shortest.totalDistance,  path: shortest.path,  label: 'Shortest Route' },
          fastest:  { timeMinutes: fastest.totalDistance,  path: fastest.path,   label: 'Fastest Route'  },
          cheapest: { costRupees:  cheapest.totalDistance, path: cheapest.path,  label: 'Budget Route'   }
        },
        modeInfo,
        alternativeCities: alternatives,
        dfsPath: null
      });
    }

    // Coordinate-based estimate for cities not in the graph
    const fromCoord = coordinates[from];
    const toCoord   = coordinates[to];
    if (fromCoord && toCoord) {
      const straightDist = haversineKm(fromCoord.lat, fromCoord.lng, toCoord.lat, toCoord.lng);
      const roadDist     = Math.round(straightDist * 1.3);
      const cheapCost    = Math.round(roadDist * 1.2);
      const modeInfo     = getModeInfo(from, to, roadDist);

      return res.json({
        from, to, fallback: true, estimated: true,
        routes: {
          shortest: { distanceKm: roadDist,                              path: [from, to], label: 'Shortest Route (Est.)' },
          fastest:  { timeMinutes: Math.round((roadDist / 60) * 60),     path: [from, to], label: 'Fastest Route (Est.)'  },
          cheapest: { costRupees:  cheapCost,                            path: [from, to], label: 'Budget Route (Est.)'   }
        },
        modeInfo,
        alternativeCities: alternatives,
        dfsPath: null
      });
    }

    res.status(500).json({ error: 'Route calculation failed', detail: err.message });
  }
});

// GET /api/routes/cities
router.get('/cities', (req, res) => res.json({ cities: cityList }));

module.exports = router;