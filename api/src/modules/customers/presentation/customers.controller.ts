import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { CustomersService } from '../application/customers.service.js';
import {
  CreateAddressDto,
  CreateCustomerDto,
  UpdateAddressDto,
  UpdateCustomerDto,
} from './dto/customers.dto.js';
import {
  AddressListResponseDto,
  AddressResponseDto,
  CustomerListResponseDto,
  CustomerResponseDto,
} from './dto/customers-response.dto.js';

/**
 * Customer profiles and their saved addresses. Reads need `customers:read`,
 * writes need `customers:manage`. Address routes are nested under their
 * customer and verify both the tenant and the parent on every call.
 */
@ApiTags('customers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly context: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('customers:manage')
  @ApiOperation({ summary: 'Create a customer' })
  @ApiCreatedResponse({ type: CustomerResponseDto })
  async create(@Body() dto: CreateCustomerDto): Promise<CustomerResponseDto> {
    const customer = await this.customers.createCustomer(
      this.context.requireTenantId(),
      {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        userId: dto.userId,
      },
    );
    return CustomerResponseDto.from(customer);
  }

  @Get()
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'List customers of the active tenant' })
  @ApiOkResponse({ type: CustomerListResponseDto })
  async list(): Promise<CustomerListResponseDto> {
    const customers = await this.customers.listCustomers(
      this.context.requireTenantId(),
    );
    return { data: customers.map((c) => CustomerResponseDto.from(c)) };
  }

  @Get(':id')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Get one customer' })
  @ApiOkResponse({ type: CustomerResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerResponseDto> {
    return CustomerResponseDto.from(
      await this.customers.getCustomer(this.context.requireTenantId(), id),
    );
  }

  @Patch(':id')
  @RequirePermissions('customers:manage')
  @ApiOperation({ summary: 'Update a customer' })
  @ApiOkResponse({ type: CustomerResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerResponseDto> {
    return CustomerResponseDto.from(
      await this.customers.updateCustomer(this.context.requireTenantId(), id, {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        userId: dto.userId,
      }),
    );
  }

  @Delete(':id')
  @RequirePermissions('customers:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a customer and its addresses' })
  @ApiOkResponse({ description: 'Deleted.' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.customers.removeCustomer(this.context.requireTenantId(), id);
  }

  @Post(':id/addresses')
  @RequirePermissions('customers:manage')
  @ApiOperation({ summary: 'Add an address to a customer' })
  @ApiCreatedResponse({ type: AddressResponseDto })
  async createAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressResponseDto> {
    return AddressResponseDto.from(
      await this.customers.createAddress(this.context.requireTenantId(), id, {
        line1: dto.line1,
        line2: dto.line2,
        city: dto.city,
        region: dto.region,
        country: dto.country,
        postalCode: dto.postalCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
      }),
    );
  }

  @Get(':id/addresses')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'List addresses of a customer' })
  @ApiOkResponse({ type: AddressListResponseDto })
  async listAddresses(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AddressListResponseDto> {
    const addresses = await this.customers.listAddresses(
      this.context.requireTenantId(),
      id,
    );
    return { data: addresses.map((a) => AddressResponseDto.from(a)) };
  }

  @Get(':customerId/addresses/:addressId')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Get one address of a customer' })
  @ApiOkResponse({ type: AddressResponseDto })
  async getAddress(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ): Promise<AddressResponseDto> {
    return AddressResponseDto.from(
      await this.customers.getAddress(
        this.context.requireTenantId(),
        customerId,
        addressId,
      ),
    );
  }

  @Patch(':customerId/addresses/:addressId')
  @RequirePermissions('customers:manage')
  @ApiOperation({ summary: 'Update an address of a customer' })
  @ApiOkResponse({ type: AddressResponseDto })
  async updateAddress(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponseDto> {
    return AddressResponseDto.from(
      await this.customers.updateAddress(
        this.context.requireTenantId(),
        customerId,
        addressId,
        {
          line1: dto.line1,
          line2: dto.line2,
          city: dto.city,
          region: dto.region,
          country: dto.country,
          postalCode: dto.postalCode,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      ),
    );
  }

  @Delete(':customerId/addresses/:addressId')
  @RequirePermissions('customers:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an address of a customer' })
  @ApiOkResponse({ description: 'Deleted.' })
  async removeAddress(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ): Promise<void> {
    await this.customers.removeAddress(
      this.context.requireTenantId(),
      customerId,
      addressId,
    );
  }
}
