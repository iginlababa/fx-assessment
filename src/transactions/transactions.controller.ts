import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { VerifiedUserGuard } from '../common/guards/verified-user.guard';
import { GetTransactionsQueryDto } from './dto/get-transactions-query.dto';
import { TransactionsService } from './transactions.service';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  isEmailVerified: boolean;
}

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, VerifiedUserGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiResponse({
    status: 200,
    description: 'Paginated transaction history sorted by date descending.',
    schema: {
      example: {
        data: [
          {
            id: 'uuid',
            type: 'funding',
            status: 'completed',
            from_currency: null,
            to_currency: 'NGN',
            from_amount: null,
            to_amount: '10000.0000',
            exchange_rate: null,
            idempotency_key: 'fund-uuid-123',
            created_at: '2026-03-17T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  getTransactions(
    @CurrentUser() user: AuthUser,
    @Query() query: GetTransactionsQueryDto,
  ) {
    return this.transactionsService.getTransactions(user.id, query);
  }
}
