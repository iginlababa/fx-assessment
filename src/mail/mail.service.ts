import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: this.configService.get<number>('MAIL_PORT', 587),
      secure: false,
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    });
  }

  async sendOtpEmail(to: string, otp: string, firstName: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"FX Trading App" <${this.configService.get<string>('MAIL_USER')}>`,
        to,
        subject: 'FX Trading App — Email Verification',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1e293b;">Email Verification</h2>
            <p>Hi <strong>${firstName}</strong>,</p>
            <p>Your verification code is:</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #4F46E5; margin: 24px 0;">
              ${otp}
            </div>
            <p>It expires in <strong>10 minutes</strong>.</p>
            <p style="color: #64748b; font-size: 13px;">
              If you did not request this, please ignore this email.
            </p>
          </div>
        `,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send OTP email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to send verification email. Please try again.',
      );
    }
  }
}
