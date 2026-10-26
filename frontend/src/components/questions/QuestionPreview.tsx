import type { Difficulty, OptionKey } from '../../types';
import { DifficultyBadge } from '../common/Badges';
import { AnswerOptions } from './AnswerOptions';

interface QuestionPreviewProps {
  questionText: string;
  options: string[];
  difficulty: Difficulty;
  timeLimitSeconds: number;
  points: number;
  correctOption?: OptionKey;
  explanation?: string;
}

/** Shows a question the way students will see it, with the answer highlighted for the host. */
export function QuestionPreview(props: QuestionPreviewProps) {
  return (
    <div className="stack">
      <div className="row">
        <DifficultyBadge difficulty={props.difficulty} />
        <span className="badge badge--neutral">{props.timeLimitSeconds}s</span>
        <span className="badge badge--neutral">{props.points} pts</span>
      </div>
      <p className="question-text" style={{ margin: 0 }}>{props.questionText || <span className="muted">Question text will appear here.</span>}</p>
      <AnswerOptions name="preview" options={props.options.map((o, i) => o || `Option ${'ABCD'[i]}`)} selected={null} locked correctOption={props.correctOption} />
      {props.explanation && <p className="muted small"><strong>Explanation:</strong> {props.explanation}</p>}
    </div>
  );
}
