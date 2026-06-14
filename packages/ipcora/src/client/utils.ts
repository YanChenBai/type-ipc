import type { AnySchema } from '../host/types';
import { ClientIpcError } from './error';

export async function parseSchema(schema: AnySchema | undefined, value: unknown): Promise<unknown> {
  if (!schema) return value;
  const result = await schema['~standard'].validate(value);
  if ('issues' in result && result.issues) {
    throw new ClientIpcError('VALIDATION_ERROR', {
      message: result.issues.map(issue => issue.message).join('; '),
      data: result.issues,
    });
  }
  return result.value;
}
