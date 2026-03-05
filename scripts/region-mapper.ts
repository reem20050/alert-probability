import citiesMap from '../data/cities-to-regions.json';

const cityToRegion: Record<string, string> = citiesMap as Record<string, string>;

function lookup(name: string): string | null {
  return cityToRegion[name] ?? null;
}

export function mapCityToRegion(cityName: string): string | null {
  // 1. Direct match
  const direct = lookup(cityName);
  if (direct) return direct;

  // 2. Trim and normalize
  const normalized = cityName.trim();
  const trimmed = lookup(normalized);
  if (trimmed) return trimmed;

  // 3. Remove parenthetical content: "נתניה (מערב)" → "נתניה"
  const withoutParens = normalized.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (withoutParens !== normalized) {
    const result = lookup(withoutParens);
    if (result) return result;
  }

  // 4. Remove dash-suffixed sub-area: "הרצליה - מערב" → "הרצליה"
  const dashIdx = normalized.indexOf(' - ');
  if (dashIdx > 0) {
    const baseCity = normalized.slice(0, dashIdx).trim();
    const result = lookup(baseCity);
    if (result) return result;
  }

  // 5. Strip "אזור תעשייה" prefix: "אזור תעשייה קריית ביאליק" → "קריית ביאליק"
  const indPrefix = 'אזור תעשייה ';
  if (normalized.startsWith(indPrefix)) {
    const stripped = normalized.slice(indPrefix.length).trim();
    const result = lookup(stripped);
    if (result) return result;
    // Also try after removing dash suffix: "אזור תעשייה נשר - רמלה" → "נשר - רמלה" → "נשר"
    const indDashIdx = stripped.indexOf(' - ');
    if (indDashIdx > 0) {
      const indBase = stripped.slice(0, indDashIdx).trim();
      const result2 = lookup(indBase);
      if (result2) return result2;
    }
  }

  // 6. Strip "מרכז אזורי" prefix: "מרכז אזורי משגב" → "משגב"
  const regionalPrefix = 'מרכז אזורי ';
  if (normalized.startsWith(regionalPrefix)) {
    const stripped = normalized.slice(regionalPrefix.length).trim();
    const result = lookup(stripped);
    if (result) return result;
  }

  // 7. No match found — do NOT use substring matching (too many false positives)
  console.warn(`Unknown city: "${cityName}" - no region mapping found`);
  return null;
}
