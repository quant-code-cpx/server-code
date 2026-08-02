import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import { AgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentApiConfig } from 'src/config/agent-api.config'
import { AgentStreamConfig } from 'src/config/agent-stream.config'
import { AgentContextConfig } from 'src/config/agent-context.config'
import { ModelConfig } from 'src/config/model.config'
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
import { createSaveResearchReportToolDefinition } from './tools/adapters/save-research-report.tool'
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
import { STOCK_RESEARCH_WORKFLOW_DEFINITIONS } from './workflow/workflows/stock-research.v2'
import { AgentController } from './api/agent.controller'
import { AgentStrictBodyGuard } from './api/agent-strict-body.guard'
import { AgentErrorInterceptor } from './api/agent-error.interceptor'
import { AgentRestReadRepository } from './api/agent-rest-read.repository'
import { AgentConversationService } from './application/agent-conversation.service'
import { AgentRunService } from './application/agent-run.service'
import { AgentInteractionRepository } from './application/agent-interaction.repository'
import { AgentStreamController } from './api/agent-stream.controller'
import { AgentStreamMetricsService } from './streaming/agent-stream-metrics.service'
import { AgentStreamService } from './streaming/agent-stream.service'
import { ConversationSummaryRepository } from './memory/conversation-summary.repository'
import { UserMemoryRepository } from './memory/user-memory.repository'
import { ConversationSummaryService } from './memory/conversation-summary.service'
import { UserMemoryService } from './memory/user-memory.service'
import { AgentMemoryController } from './api/agent-memory.controller'
import { ContextBuilderService } from './memory/context-builder.service'
import { ContextTokenEstimator } from './memory/context-token-estimator'
import { ConversationSummaryGeneratorService } from './memory/conversation-summary-generator.service'
import { ResearchReportModule } from './research/research-report.module'
import { AgentObservabilityModule } from './observability/agent-observability.module'
import { AgentMetricsService } from './observability/agent-metrics.service'
import { AgentEvaluationService } from './observability/evaluation/agent-evaluation.service'
import { AgentEvaluationAdminController } from './api/agent-evaluation-admin.controller'
import { ModelProviderAdminController } from './api/model-provider-admin.controller'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { RetrievalModule } from './retrieval/retrieval.module'

@Module({
  imports: [
    ConfigModule.forFeature(AgentToolsConfig),
    ConfigModule.forFeature(AgentExecutionConfig),
    ConfigModule.forFeature(AgentApiConfig),
    ConfigModule.forFeature(AgentStreamConfig),
    ConfigModule.forFeature(AgentContextConfig),
    ConfigModule.forFeature(ModelConfig),
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
    ResearchReportModule,
    AgentObservabilityModule,
    RetrievalModule,
  ],
  controllers: [
    AgentController,
    AgentMemoryController,
    AgentStreamController,
    AgentEvaluationAdminController,
    ModelProviderAdminController,
  ],
  providers: [
    AgentConversationRepository,
    AgentMessageRepository,
    ConversationSummaryRepository,
    UserMemoryRepository,
    ConversationSummaryService,
    ConversationSummaryGeneratorService,
    UserMemoryService,
    ContextTokenEstimator,
    ContextBuilderService,
    AgentRestReadRepository,
    AgentInteractionRepository,
    AgentConversationService,
    AgentRunService,
    AgentStrictBodyGuard,
    AgentErrorInterceptor,
    RolesGuard,
    AgentStreamMetricsService,
    AgentStreamService,
    AgentEvaluationService,
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
    { provide: AGENT_WORKFLOW_DEFINITIONS, useValue: STOCK_RESEARCH_WORKFLOW_DEFINITIONS },
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
          createSaveResearchReportToolDefinition(),
        ]),
    },
    { provide: TOOL_EXECUTION_OBSERVER, useExisting: AgentMetricsService },
  ],
  exports: [
    ModelGatewayModule,
    AgentExecutionModule,
    AgentAuditModule,
    AgentConversationRepository,
    AgentMessageRepository,
    ConversationSummaryRepository,
    UserMemoryRepository,
    ConversationSummaryService,
    ConversationSummaryGeneratorService,
    UserMemoryService,
    ContextBuilderService,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
    WorkflowRegistryService,
    WorkflowEngineService,
    AgentOrchestratorService,
    AgentRunService,
    AgentStrictBodyGuard,
    AgentErrorInterceptor,
  ],
})
export class AgentModule {}
