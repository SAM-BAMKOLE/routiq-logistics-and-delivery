import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from '../application/auth.service.js';
import {
  AcceptInviteDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  SwitchTenantDto,
} from './dto/auth.dto.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';

/**
 * Authentication: login, refresh rotation, logout, tenant switching, and
 * invitation acceptance. All routes are public — the credentials or tokens in
 * the body are the authentication. Login and token endpoints are the place to
 * add strict throttling when `@nestjs/throttler` lands.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return AuthResponseDto.from(
      await this.auth.login({
        email: dto.email,
        password: dto.password,
        tenantId: dto.tenantId,
      }),
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token for a new access/refresh pair',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  async refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return AuthResponseDto.from(await this.auth.refresh(dto.refreshToken));
  }

  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scope the session to another membership' })
  @ApiOkResponse({ type: AuthResponseDto })
  async switchTenant(@Body() dto: SwitchTenantDto): Promise<AuthResponseDto> {
    return AuthResponseDto.from(
      await this.auth.switchTenant(dto.refreshToken, dto.tenantId),
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiOkResponse({ description: 'Always succeeds, even for unknown tokens.' })
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('accept-invite')
  @ApiOperation({ summary: 'Accept an invitation: set a password and activate' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  async acceptInvite(@Body() dto: AcceptInviteDto): Promise<AuthResponseDto> {
    return AuthResponseDto.from(
      await this.auth.acceptInvite(dto.token, dto.password),
    );
  }
}
