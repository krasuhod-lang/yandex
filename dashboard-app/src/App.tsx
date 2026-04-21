import { useEffect } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import { Sidebar } from '@/components/layout/Sidebar'
import { FilterBar } from '@/components/filters/FilterBar'
import { Onboarding } from '@/components/upload/Onboarding'
import { Overview } from '@/sections/Overview'
import { Traffic } from '@/sections/Traffic'
import { Conversions } from '@/sections/Conversions'
import { Campaigns } from '@/sections/Campaigns'
import { Products } from '@/sections/Products'
import { DataQuality } from '@/sections/DataQuality'
import { Uploads } from '@/sections/Uploads'
import type { SectionId } from '@/types/dashboard'

function Section({ id }: { id: SectionId }): JSX.Element {
  switch (id) {
    case 'overview':
      return <Overview />
    case 'traffic':
      return <Traffic />
    case 'conversions':
      return <Conversions />
    case 'campaigns':
      return <Campaigns />
    case 'products':
      return <Products />
    case 'data-quality':
      return <DataQuality />
    case 'uploads':
      return <Uploads />
  }
}

export default function App(): JSX.Element {
  const parseResult = useDashboardStore((s) => s.parseResult)
  const isParsing = useDashboardStore((s) => s.isParsing)
  const restoreLastFile = useDashboardStore((s) => s.restoreLastFile)
  const syncFiltersFromUrl = useDashboardStore((s) => s.syncFiltersFromUrl)
  const section = useDashboardStore((s) => s.filters.section)

  useEffect(() => {
    void restoreLastFile()
  }, [restoreLastFile])

  useEffect(() => {
    const handler = () => syncFiltersFromUrl()
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [syncFiltersFromUrl])

  const hasData = Boolean(parseResult && parseResult.rows.length > 0)

  return (
    <div className="flex h-screen min-w-[1280px] overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {hasData && <FilterBar />}
        <main className="flex-1 overflow-y-auto bg-slate-50">
          {isParsing && !hasData ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Обрабатываем файл…
            </div>
          ) : hasData ? (
            <Section id={section} />
          ) : section === 'uploads' ? (
            <Uploads />
          ) : (
            <Onboarding />
          )}
        </main>
      </div>
    </div>
  )
}
