import { describe, expect, it } from 'vitest';
import { validateQuestion, emptyQuestion } from '../../src/components/questions/QuestionForm';
import { validateRegistration } from '../../src/pages/StudentRegisterPage';

describe('question form validation', () => {
  it('requires four distinct options and in-range timers', () => {
    const q = { ...emptyQuestion(), questionText: 'What is 2+2?', options: ['1', '2', '2', ''], timeLimitSeconds: 60 };
    const errors = validateQuestion(q);
    expect(errors['options.3']).toBeDefined();
    expect(errors.options).toMatch(/different/);
    expect(errors.timeLimitSeconds).toMatch(/20–30/);
  });

  it('accepts a valid question', () => {
    expect(validateQuestion({ ...emptyQuestion(), questionText: 'What is 2+2?', options: ['1', '2', '3', '4'] })).toEqual({});
  });
});

describe('registration validation', () => {
  const valid = { name: 'Ada Lovelace', prn: 'PRN123456', email: 'ada@college.edu', department: 'Maths', academicYear: 'SE', password: 'Analytical1Engine', confirmPassword: 'Analytical1Engine' };

  it('accepts a valid registration', () => {
    expect(validateRegistration(valid)).toEqual({});
  });

  it('flags weak passwords, mismatches and malformed PRNs', () => {
    const errors = validateRegistration({ ...valid, prn: 'ab!', password: 'alllowercase1', confirmPassword: 'x' });
    expect(Object.keys(errors).sort()).toEqual(['confirmPassword', 'password', 'prn']);
  });
});
