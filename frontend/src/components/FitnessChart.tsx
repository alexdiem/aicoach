import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import type { FitnessPoint } from '../types'

interface Props {
  data: FitnessPoint[]
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 text-xs shadow-lg">
      <p className="text-gray-700 font-semibold mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500">{p.name}</span>
          <span className="text-gray-900 font-semibold ml-auto pl-4 tabular-nums">{Math.round(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function FitnessChart({ data }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    dateLabel: format(parseISO(d.date), 'MMM d'),
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
        <XAxis
          dataKey="dateLabel"
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval={Math.floor(formatted.length / 6)}
        />
        <YAxis
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ paddingTop: 12, fontSize: 11, color: '#9CA3AF' }}
          iconType="circle"
          iconSize={8}
        />
        <ReferenceLine y={0} stroke="#D1D5DB" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="ctl"
          name="CTL"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="atl"
          name="ATL"
          stroke="#f43f5e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="tsb"
          name="TSB"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
