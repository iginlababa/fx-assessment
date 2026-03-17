import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetRatesQueryDto } from './dto/get-rates-query.dto';
import { FxService } from './fx.service';

@ApiTags('FX Rates')
@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rates')
  @ApiOperation({
    summary: 'Get FX exchange rates',
    description:
      'Returns current exchange rates for a base currency. Uses a 3-tier cache: Redis → DB (30min stale) → 503.',
  })
  @ApiQuery({ name: 'base', required: false, example: 'NGN', description: 'Base currency (default: NGN)' })
  @ApiQuery({ name: 'symbols', required: false, example: 'USD,EUR,GBP', description: 'Comma-separated target currencies' })
  @ApiResponse({
    status: 200,
    description: 'Exchange rates returned successfully.',
    schema: {
      example: {
        base: 'NGN',
        rates: {
          USD: '0.00061000',
          EUR: '0.00056000',
          GBP: '0.00048000',
        },
        lastUpdated: '2026-03-17T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 503, description: 'FX rates temporarily unavailable.' })
  getRates(@Query() query: GetRatesQueryDto) {
    const symbols = query.symbols
      ? query.symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;

    return this.fxService.getRates(query.base.toUpperCase(), symbols);
  }
}
