import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';
import { OtpType } from '../otp/enums/otp-type.enum';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';
import { WalletService } from '../wallet/wallet.service';
import { AuthService } from './auth.service';

const mockUser = {
  id: 'user-uuid-123',
  email: 'test@example.com',
  password_hash: 'hashed-password',
  first_name: 'John',
  last_name: 'Doe',
  is_email_verified: false,
  role: UserRole.USER,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let otpService: jest.Mocked<OtpService>;
  let mailService: jest.Mocked<MailService>;
  let walletService: jest.Mocked<WalletService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            createUser: jest.fn(),
            markEmailVerified: jest.fn(),
          },
        },
        {
          provide: OtpService,
          useValue: {
            generateOtp: jest.fn(),
            verifyOtp: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendOtpEmail: jest.fn(),
          },
        },
        {
          provide: WalletService,
          useValue: {
            createWallet: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('15m'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    otpService = module.get(OtpService);
    mailService = module.get(MailService);
    walletService = module.get(WalletService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
  });

  // ─── register ──────────────────────────────────────────────────────────────

  describe('register()', () => {
    const registerDto = {
      email: 'test@example.com',
      password: 'Password@123',
      firstName: 'John',
      lastName: 'Doe',
    };

    it('successfully registers a new user', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createUser.mockResolvedValue(mockUser as any);
      walletService.createWallet.mockResolvedValue({} as any);
      otpService.generateOtp.mockResolvedValue('123456');
      mailService.sendOtpEmail.mockResolvedValue();

      const result = await service.register(registerDto);

      expect(result.message).toBe('Registration successful. Please verify your email.');
      expect(result.userId).toBe(mockUser.id);

      // password must be hashed — the stored hash must NOT equal the plain password
      const savedHash = usersService.createUser.mock.calls[0][0].passwordHash;
      expect(savedHash).not.toBe(registerDto.password);
      expect(await bcrypt.compare(registerDto.password, savedHash)).toBe(true);

      // NGN wallet created for the new user
      expect(walletService.createWallet).toHaveBeenCalledWith(mockUser.id, 'NGN');

      // OTP generated and email sent
      expect(otpService.generateOtp).toHaveBeenCalledWith(mockUser.id, OtpType.EMAIL_VERIFICATION);
      expect(mailService.sendOtpEmail).toHaveBeenCalledWith(
        mockUser.email,
        '123456',
        mockUser.first_name,
      );
    });

    it('throws ConflictException when email already exists', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      expect(usersService.createUser).not.toHaveBeenCalled();
    });
  });

  // ─── verifyEmail ───────────────────────────────────────────────────────────

  describe('verifyEmail()', () => {
    it('successfully verifies a valid OTP', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      otpService.verifyOtp.mockResolvedValue(true);
      usersService.markEmailVerified.mockResolvedValue();

      const result = await service.verifyEmail({ email: mockUser.email, otp: '123456' });

      expect(result.message).toBe('Email verified successfully.');
      expect(usersService.markEmailVerified).toHaveBeenCalledWith(mockUser.id);
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ email: 'ghost@example.com', otp: '123456' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when email is already verified', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        is_email_verified: true,
      } as any);

      await expect(
        service.verifyEmail({ email: mockUser.email, otp: '123456' }),
      ).rejects.toThrow(BadRequestException);
      expect(otpService.verifyOtp).not.toHaveBeenCalled();
    });
  });

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const validHash = bcrypt.hashSync('Password@123', 1);

    it('returns access and refresh tokens for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        password_hash: validHash,
        is_email_verified: true,
      } as any);
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const result = await service.login({ email: mockUser.email, password: 'Password@123' });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).toMatchObject({ email: mockUser.email });
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'anything' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password — same message as wrong email', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        password_hash: validHash,
      } as any);

      let wrongPasswordError: UnauthorizedException | undefined;
      let wrongEmailError: UnauthorizedException | undefined;

      try {
        await service.login({ email: mockUser.email, password: 'WrongPass@1' });
      } catch (e) {
        wrongPasswordError = e as UnauthorizedException;
      }

      usersService.findByEmail.mockResolvedValue(null);
      try {
        await service.login({ email: 'nobody@example.com', password: 'anything' });
      } catch (e) {
        wrongEmailError = e as UnauthorizedException;
      }

      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect(wrongEmailError).toBeInstanceOf(UnauthorizedException);
      // Same message — don't leak which field failed
      expect(wrongPasswordError?.message).toBe(wrongEmailError?.message);
    });
  });

  // ─── resendOtp ─────────────────────────────────────────────────────────────

  describe('resendOtp()', () => {
    it('successfully generates and sends a new OTP', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      otpService.generateOtp.mockResolvedValue('654321');
      mailService.sendOtpEmail.mockResolvedValue();

      const result = await service.resendOtp({ email: mockUser.email });

      expect(result.message).toBe('OTP resent successfully.');
      expect(otpService.generateOtp).toHaveBeenCalledWith(mockUser.id, OtpType.EMAIL_VERIFICATION);
      expect(mailService.sendOtpEmail).toHaveBeenCalledWith(
        mockUser.email,
        '654321',
        mockUser.first_name,
      );
    });

    it('throws BadRequestException when email is already verified', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        is_email_verified: true,
      } as any);

      await expect(service.resendOtp({ email: mockUser.email })).rejects.toThrow(
        BadRequestException,
      );
      expect(otpService.generateOtp).not.toHaveBeenCalled();
    });
  });
});
