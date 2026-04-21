import { useRef, useState, type DragEvent } from 'react'
import clsx from 'clsx'
import { useDashboardStore } from '@/store/dashboardStore'
import { formatFileSize } from '@/lib/formatters'

type Props = {
  /** Compact layout for sidebar-like usage. */
  compact?: boolean
}

/**
 * Drag-and-drop + button upload. Accepts .xlsx and .xls. Routes the file
 * into the store's loadFileFromBuffer action. Safe to render on any screen.
 */
export function Uploader({ compact }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const loadFileFromBuffer = useDashboardStore((s) => s.loadFileFromBuffer)
  const isParsing = useDashboardStore((s) => s.isParsing)

  async function handleFile(file: File): Promise<void> {
    setLastError(null)
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setLastError('Поддерживаются только файлы .xlsx и .xls')
      return
    }
    // 50 MB hard cap — everything parses client-side so huge files would
    // freeze the UI.
    if (file.size > 50 * 1024 * 1024) {
      setLastError(
        `Файл слишком большой (${formatFileSize(file.size)}). Максимум 50 МБ для v1.`,
      )
      return
    }
    const buffer = await file.arrayBuffer()
    await loadFileFromBuffer(buffer, { fileName: file.name })
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  return (
    <div
      className={clsx(
        'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
        dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white',
        compact && 'p-4',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          // Reset so selecting the same file twice re-triggers the handler.
          e.target.value = ''
        }}
      />
      <div className={clsx('text-sm text-slate-700', compact && 'text-xs')}>
        Перетащите Excel-файл сюда или
      </div>
      <button
        type="button"
        className="btn-primary mt-2"
        onClick={() => inputRef.current?.click()}
        disabled={isParsing}
      >
        {isParsing ? 'Обрабатываем…' : 'Загрузить Excel'}
      </button>
      <div className={clsx('mt-2 text-xs text-slate-500', compact && 'text-[10px]')}>
        Поддерживаются .xlsx и .xls, до 50 МБ
      </div>
      {lastError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {lastError}
        </div>
      )}
    </div>
  )
}
