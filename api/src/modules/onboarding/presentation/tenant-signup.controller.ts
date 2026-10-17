import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthResponseDto } from '../../identity/presentation/dto/auth-response.dto.js';
import { TenantSignupService } from '../application/tenant-signup.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';

/**
 * Public company sign-up. Unlike the rest of the onboarding module's work it is
 * an anonymous route — the tenant does not exist yet — and the response is an
 * ordinary session, so the founder is signed in the moment they register.
 */
@ApiTags('auth')
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class TenantSignupController {
  constructor(private readonly signup: TenantSignupService) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create a company and its first administrator',
    description:
      'Self-service onboarding: creates a tenant with a default rate card, ' +
      'makes the caller its `tenant_admin`, and returns a logged-in session. ' +
      'Team members are added afterwards by invitation.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({
    description: 'An account already exists for this email address.',
  })
  async register(@Body() dto: RegisterCompanyDto): Promise<AuthResponseDto> {
    return AuthResponseDto.from(
      await this.signup.register({
        companyName: dto.companyName,
        email: dto.email,
        password: dto.password,
        name: dto.name ?? null,
      }),
    );
  }
}
