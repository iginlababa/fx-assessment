import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FxRate } from './entities/fx-rate.entity';

@Injectable()
export class FxService {
  constructor(
    @InjectRepository(FxRate)
    private readonly fxRateRepository: Repository<FxRate>,
  ) {}
}
