import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import { TransactionType } from '../enums/transaction-type.enum';

export class GetTransactionsQueryDto {
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiProperty({
    required: false,
    enum: TransactionType,
    description: 'Filter by transaction type',
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({
    required: false,
    enum: SUPPORTED_CURRENCIES,
    description: 'Filter transactions involving this currency (from or to)',
  })
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @ApiProperty({
    required: false,
    example: '2026-01-01',
    description: 'Filter from this date (inclusive)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    required: false,
    example: '2026-12-31',
    description: 'Filter up to this date (inclusive)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
