import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { UsersService } from '../application/users.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { RequirePermissions } from './guards/require-permissions.decorator.js';
import { UpdateMembershipDto } from './dto/users.dto.js';

/** Membership administration inside the active tenant. */
@ApiTags('users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('memberships')
export class MembershipsController {
  constructor(
    private readonly users: UsersService,
    private readonly context: TenantContextService,
  ) {}

  @Patch(':id')
  @RequirePermissions('memberships:update')
  @ApiOperation({ summary: "Change a member's role or suspend/reactivate them" })
  @ApiOkResponse({ description: 'The updated membership.' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMembershipDto,
  ): Promise<{
    membershipId: string;
    role: string;
    status: string;
  }> {
    const membership = await this.users.updateMembership(
      this.context.requireTenantId(),
      id,
      { role: dto.role, status: dto.status },
    );
    return {
      membershipId: membership.id,
      role: membership.role,
      status: membership.status,
    };
  }
}
