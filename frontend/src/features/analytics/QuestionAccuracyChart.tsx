import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { QuestionStats } from '../../types';

export function QuestionAccuracyChart({ questions }: { questions: QuestionStats[] }) {
  const rows = questions.map((q) => ({ name: `Q${q.position}`, accuracy: q.accuracy === null ? 0 : Math.round(q.accuracy * 1000) / 10, answered: q.submissions }));
  return (
    <div className="chart-box" role="img" aria-label={`Accuracy per question: ${rows.map((r) => `${r.name} ${r.answered ? `${r.accuracy}%` : 'no answers'}`).join(', ')}`}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="rgba(167,139,250,0.12)" vertical={false} />
          <XAxis dataKey="name" stroke="#a49fbd" tickLine={false} />
          <YAxis domain={[0, 100]} unit="%" stroke="#a49fbd" tickLine={false} />
          <Tooltip contentStyle={{ background: '#191427', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 10 }} cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
          <Bar dataKey="accuracy" name="Accuracy" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
