import { Injectable, NotFoundException } from '@nestjs/common'
import { FactorLibraryQueryDto, FactorDetailQueryDto } from './dto/factor-library.dto'
import { FactorValuesQueryDto } from './dto/factor-values.dto'
import { FactorLibraryService } from './services/factor-library.service'
import { FactorComputeService } from './services/factor-compute.service'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class FactorService {
  constructor(
    private readonly library: FactorLibraryService,
    private readonly compute: FactorComputeService,
    private readonly prisma: PrismaService,
  ) {}

  getLibrary(dto: FactorLibraryQueryDto) {
    return this.library.getLibrary(dto)
  }

  getDetail(dto: FactorDetailQueryDto) {
    return this.library.getDetail(dto)
  }

  async getFactorValues(dto: FactorValuesQueryDto) {
    const factor = await this.prisma.factorDefinition.findUnique({
      where: { name: dto.factorName },
    })

    if (!factor) {
      throw new NotFoundException(`因子 "${dto.factorName}" 不存在`)
    }

    if (!factor.isEnabled) {
      throw new NotFoundException(`因子 "${dto.factorName}" 已禁用`)
    }

    return this.compute.getFactorValues(dto, factor.sourceType, factor.name)
  }
}
