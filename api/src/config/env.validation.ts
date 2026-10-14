import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
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
   * HMAC secret signing the short-lived access tokens. No default: a leaked
   * or guessable default would forge any identity, so the app refuses to boot
   * without an explicit value.
   */
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  /** Access-token lifetime, in a format like `15m` or `3600s`. */
  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL: string = '15m';

  /** Refresh-token lifetime in days. Rotation happens on every use. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  JWT_REFRESH_TTL_DAYS: number = 30;

  /**
   * Email transport: `gmail` (Nodemailer over smtp.gmail.com),
   * `console` (local development), or `memory` (tests). Defaults to
   * `memory` under NODE_ENV=test and `console` otherwise, so omitting it
   * never sends real mail by accident.
   */
  @IsIn(['gmail', 'console', 'memory'])
  @IsOptional()
  EMAIL_ADAPTER?: 'gmail' | 'console' | 'memory';

  /**
   * Gmail credentials, required only when EMAIL_ADAPTER=gmail (the adapter
   * fails at boot without them). Use a Gmail App Password, never the
   * account password.
   */
  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASSWORD?: string;

  /**
   * Daily email ceilings. A personal Gmail account allows roughly 500
   * messages a day; the global limit keeps headroom below that, and the
   * per-tenant share stops one tenant consuming the shared allowance.
   * Critical messages ignore both.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  EMAIL_DAILY_GLOBAL_LIMIT: number = 450;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  EMAIL_DAILY_TENANT_LIMIT: number = 100;

  /**
   * Base URL used in emailed links (invitations, password resets). There
   * is no frontend yet; this is where it will live.
   */
  @IsString()
  @IsOptional()
  APP_BASE_URL: string = 'http://localhost:5173';

  /**
   * Which `EventBus` adapter the messaging kernel binds. `outbox` persists
   * every event before delivering it; `messaging` is the phase-1 in-process
   * bus, useful when running without the outbox table.
   */
  @IsIn(['outbox', 'messaging'])
  @IsOptional()
  EVENT_BUS_ADAPTER: 'outbox' | 'messaging' = 'outbox';

  /**
   * The embedded outbox relay. On by default; tests that drive the relay
   * explicitly set it to false so no background poll races their assertions.
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  OUTBOX_RELAY_ENABLED: boolean = true;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(600_000)
  @IsOptional()
  OUTBOX_RELAY_INTERVAL_MS: number = 5_000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  @IsOptional()
  OUTBOX_RELAY_BATCH_SIZE: number = 25;

  /** After this many failed attempts a row becomes terminal `failed`. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  OUTBOX_MAX_ATTEMPTS: number = 8;

  /** A `processing` row older than this may be reclaimed by another worker. */
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(3_600_000)
  @IsOptional()
  OUTBOX_LOCK_TIMEOUT_MS: number = 60_000;
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
