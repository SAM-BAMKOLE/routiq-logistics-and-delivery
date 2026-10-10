import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/**
 * Raised by the global validation pipe when request payloads fail validation.
 * Carries a field-level map of errors (`{ "email": ["must be an email"] }`)
 * that the exception filter serializes as a problem+json response.
 */
export class ValidationException extends BadRequestException {
  constructor(validationErrors: ValidationError[]) {
    const errors: Record<string, string[]> = collectErrors(
      validationErrors,
      '',
    );
    super({
      message: 'Request payload failed validation.',
      code: 'VALIDATION_ERROR',
      errors,
    });
  }
}

function collectErrors(
  errors: ValidationError[],
  parent: string,
  result: Record<string, string[]> = {},
): Record<string, string[]> {
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      result[path] = Object.values(error.constraints);
    }
    if (error.children?.length) {
      collectErrors(error.children, path, result);
    }
  }
  return result;
}
