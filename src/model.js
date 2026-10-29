// Modelo de domínio: o que existe numa plataforma de dados GCP.
// Nenhuma coordenada, cor ou detalhe de tela mora aqui.

export const PROJECT = { name: 'orders-platform', region: 'southamerica-east1' };

// rate = lotes por minuto de operação (1 s de simulação = 1 min)
export const SOURCES = [
  { id: 'pubsub',   name: 'orders-api → Pub/Sub',   short: 'orders-api', kind: 'API REST publicando eventos de pedido', via: 'Pub/Sub + Dataflow streaming',
    rate: 0.14, rows: [850000, 1200000], schema: 'v6', baseRps: 2400 },
  { id: 'cloudsql', name: 'Cloud SQL · ERP',         short: 'Cloud SQL',  kind: 'CDC das tabelas de estoque e preço', via: 'Datastream',
    rate: 0.12, rows: [250000, 400000], schema: 'v12', baseRps: 650 },
  { id: 'gcs',      name: 'GCS · arquivos de parceiros', short: 'GCS',    kind: 'Parquet de marketplaces, de hora em hora', via: 'Storage Transfer + Dataflow batch',
    rate: 0.07, rows: [1200000, 3500000], schema: 'v2' },
];

// dur = minutos de processamento por lote (antes do ajuste pelo tamanho)
export const LAYERS = [
  { id: 'raw',  name: 'Bronze', tool: 'Dataflow', dur: 1.6, table: 'raw.orders_events',       desc: 'Dataflow grava os eventos como chegam, particionados por dia. Nada é descartado aqui.' },
  { id: 'stg',  name: 'Silver', tool: 'dbt',      dur: 2.4, table: 'stg_orders',              desc: 'Modelo dbt que deduplica por event_id (o Pub/Sub entrega pelo menos uma vez), filtra pedidos de teste e tipa as colunas. Na saída, testes e contrato decidem quem segue.',
    dupRate: [0.004, 0.012], testRate: [0.012, 0.03] },
  { id: 'mart', name: 'Gold',   tool: 'dbt',      dur: 2.0, table: 'mart_daily_revenue',      desc: 'Modelos de negócio, particionados e clusterizados, que alimentam Looker, Vertex AI e a API.' },
];

export const CONSUMERS = [
  { id: 'looker', name: 'Looker',    desc: 'Dashboard executivo de receita. Cada atualização escaneia o mart no BigQuery.' },
  { id: 'vertex', name: 'Vertex AI', desc: 'Features para o modelo de previsão de demanda.' },
  { id: 'api',    name: 'API de consulta', desc: 'API de leitura de pedidos usada pelo app e por parceiros.' },
];

// Testes dbt na saída do staging. O primeiro é o que quebra no incidente.
export const TESTS = [
  { name: 'contract: amount NUMERIC',    rule: 'data_type: numeric (contrato do modelo stg_orders)' },
  { name: 'not_null(order_id)',          rule: 'order_id não pode ser nulo' },
  { name: 'accepted_range(amount ≥ 0)',  rule: 'valores negativos indicam estorno mal mapeado' },
  { name: 'source freshness',            rule: 'warn > 30 min, error > 60 min' },
];

// Preços ilustrativos, não são tabela oficial.
export const CONFIG = {
  workerHour: 0.95,      // US$/h por worker Dataflow
  scanPerTB: 6.25,       // US$/TiB escaneado no BigQuery on-demand
  bytesPerRow: 650,      // tamanho médio de um evento de pedido
  slotsReserved: 2000,   // reserva de slots do BigQuery
  rowsPerMinDay: 330000, // ritmo médio do dia, para os contadores "hoje"
  slaMin: 60,            // SLA ponta a ponta, em minutos
  minWorkers: 3,
  maxWorkers: 9,
  scaleUpBacklog: 6,     // fila total que dispara +1 worker
  scaleUpCooldown: 2.5,
  scaleDownAfter: 8,     // minutos com worker ocioso antes de desligar
};
