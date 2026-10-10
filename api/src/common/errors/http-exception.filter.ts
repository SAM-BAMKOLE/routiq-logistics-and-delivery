import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { PROBLEM_TYPE_BASE, type ProblemDetails } from './problem-details.js';

const DEFAULT_TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Method not allowed',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PRECONDITION_FAILED]: 'Precondition failed',
  [HttpStatus.PRECONDITION_REQUIRED]: 'Precondition required',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported media type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service unavailable',
};

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.METHOD_NOT_ALLOWED:
      return 'METHOD_NOT_ALLOWED';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.PRECONDITION_FAILED:
      return 'PRECONDITION_FAILED';
    case HttpStatus.PRECONDITION_REQUIRED:
      return 'PRECONDITION_REQUIRED';
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Single, global exception filter. Every error - domain, validation, HTTP or
 * unexpected - leaves the API as an RFC 9457 problem+json document with a
 * stable code and a correlation ID. Internals are never leaked to callers.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = resolveCorrelationId(request);
    response.setHeader('x-request-id', correlationId);

    const problem = this.toProblem(exception, request, correlationId);

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { err: exception, correlationId, path: request.originalUrl },
        'Unhandled error',
      );
    }

    response
      .status(problem.status)
      .contentType('application/problem+json')
      .json(problem);
  }

  private toProblem(
    exception: unknown,
    request: Request,
    correlationId: string,
  ): ProblemDetails {
    if (exception instanceof HttpException) {
      return this.toHttpProblem(exception, request, correlationId);
    }
    return {
      type: `${PROBLEM_TYPE_BASE}internal_error`,
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
      instance: request.originalUrl,
      code: 'INTERNAL_ERROR',
      correlationId,
    };
  }

  private toHttpProblem(
    exception: HttpException,
    request: Request,
    correlationId: string,
  ): ProblemDetails {
    const status = exception.getStatus();
    const body = exception.getResponse();

    let detail = '';
    let code = defaultCodeForStatus(status);
    let errors: Record<string, string[]> | undefined;

    if (typeof body === 'string') {
      detail = body;
    } else {
      const record = body as Record<string, unknown>;
      if (typeof record.message === 'string') {
        detail = record.message;
      } else if (Array.isArray(record.message)) {
        detail = record.message.join(', ');
        errors = { request: record.message as string[] };
      }
      if (typeof record.code === 'string') {
        code = record.code;
      }
      const nestedErrors = record.errors as
        Record<string, string[]> | undefined;
      if (nestedErrors) {
        errors = nestedErrors;
      }
    }

    return {
      type: `${PROBLEM_TYPE_BASE}${code.toLowerCase()}`,
      title: DEFAULT_TITLES[status] ?? 'Request failed',
      status,
      detail,
      instance: request.originalUrl,
      code,
      correlationId,
      ...(errors ? { errors } : {}),
    };
  }
}

function resolveCorrelationId(request: Request): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  return (request as Request & { id?: string }).id ?? randomUUID();
}
