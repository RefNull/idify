export type IDPhotoType =
  | 'identification'
  | 'passport'
  | 'visa'
  | 'driving'
  | 'student'
  | 'generic'
  | 'others'
  | 'custom'

export interface IDPhotoSpec {
  name: string
  type: IDPhotoType
  title: string
  region: string
  zone: string
  flag: string
  dimension: {
    dpi: number
    width: number
    height: number
    unit: 'mm' | 'cm' | 'inch'
  }
  /** Composition rules. Ratios are fractions of the photo height (0..1]. */
  rules?: {
    /** Maximum file size in KB. */
    size?: number
    /** Smallest chin-to-crown head height. */
    minHeadHeight?: number
    /** Clear space required above the crown, measured from the top edge. */
    minHeadOffset?: number
    /** Largest clear space allowed above the crown. */
    maxHeadOffset?: number
    /** Clear space required below the chin, measured from the bottom edge. */
    minChinOffset?: number
    /** Largest clear space allowed below the chin. */
    maxChinOffset?: number
    /** How far the face's centre line may stray from the photo's centre line. */
    maxCenterOffset?: number
    /** Largest chin-to-crown head height. */
    maxHeadHeight?: number
    /** Eye line distance from the BOTTOM edge, lower bound (min ≤ max). */
    minEyeHeight?: number
    /** Eye line distance from the BOTTOM edge, upper bound (min ≤ max). */
    maxEyeHeight?: number
  }
  background: string
  comment?: string
  prohibitBackgroundRemoval?: boolean
}

export interface IDPhotoGroup {
  name: string
  title: string
  specs: IDPhotoSpec[]
}
