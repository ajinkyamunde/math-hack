import { useState, type FormEvent } from 'react';
import { DIFFICULTIES, DIFFICULTY_RULES, OPTION_KEYS, type Difficulty, type OptionKey, type QuestionInput, type QuestionStatus } from '../../types';
import { ErrorAlert } from '../common/Alert';
import { SelectField, TextAreaField, TextField } from '../forms/Fields';
import { QuestionPreview } from './QuestionPreview';
import type { ApiError } from '../../services/apiClient';
import { titleCase } from '../../utils/format';

export const emptyQuestion = (): QuestionInput => ({
  questionText: '',
  options: ['', '', '', ''],
  correctOption: 'A',
  difficulty: 'EASY',
  timeLimitSeconds: DIFFICULTY_RULES.EASY.defaultSeconds,
  points: DIFFICULTY_RULES.EASY.defaultPoints,
  topic: '',
  explanation: '',
  tags: [],
  status: 'DRAFT',
});

/** Client-side checks for fast feedback; the server re-validates everything. */
export function validateQuestion(q: QuestionInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (q.questionText.trim().length < 3) errors.questionText = 'Question text is required.';
  q.options.forEach((option, i) => {
    if (!option.trim()) errors[`options.${i}`] = `Option ${OPTION_KEYS[i]} is required.`;
  });
  const normalized = q.options.map((o) => o.trim().toLowerCase()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) errors.options = 'Options must all be different.';
  const rule = DIFFICULTY_RULES[q.difficulty];
  if (!Number.isInteger(q.timeLimitSeconds) || q.timeLimitSeconds < rule.minSeconds || q.timeLimitSeconds > rule.maxSeconds) {
    errors.timeLimitSeconds = `${titleCase(q.difficulty)} questions need ${rule.minSeconds}–${rule.maxSeconds} seconds.`;
  }
  if (!Number.isInteger(q.points) || q.points < 1 || q.points > 1000) errors.points = 'Points must be a whole number from 1 to 1000.';
  return errors;
}

interface QuestionFormProps {
  initial: QuestionInput;
  submitting: boolean;
  serverError: ApiError | null;
  onSubmit: (input: QuestionInput) => void;
  onCancel: () => void;
}

export function QuestionForm({ initial, submitting, serverError, onSubmit, onCancel }: QuestionFormProps) {
  const [question, setQuestion] = useState<QuestionInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagsText, setTagsText] = useState(initial.tags.join(', '));
  const serverFieldErrors = serverError?.fieldErrors ?? {};
  const fieldError = (key: string) => errors[key] ?? serverFieldErrors[key];
  const rule = DIFFICULTY_RULES[question.difficulty];

  const update = <K extends keyof QuestionInput>(key: K, value: QuestionInput[K]) => setQuestion((q) => ({ ...q, [key]: value }));

  function changeDifficulty(difficulty: Difficulty) {
    const next = DIFFICULTY_RULES[difficulty];
    setQuestion((q) => ({
      ...q,
      difficulty,
      timeLimitSeconds: next.defaultSeconds,
      points: q.points === DIFFICULTY_RULES[q.difficulty].defaultPoints ? next.defaultPoints : q.points,
    }));
  }

  function submit(status: QuestionStatus) {
    return (event?: FormEvent) => {
      event?.preventDefault();
      const payload = { ...question, status, tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10) };
      const found = validateQuestion(payload);
      setErrors(found);
      if (Object.keys(found).length === 0) onSubmit(payload);
    };
  }

  return (
    <div className="grid grid--2">
      <form className="panel stack" onSubmit={submit('ACTIVE')} noValidate>
        <ErrorAlert error={serverError} title="The question could not be saved" />
        <TextAreaField
          label="Question"
          value={question.questionText}
          maxLength={2000}
          onChange={(e) => update('questionText', e.target.value)}
          error={fieldError('questionText')}
          required
        />
        {question.options.map((option, index) => (
          <TextField
            key={OPTION_KEYS[index]}
            label={`Option ${OPTION_KEYS[index]}`}
            value={option}
            maxLength={500}
            onChange={(e) => update('options', question.options.map((o, i) => (i === index ? e.target.value : o)))}
            error={fieldError(`options.${index}`) ?? (index === 3 ? fieldError('options') : undefined)}
            required
          />
        ))}
        <div className="form-grid">
          <SelectField
            label="Correct answer"
            value={question.correctOption}
            onChange={(e) => update('correctOption', e.target.value as OptionKey)}
            options={OPTION_KEYS.map((k) => ({ value: k, label: `Option ${k}` }))}
          />
          <SelectField
            label="Difficulty"
            value={question.difficulty}
            onChange={(e) => changeDifficulty(e.target.value as Difficulty)}
            options={DIFFICULTIES.map((d) => ({ value: d, label: titleCase(d) }))}
          />
          <TextField
            label="Time limit (seconds)"
            type="number"
            inputMode="numeric"
            min={rule.minSeconds}
            max={rule.maxSeconds}
            value={question.timeLimitSeconds}
            onChange={(e) => update('timeLimitSeconds', Number(e.target.value))}
            hint={`${rule.minSeconds}–${rule.maxSeconds} s for ${titleCase(question.difficulty)}`}
            error={fieldError('timeLimitSeconds')}
          />
          <TextField
            label="Points"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={question.points}
            onChange={(e) => update('points', Number(e.target.value))}
            error={fieldError('points')}
          />
        </div>
        <div className="form-grid">
          <TextField label="Topic (optional)" value={question.topic} maxLength={100} onChange={(e) => update('topic', e.target.value)} />
          <TextField label="Tags (optional)" value={tagsText} onChange={(e) => setTagsText(e.target.value)} hint="Comma separated" />
        </div>
        <TextAreaField
          label="Explanation (optional)"
          value={question.explanation}
          maxLength={2000}
          onChange={(e) => update('explanation', e.target.value)}
          hint="Shown to students after the question closes, if answer reveal is enabled."
        />
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save as active'}</button>
          <button type="button" className="btn" disabled={submitting} onClick={submit('DRAFT')}>Save draft</button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
      <section className="panel panel--holo" aria-labelledby="preview-title">
        <div className="panel__title"><h2 id="preview-title">Student preview</h2></div>
        <QuestionPreview {...question} />
      </section>
    </div>
  );
}
