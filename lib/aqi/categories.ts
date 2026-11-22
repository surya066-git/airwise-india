const CATEGORIES = [
  { label: "Good", min: 0, max: 50, interpretation: "Minimal impact." },
  { label: "Satisfactory", min: 51, max: 100, interpretation: "May cause minor breathing discomfort to sensitive people." },
  { label: "Moderate", min: 101, max: 200, interpretation: "May cause breathing discomfort to people with lung or heart conditions, children, and older adults." },
  { label: "Poor", min: 201, max: 300, interpretation: "May cause breathing discomfort to people on prolonged exposure and discomfort to people with heart disease." },
  { label: "Very Poor", min: 301, max: 400, interpretation: "May cause respiratory illness on prolonged exposure; effects may be stronger for people with lung or heart disease." },
  { label: "Severe", min: 401, max: 500, interpretation: "May cause respiratory effects even in healthy people and serious impacts for people with lung or heart disease." }
] as const;

export function getCpcbCategory(aqi: number): { label: string; interpretation: string } | null {
  if (!Number.isInteger(aqi) || aqi < 0 || aqi > 500) return null;
  const category = CATEGORIES.find((item) => aqi >= item.min && aqi <= item.max);
  return category ? { label: category.label, interpretation: category.interpretation } : null;
}
