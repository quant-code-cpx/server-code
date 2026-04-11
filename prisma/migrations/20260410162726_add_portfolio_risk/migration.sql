-- CreateEnum
CREATE TYPE "PortfolioRiskRuleType" AS ENUM ('MAX_SINGLE_POSITION', 'MAX_INDUSTRY_WEIGHT', 'MAX_DRAWDOWN_STOP');

-- CreateTable
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "initialCash" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_holdings" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tsCode" VARCHAR(15) NOT NULL,
    "stockName" VARCHAR(60) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "avgCost" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_risk_rules" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "ruleType" "PortfolioRiskRuleType" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memo" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_risk_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_violation_logs" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleType" "PortfolioRiskRuleType" NOT NULL,
    "actualValue" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_violation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_holdings_portfolioId_idx" ON "portfolio_holdings"("portfolioId");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_holdings_portfolioId_tsCode_key" ON "portfolio_holdings"("portfolioId", "tsCode");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_risk_rules_portfolioId_ruleType_key" ON "portfolio_risk_rules"("portfolioId", "ruleType");

-- CreateIndex
CREATE INDEX "risk_violation_logs_portfolioId_checkedAt_idx" ON "risk_violation_logs"("portfolioId", "checkedAt");

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_risk_rules" ADD CONSTRAINT "portfolio_risk_rules_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_violation_logs" ADD CONSTRAINT "risk_violation_logs_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_violation_logs" ADD CONSTRAINT "risk_violation_logs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "portfolio_risk_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
