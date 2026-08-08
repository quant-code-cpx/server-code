export const NEWS_INGESTION_QUEUE = 'news-ingestion'
export const NEWS_INGESTION_JOB = 'ingest-news-feed'

export interface NewsIngestionJob {
  schemaVersion: 1
  runId: string
}
