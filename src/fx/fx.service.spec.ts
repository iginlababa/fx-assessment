import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import Decimal from 'decimal.js';
import { FxRate } from './entities/fx-rate.entity';
import { FxService } from './fx.service';

// Minimal AxiosResponse shape that satisfies firstValueFrom()
const makeAxiosResponse = (data: unknown) => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: { headers: {} } as any,
});

const mockApiRates = { USD: 0.00061, EUR: 0.00056, GBP: 0.00048, NGN: 1 };

const mockApiResponse = {
  result: 'success',
  base_code: 'NGN',
  rates: mockApiRates,
};

describe('FxService', () => {
  let service: FxService;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let fxRateRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let httpService: { get: jest.Mock };
  let configService: { get: jest.Mock };

  // Reusable query builder mock
  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  beforeEach(async () => {
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    fxRateRepository = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    };
    httpService = { get: jest.fn() };
    configService = {
      get: jest.fn().mockImplementation((key: string, def?: unknown) => {
        if (key === 'FX_API_BASE_URL') return 'https://open.er-api.com/v6/latest';
        if (key === 'FX_RATE_CACHE_TTL') return 300;
        if (key === 'FX_RATE_MAX_AGE') return 1800;
        return def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxService,
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: getRepositoryToken(FxRate), useValue: fxRateRepository },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<FxService>(FxService);
    jest.clearAllMocks();

    // Reset query builder chain mocks after clearAllMocks
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    fxRateRepository.createQueryBuilder.mockReturnValue(mockQb);
    fxRateRepository.create.mockImplementation((data: any) => data);
    fxRateRepository.save.mockResolvedValue([]);
    configService.get.mockImplementation((key: string, def?: unknown) => {
      if (key === 'FX_API_BASE_URL') return 'https://open.er-api.com/v6/latest';
      if (key === 'FX_RATE_CACHE_TTL') return 300;
      if (key === 'FX_RATE_MAX_AGE') return 1800;
      return def;
    });
  });

  // ─── getRate() ─────────────────────────────────────────────────────────────

  describe('getRate()', () => {
    it('returns rate from Redis cache on cache hit — API is NOT called', async () => {
      cacheManager.get.mockResolvedValue('0.00061000');

      const rate = await service.getRate('NGN', 'USD');

      expect(rate).toBe('0.00061000');
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('fetches from API on cache miss, stores in Redis and DB', async () => {
      cacheManager.get.mockResolvedValue(undefined); // cache miss
      cacheManager.set.mockResolvedValue(undefined);
      httpService.get.mockReturnValue(of(makeAxiosResponse(mockApiResponse)));

      const rate = await service.getRate('NGN', 'USD');

      expect(rate).toBe(new Decimal(mockApiRates.USD).toFixed(8));
      expect(httpService.get).toHaveBeenCalledTimes(1);
      expect(cacheManager.set).toHaveBeenCalled(); // stored in Redis
      expect(fxRateRepository.save).toHaveBeenCalled(); // persisted to DB
    });

    it('falls back to DB when API fails and Redis is empty', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      httpService.get.mockReturnValue(throwError(() => new Error('Network error')));
      mockQb.getOne.mockResolvedValue({
        rate: '0.00061000',
        fetched_at: new Date(),
      });

      const rate = await service.getRate('NGN', 'USD');

      expect(rate).toBe('0.00061000');
      expect(mockQb.where).toHaveBeenCalled(); // DB was queried
    });

    it('throws ServiceUnavailableException when all three tiers fail', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      httpService.get.mockReturnValue(throwError(() => new Error('API down')));
      mockQb.getOne.mockResolvedValue(null); // no fresh DB record

      await expect(service.getRate('NGN', 'USD')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('returns "1" for same-currency pair without any API/DB call', async () => {
      const rate = await service.getRate('USD', 'USD');
      expect(rate).toBe('1');
      expect(httpService.get).not.toHaveBeenCalled();
      expect(cacheManager.get).not.toHaveBeenCalled();
    });
  });

  // ─── getExchangeRate() ─────────────────────────────────────────────────────

  describe('getExchangeRate()', () => {
    it('returns a Decimal instance with the correct rate', async () => {
      cacheManager.get.mockResolvedValue('0.00061000');

      const rate = await service.getExchangeRate('NGN', 'USD');

      expect(rate).toBeInstanceOf(Decimal);
      expect(rate.toFixed(8)).toBe('0.00061000');
    });

    it('returns Decimal(1) for same currency', async () => {
      const rate = await service.getExchangeRate('USD', 'USD');
      expect(rate.toFixed(2)).toBe('1.00');
    });

    it('calculates cross-rate via USD when direct pair is unavailable', async () => {
      // First call (direct EUR→GBP) throws, then cross-rate calls succeed
      let callCount = 0;
      cacheManager.get.mockImplementation(() => {
        callCount++;
        // First getRate call (direct pair) → miss, API also fails
        if (callCount === 1) return Promise.resolve(undefined);
        // Cross-rate calls: EUR→USD and USD→GBP
        if (callCount === 2) return Promise.resolve('1.08000000'); // EUR→USD
        if (callCount === 3) return Promise.resolve('0.79000000'); // USD→GBP
        return Promise.resolve(undefined);
      });
      httpService.get.mockReturnValue(throwError(() => new Error('API down')));
      mockQb.getOne.mockResolvedValue(null); // DB also empty for direct pair

      const rate = await service.getExchangeRate('EUR', 'GBP');

      // cross = 1.08 * 0.79 = 0.8532
      expect(rate).toBeInstanceOf(Decimal);
      expect(parseFloat(rate.toString())).toBeCloseTo(1.08 * 0.79, 4);
    });
  });

  // ─── Redis resilience ──────────────────────────────────────────────────────

  describe('Redis resilience', () => {
    it('Redis get() throwing does not crash — falls through to API', async () => {
      cacheManager.get.mockRejectedValue(new Error('Redis connection lost'));
      cacheManager.set.mockResolvedValue(undefined);
      httpService.get.mockReturnValue(of(makeAxiosResponse(mockApiResponse)));

      const rate = await service.getRate('NGN', 'USD');

      expect(rate).toBeDefined();
      expect(httpService.get).toHaveBeenCalled(); // fell through to API
    });

    it('Redis set() throwing does not crash — rate is still returned', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      cacheManager.set.mockRejectedValue(new Error('Redis write failed'));
      httpService.get.mockReturnValue(of(makeAxiosResponse(mockApiResponse)));

      const rate = await service.getRate('NGN', 'USD');

      expect(rate).toBe(new Decimal(mockApiRates.USD).toFixed(8));
    });
  });
});
