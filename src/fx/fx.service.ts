import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom, catchError } from 'rxjs';
import Decimal from 'decimal.js';
import { FxRate } from './entities/fx-rate.entity';

interface ExchangeRateApiResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
  time_last_update_utc?: string;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    @InjectRepository(FxRate)
    private readonly fxRateRepository: Repository<FxRate>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Private: fetch all rates for a base currency from external API ──────────

  private async fetchRatesFromApi(
    baseCurrency: string,
  ): Promise<Record<string, number> | null> {
    const baseUrl = this.configService.get<string>(
      'FX_API_BASE_URL',
      'https://open.er-api.com/v6/latest',
    );
    const apiKey = this.configService.get<string>('FX_API_KEY', '');
    const url = apiKey
      ? `${baseUrl}/${baseCurrency}?apikey=${apiKey}`
      : `${baseUrl}/${baseCurrency}`;

    try {
      this.logger.log(`Fetching FX rates from API for base: ${baseCurrency}`);
      const { data } = await firstValueFrom(
        this.httpService.get<ExchangeRateApiResponse>(url).pipe(
          catchError((err) => {
            throw err;
          }),
        ),
      );

      if (data.result !== 'success' || !data.rates) {
        this.logger.warn(`FX API returned unexpected response for ${baseCurrency}`);
        return null;
      }

      this.logger.log(
        `FX API fetch success for ${baseCurrency}: ${Object.keys(data.rates).length} rates`,
      );
      return data.rates;
    } catch (error) {
      this.logger.error(
        `FX API fetch failed for ${baseCurrency}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // ─── Private: persist a batch of rates to the DB ─────────────────────────────

  private async persistRatesToDb(
    baseCurrency: string,
    rates: Record<string, number>,
  ): Promise<void> {
    try {
      const fetchedAt = new Date();
      const entities = Object.entries(rates).map(([target, rate]) => {
        const entity = this.fxRateRepository.create({
          base_currency: baseCurrency,
          target_currency: target,
          rate: new Decimal(rate).toFixed(8),
          fetched_at: fetchedAt,
        });
        return entity;
      });
      await this.fxRateRepository.save(entities, { chunk: 50 });
      this.logger.log(`Persisted ${entities.length} FX rates to DB for base ${baseCurrency}`);
    } catch (error) {
      this.logger.warn(
        `Failed to persist FX rates to DB: ${(error as Error).message}`,
      );
    }
  }

  // ─── Private: cache all rates in Redis ───────────────────────────────────────

  private async cacheRates(
    baseCurrency: string,
    rates: Record<string, number>,
  ): Promise<void> {
    const ttlMs =
      this.configService.get<number>('FX_RATE_CACHE_TTL', 300) * 1000;
    try {
      for (const [target, rate] of Object.entries(rates)) {
        const key = `fx_rate:${baseCurrency}:${target}`;
        await this.cacheManager.set(key, new Decimal(rate).toFixed(8), ttlMs);
      }
      this.logger.log(
        `Cached ${Object.keys(rates).length} rates in Redis for base ${baseCurrency} (TTL: ${ttlMs}ms)`,
      );
    } catch (error) {
      this.logger.warn(
        `Redis cache set failed (non-fatal): ${(error as Error).message}`,
      );
    }
  }

  // ─── Private: DB fallback for a single pair ───────────────────────────────────

  private async getRateFromDb(
    baseCurrency: string,
    targetCurrency: string,
  ): Promise<string | null> {
    const maxAgeSeconds = this.configService.get<number>('FX_RATE_MAX_AGE', 1800);
    try {
      const result = await this.fxRateRepository
        .createQueryBuilder('fx')
        .where('fx.base_currency = :base', { base: baseCurrency })
        .andWhere('fx.target_currency = :target', { target: targetCurrency })
        .andWhere(
          `fx.fetched_at > NOW() - make_interval(secs => :maxAge)`,
          { maxAge: maxAgeSeconds },
        )
        .orderBy('fx.fetched_at', 'DESC')
        .getOne();

      if (result) {
        this.logger.log(
          `DB cache hit for ${baseCurrency}→${targetCurrency} (fetched at ${result.fetched_at.toISOString()})`,
        );
        return result.rate;
      }
      return null;
    } catch (error) {
      this.logger.warn(`DB fallback query failed: ${(error as Error).message}`);
      return null;
    }
  }

  // ─── Public: get a single rate (3-tier caching chain) ────────────────────────

  async getRate(baseCurrency: string, targetCurrency: string): Promise<string> {
    if (baseCurrency === targetCurrency) {
      return '1';
    }

    // Tier 1: Redis cache
    try {
      const cached = await this.cacheManager.get<string>(
        `fx_rate:${baseCurrency}:${targetCurrency}`,
      );
      if (cached) {
        this.logger.log(`Redis cache HIT: ${baseCurrency}→${targetCurrency} = ${cached}`);
        return cached;
      }
      this.logger.log(`Redis cache MISS: ${baseCurrency}→${targetCurrency}`);
    } catch (error) {
      this.logger.warn(
        `Redis cache get failed (non-fatal): ${(error as Error).message}`,
      );
    }

    // Tier 2: External API
    const apiRates = await this.fetchRatesFromApi(baseCurrency);
    if (apiRates) {
      await this.cacheRates(baseCurrency, apiRates);
      await this.persistRatesToDb(baseCurrency, apiRates);

      const rate = apiRates[targetCurrency];
      if (rate !== undefined) {
        return new Decimal(rate).toFixed(8);
      }
    }

    // Tier 3: DB fallback
    this.logger.warn(
      `API unavailable for ${baseCurrency}→${targetCurrency}, trying DB fallback`,
    );
    const dbRate = await this.getRateFromDb(baseCurrency, targetCurrency);
    if (dbRate) {
      // Re-warm Redis with the stale DB rate
      try {
        await this.cacheManager.set(
          `fx_rate:${baseCurrency}:${targetCurrency}`,
          dbRate,
          60000, // 1 min TTL for stale data
        );
      } catch (_) {
        // Redis unavailable — fine
      }
      return dbRate;
    }

    throw new ServiceUnavailableException(
      'FX rates temporarily unavailable. Please try again later.',
    );
  }

  // ─── Public: get multiple rates for a base (used by controller) ──────────────

  async getRates(
    baseCurrency: string,
    symbols?: string[],
  ): Promise<{ base: string; rates: Record<string, string>; lastUpdated: string }> {
    // Attempt to get all rates from API (to return a full set)
    const apiRates = await this.fetchRatesFromApi(baseCurrency);

    if (apiRates) {
      await this.cacheRates(baseCurrency, apiRates);
      await this.persistRatesToDb(baseCurrency, apiRates);

      const allRates: Record<string, string> = {};
      for (const [target, rate] of Object.entries(apiRates)) {
        allRates[target] = new Decimal(rate).toFixed(8);
      }

      const filtered = symbols?.length
        ? Object.fromEntries(
            symbols
              .map((s) => s.toUpperCase())
              .filter((s) => allRates[s] !== undefined)
              .map((s) => [s, allRates[s]]),
          )
        : allRates;

      return {
        base: baseCurrency,
        rates: filtered,
        lastUpdated: new Date().toISOString(),
      };
    }

    // API failed — fall back to DB for the requested symbols (or supported set)
    const targets = symbols?.length
      ? symbols.map((s) => s.toUpperCase())
      : ['USD', 'EUR', 'GBP', 'NGN'].filter((s) => s !== baseCurrency);

    const rates: Record<string, string> = {};
    let lastUpdated: string | null = null;

    for (const target of targets) {
      const dbRate = await this.getRateFromDb(baseCurrency, target);
      if (dbRate) {
        rates[target] = dbRate;
        if (!lastUpdated) lastUpdated = new Date().toISOString();
      }
    }

    if (Object.keys(rates).length === 0) {
      throw new ServiceUnavailableException(
        'FX rates temporarily unavailable. Please try again later.',
      );
    }

    return {
      base: baseCurrency,
      rates,
      lastUpdated: lastUpdated ?? new Date().toISOString(),
    };
  }

  // ─── Public: get exchange rate as Decimal (used by WalletService) ────────────

  async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<Decimal> {
    if (fromCurrency === toCurrency) {
      return new Decimal('1');
    }

    try {
      // Try direct pair
      const rate = await this.getRate(fromCurrency, toCurrency);
      return new Decimal(rate);
    } catch {
      // Try cross-rate via USD
      if (fromCurrency !== 'USD' && toCurrency !== 'USD') {
        this.logger.warn(
          `Direct rate unavailable for ${fromCurrency}→${toCurrency}, trying cross-rate via USD`,
        );
        const fromUsd = await this.getRate(fromCurrency, 'USD');
        const usdTo = await this.getRate('USD', toCurrency);
        return new Decimal(fromUsd).times(new Decimal(usdTo));
      }
      throw new ServiceUnavailableException(
        'FX rates temporarily unavailable. Please try again later.',
      );
    }
  }
}
