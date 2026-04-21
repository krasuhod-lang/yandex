import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  FilterState,
  FilterPreset,
  ParseResult,
  SectionId,
  UploadHistoryEntry,
} from '@/types/dashboard'
import { DEFAULT_FILTERS, parseQuery, stringifyQuery, areFiltersEqual } from '@/lib/query-state'
import { parseWorkbook } from '@/lib/parser'

const LAST_FILE_KEY = 'dashboard:lastFile:v1'
const MAX_HISTORY = 5
const MAX_STORED_BYTES = 6 * 1024 * 1024 // ~6 MB safety cap for localStorage

type DashboardState = {
  /** Parsed currently active file, null when none uploaded. */
  parseResult: ParseResult | null
  /** Last-parsing error, presented on the Uploads screen. */
  parseError: string | null
  /** In-flight parsing state (for skeletons / onboarding). */
  isParsing: boolean
  /** Filter state, synchronised with URL. */
  filters: FilterState
  /** Saved filter presets (persisted in localStorage). */
  presets: FilterPreset[]
  /** Upload history metadata (file content itself is stored separately). */
  history: UploadHistoryEntry[]

  // actions
  loadFileFromBuffer: (
    buffer: ArrayBuffer,
    meta: { fileName: string; sheetName?: string },
  ) => Promise<void>
  loadFileFromUrl: (url: string, meta: { fileName: string }) => Promise<void>
  restoreLastFile: () => Promise<boolean>
  setFilters: (patch: Partial<FilterState>) => void
  resetFilters: () => void
  setSection: (section: SectionId) => void
  syncFiltersFromUrl: () => void
  savePreset: (name: string) => void
  applyPreset: (id: string) => void
  deletePreset: (id: string) => void
}

type PersistedSlice = Pick<DashboardState, 'presets' | 'history'>

export const useDashboardStore = create<DashboardState>()(
  persist<DashboardState, [], [], PersistedSlice>(
    (set, get) => ({
      parseResult: null,
      parseError: null,
      isParsing: false,
      filters: { ...DEFAULT_FILTERS, ...parseQuery(window.location.search) },
      presets: [],
      history: [],

      loadFileFromBuffer: async (buffer, meta) => {
        set({ isParsing: true, parseError: null })
        try {
          const result = await parseWorkbook(buffer, meta)
          if (result.errors.length > 0) {
            set({
              parseError: result.errors.join(' '),
              parseResult: result,
              isParsing: false,
            })
            return
          }
          // Persist the raw buffer for "resume on reload" if it fits.
          try {
            if (buffer.byteLength <= MAX_STORED_BYTES) {
              const b64 = bufferToBase64(buffer)
              localStorage.setItem(
                LAST_FILE_KEY,
                JSON.stringify({
                  fileName: meta.fileName,
                  sheetName: result.sheetName,
                  data: b64,
                  savedAt: Date.now(),
                }),
              )
            }
          } catch {
            // Quota exceeded — silently ignore, active file still works in memory.
          }

          const entry: UploadHistoryEntry = {
            id: `${result.parsedAt}-${meta.fileName}`,
            fileName: meta.fileName,
            sheetName: result.sheetName,
            rowCount: result.rows.length,
            uploadedAt: result.parsedAt,
          }

          set((state) => ({
            parseResult: result,
            parseError: null,
            isParsing: false,
            history: [entry, ...state.history].slice(0, MAX_HISTORY),
          }))
        } catch (err) {
          set({
            parseError: err instanceof Error ? err.message : 'Неизвестная ошибка при парсинге',
            isParsing: false,
          })
        }
      },

      loadFileFromUrl: async (url, meta) => {
        set({ isParsing: true, parseError: null })
        try {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buffer = await res.arrayBuffer()
          await get().loadFileFromBuffer(buffer, meta)
        } catch (err) {
          set({
            parseError:
              err instanceof Error ? err.message : 'Не удалось загрузить файл по URL',
            isParsing: false,
          })
        }
      },

      restoreLastFile: async () => {
        try {
          const raw = localStorage.getItem(LAST_FILE_KEY)
          if (!raw) return false
          const parsed = JSON.parse(raw) as {
            fileName: string
            sheetName?: string
            data: string
          }
          const buffer = base64ToBuffer(parsed.data)
          await get().loadFileFromBuffer(buffer, {
            fileName: parsed.fileName,
            sheetName: parsed.sheetName,
          })
          return true
        } catch {
          // Corrupt entry: remove so we don't loop on broken state.
          try {
            localStorage.removeItem(LAST_FILE_KEY)
          } catch {
            /* ignore */
          }
          return false
        }
      },

      setFilters: (patch) => {
        set((state) => {
          const next = { ...state.filters, ...patch }
          if (areFiltersEqual(next, state.filters)) return state
          syncUrl(next)
          return { filters: next }
        })
      },

      resetFilters: () => {
        set((state) => {
          const next: FilterState = { ...DEFAULT_FILTERS, section: state.filters.section }
          syncUrl(next)
          return { filters: next }
        })
      },

      setSection: (section) => {
        set((state) => {
          if (state.filters.section === section) return state
          const next = { ...state.filters, section }
          syncUrl(next)
          return { filters: next }
        })
      },

      syncFiltersFromUrl: () => {
        const next = parseQuery(window.location.search)
        set((state) => (areFiltersEqual(state.filters, next) ? state : { filters: next }))
      },

      savePreset: (name) => {
        set((state) => {
          const { section: _section, ...filters } = state.filters
          void _section
          const preset: FilterPreset = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: name.trim() || 'Без названия',
            filters,
            createdAt: Date.now(),
          }
          return { presets: [preset, ...state.presets].slice(0, 20) }
        })
      },

      applyPreset: (id) => {
        const preset = get().presets.find((p) => p.id === id)
        if (!preset) return
        set((state) => {
          const next: FilterState = {
            ...state.filters,
            ...preset.filters,
          }
          syncUrl(next)
          return { filters: next }
        })
      },

      deletePreset: (id) => {
        set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }))
      },
    }),
    {
      name: 'dashboard:state:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedSlice => ({
        presets: state.presets,
        history: state.history,
      }),
    },
  ),
)

function syncUrl(state: FilterState): void {
  const qs = stringifyQuery(state)
  const next = `${window.location.pathname}${qs}${window.location.hash}`
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(null, '', next)
  }
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
