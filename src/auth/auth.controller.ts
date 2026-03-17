import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User registered. OTP sent to email.',
    schema: {
      example: {
        message: 'Registration successful. Please verify your email.',
        userId: 'uuid-here',
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with OTP' })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully.',
    schema: { example: { message: 'Email verified successfully.' } },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP / already verified' })
  @ApiResponse({ status: 404, description: 'User not found' })
  verifyEmail(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyEmail({ email: dto.email, otp: dto.otp });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Returns JWT access and refresh tokens.',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: 'uuid-here',
          email: 'user@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'user',
          isEmailVerified: true,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login({ email: dto.email, password: dto.password });
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Resend OTP verification email' })
  @ApiResponse({
    status: 200,
    description: 'OTP resent successfully.',
    schema: { example: { message: 'OTP resent successfully.' } },
  })
  @ApiResponse({ status: 400, description: 'Email already verified' })
  @ApiResponse({ status: 404, description: 'User not found' })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp({ email: dto.email });
  }
}
