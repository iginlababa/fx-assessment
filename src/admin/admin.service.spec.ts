import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SelectQueryBuilder } from 'typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionStatus } from '../transactions/enums/transaction-status.enum';
import { TransactionType } from '../transactions/enums/transaction-type.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Wallet } from '../wallet/entities/wallet.entity';
import { AdminService } from './admin.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    is_email_verified: true,
    role: UserRole.USER,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as User;

const makeQB = (rows: unknown[], total: number) => {
  const qb = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
  };
  return qb as unknown as SelectQueryBuilder<unknown>;
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;

  const mockUserRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
  };
  const mockTransactionRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };
  const mockWalletRepo = {
    find: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Transaction), useValue: mockTransactionRepo },
        { provide: getRepositoryToken(Wallet), useValue: mockWalletRepo },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // ─── getAllUsers() ───────────────────────────────────────────────────────────

  describe('getAllUsers()', () => {
    it('returns paginated users with correct meta', async () => {
      const users = [makeUser(), makeUser({ id: 'user-2' })];
      const qb = makeQB(users, 2);
      mockUserRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAllUsers({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('applies ILIKE search filter', async () => {
      const qb = makeQB([], 0);
      mockUserRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllUsers({ page: 1, limit: 20, search: 'alice' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        { search: '%alice%' },
      );
    });

    it('applies isVerified filter', async () => {
      const qb = makeQB([], 0);
      mockUserRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllUsers({ page: 1, limit: 20, isVerified: true });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'user.is_email_verified = :isVerified',
        { isVerified: true },
      );
    });

    it('applies role filter', async () => {
      const qb = makeQB([], 0);
      mockUserRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllUsers({ page: 1, limit: 20, role: UserRole.ADMIN });

      expect(qb.andWhere).toHaveBeenCalledWith('user.role = :role', {
        role: UserRole.ADMIN,
      });
    });

    it('returns empty array with correct meta when no users match', async () => {
      const qb = makeQB([], 0);
      mockUserRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAllUsers({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  // ─── getUserById() ───────────────────────────────────────────────────────────

  describe('getUserById()', () => {
    it('returns user with wallets and recent transactions', async () => {
      const user = makeUser();
      mockUserRepo.findOne.mockResolvedValue(user);
      mockWalletRepo.find.mockResolvedValue([{ currency: 'NGN', balance: '0' }]);
      mockTransactionRepo.find.mockResolvedValue([
        { id: 'tx-1', type: TransactionType.FUNDING },
      ]);

      const result = await service.getUserById('user-1');

      expect(result.user).toEqual(user);
      expect(result.wallets).toHaveLength(1);
      expect(result.recentTransactions).toHaveLength(1);
      expect(mockTransactionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('throws NotFoundException for non-existent user ID', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.getUserById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getAllTransactions() ────────────────────────────────────────────────────

  describe('getAllTransactions()', () => {
    it('returns paginated transactions across all users', async () => {
      const txs = [{ id: 'tx-1' }, { id: 'tx-2' }];
      const qb = makeQB(txs, 2);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAllTransactions({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('filters by userId', async () => {
      const qb = makeQB([], 0);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllTransactions({ page: 1, limit: 20, userId: 'user-1' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.user_id = :userId',
        { userId: 'user-1' },
      );
    });

    it('filters by type', async () => {
      const qb = makeQB([], 0);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllTransactions({ page: 1, limit: 20, type: TransactionType.FUNDING });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.type = :type',
        { type: TransactionType.FUNDING },
      );
    });

    it('filters by status', async () => {
      const qb = makeQB([], 0);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllTransactions({ page: 1, limit: 20, status: TransactionStatus.COMPLETED });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.status = :status',
        { status: TransactionStatus.COMPLETED },
      );
    });

    it('filters by currency (from or to)', async () => {
      const qb = makeQB([], 0);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllTransactions({ page: 1, limit: 20, currency: 'USD' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('from_currency'),
        { currency: 'USD' },
      );
    });

    it('filters by date range', async () => {
      const qb = makeQB([], 0);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllTransactions({
        page: 1,
        limit: 20,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.created_at >= :startDate',
        { startDate: '2026-01-01' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'transaction.created_at <= :endDate',
        expect.objectContaining({ endDate: expect.stringContaining('2026-12-31') }),
      );
    });

    it('filters by amount range (minAmount and maxAmount)', async () => {
      const qb = makeQB([], 0);
      mockTransactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAllTransactions({
        page: 1,
        limit: 20,
        minAmount: 100,
        maxAmount: 5000,
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('minAmount'),
        { minAmount: 100 },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('maxAmount'),
        { maxAmount: 5000 },
      );
    });
  });

  // ─── getSystemStats() ────────────────────────────────────────────────────────

  describe('getSystemStats()', () => {
    it('returns correct counts using COUNT queries (no full table loads)', async () => {
      mockUserRepo.count
        .mockResolvedValueOnce(10) // totalUsers
        .mockResolvedValueOnce(8); // verifiedUsers
      mockTransactionRepo.count
        .mockResolvedValueOnce(50) // totalTransactions
        .mockResolvedValueOnce(20) // funding
        .mockResolvedValueOnce(25) // conversion
        .mockResolvedValueOnce(5); // trade
      mockWalletRepo.count.mockResolvedValue(15);

      const result = await service.getSystemStats();

      expect(result.totalUsers).toBe(10);
      expect(result.verifiedUsers).toBe(8);
      expect(result.totalTransactions).toBe(50);
      expect(result.transactionsByType).toEqual({
        funding: 20,
        conversion: 25,
        trade: 5,
      });
      expect(result.totalWallets).toBe(15);
      expect(result.supportedCurrencies).toEqual(
        expect.arrayContaining(['NGN', 'USD', 'EUR', 'GBP']),
      );
      // Must use COUNT queries, not find() — find() would be called here if it loaded all records
      expect(mockUserRepo.count).toHaveBeenCalledTimes(2);
      expect(mockTransactionRepo.count).toHaveBeenCalledTimes(4);
    });
  });
});
