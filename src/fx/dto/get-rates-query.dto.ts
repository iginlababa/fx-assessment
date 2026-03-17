import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class GetRatesQueryDto {
  @ApiProperty({
    required: false,
    default: 'NGN',
    example: 'NGN',
    description: 'Base currency code',
    enum: SUPPORTED_CURRENCIES,
  })
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  base: string = 'NGN';

  @ApiProperty({
    required: false,
    example: 'USD,EUR,GBP',
    description: 'Comma-separated list of target currency codes to return',
  })
  @IsOptional()
  @IsString()
  symbols?: string;
}
