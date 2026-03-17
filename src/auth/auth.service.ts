import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';
import { OtpType } from '../otp/enums/otp-type.enum';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly walletService: WalletService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ message: string; userId: string }> {
    const existing = await this.usersService.findByEmail(data.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await this.usersService.createUser({
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
    });

    await this.walletService.createWallet(user.id, 'NGN');

    const otp = await this.otpService.generateOtp(user.id, OtpType.EMAIL_VERIFICATION);

    await this.mailService.sendOtpEmail(user.email, otp, user.first_name);

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
    };
  }

  async verifyEmail(data: {
    email: string;
    otp: string;
  }): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(data.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.is_email_verified) {
      throw new BadRequestException('Email already verified');
    }

    await this.otpService.verifyOtp(user.id, data.otp, OtpType.EMAIL_VERIFICATION);
    await this.usersService.markEmailVerified(user.id);

    return { message: 'Email verified successfully.' };
  }

  async login(data: {
    email: string;
    password: string;
  }): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    const user = await this.usersService.findByEmail(data.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(data.password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      isEmailVerified: user.is_email_verified,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRY', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRY', '7d'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isEmailVerified: user.is_email_verified,
      },
    };
  }

  async resendOtp(data: { email: string }): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(data.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.is_email_verified) {
      throw new BadRequestException('Email already verified');
    }

    const otp = await this.otpService.generateOtp(user.id, OtpType.EMAIL_VERIFICATION);
    await this.mailService.sendOtpEmail(user.email, otp, user.first_name);

    return { message: 'OTP resent successfully.' };
  }
}
