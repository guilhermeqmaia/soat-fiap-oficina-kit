process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'kit-test-secret-0123456789abcdef';
import { Logger } from '@nestjs/common';
Logger.overrideLogger(false);
