import { useState } from 'react';
import { DifficultyBadge } from '../../components/common/Badges';
import { EmptyState } from '../../components/common/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/forms/Fields';
import { DIFFICULTIES, OPTION_KEYS, type Difficulty, type DirectQuestionInput, type OptionKey } from '../../types';
import { titleCase } from '../../utils/format';

interface BulkQuestionEditorProps {
  questions: DirectQuestionInput[];
  onChange: (questions: DirectQuestionInput[]) => void;
  maxQuestions?: number;
  disabled?: boolean;
}

const emptyForm = (): {
  questionText: string;
  options: [string, string, string, string];
  correctOption: OptionKey;
  difficulty: Difficulty;
} => ({
  questionText: '',
  options: ['', '', '', ''],
  correctOption: 'A',
  difficulty: 'EASY',
});

export function BulkQuestionEditor({ questions, onChange, maxQuestions = 50, disabled = false }: BulkQuestionEditorProps) {
  // editingIndex: null = no form open; -1 = creating a new question; >= 0 = editing that question index
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  function openNew() {
    if (questions.length >= maxQuestions) return;
    setForm(emptyForm());
    setFormError(null);
    setEditingIndex(-1);
  }

  function openEdit(index: number) {
    const q = questions[index];
    if (!q) return;
    setForm({
      questionText: q.questionText,
      options: [q.options[0] ?? '', q.options[1] ?? '', q.options[2] ?? '', q.options[3] ?? ''],
      correctOption: q.correctOption,
      difficulty: q.difficulty,
    });
    setFormError(null);
    setEditingIndex(index);
  }

  function closeForm() {
    setEditingIndex(null);
    setFormError(null);
  }

  function saveQuestion() {
    if (form.questionText.trim().length < 3) {
      setFormError('Question text must be at least 3 characters.');
      return;
    }
    for (let i = 0; i < 4; i++) {
      const opt = form.options[i];
      if (!opt || !opt.trim()) {
        setFormError(`Option ${OPTION_KEYS[i]} is required.`);
        return;
      }
    }
    const normalized = form.options.map((o) => o.trim().toLowerCase());
    if (new Set(normalized).size !== 4) {
      setFormError('All four options must be distinct.');
      return;
    }

    const payload: DirectQuestionInput = {
      id: editingIndex !== null && editingIndex >= 0 ? questions[editingIndex]?.id : undefined,
      questionText: form.questionText.trim(),
      options: [form.options[0].trim(), form.options[1].trim(), form.options[2].trim(), form.options[3].trim()],
      correctOption: form.correctOption,
      difficulty: form.difficulty,
    };

    if (editingIndex === -1) {
      onChange([...questions, payload]);
    } else if (editingIndex !== null && editingIndex >= 0) {
      const next = [...questions];
      next[editingIndex] = payload;
      onChange(next);
    }
    closeForm();
  }

  function removeQuestion(index: number) {
    onChange(questions.filter((_, i) => i !== index));
    if (editingIndex === index) closeForm();
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    const temp = next[index]!;
    next[index] = next[target]!;
    next[target] = temp;
    onChange(next);
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row row--between" style={{ alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0 }}>Questions ({questions.length} / {maxQuestions})</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Enter up to {maxQuestions} MCQ questions directly for this competition.
          </p>
        </div>
        {!disabled && editingIndex === null && (
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={questions.length >= maxQuestions}
            onClick={openNew}
          >
            + Add Question
          </button>
        )}
      </div>

      {editingIndex !== null && (
        <div className="panel panel--compact stack" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--color-border-bright, rgba(255, 215, 0, 0.3))' }}>
          <h4 style={{ margin: 0 }}>{editingIndex === -1 ? 'Add Question' : `Edit Question ${editingIndex + 1}`}</h4>
          {formError && <p className="field__error" style={{ margin: 0 }}>{formError}</p>}
          <TextAreaField
            label="Question text"
            value={form.questionText}
            onChange={(e) => setForm({ ...form, questionText: e.target.value })}
            placeholder="e.g. Solve for x: 3x + 15 = 45"
            maxLength={2000}
            required
          />
          <div className="grid grid--2">
            <TextField
              label="Option A"
              value={form.options[0]}
              onChange={(e) => setForm({ ...form, options: [e.target.value, form.options[1], form.options[2], form.options[3]] })}
              maxLength={500}
              required
            />
            <TextField
              label="Option B"
              value={form.options[1]}
              onChange={(e) => setForm({ ...form, options: [form.options[0], e.target.value, form.options[2], form.options[3]] })}
              maxLength={500}
              required
            />
            <TextField
              label="Option C"
              value={form.options[2]}
              onChange={(e) => setForm({ ...form, options: [form.options[0], form.options[1], e.target.value, form.options[3]] })}
              maxLength={500}
              required
            />
            <TextField
              label="Option D"
              value={form.options[3]}
              onChange={(e) => setForm({ ...form, options: [form.options[0], form.options[1], form.options[2], e.target.value] })}
              maxLength={500}
              required
            />
          </div>
          <div className="grid grid--2">
            <SelectField
              label="Correct answer"
              value={form.correctOption}
              onChange={(e) => setForm({ ...form, correctOption: e.target.value as OptionKey })}
              options={OPTION_KEYS.map((k) => ({ value: k, label: `Option ${k}` }))}
            />
            <SelectField
              label="Difficulty"
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
              options={DIFFICULTIES.map((d) => ({ value: d, label: titleCase(d) }))}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--gold btn--small" onClick={saveQuestion}>
              {editingIndex === -1 ? 'Add to competition' : 'Save changes'}
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <EmptyState title="No questions entered yet">
          Click &ldquo;+ Add Question&rdquo; above to add questions for participants.
        </EmptyState>
      ) : (
        <ol className="queue-list" style={{ margin: 0, padding: 0 }}>
          {questions.map((q, index) => (
            <li key={q.id ?? index} className="queue-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ alignItems: 'center', gap: 8, flex: 1 }}>
                  <span className="queue-item__index">{index + 1}</span>
                  <DifficultyBadge difficulty={q.difficulty} />
                  <span className="queue-item__text" style={{ fontWeight: 600 }}>{q.questionText}</span>
                </div>
                {!disabled && (
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn--small icon-btn"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move question ${index + 1} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn--small icon-btn"
                      onClick={() => move(index, 1)}
                      disabled={index === questions.length - 1}
                      aria-label={`Move question ${index + 1} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => openEdit(index)}
                      aria-label={`Edit question ${index + 1}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--danger icon-btn"
                      onClick={() => removeQuestion(index)}
                      aria-label={`Remove question ${index + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid--2" style={{ gap: 4, paddingLeft: 28, fontSize: '0.85rem' }}>
                {q.options.map((opt, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      color: OPTION_KEYS[i] === q.correctOption ? 'var(--color-gold, #ffd700)' : 'var(--color-muted, #aaa)',
                      fontWeight: OPTION_KEYS[i] === q.correctOption ? 600 : 'normal',
                    }}
                  >
                    <strong>{OPTION_KEYS[i]}:</strong> {opt} {OPTION_KEYS[i] === q.correctOption && '(Correct)'}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
