import { Types } from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .refine((value) => Types.ObjectId.isValid(value) && /^[a-f0-9]{24}$/i.test(value), 'Invalid identifier.');

export const idParams = z.object({ id: objectId });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
