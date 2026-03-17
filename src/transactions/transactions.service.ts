import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { GetTransactionsQueryDto } from './dto/get-transactions-query.dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
  ) {}

  async getTransactions(
    userId: string,
    query: GetTransactionsQueryDto,
  ): Promise<{
    data: Transaction[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const { page, limit, type, currency, startDate, endDate } = query;

    const qb = this.transactionsRepository
      .createQueryBuilder('transaction')
      .where('transaction.user_id = :userId', { userId });

    if (type) {
      qb.andWhere('transaction.type = :type', { type });
    }

    if (currency) {
      qb.andWhere(
        '(transaction.from_currency = :currency OR transaction.to_currency = :currency)',
        { currency },
      );
    }

    if (startDate) {
      qb.andWhere('transaction.created_at >= :startDate', { startDate });
    }

    if (endDate) {
      qb.andWhere('transaction.created_at <= :endDate', {
        endDate: `${endDate}T23:59:59.999Z`,
      });
    }

    qb.orderBy('transaction.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
