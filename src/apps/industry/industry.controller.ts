import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { IndustryDictService } from './industry-dict.service'
import { IndustryDictMappingQueryDto } from './dto/industry-dict-query.dto'
import { IndustryDictMappingResponseDto } from './dto/industry-dict-response.dto'

@ApiTags('行业字典')
@Controller('industry')
export class IndustryController {
  constructor(private readonly industryDictService: IndustryDictService) {}

  @Post('dict-mapping')
  @ApiOperation({ summary: '行业字典映射（申万 L1 → 东财行业板块）' })
  @ApiSuccessResponse(IndustryDictMappingResponseDto)
  getDictMapping(@Body() query: IndustryDictMappingQueryDto) {
    return this.industryDictService.getDictMapping(query)
  }
}
