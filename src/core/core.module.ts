import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainExceptionFilter } from './infrastructure/domain-exception.filter';

/**
 * Traducao `DomainError` -> HTTP registrada como APP_FILTER (DI-based), para
 * valer no bootstrap real e nos `Test.createTestingModule` dos servicos.
 */
@Global()
@Module({ providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }] })
export class CoreModule {}
