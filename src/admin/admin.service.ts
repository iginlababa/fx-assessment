import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionType } from '../transactions/enums/transaction-type.enum';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { AdminGetTransactionsQueryDto } from './dto/admin-get-transactions-query.dto';
import { AdminGetUsersQueryDto } from './dto/admin-get-users-query.dto';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  async getAllUsers(
    query: AdminGetUsersQueryDto,
  ): Promise<{ data: User[]; meta: PaginationMeta }> {
    const { page, limit, search, isVerified, role } = query;

    const qb = this.userRepository.createQueryBuilder('user');

    if (search) {
      qb.andWhere(
        '(user.email ILIKE :search OR user.first_name ILIKE :search OR user.last_name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (isVerified !== undefined) {
      qb.andWhere('user.is_email_verified = :isVerified', { isVerified });
    }

    if (role) {
      qb.andWhere('user.role = :role', { role });
    }

    qb.orderBy('user.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUserById(userId: string): Promise<{
    user: User;
    wallets: Wallet[];
    recentTransactions: Transaction[];
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const wallets = await this.walletRepository.find({
      where: { user_id: userId },
      order: { currency: 'ASC' },
    });

    const recentTransactions = await this.transactionRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: 10,
    });

    return { user, wallets, recentTransactions };
  }

  async getAllTransactions(
    query: AdminGetTransactionsQueryDto,
  ): Promise<{ data: Transaction[]; meta: PaginationMeta }> {
    const {
      page,
      limit,
      userId,
      type,
      status,
      currency,
      startDate,
      endDate,
      minAmount,
      maxAmount,
    } = query;

    const qb = this.transactionRepository
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.user', 'user');

    if (userId) {
      qb.andWhere('transaction.user_id = :userId', { userId });
    }

    if (type) {
      qb.andWhere('transaction.type = :type', { type });
    }

    if (status) {
      qb.andWhere('transaction.status = :status', { status });
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

    if (minAmount !== undefined) {
      qb.andWhere('CAST(transaction.to_amount AS DECIMAL) >= :minAmount', {
        minAmount,
      });
    }

    if (maxAmount !== undefined) {
      qb.andWhere('CAST(transaction.to_amount AS DECIMAL) <= :maxAmount', {
        maxAmount,
      });
    }

    qb.orderBy('transaction.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSystemStats(): Promise<{
    totalUsers: number;
    verifiedUsers: number;
    totalTransactions: number;
    transactionsByType: { funding: number; conversion: number; trade: number };
    totalWallets: number;
    supportedCurrencies: string[];
  }> {
    const [
      totalUsers,
      verifiedUsers,
      totalTransactions,
      fundingCount,
      conversionCount,
      tradeCount,
      totalWallets,
    ] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { is_email_verified: true } }),
      this.transactionRepository.count(),
      this.transactionRepository.count({
        where: { type: TransactionType.FUNDING },
      }),
      this.transactionRepository.count({
        where: { type: TransactionType.CONVERSION },
      }),
      this.transactionRepository.count({
        where: { type: TransactionType.TRADE },
      }),
      this.walletRepository.count(),
    ]);

    return {
      totalUsers,
      verifiedUsers,
      totalTransactions,
      transactionsByType: {
        funding: fundingCount,
        conversion: conversionCount,
        trade: tradeCount,
      },
      totalWallets,
      supportedCurrencies: [...SUPPORTED_CURRENCIES],
    };
  }
}
