import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import { AgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentApiConfig } from 'src/config/agent-api.config'
import { AgentQueueProducerModule } from 'src/queue/agent/agent-queue-producer.module'
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
import { ValuationToolFacade } from 'src/apps/stock/valuation-tool.facade'
import { PortfolioModule } from 'src/apps/portfolio/portfolio.module'
import { PortfolioToolFacade } from 'src/apps/portfolio/portfolio-tool.facade'
import { BacktestModule } from 'src/apps/backtest/backtest.module'
import { BacktestToolFacade } from 'src/apps/backtest/backtest-tool.facade'
import { WebFetchService } from 'src/apps/web-search/web-fetch.service'
import { WebSearchModule } from 'src/apps/web-search/web-search.module'
import { WebSearchService } from 'src/apps/web-search/web-search.service'
import { AgentAuditModule } from './audit/agent-audit.module'
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
import { createQuantToolDefinitions } from './tools/adapters/quant-tools'
import { createWebResearchToolDefinitions } from './tools/adapters/web-research-tools'
import { AgentOrchestratorService } from './orchestrator/agent-orchestrator.service'
import { CitationCoverageService } from './workflow/citation-coverage.service'
import { AuthorizeToolsNode } from './workflow/nodes/authorize-tools.node'
import { CompleteNode } from './workflow/nodes/complete.node'
import { ExecuteToolsNode } from './workflow/nodes/execute-tools.node'
import { LoadContextNode } from './workflow/nodes/load-context.node'
import { PersistNode } from './workflow/nodes/persist.node'
import { PlanNode } from './workflow/nodes/plan.node'
import { SynthesizeNode } from './workflow/nodes/synthesize.node'
import { ValidateCitationsNode } from './workflow/nodes/validate-citations.node'
import { ResearchPlanCompilerService } from './workflow/research-plan-compiler.service'
import { WorkflowBudgetService } from './workflow/workflow-budget.service'
import { WorkflowContextService } from './workflow/workflow-context.service'
import { WorkflowEngineService } from './workflow/workflow-engine.service'
import { WorkflowFinalizationService } from './workflow/workflow-finalization.service'
import { WorkflowModelService } from './workflow/workflow-model.service'
import { AGENT_WORKFLOW_DEFINITIONS, WorkflowRegistryService } from './workflow/workflow-registry.service'
import { WorkflowToolService } from './workflow/workflow-tool.service'
import { STOCK_RESEARCH_WORKFLOW_V1 } from './workflow/workflows/stock-research.v1'
import { AgentController } from './api/agent.controller'
import { AgentStrictBodyGuard } from './api/agent-strict-body.guard'
import { AgentErrorInterceptor } from './api/agent-error.interceptor'
import { AgentRestReadRepository } from './api/agent-rest-read.repository'
import { AgentConversationService } from './application/agent-conversation.service'
import { AgentRunService } from './application/agent-run.service'
import { AgentInteractionRepository } from './application/agent-interaction.repository'

@Module({
  imports: [
    ConfigModule.forFeature(AgentToolsConfig),
    ConfigModule.forFeature(AgentExecutionConfig),
    ConfigModule.forFeature(AgentApiConfig),
    AgentQueueProducerModule,
    ModelGatewayModule,
    AgentExecutionModule,
    AgentAuditModule,
    WebSearchModule,
    StockModule,
    MarketModule,
    IndustryModule,
    WatchlistModule,
    PortfolioModule,
    BacktestModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentConversationRepository,
    AgentMessageRepository,
    AgentRestReadRepository,
    AgentInteractionRepository,
    AgentConversationService,
    AgentRunService,
    AgentStrictBodyGuard,
    AgentErrorInterceptor,
    ToolSchemaValidator,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
    WorkflowRegistryService,
    WorkflowBudgetService,
    ResearchPlanCompilerService,
    WorkflowContextService,
    WorkflowModelService,
    WorkflowToolService,
    CitationCoverageService,
    WorkflowFinalizationService,
    LoadContextNode,
    PlanNode,
    AuthorizeToolsNode,
    ExecuteToolsNode,
    SynthesizeNode,
    ValidateCitationsNode,
    PersistNode,
    CompleteNode,
    WorkflowEngineService,
    AgentOrchestratorService,
    { provide: AGENT_WORKFLOW_DEFINITIONS, useValue: Object.freeze([STOCK_RESEARCH_WORKFLOW_V1]) },
    {
      provide: AGENT_TOOL_DEFINITIONS,
      inject: [
        StockToolFacade,
        MarketToolFacade,
        SectorToolFacade,
        WatchlistToolFacade,
        FinancialToolFacade,
        MoneyflowToolFacade,
        PortfolioToolFacade,
        BacktestToolFacade,
        ValuationToolFacade,
        WebSearchService,
        WebFetchService,
        AgentToolsConfig.KEY,
      ],
      useFactory: (
        stock: StockToolFacade,
        market: MarketToolFacade,
        sector: SectorToolFacade,
        watchlist: WatchlistToolFacade,
        financial: FinancialToolFacade,
        moneyflow: MoneyflowToolFacade,
        portfolio: PortfolioToolFacade,
        backtest: BacktestToolFacade,
        valuation: ValuationToolFacade,
        webSearch: WebSearchService,
        webFetch: WebFetchService,
        config: IAgentToolsConfig,
      ) =>
        Object.freeze([
          ...createStockMarketToolDefinitions({ stock, market, sector, watchlist, config }),
          ...createFinancialToolDefinitions({ financial, moneyflow, config }),
          ...createQuantToolDefinitions({ portfolio, backtest, valuation, config }),
          ...createWebResearchToolDefinitions({ search: webSearch, fetch: webFetch }),
        ]),
    },
    { provide: TOOL_EXECUTION_OBSERVER, useValue: Object.freeze({}) },
  ],
  exports: [
    ModelGatewayModule,
    AgentExecutionModule,
    AgentAuditModule,
    AgentConversationRepository,
    AgentMessageRepository,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
    WorkflowRegistryService,
    WorkflowEngineService,
    AgentOrchestratorService,
  ],
})
export class AgentModule {}
