import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentRetrievalConfig, type IAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import { AGENT_EMBEDDING_PROVIDER } from './embedding.provider'
import { FtsRetrievalService } from './fts-retrieval.service'
import { HybridRetrievalService } from './hybrid-retrieval.service'
import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding.provider'
import { PgvectorRetrievalService } from './pgvector-retrieval.service'
import { AGENT_RETRIEVAL } from './retrieval.port'

@Module({
  imports: [ConfigModule.forFeature(AgentRetrievalConfig)],
  providers: [
    FtsRetrievalService,
    PgvectorRetrievalService,
    HybridRetrievalService,
    OpenAiCompatibleEmbeddingProvider,
    { provide: AGENT_EMBEDDING_PROVIDER, useExisting: OpenAiCompatibleEmbeddingProvider },
    {
      provide: AGENT_RETRIEVAL,
      inject: [AgentRetrievalConfig.KEY, FtsRetrievalService, HybridRetrievalService],
      useFactory: (config: IAgentRetrievalConfig, fts: FtsRetrievalService, hybrid: HybridRetrievalService) =>
        config.mode === 'hybrid' ? hybrid : fts,
    },
  ],
  exports: [AGENT_RETRIEVAL, FtsRetrievalService],
})
export class RetrievalModule {}
