/**
 * Minimal CSV / PNG export helpers that work in the browser without any
 * additional runtime dependencies.
 */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick to allow the browser to start the download first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** RFC 4180-style CSV: quote cells that contain ",", "\"", or newlines. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return ''
          const s = String(cell)
          if (/[",\n\r;]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`
          }
          return s
        })
        .join(','),
    )
    .join('\r\n')
}

export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]): void {
  // BOM for Excel to recognise UTF-8.
  const csv = '\uFEFF' + toCsv(rows)
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName)
}

/**
 * Serialise an SVG element (the chart root rendered by recharts) into a
 * standalone SVG string, adding an XML preamble and inlining the namespace.
 */
export function serializeSvg(svg: SVGElement): string {
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  const serializer = new XMLSerializer()
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(clone)
}

export function downloadSvg(fileName: string, svg: SVGElement): void {
  const str = serializeSvg(svg)
  downloadBlob(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }), fileName)
}

/**
 * Rasterise an SVG element into a PNG via a Canvas. Works entirely in the
 * browser with no external dependencies.
 */
export async function downloadSvgAsPng(
  fileName: string,
  svg: SVGElement,
  { scale = 2, background = '#ffffff' }: { scale?: number; background?: string } = {},
): Promise<void> {
  const svgStr = serializeSvg(svg)
  const { width, height } = getSvgSize(svg)
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Не удалось подготовить изображение для экспорта'))
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось получить контекст canvas')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error('Не удалось закодировать PNG'))
          return
        }
        downloadBlob(pngBlob, fileName)
        resolve()
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function getSvgSize(svg: SVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect()
  const w = rect.width || Number(svg.getAttribute('width')) || 800
  const h = rect.height || Number(svg.getAttribute('height')) || 400
  return { width: w, height: h }
}
