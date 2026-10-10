/**
 * Shared types for the RFC 9457 `application/problem+json` error format used
 * by every endpoint.
 */
export const PROBLEM_TYPE_BASE = 'https://problems.ldms.example/';

export interface ProblemDetails {
  /** URI reference identifying the problem type. */
  type: string;
  /** Short, human-readable summary of the problem. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail: string;
  /** URI identifying the request that failed. */
  instance: string;
  /** Stable, machine-readable error code. */
  code: string;
  /** Correlation ID so a failure can be traced through logs. */
  correlationId: string;
  /** Field-level validation errors, when the problem is a validation failure. */
  errors?: Record<string, string[]>;
}
