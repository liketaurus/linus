const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const WMO: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with hail",
};

export const schema = {
  type: "function",
  function: {
    name: "weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

export const handler = async ({ city }: { city: string }) => {
  const found = await fetch(
    `${GEOCODE}?name=${encodeURIComponent(city)}&count=1`,
  ).then((r) => r.json());

  const place = found.results?.[0];
  if (!place) return `no such city: ${city}`;

  const now = await fetch(
    `${FORECAST}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,wind_speed_10m,weather_code`,
  ).then((r) => r.json());

  const { temperature_2m, wind_speed_10m, weather_code } = now.current;
  return (
    `${place.name}, ${place.country}: ${temperature_2m}C, ` +
    `${WMO[weather_code] ?? `code ${weather_code}`}, ` +
    `wind ${wind_speed_10m} km/h`
  );
};
