/** Key used by older versions, which cached a region looked up from the user's IP. */
const LEGACY_REGION_KEY = 'region'

function regionFromLocale(tag: string): string {
  try {
    const locale = new Intl.Locale(tag)
    const region = locale.region || locale.maximize().region
    return region && /^[A-Z]{2}$/.test(region) ? region : ''
  } catch {
    return ''
  }
}

/**
 * Best-effort ISO 3166-1 alpha-2 region of the user, derived from the browser
 * language settings only (no network request). Resolves to '' when unknown and
 * never rejects.
 */
export function getRegion(): Promise<string> {
  try {
    localStorage.removeItem(LEGACY_REGION_KEY)
  } catch {
    // storage unavailable
  }
  try {
    const languages =
      typeof navigator === 'undefined'
        ? []
        : navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
    for (const language of languages) {
      if (!language) continue
      const region = regionFromLocale(language)
      if (region) return Promise.resolve(region)
    }
  } catch {
    // fall through
  }
  return Promise.resolve('')
}
