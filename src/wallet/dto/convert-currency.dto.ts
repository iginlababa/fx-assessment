import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class ConvertCurrencyDto {
  @ApiProperty({ example: 'NGN', enum: SUPPORTED_CURRENCIES })
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  fromCurrency!: string;

  @ApiProperty({ example: 'USD', enum: SUPPORTED_CURRENCIES })
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  toCurrency!: string;

  @ApiProperty({ example: 1000 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'convert-uuid-456' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
