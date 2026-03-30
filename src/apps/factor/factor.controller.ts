import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { FactorService } from './factor.service'
import { FactorDetailQueryDto, FactorLibraryQueryDto } from './dto/factor-library.dto'
import { FactorValuesQueryDto } from './dto/factor-values.dto'

@ApiTags('Factor - 因子市场')
@UseGuards(JwtAuthGuard)
@Controller('factor')
export class FactorController {
  constructor(private readonly factorService: FactorService) {}

  @Post('library')
  @ApiOperation({ summary: '因子库列表（按分类分组）' })
  getLibrary(@Body() dto: FactorLibraryQueryDto) {
    return this.factorService.getLibrary(dto)
  }

  @Post('detail')
  @ApiOperation({ summary: '因子详情' })
  getDetail(@Body() dto: FactorDetailQueryDto) {
    return this.factorService.getDetail(dto)
  }

  @Post('values')
  @ApiOperation({ summary: '因子截面值查询（指定因子在指定交易日的全市场值）' })
  getFactorValues(@Body() dto: FactorValuesQueryDto) {
    return this.factorService.getFactorValues(dto)
  }
}
