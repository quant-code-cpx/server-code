import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { CreateUserDto } from './dto/create-user.dto'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import * as bcrypt from 'bcrypt'

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { account: dto.account } })
    if (exists) throw new BusinessException(ErrorEnum.USER_ALREADY_EXISTS)

    const hashedPassword = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        account: dto.account,
        password: hashedPassword,
        nickname: dto.nickname,
      },
      select: { id: true, account: true, nickname: true, status: true, createdAt: true },
    })

    return user
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, account: true, nickname: true, status: true, createdAt: true },
    })
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, account: true, nickname: true, status: true, createdAt: true },
    })
    if (!user) throw new BusinessException(ErrorEnum.USER_NOT_FOUND)
    return user
  }

  async remove(id: number) {
    // 使用单次 update 避免 TOCTOU 竞态：先找到再更新改为原子操作
    const deleted = await this.prisma.user.updateMany({
      where: { id, status: { not: 'DELETED' } },
      data: { status: 'DELETED' },
    })
    if (deleted.count === 0) throw new BusinessException(ErrorEnum.USER_NOT_FOUND)
  }
}
