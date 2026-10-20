import { IDPhotoSpec } from '../types'
import { getHeadGuideMetrics, HeadGuideMetrics } from './pure'
import { EYE_IN_HEAD, getHeadPlacement } from './placement'

export { getHeadGuideMetrics }
export type { HeadGuideMetrics }

function round(value: number) {
  return Math.round(value * 10) / 10
}

/**
 * An SVG overlay showing where the head must sit, from the same placement
 * model automatic framing uses: the target crown line, the band the chin must
 * land in, the eye band when the spec has one, a shaded clear-space strip at
 * the top, and head outlines at the smallest and largest permitted heights.
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
  const { minHead, maxHead, minEye, maxEye, crownOffset } = placement
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
  const ellipse = (head: number) => {
    const top = y(crownFor(head))
    const h = head * height
    return `<ellipse cx="${cx}" cy="${top + h / 2}" rx="${(h * 0.75) / 2}" ry="${h / 2}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`
  }
  const hline = (at: number, dash: string, opacity = 0.7) =>
    `<line x1="0" y1="${at}" x2="${width}" y2="${at}" stroke="rgba(255,255,255,${opacity})" stroke-width="1"${
      dash ? ` stroke-dasharray="${dash}"` : ''
    }/>`

  const font = Math.max(9, Math.min(13, height * 0.028))
  const label = (at: number, text: string, anchor: 'start' | 'end') =>
    `<text x="${anchor === 'start' ? 6 : width - 6}" y="${at}" fill="rgba(255,255,255,0.95)" font-family="sans-serif" font-size="${font}" text-anchor="${anchor}" paint-order="stroke" stroke="rgba(0,0,0,0.55)" stroke-width="2.5">${text}</text>`

  const hasRange = largest > smallest
  const headLabel = hasRange
    ? `${round(metrics.minHeadMm)}-${round(metrics.maxHeadMm)} mm`
    : `min ${round(metrics.minHeadMm || metrics.maxHeadMm)} mm`
  const crownY = y(placement.crown)
  const chinMinY = y(crownFor(smallest) + smallest)
  const chinMaxY = y(crownFor(largest) + largest)

  let eyeBand = ''
  if (minEye > 0 || maxEye > 0) {
    const top = y(1 - (maxEye || minEye))
    const bottom = y(1 - (minEye || maxEye))
    eyeBand =
      (bottom > top
        ? `<rect x="0" y="${top}" width="${width}" height="${bottom - top}" fill="rgba(110,170,255,0.18)"/>`
        : hline(top, '2,3', 0.6)) + label(bottom - 4, 'eyes', 'end')
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    (crownOffset > 0
      ? `<rect x="0" y="0" width="${width}" height="${y(crownOffset)}" fill="rgba(0,0,0,0.22)"/>`
      : '') +
    eyeBand +
    (hasRange
      ? `<rect x="0" y="${chinMinY}" width="${width}" height="${
          chinMaxY - chinMinY
        }" fill="rgba(80,220,140,0.2)"/>`
      : '') +
    ellipse(smallest) +
    (hasRange ? ellipse(largest) : '') +
    hline(crownY, '') +
    hline(chinMinY, '4,3') +
    (hasRange ? hline(chinMaxY, '4,3') : '') +
    label(Math.max(font, crownY - 4), 'crown', 'start') +
    label(chinMinY - 4, `chin · head ${headLabel}`, 'start') +
    `</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export default createHeadGuideSVG
