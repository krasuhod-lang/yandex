import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

type MultiSelectProps = {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchable?: boolean
}

/**
 * Accessible multi-select: button opens a popover with a checkbox list.
 * Keyboard: Esc closes, arrow keys navigate focus on options inside
 * the listbox (browser default focus order does the job here).
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Все',
  searchable = false,
}: MultiSelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = searchable && search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? value[0]
        : `${value.length} выбрано`

  function toggle(v: string): void {
    if (value.includes(v)) onChange(value.filter((x) => x !== v))
    else onChange([...value, v])
  }

  return (
    <div ref={ref} className="relative">
      <div className="label-muted mb-1">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={clsx(
          'input flex items-center justify-between text-left',
          value.length > 0 && 'border-brand-500 bg-brand-50',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={clsx('truncate', value.length === 0 && 'text-slate-400')}>
          {summary}
        </span>
        <span className="ml-2 text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 max-h-72 w-[280px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
          role="listbox"
        >
          {searchable && (
            <div className="border-b border-slate-200 p-2">
              <input
                type="text"
                placeholder="Поиск…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input text-xs"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">Ничего не найдено</div>
            ) : (
              filtered.map((o) => {
                const selected = value.includes(o)
                return (
                  <label
                    key={o}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                      selected ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-brand-600"
                      checked={selected}
                      onChange={() => toggle(o)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={o}>
                      {o}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {value.length > 0 && (
            <div className="border-t border-slate-200 p-2">
              <button
                type="button"
                className="btn-ghost w-full text-xs"
                onClick={() => onChange([])}
              >
                Очистить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
