/**
 * Fail-fast no boot (`ConfigModule.forRoot({ validate })`): sem JWT_SECRET o
 * servico nao valida os tokens da Lambda nem emite o JWT de servico; sem
 * DATABASE_URL nao ha banco proprio; URLs internas, quando informadas, precisam ser http(s).
 */
const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRETS = new Set([
  'change-me-to-a-strong-random-secret',
  'changeme',
  'change-me',
  'secret',
]);
const SERVICE_URL_VARS = ['OS_SERVICE_URL', 'BILLING_SERVICE_URL', 'EXECUCAO_SERVICE_URL'];

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const secret = config.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length === 0)
    throw new Error('JWT_SECRET e obrigatorio.');
  if (PLACEHOLDER_SECRETS.has(secret))
    throw new Error('JWT_SECRET nao pode ser um placeholder (gere com `openssl rand -base64 48`).');
  if (config.NODE_ENV === 'production' && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET deve ter ao menos ${MIN_SECRET_LENGTH} caracteres em producao.`);
  }
  if (typeof config.DATABASE_URL !== 'string' || !config.DATABASE_URL.startsWith('postgres')) {
    throw new Error('DATABASE_URL e obrigatoria (banco proprio deste servico).');
  }
  for (const nome of SERVICE_URL_VARS) {
    const valor = config[nome];
    if (valor !== undefined && valor !== '' && !/^https?:\/\/.+/.test(String(valor))) {
      throw new Error(`${nome} deve ser uma URL http(s) (ex.: http://billing-service:3001).`);
    }
  }
  return config;
}
