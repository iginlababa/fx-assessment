import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus } from '../transactions/enums/transaction-status.enum';
import { TransactionType } from '../transactions/enums/transaction-type.enum';
import { FxService } from '../fx/fx.service';
import { ConvertCurrencyDto } from './dto/convert-currency.dto';
import { FundWalletDto } from './dto/fund-wallet.dto';
import { TradeCurrencyDto } from './dto/trade-currency.dto';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly fxService: FxService,
  ) {}

  // ─── createWallet (used by AuthService on registration) ──────────────────────

  async createWallet(userId: string, currency: string): Promise<Wallet> {
    const wallet = this.walletRepository.create({
      user_id: userId,
      currency,
      balance: '0.0000',
    });
    return this.walletRepository.save(wallet);
  }

  // ─── getWallets ───────────────────────────────────────────────────────────────

  async getWallets(userId: string): Promise<{ currency: string; balance: string }[]> {
    const wallets = await this.walletRepository.find({
      where: { user_id: userId },
      order: { currency: 'ASC' },
    });
    return wallets.map((w) => ({ currency: w.currency, balance: w.balance }));
  }

  // ─── fundWallet ───────────────────────────────────────────────────────────────

  async fundWallet(
    userId: string,
    dto: FundWalletDto,
  ): Promise<{ wallet: object; transaction: object }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // (a) Idempotency check
      const existing = await queryRunner.manager.findOne(Transaction, {
        where: { idempotency_key: dto.idempotencyKey },
      });
      if (existing) {
        this.logger.log(`Idempotency hit on fund: key=${dto.idempotencyKey}`);
        await queryRunner.commitTransaction();
        return {
          wallet: { currency: dto.currency },
          transaction: existing,
        };
      }

      // (b) Find or create wallet
      let wallet = await queryRunner.manager.findOne(Wallet, {
        where: { user_id: userId, currency: dto.currency },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        wallet = queryRunner.manager.create(Wallet, {
          user_id: userId,
          currency: dto.currency,
          balance: '0.0000',
        });
      }

      // (c) Update balance
      wallet.balance = new Decimal(wallet.balance)
        .plus(new Decimal(dto.amount))
        .toFixed(4);

      // (d) Save wallet
      await queryRunner.manager.save(Wallet, wallet);

      // (e) Create transaction record
      const txRecord = queryRunner.manager.create(Transaction, {
        user_id: userId,
        type: TransactionType.FUNDING,
        status: TransactionStatus.COMPLETED,
        from_currency: null,
        from_amount: null,
        to_currency: dto.currency,
        to_amount: new Decimal(dto.amount).toFixed(4),
        exchange_rate: null,
        idempotency_key: dto.idempotencyKey,
        metadata: null,
      });
      await queryRunner.manager.save(Transaction, txRecord);

      // (f) Commit
      await queryRunner.commitTransaction();

      this.logger.log(
        `Funded ${dto.currency} wallet for user ${userId}: +${dto.amount}, new balance=${wallet.balance}`,
      );

      return {
        wallet: { currency: wallet.currency, newBalance: wallet.balance },
        transaction: {
          id: txRecord.id,
          type: txRecord.type,
          status: txRecord.status,
          currency: txRecord.to_currency,
          amount: txRecord.to_amount,
          idempotencyKey: txRecord.idempotency_key,
          createdAt: txRecord.created_at,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`fundWallet failed: ${(err as Error).message}`);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── convertCurrency ─────────────────────────────────────────────────────────

  async convertCurrency(
    userId: string,
    dto: ConvertCurrencyDto,
    txType: TransactionType = TransactionType.CONVERSION,
  ): Promise<{
    fromCurrency: string;
    toCurrency: string;
    fromAmount: string;
    toAmount: string;
    rateUsed: string;
    transaction: object;
  }> {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new BadRequestException('Cannot convert to the same currency');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // (a) Idempotency check
      const existing = await queryRunner.manager.findOne(Transaction, {
        where: { idempotency_key: dto.idempotencyKey },
      });
      if (existing) {
        this.logger.log(`Idempotency hit on convert: key=${dto.idempotencyKey}`);
        await queryRunner.commitTransaction();
        return {
          fromCurrency: existing.from_currency ?? dto.fromCurrency,
          toCurrency: existing.to_currency,
          fromAmount: existing.from_amount ?? '0',
          toAmount: existing.to_amount,
          rateUsed: existing.exchange_rate ?? '0',
          transaction: existing,
        };
      }

      // (b) Lock source wallet — SELECT ... FOR UPDATE
      const sourceWallet = await queryRunner.manager.findOne(Wallet, {
        where: { user_id: userId, currency: dto.fromCurrency },
        lock: { mode: 'pessimistic_write' },
      });

      // (c) Balance check
      if (!sourceWallet || new Decimal(sourceWallet.balance).lessThan(dto.amount)) {
        throw new BadRequestException(
          `Insufficient balance in ${dto.fromCurrency} wallet`,
        );
      }

      // (d) Fetch exchange rate (outside the lock but inside the transaction)
      const exchangeRate = await this.fxService.getExchangeRate(
        dto.fromCurrency,
        dto.toCurrency,
      );

      // (e) Calculate amounts
      const fromAmount = new Decimal(dto.amount);
      const toAmount = fromAmount.times(exchangeRate).toDecimalPlaces(4);

      // (f) Debit source wallet
      sourceWallet.balance = new Decimal(sourceWallet.balance)
        .minus(fromAmount)
        .toFixed(4);
      await queryRunner.manager.save(Wallet, sourceWallet);

      // (g) Credit destination wallet (lock it too)
      let destWallet = await queryRunner.manager.findOne(Wallet, {
        where: { user_id: userId, currency: dto.toCurrency },
        lock: { mode: 'pessimistic_write' },
      });

      if (!destWallet) {
        destWallet = queryRunner.manager.create(Wallet, {
          user_id: userId,
          currency: dto.toCurrency,
          balance: '0.0000',
        });
      }

      destWallet.balance = new Decimal(destWallet.balance)
        .plus(toAmount)
        .toFixed(4);
      await queryRunner.manager.save(Wallet, destWallet);

      // (h) Create transaction record
      const txRecord = queryRunner.manager.create(Transaction, {
        user_id: userId,
        type: txType,
        status: TransactionStatus.COMPLETED,
        from_currency: dto.fromCurrency,
        from_amount: fromAmount.toFixed(4),
        to_currency: dto.toCurrency,
        to_amount: toAmount.toFixed(4),
        exchange_rate: exchangeRate.toFixed(8),
        idempotency_key: dto.idempotencyKey,
        metadata: null,
      });
      await queryRunner.manager.save(Transaction, txRecord);

      // (i) Commit
      await queryRunner.commitTransaction();

      this.logger.log(
        `Converted ${fromAmount} ${dto.fromCurrency} → ${toAmount.toFixed(4)} ${dto.toCurrency} ` +
          `at rate ${exchangeRate.toFixed(8)} for user ${userId}`,
      );

      return {
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        fromAmount: fromAmount.toFixed(4),
        toAmount: toAmount.toFixed(4),
        rateUsed: exchangeRate.toFixed(8),
        transaction: {
          id: txRecord.id,
          type: txRecord.type,
          status: txRecord.status,
          idempotencyKey: txRecord.idempotency_key,
          createdAt: txRecord.created_at,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`convertCurrency failed: ${(err as Error).message}`);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── tradeCurrency ────────────────────────────────────────────────────────────

  async tradeCurrency(
    userId: string,
    dto: TradeCurrencyDto,
  ): Promise<ReturnType<typeof this.convertCurrency>> {
    if (dto.fromCurrency !== 'NGN' && dto.toCurrency !== 'NGN') {
      throw new BadRequestException(
        'Trade must involve NGN. Use /wallet/convert for other currency pairs.',
      );
    }
    return this.convertCurrency(userId, dto, TransactionType.TRADE);
  }
}
