import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import { StockModule } from 'src/apps/stock/stock.module'
import { MarketModule } from 'src/apps/market/market.module'
import { IndustryModule } from 'src/apps/industry/industry.module'
import { WatchlistModule } from 'src/apps/watchlist/watchlist.module'
import { StockToolFacade } from 'src/apps/stock/stock-tool.facade'
import { MarketToolFacade } from 'src/apps/market/market-tool.facade'
import { SectorToolFacade } from 'src/apps/industry/sector-tool.facade'
import { WatchlistToolFacade } from 'src/apps/watchlist/watchlist-tool.facade'
import { FinancialToolFacade } from 'src/apps/stock/financial-tool.facade'
import { MoneyflowToolFacade } from 'src/apps/stock/moneyflow-tool.facade'
import { AgentAuditRepository } from './audit/agent-audit.repository'
import { CitationRepository } from './audit/citation.repository'
import { AgentConversationRepository } from './conversation/agent-conversation.repository'
import { AgentMessageRepository } from './conversation/agent-message.repository'
import { AgentExecutionModule } from './execution/agent-execution.module'
import { ModelGatewayModule } from './model-gateway/model-gateway.module'
import { AGENT_TOOL_DEFINITIONS, ToolRegistryService } from './tools/tool-registry.service'
import { TOOL_EXECUTION_OBSERVER } from './tools/contracts/tool-observer'
import { ToolExecutorService } from './tools/tool-executor.service'
import { ToolPolicyService } from './tools/tool-policy.service'
import { ToolRunLimiterService } from './tools/tool-run-limiter.service'
import { ToolSchemaValidator } from './tools/tool-schema-validator'
import { createStockMarketToolDefinitions } from './tools/adapters/stock-market-tools'
import { createFinancialToolDefinitions } from './tools/adapters/financial-tools'

@Module({
  imports: [
    ConfigModule.forFeature(AgentToolsConfig),
    ModelGatewayModule,
    AgentExecutionModule,
    StockModule,
    MarketModule,
    IndustryModule,
    WatchlistModule,
  ],
  providers: [
    AgentConversationRepository,
    AgentMessageRepository,
    AgentAuditRepository,
    CitationRepository,
    ToolSchemaValidator,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
    {
      provide: AGENT_TOOL_DEFINITIONS,
      inject: [
        StockToolFacade,
        MarketToolFacade,
        SectorToolFacade,
        WatchlistToolFacade,
        FinancialToolFacade,
        MoneyflowToolFacade,
        AgentToolsConfig.KEY,
      ],
      useFactory: (
        stock: StockToolFacade,
        market: MarketToolFacade,
        sector: SectorToolFacade,
        watchlist: WatchlistToolFacade,
        financial: FinancialToolFacade,
        moneyflow: MoneyflowToolFacade,
        config: IAgentToolsConfig,
      ) =>
        Object.freeze([
          ...createStockMarketToolDefinitions({ stock, market, sector, watchlist, config }),
          ...createFinancialToolDefinitions({ financial, moneyflow, config }),
        ]),
    },
    { provide: TOOL_EXECUTION_OBSERVER, useValue: Object.freeze({}) },
  ],
  exports: [
    ModelGatewayModule,
    AgentExecutionModule,
    AgentConversationRepository,
    AgentMessageRepository,
    AgentAuditRepository,
    CitationRepository,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
  ],
})
export class AgentModule {}
