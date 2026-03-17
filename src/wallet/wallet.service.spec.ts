import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus } from '../transactions/enums/transaction-status.enum';
import { TransactionType } from '../transactions/enums/transaction-type.enum';
import { FxService } from '../fx/fx.service';
import { ConvertCurrencyDto } from './dto/convert-currency.dto';
import { FundWalletDto } from './dto/fund-wallet.dto';
import { Wallet } from './entities/wallet.entity';
import { WalletService } from './wallet.service';

// ─── Mock QueryRunner factory ─────────────────────────────────────────────────

const makeMockQueryRunner = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  manager: {
    findOne: jest.fn(),
    save: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockImplementation((_entity: unknown, data: unknown) => ({ ...data as object })),
  },
});

describe('WalletService', () => {
  let service: WalletService;
  let mockQR: ReturnType<typeof makeMockQueryRunner>;
  let mockDataSource: { createQueryRunner: jest.Mock };
  let mockWalletRepository: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let mockFxService: { getExchangeRate: jest.Mock };

  const USER_ID = 'user-uuid-123';

  const makeWallet = (currency: string, balance: string): Wallet =>
    ({ id: `wallet-${currency}`, user_id: USER_ID, currency, balance }) as Wallet;

  beforeEach(async () => {
    mockQR = makeMockQueryRunner();
    mockDataSource = { createQueryRunner: jest.fn().mockReturnValue(mockQR) };
    mockWalletRepository = {
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
    };
    mockFxService = { getExchangeRate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(Wallet), useValue: mockWalletRepository },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: FxService, useValue: mockFxService },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  // ─── fundWallet() ─────────────────────────────────────────────────────────

  describe('fundWallet()', () => {
    const fundDto: FundWalletDto = {
      amount: 10000,
      currency: 'NGN',
      idempotencyKey: 'fund-key-001',
    };

    it('funds an existing wallet and increases balance correctly', async () => {
      const existingWallet = makeWallet('NGN', '5000.0000');
      // findOne: first call = idempotency check (no existing tx), second call = wallet
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)          // no duplicate tx
        .mockResolvedValueOnce(existingWallet); // existing wallet

      const result = await service.fundWallet(USER_ID, fundDto);

      // new balance = 5000 + 10000 = 15000
      expect((result.wallet as any).newBalance).toBe(
        new Decimal('5000.0000').plus(10000).toFixed(4),
      );
      expect(mockQR.manager.save).toHaveBeenCalledTimes(2); // wallet + transaction
      expect(mockQR.commitTransaction).toHaveBeenCalledTimes(1);
      expect(mockQR.release).toHaveBeenCalledTimes(1);
    });

    it('creates a new wallet when one does not exist for the currency', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)   // no duplicate tx
        .mockResolvedValueOnce(null);  // wallet doesn't exist

      const result = await service.fundWallet(USER_ID, fundDto);

      // create() was called for the new wallet
      expect(mockQR.manager.create).toHaveBeenCalledWith(
        Wallet,
        expect.objectContaining({ currency: 'NGN', balance: '0.0000' }),
      );
      // balance should equal the funded amount
      expect((result.wallet as any).newBalance).toBe(
        new Decimal(10000).toFixed(4),
      );
    });

    it('returns existing transaction on duplicate idempotency key — no processing', async () => {
      const existingTx = {
        id: 'tx-existing',
        type: TransactionType.FUNDING,
        status: TransactionStatus.COMPLETED,
        idempotency_key: fundDto.idempotencyKey,
      };
      mockQR.manager.findOne.mockResolvedValueOnce(existingTx); // idempotency hit

      const result = await service.fundWallet(USER_ID, fundDto);

      expect(result.transaction).toEqual(existingTx);
      // Should commit immediately after idempotency hit — wallet NOT touched
      expect(mockQR.commitTransaction).toHaveBeenCalledTimes(1);
      // Only ONE findOne call (the idempotency check) — wallet query never happens
      expect(mockQR.manager.findOne).toHaveBeenCalledTimes(1);
    });

    it('rolls back and always releases on error', async () => {
      mockQR.manager.findOne.mockResolvedValueOnce(null);
      mockQR.manager.findOne.mockResolvedValueOnce(makeWallet('NGN', '100.0000'));
      mockQR.manager.save.mockRejectedValueOnce(new Error('DB write error'));

      await expect(service.fundWallet(USER_ID, fundDto)).rejects.toThrow('DB write error');

      expect(mockQR.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQR.release).toHaveBeenCalledTimes(1); // always released
      expect(mockQR.commitTransaction).not.toHaveBeenCalled();
    });

    it('always releases the QueryRunner even on error', async () => {
      mockQR.manager.findOne.mockRejectedValue(new Error('unexpected'));

      await expect(service.fundWallet(USER_ID, fundDto)).rejects.toThrow();

      expect(mockQR.release).toHaveBeenCalledTimes(1);
    });
  });

  // ─── convertCurrency() ────────────────────────────────────────────────────

  describe('convertCurrency()', () => {
    const convertDto: ConvertCurrencyDto = {
      fromCurrency: 'NGN',
      toCurrency: 'USD',
      amount: 1000,
      idempotencyKey: 'convert-key-001',
    };

    const ngnWallet = makeWallet('NGN', '50000.0000');

    it('successfully converts with correct debit and credit amounts', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)       // no duplicate tx
        .mockResolvedValueOnce(ngnWallet)  // source wallet (NGN)
        .mockResolvedValueOnce(makeWallet('USD', '5.0000')); // dest wallet (USD)

      mockFxService.getExchangeRate.mockResolvedValue(new Decimal('0.00061'));

      const result = await service.convertCurrency(USER_ID, convertDto);

      // debit: 50000 - 1000 = 49000
      const savedWallets = mockQR.manager.save.mock.calls
        .filter((call) => call[0] === Wallet)
        .map((call) => call[1]);
      const sourceAfter = savedWallets[0] as Wallet;
      expect(sourceAfter.balance).toBe(new Decimal('50000').minus(1000).toFixed(4));

      // credit: 5.0000 + (1000 * 0.00061) = 5.0000 + 0.6100 = 5.6100
      const destAfter = savedWallets[1] as Wallet;
      expect(destAfter.balance).toBe(
        new Decimal('5.0000').plus(new Decimal(1000).times('0.00061').toDecimalPlaces(4)).toFixed(4),
      );

      expect(result.rateUsed).toBe(new Decimal('0.00061').toFixed(8));
      expect(result.fromCurrency).toBe('NGN');
      expect(result.toCurrency).toBe('USD');
      expect(mockQR.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when fromCurrency === toCurrency', async () => {
      await expect(
        service.convertCurrency(USER_ID, { ...convertDto, toCurrency: 'NGN' }),
      ).rejects.toThrow(BadRequestException);

      // Transaction never started for same-currency guard
      expect(mockQR.startTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for insufficient balance', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null) // no duplicate tx
        .mockResolvedValueOnce(makeWallet('NGN', '500.0000')); // only 500, needs 1000

      await expect(service.convertCurrency(USER_ID, convertDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockQR.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQR.manager.save).not.toHaveBeenCalled(); // no changes persisted
    });

    it('throws BadRequestException when source wallet does not exist', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)   // no duplicate tx
        .mockResolvedValueOnce(null);  // source wallet missing

      await expect(service.convertCurrency(USER_ID, convertDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockQR.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('creates destination wallet if it does not exist', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)       // no duplicate tx
        .mockResolvedValueOnce(ngnWallet)  // source wallet exists
        .mockResolvedValueOnce(null);      // dest wallet doesn't exist

      mockFxService.getExchangeRate.mockResolvedValue(new Decimal('0.00061'));

      await service.convertCurrency(USER_ID, convertDto);

      expect(mockQR.manager.create).toHaveBeenCalledWith(
        Wallet,
        expect.objectContaining({ currency: 'USD', balance: '0.0000' }),
      );
    });

    it('requests pessimistic_write lock on wallet reads', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)       // idempotency
        .mockResolvedValueOnce(ngnWallet)
        .mockResolvedValueOnce(makeWallet('USD', '0.0000'));
      mockFxService.getExchangeRate.mockResolvedValue(new Decimal('0.00061'));

      await service.convertCurrency(USER_ID, convertDto);

      const walletFinds = mockQR.manager.findOne.mock.calls.filter(
        (call) => call[0] === Wallet,
      );
      walletFinds.forEach((call) => {
        expect(call[1]).toMatchObject({ lock: { mode: 'pessimistic_write' } });
      });
    });

    it('idempotency returns existing tx without re-processing', async () => {
      const existingTx = {
        id: 'tx-existing',
        from_currency: 'NGN',
        to_currency: 'USD',
        from_amount: '1000.0000',
        to_amount: '0.6100',
        exchange_rate: '0.00061000',
        idempotency_key: convertDto.idempotencyKey,
      };
      mockQR.manager.findOne.mockResolvedValueOnce(existingTx);

      const result = await service.convertCurrency(USER_ID, convertDto);

      expect(result.toAmount).toBe('0.6100');
      expect(mockQR.manager.findOne).toHaveBeenCalledTimes(1); // only idempotency check
      expect(mockFxService.getExchangeRate).not.toHaveBeenCalled();
    });

    it('rolls back when FxService throws (503)', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ngnWallet);
      mockFxService.getExchangeRate.mockRejectedValue(
        new Error('FX rates unavailable'),
      );

      await expect(service.convertCurrency(USER_ID, convertDto)).rejects.toThrow();

      expect(mockQR.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQR.release).toHaveBeenCalledTimes(1);
      // No wallet balance changes persisted
      expect(mockQR.manager.save).not.toHaveBeenCalled();
    });
  });

  // ─── tradeCurrency() ──────────────────────────────────────────────────────

  describe('tradeCurrency()', () => {
    it('successfully trades NGN → USD', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWallet('NGN', '50000.0000'))
        .mockResolvedValueOnce(makeWallet('USD', '0.0000'));
      mockFxService.getExchangeRate.mockResolvedValue(new Decimal('0.00061'));

      const result = await service.tradeCurrency(USER_ID, {
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        amount: 1000,
        idempotencyKey: 'trade-001',
      });

      expect(result.fromCurrency).toBe('NGN');
      expect(result.toCurrency).toBe('USD');
      expect(mockQR.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('successfully trades EUR → NGN', async () => {
      mockQR.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeWallet('EUR', '100.0000'))
        .mockResolvedValueOnce(makeWallet('NGN', '0.0000'));
      mockFxService.getExchangeRate.mockResolvedValue(new Decimal('1800'));

      const result = await service.tradeCurrency(USER_ID, {
        fromCurrency: 'EUR',
        toCurrency: 'NGN',
        amount: 10,
        idempotencyKey: 'trade-002',
      });

      expect(result.fromCurrency).toBe('EUR');
      expect(result.toCurrency).toBe('NGN');
    });

    it('throws BadRequestException when neither currency is NGN', async () => {
      await expect(
        service.tradeCurrency(USER_ID, {
          fromCurrency: 'USD',
          toCurrency: 'EUR',
          amount: 100,
          idempotencyKey: 'trade-003',
        }),
      ).rejects.toThrow(BadRequestException);

      const error = await service
        .tradeCurrency(USER_ID, {
          fromCurrency: 'USD',
          toCurrency: 'EUR',
          amount: 100,
          idempotencyKey: 'trade-003',
        })
        .catch((e: BadRequestException) => e);

      expect((error as BadRequestException).message).toContain('NGN');
    });
  });
});
