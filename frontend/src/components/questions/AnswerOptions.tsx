import type { OptionKey } from '../../types';
import { OPTION_KEYS } from '../../types';

interface AnswerOptionsProps {
  options: string[];
  selected: OptionKey | null;
  onSelect?: (key: OptionKey) => void;
  locked: boolean;
  correctOption?: OptionKey | null;
  name: string;
}

/** Native radio inputs styled as large touch targets: keyboard and screen-reader friendly by default. */
export function AnswerOptions({ options, selected, onSelect, locked, correctOption, name }: AnswerOptionsProps) {
  return (
    <fieldset className="options">
      <legend className="visually-hidden">Choose one answer</legend>
      {options.map((text, index) => {
        const key = OPTION_KEYS[index]!;
        const isSelected = selected === key;
        const revealed = Boolean(correctOption);
        const isCorrect = revealed && correctOption === key;
        const isWrong = revealed && isSelected && !isCorrect;
        const classes = ['option', isSelected ? 'is-selected' : '', isCorrect ? 'is-correct' : '', isWrong ? 'is-wrong' : '', locked ? 'is-locked' : ''].filter(Boolean).join(' ');
        return (
          <label key={key} className={classes}>
            <input
              type="radio"
              name={name}
              value={key}
              checked={isSelected}
              disabled={locked}
              onChange={() => onSelect?.(key)}
            />
            <span className="option__key" aria-hidden="true">{key}</span>
            <span><span className="visually-hidden">Option {key}: </span>{text}</span>
            {isCorrect && <span className="option__tag" style={{ color: 'var(--color-success)' }}>Correct answer</span>}
            {isWrong && <span className="option__tag" style={{ color: 'var(--color-danger)' }}>Your answer</span>}
            {!revealed && isSelected && locked && <span className="option__tag" style={{ color: 'var(--color-infinity-strong)' }}>Submitted</span>}
          </label>
        );
      })}
    </fieldset>
  );
}
