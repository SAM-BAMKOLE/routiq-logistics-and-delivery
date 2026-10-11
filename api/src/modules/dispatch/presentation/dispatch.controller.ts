import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { isRole, type Role } from '../../identity/domain/membership.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import {
  DispatchService,
  type DispatchActor,
} from '../application/dispatch.service.js';
import {
  AssignmentResponseDto,
  AssignmentListResponseDto,
  DispatchCandidateListResponseDto,
  DispatchCandidateResponseDto,
} from './dto/dispatch-response.dto.js';
import {
  CancelAssignmentDto,
  CreateAssignmentDto,
  RejectAssignmentDto,
} from './dto/dispatch.dto.js';

/**
 * Dispatch endpoints, split along the guard line the roles draw:
 *
 * - dispatchers (`dispatch:manage`) rank candidates and open offers;
 * - drivers (`drivers:manage-own`, their self-service permission) see and
 *   answer their own offers; the service re-checks that the assignment
 *   really belongs to the caller's driver profile, so the guard only decides
 *   *which kind* of caller may knock, never *which row* they get.
 */
@ApiTags('dispatch')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly context: TenantContextService,
  ) {}

  @Get('shipments/:id/dispatch-candidates')
  @RequirePermissions('dispatch:manage')
  @ApiOperation({
    summary: 'Ranked driver suggestions for a confirmed shipment',
  })
  @ApiOkResponse({ type: DispatchCandidateListResponseDto })
  async candidates(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DispatchCandidateListResponseDto> {
    const ranked = await this.dispatch.candidates(this.actor(), this.tenantId(), id);
    return { data: ranked.map((c) => DispatchCandidateResponseDto.from(c)) };
  }

  @Post('shipments/:id/assignments')
  @RequirePermissions('dispatch:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Offer a confirmed shipment to a driver' })
  @ApiCreatedResponse({ type: AssignmentResponseDto })
  async create(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateAssignmentDto,
  ): Promise<AssignmentResponseDto> {
    return AssignmentResponseDto.from(
      await this.dispatch.create(this.actor(), this.tenantId(), id, {
        driverId: dto.driverId,
        vehicleId: dto.vehicleId ?? null,
        ttlMinutes: dto.ttlMinutes,
      }),
    );
  }

  @Get('assignments/me')
  @RequirePermissions('drivers:manage-own')
  @ApiOperation({ summary: 'The caller’s own offers and accepted jobs' })
  @ApiOkResponse({ type: AssignmentListResponseDto })
  async mine(): Promise<AssignmentListResponseDto> {
    const assignments = await this.dispatch.listMine(
      this.tenantId(),
      this.actor().userId,
    );
    return { data: assignments.map((a) => AssignmentResponseDto.from(a)) };
  }

  @Post('assignments/:id/accept')
  @RequirePermissions('drivers:manage-own')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an offer (the shipment becomes ASSIGNED)',
  })
  @ApiOkResponse({ type: AssignmentResponseDto })
  async accept(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AssignmentResponseDto> {
    return AssignmentResponseDto.from(
      await this.dispatch.accept(this.tenantId(), this.actor().userId, id),
    );
  }

  @Post('assignments/:id/reject')
  @RequirePermissions('drivers:manage-own')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pass on an offer (the shipment stays CONFIRMED)' })
  @ApiOkResponse({ type: AssignmentResponseDto })
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectAssignmentDto,
  ): Promise<AssignmentResponseDto> {
    return AssignmentResponseDto.from(
      await this.dispatch.reject(
        this.tenantId(),
        this.actor().userId,
        id,
        dto.reason ?? null,
      ),
    );
  }

  @Post('assignments/:id/cancel')
  @RequirePermissions('dispatch:manage', 'drivers:manage-own')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Withdraw a live assignment (an accepted one returns the shipment to CONFIRMED)',
  })
  @ApiOkResponse({ type: AssignmentResponseDto })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelAssignmentDto,
  ): Promise<AssignmentResponseDto> {
    return AssignmentResponseDto.from(
      await this.dispatch.cancel(
        this.actor(),
        this.tenantId(),
        id,
        dto.reason ?? null,
      ),
    );
  }

  private tenantId(): string {
    return this.context.requireTenantId();
  }

  /** The authenticated principal as the service layer wants it. */
  private actor(): DispatchActor {
    const principal = this.context.get();
    const role: unknown = principal?.role;
    // JwtAuthGuard guarantees a principal with a tenant role; anything else
    // is a programming error, never a silent anonymous request.
    if (!principal?.userId || !isRole(role)) {
      throw new Error('No authenticated tenant principal in context.');
    }
    return { userId: principal.userId, role: role as Role };
  }
}
