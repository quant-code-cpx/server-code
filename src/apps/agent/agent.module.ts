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
import { StockTechnicalToolFacade } from 'src/apps/stock/stock-technical-tool.facade'
import { MarketToolFacade } from 'src/apps/market/market-tool.facade'
import { SectorToolFacade } from 'src/apps/industry/sector-tool.facade'
import { WatchlistToolFacade } from 'src/apps/watchlist/watchlist-tool.facade'
import { FinancialToolFacade } from 'src/apps/stock/financial-tool.facade'
import { MoneyflowToolFacade } from 'src/apps/stock/moneyflow-tool.facade'
import { ValuationToolFacade } from 'src/apps/stock/valuation-tool.facade'
import { PortfolioModule } from 'src/apps/portfolio/portfolio.module'
import { PortfolioToolFacade } from 'src/apps/portfolio/portfolio-tool.facade'
import { PortfolioAnalyticsToolFacade } from 'src/apps/portfolio/portfolio-analytics-tool.facade'
import { BacktestModule } from 'src/apps/backtest/backtest.module'
import { BacktestToolFacade } from 'src/apps/backtest/backtest-tool.facade'
import { BacktestAnalyticsToolFacade } from 'src/apps/backtest/backtest-analytics-tool.facade'
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
import { SelectToolsNode } from './workflow/nodes/select-tools.node'
import { SynthesizeNode } from './workflow/nodes/synthesize.node'
import { ValidateCitationsNode } from './workflow/nodes/validate-citations.node'
import { ResearchPlanCompilerService } from './workflow/research-plan-compiler.service'
import { WorkflowBudgetService } from './workflow/workflow-budget.service'
import { WorkflowContextService } from './workflow/workflow-context.service'
import { WorkflowEngineService } from './workflow/workflow-engine.service'
import { WorkflowFinalizationService } from './workflow/workflow-finalization.service'
import { WorkflowModelService } from './workflow/workflow-model.service'
import { ModelContextBudgetService } from './workflow/model-context-budget.service'
import { AGENT_WORKFLOW_DEFINITIONS, WorkflowRegistryService } from './workflow/workflow-registry.service'
import { WorkflowToolService } from './workflow/workflow-tool.service'
import { STOCK_RESEARCH_WORKFLOW_DEFINITIONS } from './workflow/workflows/stock-research.v10'
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
import { ConversationContextCompatibilityService } from './memory/conversation-context-compatibility.service'
import { ResearchReportModule } from './research/research-report.module'
import { AgentObservabilityModule } from './observability/agent-observability.module'
import { AgentMetricsService } from './observability/agent-metrics.service'
import { AgentEvaluationService } from './observability/evaluation/agent-evaluation.service'
import { AgentEvaluationAdminController } from './api/agent-evaluation-admin.controller'
import { ModelProviderAdminController } from './api/model-provider-admin.controller'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { RetrievalModule } from './retrieval/retrieval.module'
import { TechnicalSignalModule } from 'src/apps/technical-signal/technical-signal.module'
import { TechnicalSignalToolFacade } from 'src/apps/technical-signal/technical-signal-tool.facade'
import { DataAvailabilityModule } from 'src/apps/data-availability/data-availability.module'
import { DataAvailabilityToolFacade } from 'src/apps/data-availability/data-availability-tool.facade'
import { createTechnicalAnalysisToolDefinitions } from './tools/adapters/technical-analysis-tools'
import { createDataAvailabilityToolDefinitions } from './tools/adapters/data-availability-tools'
import { StockDeepResearchModule } from 'src/apps/stock-deep-research/stock-deep-research.module'
import { StockChipToolFacade } from 'src/apps/stock-deep-research/chip/stock-chip-tool.facade'
import { StockMarginToolFacade } from 'src/apps/stock-deep-research/margin/stock-margin-tool.facade'
import { RelativeStrengthToolFacade } from 'src/apps/stock-deep-research/relative-strength/relative-strength-tool.facade'
import { StockEventToolFacade } from 'src/apps/stock-deep-research/events/stock-event-tool.facade'
import { StockShareholderToolFacade } from 'src/apps/stock-deep-research/shareholders/stock-shareholder-tool.facade'
import { createStockDeepResearchToolDefinitions } from './tools/adapters/stock-deep-research-tools'
import { ToolCapabilityCatalogService } from './tools/tool-capability-catalog.service'
import { IndexModule } from 'src/apps/index/index.module'
import { IndexResearchToolFacade } from 'src/apps/index/index-research-tool.facade'
import { FundModule } from 'src/apps/fund/fund.module'
import { FundResearchToolFacade } from 'src/apps/fund/fund-research-tool.facade'
import { IndustryRotationModule } from 'src/apps/industry-rotation/industry-rotation.module'
import { IndustryRotationToolFacade } from 'src/apps/industry-rotation/industry-rotation-tool.facade'
import { FactorModule } from 'src/apps/factor/factor.module'
import { FactorAnalysisToolFacade } from 'src/apps/factor/factor-analysis-tool.facade'
import { MacroResearchModule } from 'src/apps/macro-research/macro-research.module'
import { MacroResearchToolFacade } from 'src/apps/macro-research/macro-research-tool.facade'
import { createMarketMultiAssetToolDefinitions } from './tools/adapters/market-multi-asset-tools'
import { OptionMarketModule } from 'src/apps/option-market/option-market.module'
import { OptionMarketToolFacade } from 'src/apps/option-market/option-market-tool.facade'
import { ConvertibleBondModule } from 'src/apps/convertible-bond/convertible-bond.module'
import { ConvertibleBondToolFacade } from 'src/apps/convertible-bond/convertible-bond-tool.facade'
import { EventStudyModule } from 'src/apps/event-study/event-study.module'
import { EventStudyToolFacade } from 'src/apps/event-study/event-study-tool.facade'
import { createDerivativeEventToolDefinitions } from './tools/adapters/derivative-event-tools'
import { createPrivateAnalyticsToolDefinitions } from './tools/adapters/private-analytics-tools'

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
    TechnicalSignalModule,
    DataAvailabilityModule,
    StockDeepResearchModule,
    IndexModule,
    FundModule,
    IndustryRotationModule,
    FactorModule,
    MacroResearchModule,
    OptionMarketModule,
    ConvertibleBondModule,
    EventStudyModule,
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
    ConversationContextCompatibilityService,
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
    ToolCapabilityCatalogService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
    WorkflowRegistryService,
    WorkflowBudgetService,
    ResearchPlanCompilerService,
    WorkflowContextService,
    WorkflowModelService,
    ModelContextBudgetService,
    WorkflowToolService,
    CitationCoverageService,
    WorkflowFinalizationService,
    LoadContextNode,
    SelectToolsNode,
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
        StockTechnicalToolFacade,
        TechnicalSignalToolFacade,
        DataAvailabilityToolFacade,
        StockChipToolFacade,
        StockMarginToolFacade,
        RelativeStrengthToolFacade,
        StockEventToolFacade,
        StockShareholderToolFacade,
        IndexResearchToolFacade,
        FundResearchToolFacade,
        IndustryRotationToolFacade,
        FactorAnalysisToolFacade,
        MacroResearchToolFacade,
        OptionMarketToolFacade,
        ConvertibleBondToolFacade,
        EventStudyToolFacade,
        BacktestAnalyticsToolFacade,
        PortfolioAnalyticsToolFacade,
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
        stockTechnical: StockTechnicalToolFacade,
        technicalSignal: TechnicalSignalToolFacade,
        dataAvailability: DataAvailabilityToolFacade,
        chip: StockChipToolFacade,
        marginDeepResearch: StockMarginToolFacade,
        relativeStrength: RelativeStrengthToolFacade,
        events: StockEventToolFacade,
        shareholders: StockShareholderToolFacade,
        indexResearch: IndexResearchToolFacade,
        fundResearch: FundResearchToolFacade,
        industryRotation: IndustryRotationToolFacade,
        factorAnalysis: FactorAnalysisToolFacade,
        macroResearch: MacroResearchToolFacade,
        optionMarket: OptionMarketToolFacade,
        convertibleBond: ConvertibleBondToolFacade,
        eventStudy: EventStudyToolFacade,
        backtestAnalytics: BacktestAnalyticsToolFacade,
        portfolioAnalytics: PortfolioAnalyticsToolFacade,
      ) =>
        Object.freeze([
          ...createStockMarketToolDefinitions({ stock, market, sector, watchlist, config }),
          ...createFinancialToolDefinitions({ financial, moneyflow, config }),
          ...createQuantToolDefinitions({ portfolio, backtest, valuation, config }),
          ...createWebResearchToolDefinitions({ search: webSearch, fetch: webFetch }),
          createSaveResearchReportToolDefinition(),
          ...createTechnicalAnalysisToolDefinitions({ stockTechnical, technicalSignal }),
          ...createDataAvailabilityToolDefinitions(dataAvailability),
          ...createStockDeepResearchToolDefinitions({
            chip,
            margin: marginDeepResearch,
            relativeStrength,
            events,
            shareholders,
          }),
          ...createMarketMultiAssetToolDefinitions({
            index: indexResearch,
            fund: fundResearch,
            industry: industryRotation,
            factor: factorAnalysis,
            macro: macroResearch,
          }),
          ...createDerivativeEventToolDefinitions({
            option: optionMarket,
            convertibleBond,
            eventStudy,
          }),
          ...createPrivateAnalyticsToolDefinitions({
            backtest: backtestAnalytics,
            portfolio: portfolioAnalytics,
          }),
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
