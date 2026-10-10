import { ApiProperty } from '@nestjs/swagger';
import type { Address, Customer } from '../../domain/customer.js';

export class CustomerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  email: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  userId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(customer: Customer): CustomerResponseDto {
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      userId: customer.userId,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }
}

export class CustomerListResponseDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  data: CustomerResponseDto[];
}

export class AddressResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty()
  line1: string;

  @ApiProperty({ nullable: true })
  line2: string | null;

  @ApiProperty()
  city: string;

  @ApiProperty({ nullable: true })
  region: string | null;

  @ApiProperty()
  country: string;

  @ApiProperty({ nullable: true })
  postalCode: string | null;

  @ApiProperty({ nullable: true, description: 'Null until coordinates are known.' })
  latitude: number | null;

  @ApiProperty({ nullable: true, description: 'Null until coordinates are known.' })
  longitude: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(address: Address): AddressResponseDto {
    return {
      id: address.id,
      customerId: address.customerId,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      country: address.country,
      postalCode: address.postalCode,
      latitude: address.latitude,
      longitude: address.longitude,
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    };
  }
}

export class AddressListResponseDto {
  @ApiProperty({ type: [AddressResponseDto] })
  data: AddressResponseDto[];
}
