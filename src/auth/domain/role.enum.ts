export enum Role {
  ADMIN = 'ADMIN',
  ATENDENTE = 'ATENDENTE',
  MECANICO = 'MECANICO',
  ESTOQUISTA = 'ESTOQUISTA',
  CLIENTE = 'CLIENTE',
  /**
   * Chamadas entre servicos (Fase 4, comunicacao HTTP interna): JWT emitido
   * localmente por cada servico com `sub` = nome do servico (`os-service`,
   * `billing-service`, `execucao-service`) e o mesmo `JWT_SECRET` da Lambda.
   * Endpoints internos e callbacks aceitam so esta role.
   */
  SERVICO = 'SERVICO',
}
