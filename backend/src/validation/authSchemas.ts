import { z } from 'zod';

export const ACADEMIC_YEARS = ['FE', 'SE', 'TE', 'BE', 'PG1', 'PG2'] as const;

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), 'Password must include upper-case, lower-case and a number.');

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(100),
    prn: z
      .string()
      .transform((value) => value.replace(/\s+/g, '').toUpperCase())
      .pipe(z.string()
      .min(6, 'PRN must be 6–20 letters or digits.')
      .max(20, 'PRN must be 6–20 letters or digits.')
      .regex(/^[A-Z0-9]+$/, 'PRN may contain only letters and digits.')),
    email: z.string().trim().email('Enter a valid email address.').max(254),
    department: z.string().trim().min(2, 'Enter your department.').max(100),
    academicYear: z.enum(ACADEMIC_YEARS, { errorMap: () => ({ message: 'Choose your academic year.' }) }),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

export const studentLoginSchema = z.object({
  role: z.literal('student'),
  identifier: z.string().trim().min(1, 'Enter your PRN or email.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});

export const hostLoginSchema = z.object({
  role: z.literal('host'),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const loginSchema = z.discriminatedUnion('role', [studentLoginSchema, hostLoginSchema]);
