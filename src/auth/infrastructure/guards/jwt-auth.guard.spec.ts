import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  const createContext = (): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({}),
      }),
    }) as unknown as ExecutionContext;

  it('should short-circuit and allow access when route is marked @Public', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const result = guard.canActivate(createContext());
    expect(result).toBe(true);
  });

  it('should delegate to AuthGuard when route is not public', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    // We spy on the parent AuthGuard's canActivate to avoid invoking Passport.
    const parentSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true as unknown as boolean);

    const result = guard.canActivate(createContext());
    expect(parentSpy).toHaveBeenCalled();
    expect(result).toBe(true);
    parentSpy.mockRestore();
  });
});
