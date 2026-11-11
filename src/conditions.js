// -----------------------------------------------------------------------------
// WeatherKit condition codes and alerts -> the pivot values of Gladys (pure).
// -----------------------------------------------------------------------------

import { WEATHER_CONDITIONS as C } from '@gladysassistant/integration-sdk';

// The conditionCode values of the WeatherKit REST API (WeatherCondition).
// Anything else is `unknown`, never guessed.
const CONDITIONS = {
  Clear: C.CLEAR,
  MostlyClear: C.CLEAR,
  Hot: C.CLEAR,
  Frigid: C.CLEAR,
  PartlyCloudy: C.PARTLY_CLOUDY,
  MostlyCloudy: C.CLOUD,
  Cloudy: C.CLOUD,
  Fog: C.FOG,
  Haze: C.FOG,
  Smoke: C.FOG,
  Dust: C.SANDSTORM,
  BlowingDust: C.SANDSTORM,
  Breezy: C.WIND,
  Windy: C.WIND,
  Drizzle: C.DRIZZLE,
  Rain: C.RAIN,
  Showers: C.RAIN,
  ScatteredShowers: C.RAIN,
  SunShowers: C.RAIN,
  MixedRainfall: C.RAIN,
  HeavyRain: C.POURING,
  FreezingDrizzle: C.FREEZING_RAIN,
  FreezingRain: C.FREEZING_RAIN,
  Sleet: C.SLEET,
  MixedRainAndSleet: C.SLEET,
  MixedRainAndSnow: C.SLEET,
  MixedSnowAndSleet: C.SLEET,
  WintryMix: C.SLEET,
  Flurries: C.SNOW,
  SunFlurries: C.SNOW,
  Snow: C.SNOW,
  SnowShowers: C.SNOW,
  ScatteredSnowShowers: C.SNOW,
  HeavySnow: C.SNOW,
  Blizzard: C.SNOW,
  BlowingSnow: C.SNOW,
  Hail: C.HAIL,
  Thunderstorm: C.THUNDERSTORM,
  Thunderstorms: C.THUNDERSTORM,
  IsolatedThunderstorms: C.THUNDERSTORM,
  ScatteredThunderstorms: C.THUNDERSTORM,
  SevereThunderstorm: C.THUNDERSTORM,
  StrongStorms: C.THUNDERSTORM,
  TropicalStorm: C.HURRICANE,
  Hurricane: C.HURRICANE,
  Tornado: C.TORNADO,
};

export function toCondition(code) {
  return typeof code === 'string' && Object.hasOwn(CONDITIONS, code) ? CONDITIONS[code] : C.UNKNOWN;
}

// WeatherKit severities are CAP's; "unknown" is kept as the lowest level
// (an alert is never dropped for its missing level).
const SEVERITIES = {
  extreme: 'extreme',
  severe: 'severe',
  moderate: 'moderate',
  minor: 'minor',
  unknown: 'minor',
};
export const SEVERITY_RANK = { extreme: 4, severe: 3, moderate: 2, minor: 1 };

export function toSeverity(value) {
  const key = typeof value === 'string' ? value.toLowerCase() : '';
  return Object.hasOwn(SEVERITIES, key) ? SEVERITIES[key] : 'minor';
}

// The phenomenon, from the alert title (English, French, German, Spanish).
// Order matters: "thunderstorm" before "storm", "wind chill" before "wind",
// "freezing rain" before "rain". No match: no type (the core keeps the text).
const TYPES = [
  ['thunderstorm', /thunder|orage|gewitter|tormenta/],
  ['avalanche', /avalanche|lawine|alud/],
  ['flood', /flood|inondation|crue|hochwasser|überflutung|inundaci/],
  ['coastal', /coastal|storm surge|high surf|rip current|submersion|vagues|sturmflut|costero/],
  ['cold', /wind chill|extreme cold|grand froid|kälte|frío/],
  ['snow', /snow|blizzard|ice storm|winter|freezing|neige|verglas|schnee|glätte|glatteis|nieve/],
  ['heat', /heat|canicule|chaleur|hitze|calor/],
  ['cold', /cold|frost|freeze|froid|gel\b/],
  ['wind', /wind|gale|hurricane|tornado|cyclone|vent|sturm|orkan|viento/],
  ['rain', /rain|pluie|regen|lluvia/],
  ['fog', /fog|brouillard|nebel|niebla/],
];

export function toAlertType(title) {
  if (typeof title !== 'string') return undefined;
  const lower = title.toLowerCase();
  return TYPES.find(([, re]) => re.test(lower))?.[0];
}
