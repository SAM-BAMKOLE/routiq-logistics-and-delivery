import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Public company sign-up. Creating the company and its first administrator is
 * a single step, so the founder never lands in a tenant they cannot manage.
 */
export class RegisterCompanyDto {
  @ApiProperty({ example: 'Northwind Logistics', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName: string;

  @ApiPropertyOptional({ example: 'Ada Obi', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ example: 'founder@northwind.example' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}
