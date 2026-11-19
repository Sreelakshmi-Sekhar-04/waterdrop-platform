import type { z } from 'zod';
import { errors } from '../lib/errors';

/** Parses input with a Zod schema, turning failures into a 400 with field details. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw errors.validation(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
