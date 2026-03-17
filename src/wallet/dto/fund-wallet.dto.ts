import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class FundWalletDto {
  @ApiProperty({ example: 10000, description: 'Amount to fund (must be positive)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'NGN', description: 'Currency to fund', enum: SUPPORTED_CURRENCIES })
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @ApiProperty({ example: 'fund-uuid-123', description: 'Unique key to prevent duplicate funding' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
