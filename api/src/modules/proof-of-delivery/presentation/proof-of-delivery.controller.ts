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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { isRole, type Role } from '../../identity/domain/membership.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import {
  ProofsService,
  type ProofActor,
} from '../application/proofs.service.js';
import {
  ProofListResponseDto,
  ProofResponseDto,
} from './dto/proof-response.dto.js';
import { CaptureProofDto, VerifyOtpDto } from './dto/proof.dto.js';

/**
 * Proof-of-delivery endpoints: capture a photo or signature, verify the
 * recipient's OTP, list what was captured.
 *
 * Permissions follow the shipment-status split — drivers (`shipments:
 * update-status`) act on their own assignments, dispatchers (`shipments:
 * update`) on any — and the service re-checks status and ownership, so the
 * guard only decides which kind of caller may knock. OTP verification is
 * rate limited per IP (20/min) on top of the attempt cap in the service:
 * the counter lives on the row, the limiter on the edge.
 */
@ApiTags('proof-of-delivery')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('shipments')
export class ProofOfDeliveryController {
  constructor(
    private readonly proofs: ProofsService,
    private readonly context: TenantContextService,
  ) {}

  @Post(':id/proof')
  @RequirePermissions('shipments:update-status', 'shipments:update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Capture a photo or signature at the door',
    description:
      'Only an OUT_FOR_DELIVERY shipment accepts proof; the captured row is ' +
      'append-only evidence and never rewritten.',
  })
  @ApiCreatedResponse({ type: ProofResponseDto })
  async capture(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CaptureProofDto,
  ): Promise<ProofResponseDto> {
    return ProofResponseDto.from(
      await this.proofs.capture(this.actor(), this.tenantId(), id, {
        type: dto.type,
        fileUrl: dto.fileUrl ?? null,
        recipientName: dto.recipientName ?? null,
      }),
    );
  }

  @Post(':id/otp/verify')
  @RequirePermissions('shipments:update-status', 'shipments:update')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Verify the recipient’s six-digit delivery code',
    description:
      'Records an OTP proof on success; five wrong guesses retire the code. ' +
      'Rate limited per IP on top of the attempt cap.',
  })
  @ApiCreatedResponse({ type: ProofResponseDto })
  async verifyOtp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyOtpDto,
  ): Promise<ProofResponseDto> {
    return ProofResponseDto.from(
      await this.proofs.verifyOtp(this.actor(), this.tenantId(), id, dto.code),
    );
  }

  @Get(':id/proofs')
  @RequirePermissions(
    'shipments:read',
    'shipments:read-own',
    'shipments:read-assigned',
  )
  @ApiOperation({ summary: 'Every proof captured for a shipment' })
  @ApiOkResponse({ type: ProofListResponseDto })
  async list(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProofListResponseDto> {
    const proofs = await this.proofs.listForShipment(
      this.actor(),
      this.tenantId(),
      id,
    );
    return { data: proofs.map((proof) => ProofResponseDto.from(proof)) };
  }

  private tenantId(): string {
    return this.context.requireTenantId();
  }

  /** The authenticated principal as the service layer wants it. */
  private actor(): ProofActor {
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
