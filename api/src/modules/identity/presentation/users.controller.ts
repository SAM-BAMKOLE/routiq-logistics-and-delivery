import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { UsersService } from '../application/users.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { RequirePermissions } from './guards/require-permissions.decorator.js';
import { InviteUserDto } from './dto/users.dto.js';
import { TenantMemberDto, TenantMemberListDto } from './dto/users.dto.js';

/**
 * Tenant user management. Every route runs in the caller's tenant transaction
 * (opened by the interceptor after {@link JwtAuthGuard} sets the principal),
 * so RLS scopes all membership access to the active tenant.
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly context: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List members of the active tenant' })
  @ApiOkResponse({ type: TenantMemberListDto })
  async list(): Promise<TenantMemberListDto> {
    const members = await this.users.listMembers(this.context.requireTenantId());
    return { data: members.map((member) => TenantMemberDto.from(member)) };
  }

  @Post('invitations')
  @RequirePermissions('users:invite')
  @ApiOperation({
    summary: 'Invite an email address into the active tenant',
    description:
      'Mints a single-use invite token and emails it to the invitee through ' +
      'the Notifications module (invite-user template). The token itself is ' +
      'delivered by email only — it never appears in the response.',
  })
  @ApiCreatedResponse({
    description: 'Membership created or re-queued; the invitation is in the inbox.',
  })
  async invite(
    @Body() dto: InviteUserDto,
  ): Promise<{ membershipId: string }> {
    const { membership } = await this.users.invite(
      this.context.requireTenantId(),
      { email: dto.email, role: dto.role, name: dto.name },
    );
    return { membershipId: membership.id };
  }
}
