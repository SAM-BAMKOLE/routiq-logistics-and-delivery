import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Schema for the runtime configuration. Every value is read from the
 * environment (or `.env`, via @nestjs/config) and validated at boot time so
 * the application refuses to start with malformed config.
 *
 * Values that have a safe universal default are optional here; values with no
 * sensible default (database URL, JWT secret, email credentials, ...) will be
 * required once the corresponding module lands.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = '/api/v1';

  @IsString()
  @IsOptional()
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' = 'info';

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:5173';

  /**
   * Runtime database connection, as the restricted `ldms_app` role: subject to
   * Row Level Security and unable to run DDL. Migrations use
   * `MIGRATION_DATABASE_URL` instead (read only by the TypeORM CLI).
   */
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  /**
   * Shared secret for the platform administration API. Interim: replaced by
   * JWT-based platform-admin authorization when the identity module lands.
   */
  @IsString()
  @IsNotEmpty()
  PLATFORM_ADMIN_API_KEY: string;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { whitelist: true });
  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = Object.values(error.constraints ?? {}).join(', ');
        return `${error.property}: ${constraints}`;
      })
      .join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }
  return validated;
}
