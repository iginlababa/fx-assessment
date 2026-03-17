import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { Otp } from './entities/otp.entity';
import { OtpType } from './enums/otp-type.enum';

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(Otp)
    private readonly otpRepository: Repository<Otp>,
  ) {}

  async generateOtp(userId: string, type: OtpType): Promise<string> {
    // Invalidate all previous unused OTPs for this user/type
    await this.otpRepository.update(
      { user_id: userId, type, is_used: false },
      { is_used: true },
    );

    const code = randomInt(100000, 999999).toString();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    const otp = this.otpRepository.create({
      user_id: userId,
      code,
      type,
      expires_at: expiresAt,
      is_used: false,
    });

    await this.otpRepository.save(otp);
    return code;
  }

  async verifyOtp(
    userId: string,
    code: string,
    type: OtpType,
  ): Promise<boolean> {
    // Atomic: find valid OTP and mark used in a single UPDATE ... RETURNING
    const result: Array<{ id: string }> = await this.otpRepository.query(
      `UPDATE otp_codes
       SET is_used = true
       WHERE user_id = $1
         AND code = $2
         AND type = $3
         AND is_used = false
         AND expires_at > NOW()
       RETURNING id`,
      [userId, code, type],
    );

    if (result.length === 0) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    return true;
  }
}
