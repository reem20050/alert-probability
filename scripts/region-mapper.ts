import citiesMap from '../data/cities-to-regions.json';

const cityToRegion: Record<string, string> = citiesMap as Record<string, string>;

export function mapCityToRegion(cityName: string): string | null {
  // Direct match
  if (cityToRegion[cityName]) return cityToRegion[cityName];

  // Trim and normalize
  const normalized = cityName.trim();
  if (cityToRegion[normalized]) return cityToRegion[normalized];

  // Try without parenthetical content: "נתניה (מערב)" -> "נתניה"
  const withoutParens = normalized.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (cityToRegion[withoutParens]) return cityToRegion[withoutParens];

  // Partial match - find if city name is a substring of any key
  for (const [key, region] of Object.entries(cityToRegion)) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return region;
    }
  }

  console.warn(`Unknown city: "${cityName}" - no region mapping found`);
  return null;
}
