import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly walletService: WalletService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const adminEmail = this.configService.get<string>(
      'ADMIN_EMAIL',
      'admin@fxtradingapp.com',
    );
    const adminPassword = this.configService.get<string>(
      'ADMIN_PASSWORD',
      'Admin@123456',
    );

    const existing = await this.userRepository.findOne({
      where: { email: adminEmail },
    });

    if (existing) {
      this.logger.log(`Admin user already exists: ${adminEmail}`);
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const admin = this.userRepository.create({
      email: adminEmail,
      password_hash: passwordHash,
      first_name: 'Admin',
      last_name: 'User',
      is_email_verified: true,
      role: UserRole.ADMIN,
    });

    const saved = await this.userRepository.save(admin);
    await this.walletService.createWallet(saved.id, 'NGN');

    this.logger.log(`Default admin user created: ${adminEmail}`);
  }
}
