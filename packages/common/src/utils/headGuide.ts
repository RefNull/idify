import { IDPhotoSpec } from '../types'
import { getHeadGuideMetrics, HeadGuideMetrics } from './pure'
import { EYE_IN_HEAD, getHeadPlacement } from './placement'

export { getHeadGuideMetrics }
export type { HeadGuideMetrics }

function round(value: number) {
  return Math.round(value * 10) / 10
}

function range(min: number, max: number) {
  return round(min) === round(max)
    ? `${round(min)} mm`
    : `${round(min)}-${round(max)} mm`
}

/**
 * Guide strokes are drawn twice, a solid black line under white dashes, so
 * they read as alternating black and white segments on any photo.
 */
const DASH = '4,4'
const stroke = (shape: (attrs: string) => string, width = 1) =>
  shape(`fill="none" stroke="black" stroke-width="${width}"`) +
  shape(
    `fill="none" stroke="white" stroke-width="${width}" stroke-dasharray="${DASH}"`
  )

/**
 * An SVG overlay showing where the head must sit, from the same placement
 * model automatic framing uses: the crown line (or the band the crown must
 * land in), the band the chin must land in, the eye band when the spec has
 * one, a shaded clear-space strip at the top, head outlines at the smallest
 * and largest permitted heights, and the vertical centre line (with the
 * allowed drift either side when the spec sets one).
 * Returned as a data URL for use as a background image.
 */
export function createHeadGuideSVG(
  spec: IDPhotoSpec,
  size: { width: number; height: number }
): string {
  const metrics = getHeadGuideMetrics(spec)
  const placement = getHeadPlacement(spec)
  if (!metrics || !placement || size.width <= 0 || size.height <= 0) {
    return ''
  }
  const { width, height } = size
  const {
    minHead,
    maxHead,
    minEye,
    maxEye,
    crownOffset,
    maxCrownOffset,
    minChin,
    maxChin,
  } = placement
  const { photoHeightMm } = metrics
  const smallest = minHead || placement.headRatio
  const largest = maxHead || smallest
  // With an eye band, heads of every size are anchored on its middle;
  // otherwise on the crown line.
  const eyeMid =
    minEye > 0 && maxEye > 0 ? 1 - (minEye + maxEye) / 2 : null
  const crownFor = (head: number) =>
    eyeMid !== null ? eyeMid - EYE_IN_HEAD * head : placement.crown
  const y = (fraction: number) => fraction * height
  const cx = width / 2
  const ellipse = (top: number, h: number) =>
    stroke(
      (attrs) =>
        `<ellipse cx="${cx}" cy="${top + h / 2}" rx="${(h * 0.75) / 2}" ry="${h / 2}" ${attrs} stroke-opacity="0.6"/>`
    )
  const hline = (at: number) =>
    stroke(
      (attrs) =>
        `<line x1="0" y1="${at}" x2="${width}" y2="${at}" ${attrs}/>`
    )
  const vline = (at: number, opacity = 1) =>
    stroke(
      (attrs) =>
        `<line x1="${at}" y1="0" x2="${at}" y2="${height}" ${attrs} stroke-opacity="${opacity}"/>`
    )
  const band = (top: number, bottom: number, fill: string) =>
    bottom > top
      ? `<rect x="0" y="${top}" width="${width}" height="${bottom - top}" fill="${fill}"/>`
      : ''

  const font = Math.max(9, Math.min(13, height * 0.028))
  const label = (at: number, text: string, anchor: 'start' | 'end') =>
    `<text x="${anchor === 'start' ? 6 : width - 6}" y="${at}" fill="rgba(255,255,255,0.95)" font-family="sans-serif" font-size="${font}" text-anchor="${anchor}" paint-order="stroke" stroke="rgba(0,0,0,0.55)" stroke-width="2.5">${text}</text>`

  const hasRange = largest > smallest
  const headLabel = hasRange
    ? range(metrics.minHeadMm, metrics.maxHeadMm)
    : `min ${round(metrics.minHeadMm || metrics.maxHeadMm)} mm`

  // Crown: the band between the smallest and largest clear space when the
  // spec bounds both, otherwise the target line.
  const hasCrownBand = crownOffset > 0 && maxCrownOffset > crownOffset
  const crownTopY = y(hasCrownBand ? crownOffset : placement.crown)
  const crownBottomY = y(hasCrownBand ? maxCrownOffset : placement.crown)
  const crownLabel = hasCrownBand
    ? `crown ${range(crownOffset * photoHeightMm, maxCrownOffset * photoHeightMm)} from top`
    : 'crown'

  // Chin: the spec's own clear-space band below the chin when it has one,
  // otherwise where the smallest and largest heads end.
  const chinTop = maxChin || minChin
  const chinBottom = minChin || maxChin
  const chinTopY = chinTop
    ? y(1 - chinTop)
    : y(crownFor(smallest) + smallest)
  const chinBottomY = chinBottom
    ? y(1 - chinBottom)
    : y(crownFor(largest) + largest)
  const chinLabel =
    minChin > 0 && maxChin > minChin
      ? `chin ${range(minChin * photoHeightMm, maxChin * photoHeightMm)} from bottom · head ${headLabel}`
      : `chin · head ${headLabel}`

  let eyeBand = ''
  if (minEye > 0 || maxEye > 0) {
    const top = y(1 - (maxEye || minEye))
    const bottom = y(1 - (minEye || maxEye))
    eyeBand =
      (bottom > top
        ? band(top, bottom, 'rgba(110,170,255,0.18)')
        : hline(top)) + label(bottom - 4, 'eyes', 'end')
  }

  // Head outlines. With crown or chin bands, the smallest head spans the
  // inner edges of the bands and the largest the outer edges, so the outlines
  // meet the marker lines; otherwise both hang from the anchored crown.
  const hasChinBand = minChin > 0 || maxChin > 0
  const outlines =
    hasCrownBand || hasChinBand
      ? ellipse(crownBottomY, chinTopY - crownBottomY) +
        (chinBottomY > chinTopY || crownBottomY > crownTopY
          ? ellipse(crownTopY, chinBottomY - crownTopY)
          : '')
      : ellipse(y(crownFor(smallest)), smallest * height) +
        (hasRange ? ellipse(y(crownFor(largest)), largest * height) : '')

  const centerOffset = spec.rules?.maxCenterOffset ?? 0
  const centerDrift = centerOffset > 0 ? y(centerOffset) : 0

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    (crownOffset > 0 ? band(0, y(crownOffset), 'rgba(0,0,0,0.22)') : '') +
    (hasCrownBand ? band(crownTopY, crownBottomY, 'rgba(80,220,140,0.2)') : '') +
    eyeBand +
    band(chinTopY, chinBottomY, 'rgba(80,220,140,0.2)') +
    outlines +
    vline(cx) +
    (centerDrift > 0
      ? vline(cx - centerDrift, 0.6) + vline(cx + centerDrift, 0.6)
      : '') +
    hline(crownTopY) +
    (crownBottomY > crownTopY ? hline(crownBottomY) : '') +
    hline(chinTopY) +
    (chinBottomY > chinTopY ? hline(chinBottomY) : '') +
    label(Math.max(font, crownTopY - 4), crownLabel, 'start') +
    label(chinTopY - 4, chinLabel, 'start') +
    `</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export default createHeadGuideSVG
