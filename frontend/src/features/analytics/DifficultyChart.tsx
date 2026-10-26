import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DifficultySummary } from '../../types';
import { titleCase } from '../../utils/format';

/** Correct vs incorrect vs unanswered per difficulty, from stored attempts. */
export function DifficultyChart({ data }: { data: DifficultySummary[] }) {
  const rows = data.map((d) => ({ name: titleCase(d.difficulty), Correct: d.correct, Incorrect: d.incorrect, Unanswered: d.timedOut }));
  return (
    <div className="chart-box" role="img" aria-label={`Answers by difficulty: ${rows.map((r) => `${r.name} ${r.Correct} correct, ${r.Incorrect} incorrect, ${r.Unanswered} unanswered`).join('; ')}`}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="rgba(167,139,250,0.12)" vertical={false} />
          <XAxis dataKey="name" stroke="#a49fbd" tickLine={false} />
          <YAxis allowDecimals={false} stroke="#a49fbd" tickLine={false} />
          <Tooltip contentStyle={{ background: '#191427', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 10 }} cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
          <Legend />
          <Bar dataKey="Correct" stackId="a" fill="#34d399" />
          <Bar dataKey="Incorrect" stackId="a" fill="#f87171" />
          <Bar dataKey="Unanswered" stackId="a" fill="#77718f" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
