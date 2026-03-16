export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  isEmailVerified: boolean;
}
