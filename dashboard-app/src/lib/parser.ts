import ExcelJS from 'exceljs'
import { COLUMN_DEFS, type ColumnDef } from '@/config/columns'
import type { DashboardRow, ParseResult, ParsedRow, RowMeta } from '@/types/dashboard'
import { dashboardRowSchema, softValidate } from './validators'

/**
 * Values that should be treated as "missing" in any numeric or string cell.
 * Normalised with leading/trailing whitespace removed before comparison.
 */
const MISSING_TOKENS = new Set(['', '-', '—', '–', 'n/a', 'na', 'null', 'нет', 'none'])

/**
 * Normalise a header string for matching: lowercase, strip NBSP/whitespace.
 * Aliases in columns.ts are compared through this function.
 */
function normHeader(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).replace(/\u00A0/g, ' ').trim().toLowerCase()
}

function isMissing(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'number') return false
  if (typeof raw === 'boolean') return false
  if (raw instanceof Date) return false
  const s = String(raw).replace(/\u00A0/g, ' ').trim().toLowerCase()
  return MISSING_TOKENS.has(s)
}

/**
 * Parse a numeric cell with tolerance for Russian/European formats.
 * Rules (docs/data-dictionary.md §3):
 *   - "-" / "—" / "" / "n/a" → null
 *   - thousands separators: space, NBSP, apostrophe, narrow NBSP
 *   - decimal separators: "." or ","
 *   - trailing "%" → value / 100
 *   - raw number > 1 with kind="ratio" and no % sign → value / 100
 *     (the Excel cell lacked the % format flag)
 *   - ExcelJS already returns percent-formatted cells as the stored fraction
 *     (e.g. 9.9% → 0.099), so those bypass the /100 correction above.
 */
function parseNumber(raw: unknown, kind: 'number' | 'ratio'): number | null {
  if (isMissing(raw)) return null

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null
    // Ratio stored as a >1 number is almost certainly "9.9" meaning "9.9%"
    // rather than "990%". Coerce to fraction.
    if (kind === 'ratio' && raw > 1.01) return raw / 100
    return raw
  }

  if (typeof raw === 'object' && raw !== null) {
    // ExcelJS sometimes returns objects for formulas: { result, formula } or
    // rich text: { richText: [...] }. Extract a printable primitive.
    const obj = raw as {
      result?: unknown
      formula?: unknown
      text?: unknown
      richText?: { text: string }[]
    }
    if (obj.result !== undefined) return parseNumber(obj.result, kind)
    if (typeof obj.text === 'string') return parseNumber(obj.text, kind)
    if (Array.isArray(obj.richText)) {
      return parseNumber(obj.richText.map((p) => p.text ?? '').join(''), kind)
    }
    return null
  }

  const s = String(raw).replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ').trim()
  if (MISSING_TOKENS.has(s.toLowerCase())) return null

  const hasPercent = s.endsWith('%')
  let cleaned = hasPercent ? s.slice(0, -1).trim() : s
  // Strip thousand separators (space / apostrophe).
  cleaned = cleaned.replace(/[ ']/g, '')
  // Normalise decimal comma. If both "." and "," are present, assume "."
  // is the thousands separator (European "1.234,56") — strip it and convert
  // "," to ".".
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.')
  }

  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  if (hasPercent) return n / 100
  if (kind === 'ratio' && n > 1.01) return n / 100
  return n
}

function parseString(raw: unknown): string | null {
  if (isMissing(raw)) return null
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { text?: unknown; richText?: { text: string }[] }
    if (typeof obj.text === 'string') return obj.text.trim() || null
    if (Array.isArray(obj.richText)) {
      const joined = obj.richText.map((p) => p.text ?? '').join('').trim()
      return joined.length > 0 ? joined : null
    }
    return null
  }
  const s = String(raw).replace(/\u00A0/g, ' ').trim()
  return s.length > 0 ? s : null
}

/**
 * Given the sheet's header row, build an index: ColumnDef -> column index.
 * Returns list of ColumnDefs whose headers were not found (missing columns).
 */
function matchHeaders(
  headerCells: unknown[],
): { indexByField: Map<string, number>; missing: ColumnDef[] } {
  const normalisedCells = headerCells.map(normHeader)
  const indexByField = new Map<string, number>()
  const missing: ColumnDef[] = []

  for (const def of COLUMN_DEFS) {
    const aliasesNorm = def.aliases.map((a) => normHeader(a))
    const idx = normalisedCells.findIndex((cell) => aliasesNorm.includes(cell))
    if (idx === -1) missing.push(def)
    else indexByField.set(def.field, idx)
  }
  return { indexByField, missing }
}

function isAggregateCampaign(name: string | null): boolean {
  if (!name) return false
  // "Итого директ", "Итого PDL онлайн", "Total", etc.
  return /^\s*(итог|total)/i.test(name)
}

/**
 * Parse a workbook buffer into a ParseResult. The caller decides which sheet
 * to use; when omitted, the first sheet named "datank" is preferred, otherwise
 * the first sheet in the workbook.
 */
export async function parseWorkbook(
  buffer: ArrayBuffer,
  options: { fileName: string; sheetName?: string },
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch (err) {
    // Fall back to CSV parse if the buffer turned out to be CSV. Not in scope
    // for v1, so just report a clean error.
    return {
      errors: [
        `Не удалось прочитать Excel-файл: ${
          err instanceof Error ? err.message : 'неизвестная ошибка'
        }. Поддерживаются форматы .xlsx и .xls.`,
      ],
      warnings: [],
      sheetName: '',
      sheetNames: [],
      missingColumns: [],
      rows: [],
      fileName: options.fileName,
      parsedAt: Date.now(),
    }
  }

  const sheetNames = workbook.worksheets.map((ws) => ws.name)
  if (sheetNames.length === 0) {
    return {
      errors: ['Файл не содержит ни одного листа'],
      warnings: [],
      sheetName: '',
      sheetNames,
      missingColumns: [],
      rows: [],
      fileName: options.fileName,
      parsedAt: Date.now(),
    }
  }

  const preferred =
    options.sheetName ??
    sheetNames.find((n) => n.toLowerCase() === 'datank') ??
    sheetNames[0]

  const sheet = workbook.getWorksheet(preferred)
  if (!sheet) {
    return {
      errors: [`Лист "${preferred}" не найден. Доступные листы: ${sheetNames.join(', ')}`],
      warnings: [],
      sheetName: preferred,
      sheetNames,
      missingColumns: [],
      rows: [],
      fileName: options.fileName,
      parsedAt: Date.now(),
    }
  }

  // Collect header row (row 1). We deliberately use actualColumnCount rather
  // than columnCount to ignore trailing empty columns.
  const headerRow = sheet.getRow(1)
  const lastCol = Math.max(sheet.actualColumnCount, headerRow.actualCellCount)
  const headerCells: unknown[] = []
  for (let c = 1; c <= lastCol; c++) {
    headerCells.push(headerRow.getCell(c).value)
  }

  const { indexByField, missing } = matchHeaders(headerCells)

  const errors: string[] = []
  const warnings: string[] = []

  if (missing.length > 0) {
    errors.push(
      `В файле отсутствуют обязательные колонки: ${missing.map((c) => `«${c.header}»`).join(', ')}`,
    )
  }

  const rows: ParsedRow[] = []

  if (errors.length === 0) {
    const lastRow = sheet.actualRowCount
    for (let r = 2; r <= lastRow; r++) {
      const excelRow = sheet.getRow(r)
      if (excelRow.cellCount === 0 && excelRow.actualCellCount === 0) continue

      const data: Partial<DashboardRow> = {}
      const missingByField: Partial<Record<keyof DashboardRow, boolean>> = {}

      for (const def of COLUMN_DEFS) {
        const colIdx = indexByField.get(def.field)!
        // ExcelJS uses 1-based column indexing.
        const raw = excelRow.getCell(colIdx + 1).value
        if (def.kind === 'string') {
          const v = parseString(raw)
          if (v === null) {
            missingByField[def.field] = true
            ;(data as Record<string, unknown>)[def.field] = ''
          } else {
            ;(data as Record<string, unknown>)[def.field] = v
          }
        } else {
          const v = parseNumber(raw, def.kind)
          if (v === null) {
            missingByField[def.field] = true
            ;(data as Record<string, unknown>)[def.field] = 0
          } else {
            ;(data as Record<string, unknown>)[def.field] = v
          }
        }
      }

      // Skip rows that have no classification at all — empty separator rows.
      if (
        !data.month &&
        !data.product &&
        !data.trafficSource &&
        !data.campaignName
      ) {
        continue
      }

      const meta: RowMeta = {
        isAggregate: isAggregateCampaign(data.campaignName ?? null),
        isMissing: missingByField,
        warnings: [],
        sourceRow: r,
      }

      const validation = dashboardRowSchema.safeParse(data)
      if (!validation.success) {
        // Structural row-level problem (e.g. negative number). Record as warning
        // and still keep the row available for the user in Data Quality.
        const issues = validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        meta.warnings.push(...issues)
      } else {
        meta.warnings.push(...softValidate(validation.data))
      }

      rows.push({ data: data as DashboardRow, meta })
    }
  }

  const totalRows = rows.length
  const aggregates = rows.filter((r) => r.meta.isAggregate).length
  if (totalRows > 0) {
    warnings.push(`Загружено строк: ${totalRows}; из них агрегатов «Итого…»: ${aggregates}.`)
  }

  return {
    errors,
    warnings,
    sheetName: preferred,
    sheetNames,
    missingColumns: missing.map((c) => c.header),
    rows,
    fileName: options.fileName,
    parsedAt: Date.now(),
  }
}
