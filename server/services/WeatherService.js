import { weatherWindowClosesAt } from '../domain/races/weatherWindow.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'
/**
 * WeatherService - Fetch historical weather data for races
 * Uses Open-Meteo API (free, no API key required)
 *
 * API Docs: https://open-meteo.com/en/docs/historical-weather-api
 */

export class WeatherService {
  constructor() {
    this.geocodingBaseUrl = 'https://geocoding-api.open-meteo.com/v1'
    this.weatherBaseUrl = 'https://archive-api.open-meteo.com/v1'
  }

  /**
   * Get historical weather for a race
   * @param {Date} date - Race date
   * @param {string} location - Location string (e.g., "New York, NY" or "Boston, MA")
   * @returns {Promise<Object>} { temp: "XX°F", condition: "sunny|cloudy|rainy" }
   */
  async getHistoricalWeather(date, location) {
    console.log(`[WeatherService] Fetching weather for ${location} on ${date.toDateString()}`)

    try {
      // Step 1: Geocode location to get lat/long
      const coords = await this.geocodeLocation(location)

      if (!coords) {
        console.log(`[WeatherService] Could not geocode location: ${location}`)
        return { temp: null, condition: null }
      }

      // Step 2: Fetch historical weather
      const weather = await this.fetchHistoricalWeather(date, coords.lat, coords.lon)

      console.log(`[WeatherService] Weather found: ${weather.temp}, ${weather.condition}`)
      return weather

    } catch (error) {
      console.error(`[WeatherService] Error fetching weather:`, error.message)
      return { temp: null, condition: null }
    }
  }

  /**
   * Geocode a location string to lat/long coordinates
   * @param {string} location - Location string
   * @returns {Promise<Object|null>} { lat, lon, name } or null
   */
  async geocodeLocation(location) {
    try {
      // "Burlington, VT" has to land in Vermont, not Ontario. The state (or
      // country) in the location picks among same-named places; without one,
      // the first result wins as before.
      const cleanLocation = this.cleanLocationString(location)
      const region = this.regionOf(location)
      const inRegion = r => (region.country ? r.country_code === region.country : true) && (region.admin1 ? String(r.admin1 || '').toLowerCase() === region.admin1.toLowerCase() : true)
      // "St Paul" is listed as "Saint Paul"; try both spellings, and look past the
      // first ten same-named places (Jackson, Wyoming is not in Jackson's top ten).
      const names = [...new Set([cleanLocation, cleanLocation.replace(/^St\.?\s+/i, 'Saint '), cleanLocation.replace(/^Saint\s+/i, 'St. ')])]
      let result = null
      for (const name of names) {
        const url = `${this.geocodingBaseUrl}/search?name=${encodeURIComponent(name)}&count=${region ? 100 : 10}&language=en&format=json`
        console.log(`[WeatherService] Geocoding: ${name}${region ? ` (${region.label})` : ''}`)
        const data = await (await fetchWithTimeout(url)).json()
        const results = data.results || []
        if (!results.length) continue
        if (!region) { result = results[0]; break }
        const match = results.filter(inRegion).sort((a, b) => (b.population || 0) - (a.population || 0))[0]
        if (match) { result = match; break }
      }
      if (!result) {
        // Never weather for the wrong town: a place outside the state asked for is no answer.
        console.warn(`[WeatherService] No place named "${cleanLocation}"${region ? ` in ${region.label}` : ''}`)
        return null
      }
      console.log(`[WeatherService] Geocoded to: ${result.name}, ${result.admin1 || ''}, ${result.country_code} (${result.latitude}, ${result.longitude})`)
      return { lat: result.latitude, lon: result.longitude, name: [result.name, result.admin1, result.country_code].filter(Boolean).join(', '), timezone: result.timezone || null }
    } catch (error) {
      console.error(`[WeatherService] Geocoding error:`, error.message)
      return null
    }
  }

  /** The state or country named after the comma: { country, admin1, label } or null. */
  regionOf(location) {
    const m = /,\s*([A-Za-z .]{2,})\s*$/.exec(String(location || ''))
    if (!m) return null
    const part = m[1].trim()
    const states = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' }
    const abbr = part.toUpperCase()
    if (states[abbr]) return { country: 'US', admin1: states[abbr], label: states[abbr] }
    const byName = Object.values(states).find(n => n.toLowerCase() === part.toLowerCase())
    if (byName) return { country: 'US', admin1: byName, label: byName }
    const countries = { usa: 'US', 'united states': 'US', uk: 'GB', 'united kingdom': 'GB', england: 'GB', germany: 'DE', japan: 'JP', australia: 'AU', canada: 'CA', france: 'FR', spain: 'ES', italy: 'IT', netherlands: 'NL', ireland: 'IE', ecuador: 'EC', mexico: 'MX' }
    const cc = countries[part.toLowerCase()]
    if (cc) return { country: cc, admin1: null, label: part }
    return { country: null, admin1: part, label: part }
  }

  cleanLocationString(location) {
    if (!location) return ''

    // Remove state codes and common suffixes
    // "New York, NY" -> "New York"
    // "Kiawah Island, SC" -> "Kiawah Island"
    let cleaned = location
      .replace(/,\s*[A-Z]{2}$/i, '') // Remove state codes like ", NY", ", SC"
      .replace(/\s+Park$/i, '') // "Central Park" -> "Central"
      .replace(/\s+Beach$/i, '') // "Miami Beach" -> "Miami"
      .trim()

    return cleaned
  }

  /**
   * Fetch historical weather data from Open-Meteo
   * @param {Date} date - Date to fetch weather for
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Promise<Object>} { temp: "XX°F", condition: "sunny|cloudy|rainy" }
   */
  async fetchHistoricalWeather(date, lat, lon) {
    try {
      // Format date as YYYY-MM-DD
      const dateStr = date.toISOString().split('T')[0]

      // Fetch hourly data so we can get race-start conditions (~7am)
      // Marathons start early morning, so max daily temp is not representative
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        start_date: dateStr,
        end_date: dateStr,
        hourly: 'temperature_2m,weather_code,precipitation',
        temperature_unit: 'fahrenheit',
        timezone: 'auto' // Infer timezone from lat/lon coordinates
      })

      const url = `${this.weatherBaseUrl}/archive?${params.toString()}`

      const response = await fetchWithTimeout(url)
      const data = await response.json()

      if (!data.hourly || !data.hourly.temperature_2m || data.hourly.temperature_2m.length === 0) {
        console.log(`[WeatherService] No weather data available for ${dateStr}`)
        return { temp: null, condition: null }
      }

      // Pick 7am (index 7) as representative race-start conditions
      // Hourly array runs 00:00 through 23:00, so index 7 = 7:00am local time
      const RACE_START_HOUR = 7
      const temp7am = data.hourly.temperature_2m[RACE_START_HOUR]
      const weatherCode7am = data.hourly.weather_code[RACE_START_HOUR]
      const precipitation7am = data.hourly.precipitation[RACE_START_HOUR]

      console.log(`[WeatherService] 7am conditions: ${temp7am}°F, code=${weatherCode7am}, precip=${precipitation7am}mm`)

      // Format temperature
      const temp = temp7am != null ? `${Math.round(temp7am)}°F` : null

      // Map weather code to simplified condition
      const condition = this.mapWeatherCodeToCondition(weatherCode7am, precipitation7am)

      return { temp, condition }

    } catch (error) {
      console.error(`[WeatherService] Weather API error:`, error.message)
      return { temp: null, condition: null }
    }
  }

  /**
   * Calculate race-window weather for a specific date + location.
   * Temp = average of the hourly temperatures 7am–1pm (local time).
   * Condition = the dominant of {sunny, rainy, cloudy, snowy} over that window
   * (most frequent, ties broken by severity snowy > rainy > cloudy > sunny).
   *
   * @param {string} dateStr - YYYY-MM-DD
   * @param {string} location - City / "City, ST"
   * @returns {Promise<{temp:string|null, condition:string|null, breakdown:object|null}>}
   */
  /**
   * @param previous  the breakdown saved last time, if any. Same date, same
   *   place and taken from the archive: the weather cannot have changed, so it
   *   is returned as is. Recalculating without changing the date or location
   *   always gives the same answer.
   */
  async calculateRaceWeather(dateStr, location, previous = null) {
    // A race that has not happened has no weather. Never a forecast on a print.
    const notYet = { temp: null, condition: null, breakdown: null, error: 'The race has not happened yet (its 7am to 1pm weather window has not closed), so there is no weather to calculate' }
    if (String(dateStr) > new Date().toISOString().slice(0, 10)) return notYet
    const coords = await this.geocodeLocation(location)
    if (!coords) {
      return { temp: null, condition: null, breakdown: null, error: `Couldn't find "${location}"` }
    }
    // Not before 1pm where the race is: until then the window is still a forecast.
    const closes = weatherWindowClosesAt(dateStr, coords.timezone)
    if (!closes || Date.now() < closes.getTime()) return notYet
    if (previous && previous.source === 'archive' && previous.date === dateStr && previous.place === coords.name && previous.avgTempF != null && previous.condition) {
      return { temp: `${previous.avgTempF}°F`, condition: previous.condition, breakdown: previous, unchanged: true }
    }

    const hourly = await this.fetchHourly(dateStr, coords.lat, coords.lon)
    if (!hourly) {
      return { temp: null, condition: null, breakdown: null, error: 'No weather data for that date' }
    }

    // Window: 7:00 through 13:00 inclusive (indices 7..13 of the 0–23 hourly arrays).
    const START_HOUR = 7
    const END_HOUR = 13
    const hours = []
    let tempSum = 0
    let tempCount = 0
    const counts = { sunny: 0, cloudy: 0, rainy: 0, snowy: 0 }

    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const t = hourly.temperature_2m?.[h]
      const code = hourly.weather_code?.[h]
      const precip = hourly.precipitation?.[h]
      if (t == null || code == null) continue
      const condition = this.mapWeatherCodeTo4(code, precip)
      counts[condition]++
      tempSum += t
      tempCount++
      hours.push({ hour: h, tempF: Math.round(t), condition, code })
    }

    if (tempCount === 0) {
      return { temp: null, condition: null, breakdown: null, error: 'No hourly data in the 7am–1pm window' }
    }

    const avgTempF = Math.round(tempSum / tempCount)
    // Dominant condition: most frequent, ties broken by severity.
    const severity = ['snowy', 'rainy', 'cloudy', 'sunny'] // most → least severe
    const condition = Object.keys(counts)
      .filter(c => counts[c] > 0)
      .sort((a, b) => counts[b] - counts[a] || severity.indexOf(a) - severity.indexOf(b))[0]

    const breakdown = {
      method: 'Average of hourly temps 7am–1pm; dominant condition over the same window.',
      place: coords.name,
      date: dateStr,
      avgTempF,
      condition,
      counts,
      hours,
      // archive = the settled historical record. forecast = the model's numbers for a day the
      // archive does not have yet (the last ~5 days); those are replaced when the archive catches up.
      source: hourly._source || 'archive',
      // The race's timezone, so anyone can tell when its 7am to 1pm window closed (races/verification.js).
      timezone: coords.timezone || null,
      calculatedAt: new Date().toISOString(),
    }

    return { temp: `${avgTempF}°F`, condition, breakdown }
  }

  /**
   * Fetch the hourly temperature/weather-code/precipitation arrays for a date.
   * Tries the historical archive first; falls back to the forecast API (which
   * covers recent past + near future) if the archive has no data yet.
   * @returns {Promise<object|null>} the `hourly` object, or null
   */
  async fetchHourly(dateStr, lat, lon) {
    const build = (base) => `${base}?` + new URLSearchParams({
      latitude: lat,
      longitude: lon,
      start_date: dateStr,
      end_date: dateStr,
      hourly: 'temperature_2m,weather_code,precipitation',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
    }).toString()

    for (const base of [`${this.weatherBaseUrl}/archive`, 'https://api.open-meteo.com/v1/forecast']) {
      try {
        const resp = await fetchWithTimeout(build(base))
        const data = await resp.json()
        if (data?.hourly?.temperature_2m?.some(v => v != null)) return { ...data.hourly, _source: base.includes('/archive') ? 'archive' : 'forecast' }
      } catch (err) {
        console.warn(`[WeatherService] fetchHourly ${base} failed: ${err.message}`)
      }
    }
    return null
  }

  /**
   * Map an Open-Meteo WMO code to one of four buckets: sunny | cloudy | rainy | snowy.
   * @param {number} code - WMO weather code
   * @param {number} [precipitation] - mm (tiebreaker toward rainy)
   * @returns {'sunny'|'cloudy'|'rainy'|'snowy'}
   */
  mapWeatherCodeTo4(code, precipitation) {
    // Snow: 71/73/75 snowfall, 77 grains, 85/86 snow showers
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowy'
    // Rain / drizzle / freezing / thunderstorm
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rainy'
    if (precipitation && precipitation > 0.5) return 'rainy'
    // Clear / mainly clear / partly cloudy
    if (code === 0 || code === 1 || code === 2) return 'sunny'
    // Overcast (3), fog (45/48), or anything else
    return 'cloudy'
  }

  /**
   * Map Open-Meteo weather code to simplified condition
   * Weather codes: https://open-meteo.com/en/docs
   *
   * Our categories:
   * - "sunny" = Clear, Partly Cloudy
   * - "cloudy" = Overcast, Fog
   * - "rainy" = Any precipitation (rain, drizzle, snow, thunderstorm)
   *
   * @param {number} code - WMO weather code
   * @param {number} precipitation - Precipitation amount in mm
   * @returns {string} "sunny", "cloudy", or "rainy"
   */
  mapWeatherCodeToCondition(code, precipitation) {
    // If significant precipitation, always return rainy
    if (precipitation && precipitation > 0.5) {
      return 'rainy'
    }

    // WMO Weather interpretation codes
    // 0: Clear sky
    if (code === 0) return 'sunny'

    // 1, 2, 3: Mainly clear, partly cloudy, and overcast
    if (code === 1 || code === 2) return 'sunny' // Mainly clear, partly cloudy
    if (code === 3) return 'cloudy' // Overcast

    // 45, 48: Fog
    if (code === 45 || code === 48) return 'cloudy'

    // 51, 53, 55: Drizzle
    if (code >= 51 && code <= 55) return 'rainy'

    // 56, 57: Freezing Drizzle
    if (code === 56 || code === 57) return 'rainy'

    // 61, 63, 65: Rain
    if (code >= 61 && code <= 65) return 'rainy'

    // 66, 67: Freezing Rain
    if (code === 66 || code === 67) return 'rainy'

    // 71, 73, 75: Snow fall
    if (code >= 71 && code <= 75) return 'rainy'

    // 77: Snow grains
    if (code === 77) return 'rainy'

    // 80, 81, 82: Rain showers
    if (code >= 80 && code <= 82) return 'rainy'

    // 85, 86: Snow showers
    if (code === 85 || code === 86) return 'rainy'

    // 95: Thunderstorm
    if (code === 95) return 'rainy'

    // 96, 99: Thunderstorm with hail
    if (code === 96 || code === 99) return 'rainy'

    // Default to cloudy for unknown codes
    console.log(`[WeatherService] Unknown weather code: ${code}, defaulting to cloudy`)
    return 'cloudy'
  }
}

export default WeatherService
