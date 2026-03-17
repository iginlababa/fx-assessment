import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { VerifiedUserGuard } from '../common/guards/verified-user.guard';
import { ConvertCurrencyDto } from './dto/convert-currency.dto';
import { FundWalletDto } from './dto/fund-wallet.dto';
import { TradeCurrencyDto } from './dto/trade-currency.dto';
import { WalletService } from './wallet.service';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  isEmailVerified: boolean;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, VerifiedUserGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get all wallets for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'List of wallets with balances.',
    schema: {
      example: {
        wallets: [
          { currency: 'NGN', balance: '50000.0000' },
          { currency: 'USD', balance: '30.5000' },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  async getWallets(@CurrentUser() user: AuthUser) {
    const wallets = await this.walletService.getWallets(user.id);
    return { wallets };
  }

  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fund a wallet with a specified currency and amount' })
  @ApiResponse({
    status: 200,
    description: 'Wallet funded successfully.',
    schema: {
      example: {
        wallet: { currency: 'NGN', newBalance: '60000.0000' },
        transaction: {
          id: 'uuid',
          type: 'funding',
          status: 'completed',
          currency: 'NGN',
          amount: '10000.0000',
          idempotencyKey: 'fund-uuid-123',
          createdAt: '2026-03-17T00:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  fundWallet(@CurrentUser() user: AuthUser, @Body() dto: FundWalletDto) {
    return this.walletService.fundWallet(user.id, dto);
  }

  @Post('convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Convert between any two supported currencies',
    description: 'Atomically debit source wallet and credit destination wallet. Uses pessimistic locking to prevent double-spending.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversion successful.',
    schema: {
      example: {
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        fromAmount: '1000.0000',
        toAmount: '0.6100',
        rateUsed: '0.00061000',
        transaction: { id: 'uuid', type: 'conversion', status: 'completed' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Insufficient balance / same currency' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  @ApiResponse({ status: 503, description: 'FX rates unavailable' })
  convertCurrency(@CurrentUser() user: AuthUser, @Body() dto: ConvertCurrencyDto) {
    return this.walletService.convertCurrency(user.id, dto);
  }

  @Post('trade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trade currencies — one side must be NGN',
    description: 'Same as convert but enforces that either fromCurrency or toCurrency is NGN.',
  })
  @ApiResponse({
    status: 200,
    description: 'Trade successful.',
    schema: {
      example: {
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        fromAmount: '1000.0000',
        toAmount: '0.6100',
        rateUsed: '0.00061000',
        transaction: { id: 'uuid', type: 'trade', status: 'completed' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Insufficient balance / neither currency is NGN' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  @ApiResponse({ status: 503, description: 'FX rates unavailable' })
  tradeCurrency(@CurrentUser() user: AuthUser, @Body() dto: TradeCurrencyDto) {
    return this.walletService.tradeCurrency(user.id, dto);
  }
}
