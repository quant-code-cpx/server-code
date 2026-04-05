import { Module } from '@nestjs/common'
import { HeatmapController } from './heatmap.controller'
import { HeatmapService } from './heatmap.service'
import { HeatmapSnapshotService } from './heatmap-snapshot.service'

@Module({
  controllers: [HeatmapController],
  providers: [HeatmapService, HeatmapSnapshotService],
  exports: [HeatmapService, HeatmapSnapshotService],
})
export class HeatmapModule {}
