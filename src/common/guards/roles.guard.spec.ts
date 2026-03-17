import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { RolesGuard } from './roles.guard';

const makeContext = (role: string | undefined, handler?: () => void, cls?: () => void) => {
  const h = handler ?? (() => {});
  const c = cls ?? (() => {});
  return {
    getHandler: () => h,
    getClass: () => c,
    switchToHttp: () => ({
      getRequest: () => ({ user: role !== undefined ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get(RolesGuard);
    reflector = module.get(Reflector);
  });

  it('allows access when no @Roles() decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(UserRole.USER))).toBe(true);
  });

  it('allows access when @Roles() list is empty', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    expect(guard.canActivate(makeContext(UserRole.USER))).toBe(true);
  });

  it('allows access when user role matches the required role', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
  });

  it('allows admin access to admin-only routes', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
  });

  it('throws ForbiddenException when user role does not match', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext(UserRole.USER))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException with message "Insufficient permissions"', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext(UserRole.USER))).toThrow(
      'Insufficient permissions',
    );
  });

  it('blocks regular user from admin-only routes', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext('user'))).toThrow(
      ForbiddenException,
    );
  });

  it('reads metadata from ROLES_KEY on both handler and class', () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.USER]);
    const ctx = makeContext(UserRole.USER);
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    guard.canActivate(ctx);
    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [handler, cls]);
  });
});
