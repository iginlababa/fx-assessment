import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  async createWallet(userId: string, currency: string): Promise<Wallet> {
    const wallet = this.walletRepository.create({
      user_id: userId,
      currency,
      balance: '0',
    });
    return this.walletRepository.save(wallet);
  }
}
