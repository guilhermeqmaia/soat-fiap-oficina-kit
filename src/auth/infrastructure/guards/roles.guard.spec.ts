import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../../domain/role.enum';
import { AuthenticatedUser } from '../../domain/authenticated-user';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
        getResponse: () => ({}),
      }),
    }) as unknown as ExecutionContext;

  const makeUser = (role: Role) => new AuthenticatedUser('user-id', 'Test', null, role);

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const result = guard.canActivate(createContext(makeUser(Role.CLIENTE)));
    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const result = guard.canActivate(createContext(makeUser(Role.ADMIN)));
    expect(result).toBe(true);
  });

  it('should allow access when user has one of the required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN, Role.ATENDENTE]);

    const result = guard.canActivate(createContext(makeUser(Role.ATENDENTE)));
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when user lacks required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext(makeUser(Role.CLIENTE)))).toThrow(
      ForbiddenException,
    );
  });

  it('should throw ForbiddenException when user is not authenticated', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext(undefined))).toThrow(ForbiddenException);
  });
});
