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

export default function FitnessChart({ data }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    dateLabel: format(parseISO(d.date), 'MMM d'),
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={formatted} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          interval={Math.floor(formatted.length / 6)}
        />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
          labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
          itemStyle={{ color: '#d1d5db' }}
        />
        <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />
        <ReferenceLine y={0} stroke="#374151" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="ctl"
          name="CTL (Fitness)"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="atl"
          name="ATL (Fatigue)"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="tsb"
          name="TSB (Form)"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
